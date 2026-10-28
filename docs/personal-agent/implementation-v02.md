# v0.2 实现与本机验收

日期：2026-10-28。源码基线 `1147a42b17831878cf9c1c6a65c31d1666fc033f`，开发分支 `codex/personal-agent-foundation`。本轮实现作为 Personal Agent v0.2 开发检查点提交；之前的调研、设计和原型继续保留。

这份记录描述接入真实服务后的实现。[静态原型](prototype/index.html)仍然用于设计对照，不承载产品数据。当前产品入口是 `/s/:slug/personal`，Web 与 Mac 窗口使用同一服务和数据库。

## 可以使用的功能

| 原型区域 | 实现与数据来源 |
| --- | --- |
| 助理侧栏 | 现有 Agent、Computer 和实时活动；固定、隐藏、最后会话偏好持久化；不生成演示助理或在线状态 |
| 对话与工作条 | 原有 ChatPanel、消息/附件、草稿、发送幂等与任务系统；补充目标继续使用原有运行时交付机制；停止返回请求回执，启动入口复用原编排器 |
| 任务历史、待处理 | 当前用户可见 DM / 私人工作组的真实任务，稳定游标分页；汇总待验收与待决定消息，可定位到来源 |
| 成果与资料库 | 保存实际回复快照或正文；不可变内容版本、SHA-256 摘要、来源消息、Markdown 预览和导出；正文不等同于已经核验的磁盘文件 |
| 草稿决定 | 当前用户创建待发送消息，检查目标与这一版内容，批准/拒绝；绑定 version + digest，重复决定不会再发送；未知结果只能核验已有回执，不能盲目重发 |
| 平台记忆与技能 | 用户私有、助理/个人作用域、版本与启停；启用偏好进入后续 DM 上下文，`/技能名`选择技能；本机技能继续来自原节点扫描 |
| 定时工作 | IANA 时区、每天/工作日/每周、三次预览、真实试跑、启停及历史；持久 occurrence、稳定消息键、两小时补跑窗、跳过重叠；任务完成前只标“已交给助理” |
| 工作组 | 两至六个真实助理进入真正的私人频道；消息和任务复用已有协作机制，不模拟多助理回答 |
| 应用、API、设备 | 复用原应用授权、MCP、加密 provider connections、本机/远端 Computer 和 Agent 配置表单；未连接服务不展示为已连接 |
| 搜索与窄屏 | 搜索助理、任务、成果、技能、记忆与计划；历史消息由服务端按当前频道权限过滤；窄屏侧栏与详情层，Cmd+K / Cmd+N / Cmd+, / Cmd+B |
| Mac 开发版 | AppKit + WKWebView；菜单栏入口、窗口关闭后继续工作、后台服务监督和有限退避重启；本机文件选择和保存面板已接线 |

## 实现结构

- `packages/shared/src/personalWorkspace.ts`：客户端/服务端共享对象。
- `packages/server/drizzle/0374_personal_workspace.sql`、`0375_personal_skill_snapshot.sql`：个人对象、不可变修订、计划、发生账本、草稿、工作组和偏好。
- `packages/server/src/services/personalWorkspaceService.ts`：用户和空间隔离、当前频道权限、版本比较更新、成果/草稿操作与上下文投影。
- `packages/server/src/services/personalRoutineWorker.ts`：先提交 occurrence，再交付到原消息/任务链路；不另外创建 Agent loop。
- `packages/server/src/routes/personalWorkspace.ts`：`/api/personal/*`，保留原鉴权和 verified/server 检查。
- `packages/web/src/components/personal/PersonalWorkspace.tsx` 及配套组件：新工作台。原频道与设置路由继续保留。
- `mac/PersonalAgent/main.swift`、`scripts/build-personal-mac.mjs`：原生开发入口。业务状态仍来自原 Node 服务。

记忆接线做了两层处理：推送消息时构建 Agent 可见上下文；原生 CLI 经常通过 `raft message read` 读取规范历史，因此 Agent 的历史读投影也需要注入。投影仅对匹配助理的单助理 DM 生效，按原发送用户查询启用项，不改写人类消息。每页只在该用户最后一条消息附加有限上下文，避免长历史反复膨胀。停用后不再新增注入；已经进入模型上下文的内容无法由数据库停用操作抹去。

定时工作复用了原 recurrence 计算和原消息/任务交付。新增账本只记录周期计划和交付事实，不再并行创建 reminder 来触发同一次工作。技能在保存计划时固定为快照，之后修改技能不会静默改变原计划；再次编辑计划才更新快照。

## 运行

