import AppKit
import WebKit
import Foundation

struct HostConfiguration: Decodable {
    let projectDirectory: String
    let nodePath: String
    let stateDirectory: String
    let origin: String
    let initialPath: String
    let executableSearchPath: String
}

@MainActor
final class PersonalAgentHost: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private var configuration: HostConfiguration!
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusItem: NSStatusItem!
    private var statusLabel: NSTextField!
    private var process: Process?
    private var logHandle: FileHandle?
    private var attempts = 0
    private var quitting = false
    private var monitor: Timer?
    private var loaded = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            guard let file = Bundle.main.url(forResource: "host-configuration", withExtension: "json") else { throw CocoaError(.fileNoSuchFile) }
            configuration = try JSONDecoder().decode(HostConfiguration.self, from: Data(contentsOf: file))
            guard let origin = URL(string: configuration.origin), origin.scheme == "http", origin.host == "127.0.0.1", origin.port != nil,
                  configuration.initialPath.hasPrefix("/"), !configuration.initialPath.hasPrefix("//") else { throw CocoaError(.fileReadCorruptFile) }
        } catch { showError("无法读取本机启动配置。请在源码目录重新构建应用。", detail: error.localizedDescription); NSApp.terminate(nil); return }
        createWindow()
        createMenus()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        Task { await connect() }
        monitor = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, !self.quitting else { return }
                if await self.healthy() { self.statusLabel.stringValue = "后台服务运行中 · 关闭窗口后继续工作" }
                else { self.statusLabel.stringValue = "服务连接中断 · 检查网络或重新启动" }
            }
        }
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(didWake), name: NSWorkspace.didWakeNotification, object: nil)
    }

    private func createWindow() {
        let content = NSView()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 850), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "个人助理"
        window.minSize = NSSize(width: 390, height: 560)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentView = content
        window.center()
        let webConfiguration = WKWebViewConfiguration()
        webConfiguration.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: webConfiguration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        statusLabel = NSTextField(labelWithString: "正在连接本机后台服务…")
        statusLabel.font = NSFont.systemFont(ofSize: 10)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(webView)
        content.addSubview(statusLabel)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: content.topAnchor), webView.leadingAnchor.constraint(equalTo: content.leadingAnchor), webView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: statusLabel.topAnchor, constant: -5), statusLabel.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 12),
            statusLabel.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -12), statusLabel.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -5)
        ])
    }
    private func item(_ title: String, _ action: Selector, _ key: String = "") -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        return item
    }
    private func createMenus() {
        let appMenu = NSMenu()
        appMenu.addItem(item("显示个人助理", #selector(showWindow)))
        appMenu.addItem(item("在浏览器中打开", #selector(openBrowser)))
        appMenu.addItem(item("重新连接", #selector(reconnect), "r"))
        appMenu.addItem(item("查看运行日志", #selector(openLogs)))
        appMenu.addItem(.separator())
        appMenu.addItem(item("关闭窗口（继续后台工作）", #selector(closeWindow), "w"))
        appMenu.addItem(item("退出个人助理", #selector(quit), "q"))
        let bar = NSMenu()
        let app = NSMenuItem(); app.submenu = appMenu; bar.addItem(app)
        let edit = NSMenuItem(title: "编辑", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "编辑")
        for (title, selector, key) in [("撤销", "undo:", "z"), ("重做", "redo:", "Z"), ("剪切", "cut:", "x"), ("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] {
            editMenu.addItem(NSMenuItem(title: title, action: Selector(selector), keyEquivalent: key))
        }
        edit.submenu = editMenu; bar.addItem(edit)
        NSApp.mainMenu = bar
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = NSImage(systemSymbolName: "sparkle", accessibilityDescription: "个人助理")
        let tray = appMenu.copy() as! NSMenu
        statusItem.menu = tray
    }
    private func healthy() async -> Bool {
        guard let url = URL(string: configuration.origin + "/health") else { return false }
        var request = URLRequest(url: url); request.timeoutInterval = 2
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let value = try JSONSerialization.jsonObject(with: data) as? [String: String], value["status"] == "ok" else { return false }
            // Do not embed an unrelated process that happened to occupy the configured port.
            let (privacy, privacyResponse) = try await URLSession.shared.data(for: URLRequest(url: URL(string: configuration.origin + "/api/privacy-policy")!, timeoutInterval: 2))
            return (privacyResponse as? HTTPURLResponse)?.statusCode == 200 && String(data: privacy, encoding: .utf8)?.contains("standalone") == true
        } catch { return false }
    }
    private func connect() async {
        guard !quitting else { return }
        if await healthy() { loadWorkspace(); return }
        if process == nil {
            do { try launchService() }
            catch { statusLabel.stringValue = "启动失败 · 可从菜单查看日志"; showError("无法启动后台服务", detail: error.localizedDescription); return }
        }
        for _ in 0..<45 {
            if quitting { return }
            if await healthy() { loadWorkspace(); return }
            try? await Task.sleep(for: .seconds(1))
        }
        statusLabel.stringValue = "服务尚未就绪 · 请查看日志后重新连接"
    }
    private func launchService() throws {
        let root = URL(fileURLWithPath: configuration.projectDirectory)
        let node = URL(fileURLWithPath: configuration.nodePath)
        guard FileManager.default.isExecutableFile(atPath: node.path), FileManager.default.fileExists(atPath: root.appendingPathComponent("packages/server/src/standalone.ts").path) else { throw CocoaError(.fileNoSuchFile) }
        let state = URL(fileURLWithPath: configuration.stateDirectory)
        try FileManager.default.createDirectory(at: state, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let log = state.appendingPathComponent("mac-host.log")
        if !FileManager.default.fileExists(atPath: log.path) { FileManager.default.createFile(atPath: log.path, contents: nil, attributes: [.posixPermissions: 0o600]) }
        logHandle = try FileHandle(forWritingTo: log); try logHandle?.seekToEnd()
        let child = Process()
        child.executableURL = node
        child.arguments = ["--import", "@oxc-node/core/register", "src/standalone.ts"]
        child.currentDirectoryURL = root.appendingPathComponent("packages/server")
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = configuration.executableSearchPath
        environment["RAFT_STANDALONE_DIR"] = configuration.stateDirectory
        environment["RAFT_STANDALONE_PORT"] = String(URL(string: configuration.origin)!.port!)
        child.environment = environment
        child.standardOutput = logHandle; child.standardError = logHandle
        child.terminationHandler = { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.process = nil
                if self.quitting { NSApp.reply(toApplicationShouldTerminate: true); return }
                // Keep the renderer mounted so a backend restart does not discard unsent input.
                self.statusLabel.stringValue = "后台服务已退出"
                guard self.attempts < 3 else { return }
                self.attempts += 1
                try? await Task.sleep(for: .seconds(self.attempts * 2))
                await self.connect()
            }
        }
        try child.run(); process = child
        statusLabel.stringValue = "本机后台服务启动中…"
    }
    private func loadWorkspace() {
        statusLabel.stringValue = process == nil ? "已连接现有后台服务 · 退出应用不会停止该服务" : "后台服务运行中 · 关闭窗口后继续工作"
        if !loaded {
            loaded = true
            webView.load(URLRequest(url: URL(string: configuration.origin + configuration.initialPath)!))
        }
    }
    @objc private func didWake() { Task { await connect() } }
    @objc private func showWindow() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    @objc private func closeWindow() { window.close() }
    @objc private func openBrowser() { NSWorkspace.shared.open(URL(string: configuration.origin + configuration.initialPath)!) }
    @objc private func openLogs() { NSWorkspace.shared.selectFile(URL(fileURLWithPath: configuration.stateDirectory).appendingPathComponent("mac-host.log").path, inFileViewerRootedAtPath: configuration.stateDirectory) }
    @objc private func reconnect() { loaded = false; Task { await connect() } }
    @objc private func quit() { NSApp.terminate(nil) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showWindow(); return true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let child = process, child.isRunning else { return .terminateNow }
        if quitting { return .terminateLater }
        quitting = true; monitor?.invalidate(); child.terminate()
        Task {
            try? await Task.sleep(for: .seconds(20))
            if self.process?.isRunning == true {
                self.quitting = false
                NSApp.reply(toApplicationShouldTerminate: false)
                self.showError("后台任务仍在退出", detail: "请查看运行日志，稍后再次退出。应用保留运行，以免遗留执行进程。")
            }
        }
        return .terminateLater
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.absoluteString == "about:blank" { decisionHandler(.allow); return }
        if url.scheme == "blob", webView.url?.host == "127.0.0.1" { decisionHandler(.download); return }
        if action.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
        if let origin = URL(string: configuration.origin), url.scheme == origin.scheme, url.host == origin.host, url.port == origin.port { decisionHandler(.allow); return }
        if ["https", "http", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith config: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, ["https", "http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        return nil
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = parameters.allowsMultipleSelection; panel.canChooseDirectories = parameters.allowsDirectories
        panel.beginSheetModal(for: window) { response in completionHandler(response == .OK ? panel.urls : nil) }
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel(); panel.nameFieldStringValue = suggestedFilename
        panel.beginSheetModal(for: window) { response in completionHandler(response == .OK ? panel.url : nil) }
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) { showError("文件下载失败", detail: error.localizedDescription) }
    private func showError(_ title: String, detail: String) { let alert = NSAlert(); alert.messageText = title; alert.informativeText = detail; alert.runModal() }
}
MainActor.assumeIsolated {
    let application = NSApplication.shared
    let delegate = PersonalAgentHost()
    application.delegate = delegate
    application.setActivationPolicy(.regular)
    application.run()
}
