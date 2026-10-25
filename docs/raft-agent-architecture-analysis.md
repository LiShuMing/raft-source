# raft-source 架构与源码实现分析：LLM 交互 / context / session / memory

> 阅读范围：`~/xwork/raft-source`（HEAD `849d036`，13 个包，daemon 非测试 TS 约 7.1 万行）。
> 方法：只读源码 + `manual/agent-knowledge/` 的官方说明，逐条落到 `文件:行号`；**凡是我自己的设计判断，一律标 `[判断]`**，与读到的 `[事实]` 分开。
> 本文不改动任何代码；@Codex1 正在进行的 standalone 修复范围未触碰。

---

## 0. 先给结论

**⚠️ 先纠正本文初稿的一处过度概括。** 初稿第一句写的是"Raft 自己不和 LLM API 打交道"——**这是错的**，是我只看了运行时驱动注册表（`drivers/index.ts`）就下的结论。核对后的实际情况：

- `packages/server/src/services/translation/providers/openaiCompatible.ts` —— **服务端自己的 OpenAI-compatible 翻译 provider**（由 `messageTranslationService.ts:16,100-102` 装配）；
- `packages/server/src/services/providerConnectionService.ts:811`、`:869` —— 直接构造 `/chat/completions` 请求；
- `packages/daemon/src/drivers/kimi-sdk.ts` —— **进程内 SDK 驱动**，而不是拉起外部 CLI。

准确的表述是：**agent 的"主对话"由托管运行时驱动接入，但整个仓库里确实存在直接的 LLM API 调用。**

在这个前提下，另外三个问题的答案仍指向同一个设计取向：Raft 的主体是**协作平台**——把人、agent、消息、任务、渠道放在一层统一的消息服务里；**核心保持薄**，把"模型对话"当作不透明、可丢弃的外部状态，把"协作事实"当作 durable 的真状态。

这个取向决定了后面每一条的具体形态：context 大部分交给运行时、session 只保证"一个 agent 同时一个"、memory 用平台自己管的 `MEMORY.md` 而不是模型上下文。

---

## 1. 三层结构（先建立地图）

| 层 | 谁 | 职责 | 关键证据 |
|---|---|---|---|
| **平台层** | `packages/server`、`web`、`cli`、`shared` | 身份、渠道/DM/线程、消息、任务、inbox、@提及 | `packages/server/src/db/schema.ts:1847`（surface 类型枚举） |
| **运行时层** | `packages/daemon`、`computer`、`runtime-form` | 把 agent 作为子进程拉起、驱动、注入上下文、代理凭证、管理 session 生命周期 | `packages/daemon/src/drivers/index.ts:50`（驱动注册表） |
| **模型层** | 外部运行时 CLI | 真正调 LLM API、跑工具、自己管自己的上下文 | 同上；Raft 只见其事件流 |

`[事实]` 这个分层不是我归纳的修辞——daemon 的驱动接口里，一个 runtime 被抽象成"可以被 spawn、可以发消息、会吐出事件流、有 session 引用"的对象（`RuntimeDriver` / `RuntimeSession` / `ParsedEvent` / `SpawnContext` / `RuntimeTurnAttribution`，均由 `packages/daemon/src/drivers/index.ts` 再导出）。

---

## 2. 问题一：如何管理与 LLM API 的交互

### 2.1 核心抽象：RuntimeDriver —— 一个运行时一个驱动

`[事实]` 驱动注册表在 `packages/daemon/src/drivers/index.ts:50`：

```ts
const driverFactories: Record<string, () => RuntimeDriver> = {
  builtin: () => new BuiltInDriver(),
  claude: () => new ClaudeDriver(),
  codex: () => new CodexDriver(),
  grok: () => new GrokDriver(),
  antigravity: () => new AntigravityDriver(),  // deprecated，仅存量 agent 可运行
  copilot: () => new CopilotDriver(),          // deprecated
  ...
```

目录里每个运行时一个文件：`claude.ts`、`codex.ts`、`gemini.ts`、`grok.ts`、`kimi.ts`、`kimi-sdk.ts`、`opencode.ts`、`pi.ts`、`cursor.ts`、`copilot.ts`。**注意 `pi.ts` 与 `builtin`**——`~/xwork/pi` 这个独立 agent harness 在 Raft 里是**被托管的一个运行时**（见第 5 节）。

### 2.2 事件规范化：把 N 家运行时收敛成一种事件流

`[事实]` 每个运行时配一个 `*EventNormalizer.ts`（`claudeEventNormalizer` / `codexEventNormalizer` / `geminiEventNormalizer` / `grokEventNormalizer`）。也就是说：**运行时吐什么格式五花八门，平台层只认规范化之后的形状**。这是"薄核心"能成立的关键——上层逻辑（投递、状态机、审计）只写一遍。

