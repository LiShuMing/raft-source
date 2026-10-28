# GPUI Kit 复用评估

本地目录：`/Users/shuming.lsm/work/gpui-kit`；固定 revision：`611b55e331170ca375214d580b6c5409db858f83`，crate version 0.8.1。已阅读该仓库 AGENTS.md、Design Guides、Coding Guides、kit manifest、WebView 文档和示例。本轮不修改该仓库。

## 1. 判断

可以作为 Mac 原生客户端的框架候选，建议先做一个有真实 API 的对话切片再决定整体迁移。现有 Raft 客户端是 React / DOM；GPUI Kit 是 Rust 原生 UI，组件不能直接混用。WebAssembly 支持也不自动证明 iOS/Android 产品可交付。

| 能力 | 源码依据（相对于 gpui-kit 根目录） | 与个人 Agent 产品的关系 |
| --- | --- | --- |
| 统一依赖与初始化 | `crates/kit/Cargo.toml`、`crates/kit/src/lib.rs` | 固定匹配的 GPUI snapshot，`gpui_kit::init` / `open_window` |
| 输入、焦点、弹窗、虚拟列表 | `crates/base`、`crates/component` | 适合长对话、列表和配置表单 |
| Markdown / 流式文本 | `examples/markdown`、`examples/stream-markdown` | 可用于正文；需测代码块、表格、选择与复制 |
| 可调面板、Dock | `crates/base/src/dock` | 用于对话与成果详情；不必默认暴露完整 IDE 布局 |
| 语音输入 feature | `crates/kit/Cargo.toml` 的 speech | 是输入基础，不能等同于实时语音 Agent |
| WebView | `crates/webview/README.md`、`examples/webview/src/main.rs` | 可临时复用页面，混合窗口有组合层限制 |
| JavaScript 扩展 | `crates/shell` | 是应用扩展环境，不是兼容 Node daemon 的执行容器 |

GPUI Kit 的组件为 Apache-2.0；其文档有单独 LICENSE-DOCS.md。复用代码时保留许可证与通知，整体发行仍需看 Raft 的独立许可条件。

## 2. 三条可选路径

| 路径 | 优势 | 代价 / 风险 | 选择 |
| --- | --- | --- | --- |
| 先改现有 React | 最快验证真实任务；协议、设置和文件能力都可复用 | 暂时不是原生 Mac 交付 | 本轮采用 |
| GPUI Kit + 局部 WebView | 原生外壳，配置等复杂页面可延后迁移 | 焦点、IME、弹层、桥接、登录态与导航需专门验证 | M1 技术试验候选 |
| 全 GPUI Kit UI | 原生布局与应用生命周期更统一 | 重写消息、富文本、预览、设置、实时数据与无障碍 | 通过试验后分阶段决定 |

重要实证：当前 WebView 文档明确标为 experimental。默认 gpui-pre 下原生 WebView 会覆盖 GPUI 弹层且部分裁切不可用；macOS 要组合层叠加须同时启用 kit 和 webview 的 `gpui-fast`。Windows 叠加仍有限制，Linux 只支持 X11/XWayland，不能把“有 WebView”解释成跨端体验已经解决。

## 3. 推荐架构

Mac host 管理窗口、菜单、系统通知、Keychain、权限提示和本地服务进程。业务仍由现有 Node server/daemon 承担，Rust 不重新实现 agent loop。只依赖 `gpui-kit` umbrella crate，不直接追逐不同版本 GPUI；WebView 单独依赖。

以 feature 组织 `conversation`、`personal_home`、`connections` 等模块，业务模型与 UI 解耦；不修改 gpui-base。使用语义化主题、键盘路径、明确 Focus、loading/offline/error 状态，不按网页仪表盘思路堆卡片。

服务端绑定 loopback、使用现有鉴权。原生 host 不能仅凭 Origin 信任页面，也不向任意 URL 注入桥接能力；桥接限制导航来源、方法与对象范围，token 不能放在 URL。现有 desktop-contract 可提供契约参考，不能假设任意 WebView 已满足原生 handshake。

## 4. 可执行试验与退出标准

在独立应用目录创建试验，固定本地 revision；准备 Rust stable 和 Xcode 工具链。当前终端未发现 `cargo` / `rustc`，因此本轮没有 GPUI 编译、安装或性能结论，也未为评估擅自安装工具链。

试验只需：一个窗口、Agent 列表、一个真实 DM 的发送/流式读取、中文 IME、取消、断线重连；需要 WebView 时仅用于 provider settings。通过后再扩展。

| 检查 | 成功标准 |
| --- | --- |
| 文本 | 中文 IME、长文本选择、代码复制、键盘导航无阻塞 |
| 数据 | 与 Web 显示同一个消息 ID；断线补读不重发 |
| WebView | 弹窗、文件选择、焦点切换、登录重启恢复可用 |
| 生命周期 | 关闭窗口与退出后台的语义清晰；无孤儿子进程 |
| 体感 | 同机同负载测启动、内存、滚动；不引用框架宣传帧率代替测量 |

若 WebView 组合/桥接不稳定，先保留 Web 完成 M1；若原生文本和恢复切片通过，再将首页、对话和待处理逐步原生化。无需为了采用框架而暂停产品闭环。

## 2026-10-28 实现时复核

本地 kit HEAD 仍是 `611b55e331170ca375214d580b6c5409db858f83`。当前通过 `~/.cargo/bin/rustc` 可找到 Rust 1.99.1，前文“终端未发现工具链”是上一轮评估时的环境快照，不能继续作为无法开发的理由。本分支优先复用现有 React 业务与 API，补上 AppKit / WKWebView 开发入口；这不构成 GPUI 原生界面或性能验收。GPUI 迁移仍应按上述独立切片验证，不在本分支另写一套业务状态和 Agent 调度。
