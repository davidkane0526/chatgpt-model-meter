# 模型 · 额度监测 for ChatGPT v0.8.2-mod

> 基于 `pfz14/chatgpt-model-meter` v0.7.4 修改。非官方第三方扩展，与 OpenAI 无隶属、合作或官方认可关系。

在 chatgpt.com 左上角显示 Work / Codex 的 5 小时、7 天剩余额度，并显示请求模型与服务端 STE 遥测报告的模型标识。


## v0.8.2 修复

- 修复缩小态单击后部分 Chromium 环境中无法恢复完整面板的问题。现在直接在 `pointerup` 区分“轻点”和“拖动”：未移动即恢复，移动则保持缩小态并更新位置。
- 缩小态由纯图标改为 **98×48 px 额度信息胶囊**：显示 5h / 7d 剩余百分比，并用左侧环形进度表示 5h 剩余额度。
- 缩小态仍可拖动；键盘/普通 `click` 仍保留为恢复的备用路径。

## 本修改版新增

- **可拖动面板**：按住卡片标题栏拖动；自定义位置保存到 `chrome.storage.local`。
- **缩小为额度信息胶囊**：标题栏新增收起按钮；缩小后显示 5h / 7d 剩余百分比和 5h 环形进度，仍可拖动，轻点恢复。
- **恢复默认位置**：显示设置中可清除自定义位置，重新跟随 ChatGPT 左侧栏。
- **更严格的模型识别**：普通 assistant/message metadata 不再仅因出现 `turn_use_case`、`tool_invoked` 等字段就被判为 STE。
- **执行证据分级**：明确 `server_ste_metadata` 的 `model_slug` 证据优先级最高；仅在强 STE 指纹成立时才启用兼容性兜底。
- **更可靠的轮次关联**：同时利用 `conversation_id`、`turn_exchange_id`、`working_turn_id` 和 `parent_id` 关联 Work / WebSocket / SSE 事件。
- **Auto 请求不再误报为普通“不一致”**：当请求模型是 `auto` 类选择器时，UI 显示为“路由到”而不是错误式 mismatch。

## 安装

1. 解压 ZIP。
2. 打开 `chrome://extensions/`。
3. 开启“开发者模式”。
4. 选择“加载已解压的扩展程序”。
5. 选择本目录。
6. 停用旧版同类扩展，避免重复网络钩子。
7. 刷新 ChatGPT 页面。

## 模型标识说明

- `req`：网页请求体中的模型标识。
- `run`：优先取明确 `server_ste_metadata` 中的执行侧模型标识。
- `run` 仍然是服务端发送给前端的遥测标识，不应被解释为对服务器内部权重加载情况的绝对证明。

本扩展不上传对话内容，不申请 Cookie、debugger 或历史记录权限。


## v0.8.2-mod：可读模型名称

- 主面板不再直接显示难读的内部 slug；例如在标准 Chat 且套餐信息可确认时，`gpt-5-6-thinking` 会显示为 `GPT-5.6 Sol · Thinking`（Plus/Pro 等符合条件的付费方案）或 `GPT-5.6 Luna · Thinking`（Free/Go）。
- 如果是 Work / Codex，且原始 slug / UI 没有明确给出 Sol、Terra、Luna，则显示 `GPT-5.6 · Thinking`，避免只根据套餐误猜具体家族。
- `gpt-5-6-sol`、`gpt-5-6-terra`、`gpt-5-6-luna`、`gpt-6-astra-wm` 等包含明确家族信息的内部标识会直接转换成可读名称。
- `thinking_effort` 可用时会优先显示 `Medium / High / Extra High`，例如 `GPT-5.6 Sol · High`。
- 原始 req/run slug 没有丢失：悬停主面板模型名可看到，展开详情中也新增“原始请求 slug / 原始执行 slug”。
- req/run 一致性判定仍严格使用原始 slug，不使用翻译后的显示名称。
