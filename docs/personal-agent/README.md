# Personal Agent：产品设计与实现记录

**当前实现：2026-10-28 v0.2 开发版；设计基线：2026-10-27。** 按 Grok Bot 的工作闭环重做功能设计，主对象为持续工作的助理。上一轮极简首页只是早期切片。

- [实现与本机验收](implementation-v02.md)：接入真实服务后的功能、Mac 开发入口、运行证据和剩余边界。
- [产品设计 v0.2](product-design-v02.md)：主窗口、Bot、任务、工具/接管、审批、成果、记忆、技能、定时工作、本地 Agent/API 和多端。
- [Grok Bot 功能对照](grok-functional-reference.md)：官方事实、体验机制与本产品选择。
- [技术设计](technical-design-v02.md)：现有源码复用、新对象/API、恢复与 GPUI 决策。
- [实施与验收](implementation-plan.md)：一期 A–D 工作包、完整流程与故障否决项。
- [可点击交互原型](prototype/index.html)：示例数据，供评审；无真实执行或凭证保存。
- [本次交付与检查](design-review-v02.md)：原型验证范围、截图与尚未接入的真实能力。

研究日期：2026-10-26（Asia/Shanghai）。Raft 基线：`1147a42b17831878cf9c1c6a65c31d1666fc033f`；GPUI Kit 基线：`611b55e331170ca375214d580b6c5409db858f83`。这是本地研究和开发方案，不代表已交付完整平台。

建议先把 Raft 的执行能力组织成一个人的工作入口：描述目标、看到进展、处理需要自己判断的事情、拿到成果。保留 daemon、消息协议、凭证代理和 runtime drivers，在产品层减少频道、角色与运行环境对首次使用的干扰。

| 文档 | 回答的问题 |
| --- | --- |
| [产品调研](research.md) | Muse / Grok Bot 怎样降低使用成本，哪些体验结论仍需实测 |
| [历史产品设计 v0.1](product-design.md) | 早期首页切片的用户、流程与范围 |
| [源码解读](source-architecture.md) | standalone 与标准部署怎样运行，哪些机制可以复用 |
| [GPUI Kit 评估](gpui-evaluation.md) | 能复用哪些 UI 能力，代价与原生验证路径是什么 |
| [迭代与验证](iteration.md) | 本轮实际改动、启动方法、验证结果及后续工作 |
| [极简界面迭代](minimal-ui.md) | 去黄色、单侧栏、对话优先与设置渐进展开 |

商业化前置条件：根目录 [LICENSE](../../LICENSE) 的 FSL 明确定义了 Competing Use。对外提供相同或相近功能的商业产品，需要先解决授权或独立实现问题；内部使用和非商业研究属于许可证列举的用途。此处记录源码条款，不代替具体商业方案的法律审查。Raft 名称和标识也不应直接作为新产品品牌。
