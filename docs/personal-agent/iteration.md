# 第一轮实现与验证记录

开始于 2026-10-26，验收于 2026-10-27（Asia/Shanghai）。基线 `1147a42b17831878cf9c1c6a65c31d1666fc033f`，开发分支 `codex/personal-agent-foundation`。未提交或推送。

## 1. 本轮交付

产品方案先于代码落盘；研究、源码和 GPUI 评估从 [索引](README.md) 阅读。

新增 `/s/:serverSlug/personal`，置于原有鉴权与 MainLayout 实时生命周期内。桌面侧栏增加个人助理入口，页面包括目标输入、助理选择、执行位置、可编辑示例、已有对话与设备/API 配置入口。中英文文案进入现有语言目录。

发送复用 `openDM` 和 `/v2/messages`，并设置 `asTask`。同一内容和助理的失败重试复用 `randomId`；防止重复点击；空间、账号或页面生命周期变化后停止后续派发/跳转。网络请求已经提交后，切换页面不能撤销服务端已接受的动作。

个人首页提供自己的空状态，不再被 Cindy 问卷覆盖，也不把原有初始化状态写成完成。进入原有 DM / Computer 页面后，未完成工作空间仍可能出现旧向导；完整首次使用体验尚待 M1 改造。

standalone 自动生成独立 API 凭证加密主密钥，私有文件持久化；显式配置保留，损坏报错，重启不换密钥，不传给本机 runner。API connections 在 standalone 的默认 feature evaluation 中可用；显式规则、禁用和 kill switch 仍有效，standard 默认不变。

没有重写编排器、替换数据库或复制 Agent runtime。未创建 GPUI 应用、修改 gpui-kit 仓库或安装 Rust 工具链。

## 2. 验证结果

运行环境：本机 macOS，Node **24.22.1**，通过 `npm exec --package=pnpm@12.11.2` 使用仓库声明的 pnpm；`pnpm install --frozen-lockfile` 成功，未改锁文件。未使用全局旧 pnpm 代替版本要求。

| 层 | 结果 | 证明范围 |
| --- | --- | --- |
| Web production build | 通过，包含 tsc 与构建后检查 | 页面类型、正式 bundle、feedback / immutable / activity 分包约束 |
| server typecheck | 通过 | 服务端类型兼容 |
| daemon + CLI build | 通过 | 原有执行节点与 CLI 可构建；没有实际启动原生 Agent |
| server tests | 3 文件，10 项通过 | 密钥并发/重启/损坏、显式密钥、runner 环境、flag 边界及真实 PGlite 凭证加密 |
| Web unit tests | 2 文件，6 项通过 | 请求去重、作用域变更、失败重试、导航记忆 |
| Web DOM tests | 3 文件，14 项通过 | 草稿、空状态、离线、失败恢复、防重复发送、侧栏及首页向导例外 |
| 变更组件 oxlint | 通过 | PersonalHome、LeftRail、ServerSetupProjectionGate |
| color-token 检查 | 通过 | 未引入裸色值 |
| 全仓 i18n literal ratchet | 未通过 | 报告命中基线已有的 AgentDetailPanel、RemoteComputerConnect 等文件；本轮新增个人页面没有命中，未扩大豁免 |
| 真实 standalone HTTP | 通过 | 登录、空间、provider 保存/脱敏、DM、task 消息持久化、重复 randomId 返回同一消息 |
| 浏览器 | 通过当前切片 | 登录、首页、示例填入、提交后 DM 真实任务卡、API 配置页；已观察新空间 DM 仍有旧向导 |
| 390×844 窄屏 | 检查通过 | 页面 scrollWidth=390，无文档级横向溢出；不是手机原生应用验证 |

Web 构建有 chunk 超过 500 kB 的提示，DOM 测试日志中有 React act 警告，断言均通过；本轮没有首屏延迟、滚动帧率或内存基准。此前一次测试调用把选项放在 `--` 之后，启动了多余 worker，已停止该次运行；表中结果来自重新以正确参数完成的定向检查。

