# Octo 图记忆接入

此 fork 可将通过现有接纳规则的文本/富文本消息自动投递给 [Octo Memory Graph](https://github.com/Ranwanglc/octo-memory-graph)，由 [iGraph fork](https://github.com/Ranwanglc/iGraph/tree/feat/memory-extraction) 的专用 Agent 提取记忆。默认关闭，不需要让聊天模型自己决定是否调用 MCP。

## 配置

先按后台 README 启动服务，在 OpenClaw 配置中的 `channels.octo.accounts.<accountId>` 增加：

```json
{
  "memory": {
    "enabled": true,
    "mcpUrl": "http://127.0.0.1:21114/mcp",
    "tokenEnv": "OCTO_MEMORY_TOKEN_MY_BOT",
    "sourceInstance": "octo-main",
    "recallTimeoutMs": 800,
    "maxContextChars": 4000
  }
}
```

在 Gateway 进程环境中设置 `OCTO_MEMORY_TOKEN_MY_BOT`，值等于后台为这个 Bot 配置的 token。`sourceInstance` 与后台 `MEMORY_SOURCE_INSTANCE` 一致，账号键与后台 `MEMORY_BOT_ACCOUNT_ID` 一致。服务握手会核对这两个字段，错配时队列保留事件并报告不可用，不会按另一个 Bot 的身份写入。一个 token 只绑定一个来源和 Bot；多账号必须分别配置 token。账号 ID 统一小写。

`memory` 可以写在渠道顶层作为默认配置，各账号字段覆盖同名默认值。多个账号可以共用服务地址和召回预算，不能共用身份 token 或 outbox 目录。开发分支先 `npm ci && npm run build`，在你使用的 OpenClaw Gateway 中安装或链接本 fork，再重启 Gateway；不要同时装第二份同 ID 的 Octo 插件。

## 持久化与召回

事件先原子落盘到 `~/.openclaw/state/octo-memory/<accountId>/`，文件权限为 `0600`，收到后台持久化回执后才移除。可以用 `outboxDir` 指定专属持久卷目录。目录绑定来源、Bot、Octo API 地址和 MCP 地址，变更目的地后不会把旧队列直接转发过去；有积压时先恢复旧配置处理，或由操作者审核后迁移。定时器每 5 秒重试，每批最多 50 条，最多保留 10000 个待发送文件；写入失败或容量超限会记错误日志。关闭插件后未确认的事件继续保留在磁盘。

原文在所有接纳规则通过后才采集，命令、群免 @ 规则、Bot 噪声规则保持原来的行为。首次使用时历史消息不会自动回补。每个回合只查询当前 Bot 的精确 DM/群/子话题作用域，召回有超时和字符上限；失败时继续原对话。历史事实作为带来源的 JSON 数据加入 `BodyForAgent`，原始 `RawBody` 和命令正文不包含召回内容。

群聊两位成员说“我”时按真实发送人分别归属；DM 作用域保留空间信息。同名实体不跨空间合并，子话题也不自动读取父群记忆。助手正式回复、渠道主动文本发送和 message 工具的文本发送在拿到真实消息 ID 后记录；Bot 输出只作为上下文，不提取成用户事实。进度和错误通知不作为正式回复采集。主动 DM 必须先在本进程观察到唯一的入站会话映射；跨多个 Space 有歧义时跳过该主动回复的记忆记录。

## 当前边界

- 第一版不采集文档评论合成回合、卡片动作、OBO 转发和图片/附件内容；富文本只处理解析后的正文。卡片原地编辑的最终答案尚未采集，当前普通文本最终回复路径可用。
- socket 在业务采集前已经发出 ACK；本地 outbox 只能保证采集点之后的投递，尚未实现 ACK 缺口的历史回补。
- 后台提供 job 状态与删除 MCP 工具，插件尚未增加面向用户的“忘记”命令或管理页面。
- 后台删除不会清除 OpenClaw 自己的会话历史、Octo 原始聊天记录或运维备份；注入的历史内容可能随宿主会话被保存。
- 这条链路已用真实 MCP、Agno 适配器及 Neo4j 与明确模拟的模型响应联调；真实 Gateway、真实 Octo 和真实模型效果需要配置后验收。