```sh
pnpm install
pnpm standalone:build
RAFT_STANDALONE_DIR="$PWD/.local/personal-agent/state" RAFT_STANDALONE_PORT=5288 pnpm standalone
```

打开本地地址，按正常流程创建账号和工作空间，在“应用与连接”添加执行电脑或模型 API，然后创建助理。数据与密钥目录应保留在 Git 之外。

Mac 开发入口使用同一源码目录、Node 可执行文件和数据目录：

```sh
RAFT_STANDALONE_DIR="$PWD/.local/personal-agent/state" RAFT_STANDALONE_PORT=5288 pnpm personal:mac:build
```

构建产物为 `.local/personal-agent/Personal Agent.app`，可以从访达打开。应用先检查现有的 standalone 服务；没有服务时才启动自己的服务。关窗保留后台；退出时只停止它自己启动的服务，已存在的服务不受影响。服务日志位于数据目录的 `mac-host.log`。

这是依赖当前 checkout 与本机 Node 的开发包，使用临时签名。它没有打包成可复制到其他电脑的发行安装包，也未做公证、自动升级或系统通知桥接。浏览器登录态与 WKWebView 登录态独立，首次打开 Mac 窗口需要正常登录。

## 本机运行证据

本机使用隔离验收账号和独立 Agent 工作目录，不连接真实第三方收件人。

1. 已登录本机 Codex，经现有 Computer / daemon / driver 启动 `personal-codex`；真实模型创建 `personal-acceptance.md`，回传内容和绝对路径，任务进入 `in_review`，界面验收后为 `done`。
2. 用界面保存真实回复为资料库成果 v1，随后整理成 v2；v1 的来源与内容仍保留。实际导出 v2 Markdown，文件 SHA-256 与资料库该版摘要一致；刷新与服务重启后仍可读取。
3. 保存只读文件检查计划，计划时间 **2026-10-28 11:18 Asia/Shanghai**；在 Mac 关窗后，服务于 **11:18:06** 创建发生记录并派发，Codex 回传只读检查结果，验收后账本进入完成。测试计划已经暂停。
4. Mac 窗口正常启动、登录、关窗后服务保留、重新打开窗口；终止被监督的服务后，应用恢复服务与同一 Computer。退出应用的最终 UI 验证曾被系统锁屏阻断，需解锁后补验。
5. 平台记忆还通过原生历史读接口验证，修正了“只对推送消息添加上下文、CLI 历史读取不到”的问题。真实模型在问题中没有给出标识的情况下回答了保存的“灰鲸27”；测试记录保留了修复前后的回复。

本机证据目录为 `.local/personal-agent/`，包含 API 测试、前后端检查、构建日志、`live-evidence.json`、原生运行日志及截图。汇总结果为 `acceptance-final.json`，桌面与窄屏截图为 `workspace-desktop.png`、`workspace-mobile.png`。凭证夹具不进入仓库，也不写入文档。

## 验证与边界

新增 API 集成测试覆盖个人任务和搜索权限、消息上下文投影、记忆停用、成果修订、游标、技能快照、计划重复收集、离线等待、派发与完成区分、过期/重叠跳过、过期草稿和并发批准。Web 状态测试覆盖跨空间旧响应丢弃、写后刷新不被旧轮询覆盖、网络失败保留可用数据；同时回归原个人入口与配置门控。

相关测试共 50 项通过（服务端个人/standalone 18 项、原消息与历史读取回归 13 项、Web 状态与路由 9 项、DOM 回归 10 项）；同一项测试的重复执行不重复计数。前端生产构建及前后端类型检查通过。新工作台源码检查单独执行；全量 Web lint 和翻译 ratchet 在原有 `RuntimeConfigFields`、`StandaloneComputerConnect`、`RemoteComputerConnect` 等文件存在告警/未归档字面量，本轮未扩大豁免或修改检查基线。

尚未交付的设计项必须与当前实现区分：

- 受管浏览器画面、独占控制租约和接管功能没有接入，工作环境目前展示真实文件与活动。
- 草稿决定目前只覆盖 Raft 内部消息，不是第三方邮件/Notion 等外部写入的通用 ActionRequest，也不能拦截原生 Agent 任意 shell。
- 工作组复用已有任务认领，没有新增分层委派、预算和连续失败自动暂停策略。
- 尚未完成单独的通用 TaskRun/Attempt 合约、各运行时逐项认证、PostgreSQL 多节点/多端验收、睡眠唤醒故障矩阵和发行安装测试。
- 本分支采用原 React 业务组件加薄 Mac 外壳，没有将业务界面改成 GPUI。GPUI Kit 的组件可以用于独立原生客户端，不能直接复用 React 组件；后续以真实消息、IME、附件、焦点和恢复验收为迁移条件。