模型请求数为 **0**。测试使用独立的外部 Agent fixture 和假 API key，不接通模型、不发送外部消息、不读用户原生登录凭证。API 接收和任务卡出现不能证明 Agent 真正完成了工作。加密测试使用真实 PGlite 持久事实和重载的磁盘密钥，但不代表真实 provider 认证通过。

## 3. 当前可评审入口

本地独立 profile 在 `http://127.0.0.1:5288`，评审页面：

[打开个人助理首页](http://127.0.0.1:5288/s/personal-229fc446/personal)

该页面在当前浏览器已用测试身份登录。另一个浏览器需要该独立 profile 的登录；测试登录文件保存在 `.local/personal-agent/review-login.json`（0600），不属于真实用户账号。所有状态、密钥、日志与截图都在被 Git 忽略的 `.local/personal-agent/`，不能提交到仓库。

![个人助理首页](../../.local/personal-agent/personal-home.jpg)

截图：`personal-home.jpg`、`personal-mobile.jpg`、`provider-settings.jpg`、`task-receipt.jpg`。最后一张保留旧 DM 向导，不能用来宣称首次使用体验已经完成。

## 4. 重复运行

先使用 Node 24+ 和 pnpm 12.11.2，构建：

```sh
pnpm install --frozen-lockfile
pnpm --filter @botiverse/raft-daemon build
pnpm --filter @botiverse/raft-web build
```

一般用户使用原有本地注册与初始化流程。以下是开发 fixture 路径，直接准备专用测试身份，不替用户接受厂商协议。seed 前停止占用该数据库的评审服务；它拒绝其他状态目录。

```sh
RAFT_STANDALONE_DIR="$PWD/.local/personal-agent/state" \
RAFT_STANDALONE_PORT=5288 \
node --import @oxc-node/core/register scripts/e2e/personal-agent-seed.mjs

RAFT_STANDALONE_DIR="$PWD/.local/personal-agent/state" \
RAFT_STANDALONE_PORT=5288 pnpm standalone
```

另一个终端运行 `node scripts/e2e/personal-agent-smoke.mjs`，产生 `api-smoke.json` 与私有登录文件。脚本每次创建独立测试空间，使用假密钥；不要将其用于日常 profile。服务启动时会读取并缓存构建后的 index，因此重新 build 后重启服务，再刷新浏览器，避免旧 HTML 指向已经删除的 chunk。

定向检查：

```sh
pnpm --filter @botiverse/raft-server exec vitest run \
  src/standalone/config.test.ts src/standalone/localComputer.test.ts \
  src/standalone/providerConnections.test.ts --maxWorkers=1 \
  --testTimeout=30000 --hookTimeout=30000
pnpm --filter @botiverse/raft-web exec node scripts/run-vitest-tests.mjs \
  tests/personalTask.test.ts tests/serverSurfaceMemory.test.ts
pnpm --filter @botiverse/raft-web exec node scripts/run-vitest-tests.mjs --dom \
  tests/personalHome.behavior.test.tsx tests/leftRailChrome.behavior.test.tsx \
  tests/serverSetupSettingsEscape.behavior.test.tsx
```

## 5. 下一轮建议

1. 完成 Mac 首次使用：去掉 Cindy 专属问卷对个人工作的依赖，先检测本地 runtime，再创建用户自己的默认助理；不能仅隐藏所有初始化失败。
2. 用用户选定的一条本地 Agent 连接和一条 API 连接分别完成“研究 → 文件 → 检查结果”的真实任务，保留失败记录。
3. 补个人任务读模型，包含 DM/thread；让成果与来源可打开、可修订。不可把现有 server tasks 列表当全量个人任务。
4. 做 GPUI Kit 的真实 DM 原生试验，测中文输入、流式文本、取消、断线恢复；通过后决定外壳与对话迁移。
5. 在执行边界实现审批与副作用控制，再交付 routine 和手机审批；本机 broad-permission Agent 当前不具备强隔离承诺。