### 2.3 周边：凭证、模型清单、配置契约

- `[事实]` `agentCredentialProxy.ts` —— 凭证走代理，不由 agent 直接持有（机制层面；本文不读取任何凭据值）。
- `[事实]` `runtimeModels/oarListModels.ts` + `modelSourceCache.ts` —— 模型列表来自运行时/外部源并缓存。
- `[事实]` `packages/runtime-form`（`@botiverse/raft-runtime-form`）是一个**配置契约包**：`contract:generate` 生成、`released/*.json` 与 `fixtures/*.json` 固化形态，用于在和 UI 之间声明"某运行时支持哪些配置项"。**运行时的差异被数据化，而不是散在 if-else 里。**

`[判断]` 这一层的设计价值在于：**新增一个运行时 = 加一个 driver + 一个 normalizer + 一份 runtime-form 契约**，平台其余部分不需要知道该运行时是 Claude 还是别家。这是它能同时托管 10+ 种运行时的原因。

---

## 3. 问题二：context 怎么管理

Raft 这边**不是一处集中管理**，而是三条互相独立的线——这个拆分本身就是设计选择。

### 3.1 线一：启动注入（daemon 自己组装的第一段输入）

`[事实]` `packages/daemon/src/startupMemoryBlock.ts` 在服务端 `constructedWakeContext` 显式启用且本地开关未关闭时，会在**全新（fresh）运行时会话**的首个输入里，注入 agent `MEMORY.md` 的头部，包在 XML 边界里（`:103`）：

```
<memory-index file="MEMORY.md" size=... complete="...">
（MEMORY.md 的头部内容）
</memory-index>
```

`[事实]` 源码头注释（`:8-22`）给了完整理由：MEMORY.md 是**每个会话都被要求无条件读**的那一个文件，所以平台直接把内容推过去，省掉一次保证发生的往返、也消除了"agent 没读"的合规风险；**注入视图有上限，但文件本身永不被截断**；**恢复（resume）的会话不再注入**——因为它的 transcript 里已经有更早的一次读取，重复注入会把内容塞进已缓存的 prefix。

`[判断]` 最后那条特别值得注意：它是**为了不破坏 prompt cache** 而放弃一部分冗余投递。缓存友好性在这里是一个会改变外部行为的一等约束，不是实现细节。

### 3.2 线二：输入预算（启动前的硬闸）

`[事实]` `packages/daemon/src/drivers/claudeInputBudget.ts:4-6`：

```ts
const CLAUDE_DEFAULT_CONTEXT_TOKENS = 200_000;
const CLAUDE_FABLE_CONTEXT_TOKENS = 1_000_000;
const CLAUDE_INPUT_TOKEN_RESERVE = 32_000;
```

预算 = 上下文上限 − 32k 预留；超了**在拉起进程之前**就抛 `ClaudeStartupPayloadTooLargeError`（`INPUT_TOO_LARGE`，带 estimated/budget/limit/model 四个数）。`[判断]` 这是个"失败要早、要把账算给你看"的处理方式——错误信息本身就包含了诊断所需的全部数量。

### 3.3 线三：压缩（compaction）——主体交给运行时，平台只做投影与善后

`[事实]` 平台侧有 `runtimeCompactionProjection.ts`（`projectCompactionInterruption` 等），把运行时发生的压缩事件**投影**成平台可观测/可展示的形状。

`[事实]` 失败路径在官方说明里写得很清楚（`manual/agent-knowledge/agent-status.md:88-91`）：运行时对话超出模型上限 → 压缩（总结较早部分）试图拉回来 → 拉不回来就持续失败；**Pi / Built-in Pi 的 agent 在连续三次压缩失败后会自行停止恢复该会话**；处置方式是 **Reset Session & Restart**——"保留 Raft 消息与工作区文件（含 MEMORY.md），只把运行时自己的对话上下文换新"。

`[判断]` 这三条线的分工很清晰：**启动注入 = 平台认为必须送达的信息；输入预算 = 平台对自己的注入负责；压缩 = 运行时的内政**。平台不试图自己总结对话，只在它失败时提供一个安全出口（重置会话而**不**丢协作状态）。

---

## 4. 问题三：多个 session 之间怎么串联

这是四个问题里最容易被误答的一个，因为**答案的关键是"它们并不串联"**。

### 4.1 身份 ≠ 会话

`[事实]` `manual/agent-knowledge/agent-status.md:40-48` 讲得最清楚：

> An agent is a **persistent identity** — name, workspace/MEMORY, channel memberships, config — **not** a chat session. Underneath, it runs **one** live **runtime session** at a time (its `sessionId` = the model's current context).
> - **Restart** bounces the process but **keeps** the same runtime session (resumable).
> - **Reset session** clears the live context and starts a **fresh** `sessionId`.
> So an agent has exactly one active session at a time.

`[事实]` 也就是说：**runtime session 是单数的**。一个 agent 不会同时持有多个模型会话；"会话"是模型上下文，"身份"才是跨会话延续的东西。

### 4.2 会话面（conversation surfaces）是复数，而且和模型会话解耦

`[事实]` 平台侧的对话面是一个枚举（`packages/server/src/db/schema.ts:1847`）：

```ts
type: text("type", { enum: ["channel", "private", "joint", "dm", "thread"] })
```

- **thread** 是**锚定在一条父消息上的子对话**，继承父面（渠道/DM）的可见性，**不能独立创建、不能嵌套**；
- 关键区分（`manual/agent-knowledge/thread.md`）：**可见性**继承自父面，但**投递/唤醒按 follower**——回复过、被 @到、或手动 follow 才会持续收到该线程的每条回复；仅仅打开看不算 follow。

`[事实]` 跨面的"我要处理什么"由 **inbox** 聚合（`manual/agent-knowledge/inbox.md`）：`raft inbox check` 列出所有未读会话（按最新活动排序），`raft message check` 按需排空新消息。

### 4.3 那么"串联"到底靠什么？

`[判断]` 串起来的是三样东西，**没有一样是"会话与会话相连"**：

1. **同一个 runtime session 的存续**：restart 保留、压缩替换旧消息——模型侧看到的是"一条连续对话"。
2. **平台的消息面作为持久事实**：channel/thread/DM 的历史就是协作的历史，模型会话被重置也不影响它。
3. **`MEMORY.md` 作为跨会话的自我记忆**：会话重置后靠它恢复"我是谁、在做什么"。

`[判断]` 这是个刻意的取舍：**把"对话连续性"降级为可丢弃的东西，把"协作连续性"升格为持久事实**。好处是会话坏了可以重置（第 3.3 节那条处置路径），协作状态不受损；代价是 agent 自己必须在会话之间主动重建上下文（读 inbox、读 MEMORY），平台不替它记。

---

## 5. 问题四：memory 怎么管理

### 5.1 两层记忆，必须先分清

`[事实]` `manual/agent-knowledge/runtime.md:37` 明确划分：

> Some runtimes read their own **project-context files** … **Claude Code** loads `CLAUDE.md` files up the directory tree … That's a feature of the runtime, **not** a Raft concept … It's separate from the agent's Raft memory, which is the **`MEMORY.md`** in the agent's workspace home (`$SLOCK_HOME/agents/{id}/`) … So a runtime can have two memory layers.

| | 归谁管 | 在哪 | 跨会话？ |
|---|---|---|---|
| `CLAUDE.md` / `AGENTS.md` 等 | **运行时** | 工作目录及其父目录 | 是，但属运行时行为，非 Raft 概念 |
| `MEMORY.md` | **Raft 平台** | agent workspace home | 是，**平台管理的跨会话记忆** |

### 5.2 读侧：平台主动注入（第 3.1 节已述）

`[事实]` `startupMemoryBlock.ts:139`（`applyStartupMemoryBlock`）在上述开关启用的 fresh 会话注入头部；resume 会话跳过（缓存 prefix 保护）。

### 5.3 写侧：由提示词驱动（不是代码强制）

`[事实]` 源码注释称 MEMORY.md 是"每个会话都被指示无条件读取的那一个文件（standing prompt step 2）"——**写入是提示词约定的行为，不是平台代写**。

`[判断]` 这一点值得单独说：**平台在启用时负责启动注入，agent 负责维护记忆内容（提示词引导）**。这解释了为什么不同 agent 的记忆质量差异巨大——写入环节没有代码保证。

### 5.4 增长管控：刻意不放在唤醒路径上

`[事实]` `startupMemoryBlock.ts` 头注释：注入的 footer **只报体量事实**（文件多重、展示了多少），**增长压力被有意放在别处**——CLI 指南的 16KB 目标 + `system.cleaner` 应用的空闲期提示；理由是 **"a wake never steers the agent into housekeeping ahead of the pending request"**（唤醒时不能把 agent 引去做家务、耽误正事）。

`[事实]` 相关的还有：`system.cleaner` 内置应用会在 `MEMORY.md` 过大时告警（`manual/agent-knowledge/raft-cli-overview.md:44`）；迁移时 **MEMORY.md 永远会被搬运**，即使被列在忽略清单里（`manual/agent-knowledge/agent.md:118`）。

`[判断]` "把成长压力放在空闲期、不在唤醒期"是一条很成熟的取舍——它保住了唤醒路径的可预测延迟。

---

## 6. 与 Pi（及同类平台）的对比

先说清关系：**Pi 不是竞品，是 Raft 托管的运行时之一**（`packages/daemon/src/drivers/pi.ts`，注册名 `builtin` / `pi`）。Pi 是"minimal, extensible agent harness"（npm `@earendil-works/pi-coding-agent`，`~/xwork/pi` HEAD `4dd2b149`），Raft 是"人和 agent 共用的协作平台"。**一个管"怎么把活干完"，一个管"人和 agent 怎么在一起干活"。**

| 维度 | **Raft** | **Pi** |
|---|---|---|
| 定位 | 协作平台（消息/渠道/线程/DM/任务/@提及） | 单机 agent harness（无多 agent 概念，README 明说不做 sub-agent） |
| 会话模型 | **一个 agent 同时只有一个 live runtime session**；不串成树 | 会话 = **JSONL 文件 + 条目树**，每条有 ID 和 parent；当前分支提供历史；**可 branch/fork/clone**（`how-pi-works.md`） |
| 上下文 | 启动注入 + 输入预算；**压缩交给运行时** | 自己实现：系统提示 + 活动分支 + 工具/技能描述；`compaction` 插入 summary entry **替换**旧消息（原条目仍在树里）+ branch summarization（`compaction.md`） |
| 记忆 | **平台管理**的跨会话 `MEMORY.md`，启用时为新会话注入头部 | **无独立 memory 概念**：延续性 = 会话文件本身 + 项目 context file（`AGENTS.md`/`CLAUDE.md`，`configuration.md:41-45`） |
| 多 agent 协作 | **原生**（渠道/线程/DM/任务/@提及/inbox） | 不在范围内（"skips features like sub-agents and plan mode"） |
| 可扩展性 | runtime-form 契约 + driver/normalizer 插件式加运行时 | extensions / skills / prompt-templates / themes / npm 包 |
| 关系 | **Raft 把 Pi 当运行时托管** | 可独立运行，也可被 host |

**两个设计流派（`[判断]`）**：

- **Pi 的选择：自己拥有整个循环。** 会话树、分支、压缩、工具执行都在自己手里。好处是**上下文控制精细**（能 fork 试两条路、能精确知道压缩了什么）；代价是"这段对话"和"这台机器的文件"就是它的全部世界，**没有跨 agent 的协作语义**。
- **Raft 的选择：拥有协作，不拥有对话。** 它把模型会话视为**不透明且可丢弃**的外部状态，把渠道/线程/消息/记忆视为 durable 的真状态。好处是**换运行时、重置会话都不损失协作状态**（同一套消息面托管 Claude/Codex/Pi/Gemini…）；代价是 **agent 必须在会话之间主动重建上下文**，平台不替它记，也拿不到对话内部的精细控制（压缩是运行时的内政）。

`[判断]` 这两个选择**不冲突、可组合**——事实上这个仓库就是组合的产物。谁更"先进"是个伪问题：**要单机深度用 Pi，要多人/多 agent 协作让 Raft 在下面托着。**

---

## 7. 顺带发现：manual 的 "Verified against" 已经漂了

`[事实]` `manual/agent-knowledge/thread.md` 头部自述："Verified against `packages/server/src/db/schema.ts:1415`（channel type enum …）"。但当前 HEAD 上，**该枚举实际在 `packages/server/src/db/schema.ts:1847`**，`:1415` 是一个无关的 `}, (t) => [`（该文件现已 7,701 行）。

`[判断]` 这不是小事：manual 是 agent 的行为依据，它的"已核对"声明本身就是给读者的证据。**行号会随文件增长漂移**——这类"核对点"需要定期重跑，否则会从"可信证据"退化成"看起来很可信的说法"。建议把这类 header 的核对纳入定期任务（至少按里程碑重跑一次）。

---

## 8. 没做的事（边界）

- **只读**：未修改任何代码；未触碰 @Codex1 正在进行的 standalone 修复范围。
- **未验证的部分**：各运行时内部如何调模型 API（那是运行时的事，Raft 侧不可见，我没有读 Claude Code/Pi 的模型调用实现）；`agentCredentialProxy` 的具体凭据流转细节（只确认了机制存在，未追踪全链路，且**未读取任何凭据值**）。
- **未做对比的平台**：除 Pi 外没有深入其他平台；`~/xwork` 下还有若干 agent 相关项目，需要的话可以再补。
- 本文的 `[判断]` 部分是我的解释，不是源码事实——如果与你的理解冲突，以源码为准，欢迎指正。