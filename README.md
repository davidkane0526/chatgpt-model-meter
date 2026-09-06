# ChatGPT 模型 · 额度监测

在 `chatgpt.com` 左上角显示一张小卡片：**5 小时 / 7 天剩余额度** + **本次请求的 model 与响应回来的 model_slug**。chat 窗口和 work 窗口通用。

额度部分沿用 `chatgpt-codex-usage-meter`（bridge.js 原封不动，widget.js 只换了齿轮图标）；模型部分是新增的 model.js / model-ui.js。

## 卡片长这样

```
┌──────────────────────────────────┐
│ Work / Codex                  ⚙  │
│ 5h  ▓▓▓▓▓▓░░░░   62.0%    3h 12m │
│ 7d  ▓▓▓▓▓▓▓▓░░   81.4%  4d 5h 0m │
│ ──────────────────────────────── │
│ req  gpt-5.6-terra-wm            │
│ run  gpt-5.6-terra-wm    work ✓ ▸│
└──────────────────────────────────┘
```

- **req** — 请求体里的 `model`，网页发出去时要的那个
- **run** — STE 报告的 `model_slug`，服务端实际跑的那个

两行不一样就是被重路由了，`run` 那行会变成橙色加粗，右边符号也变 `≠`。点任意一行展开**当前这一轮**的明细，再点收起。只显示当前一轮，不留历史，聊几百轮也不会堆东西。

### 关键：什么才算「实际执行的模型」

**只认流末尾 `server_ste_metadata` 事件里的 `model_slug`。**

流中间那些 message 事件也带 `metadata.model_slug`，但那是**请求侧的回显** —— 整条流从头到尾都是你请求的那个值。拿它当执行模型，结果永远显示「一致」，重路由根本测不出来。这是个很容易踩的坑（参考 `work-model-auditor`，它只比对 message 的 model_slug，两次真实样本当然都「一致」）。

所以卡片上：

- **执行** = STE 的 model_slug，这才是证据
- **回显** = message 的 model_slug，只作参考，明细里标了「非执行证据」

### 右边那个符号

| 符号 | 含义 |
|---|---|
| `✓` | 请求的 model 与 STE 报告的执行 model 一致 |
| `≠` | 两者不一样 —— 被重路由了，主行显示 `请求 → 实际` |
| `?` | 这一轮结束了，但没抓到 STE 事件，拿不到执行模型（**不会拿回显冒充**） |
| `≈` | 结果同上一格，但这条是按「同会话最近一次发送」推断关联的，不是精确对上号 |
| `···` | 已发出，在等流末尾的 STE 事件 |
| `--` | 这个标签页还没发过消息 |

拿到 STE 之后，`mdl` 行会多一个 `work` / `chat` 小标签，来源是 STE 的 `product_experience` —— 服务端自己报的，不是按接口路径猜的（`f/conversation` 两种窗口都在用，猜不出来）。

鼠标停在符号上会有一句中文说明。

### 展开后的明细

- **界面** — 发送那一刻输入框上显示的模型名（取不到就是「未捕获」，不影响别的行）
- **请求** — 请求体里的 `model`
- **消息层标识** — `message.metadata.model_slug`。它是请求的回声，正常情况下跟 `req` 一模一样，所以**只在跟请求对不上时才显示** —— 那说明服务端在消息层改写了标识。想一直看就开「显示字段路径」
- **强度** — 请求体里的 `thinking_effort` / `reasoning_effort`（有才显示）
- **请求档位 / 自动转推理 / 自动切换器 / 用途 / 调用工具 / 套餐 / 首字延迟** — STE 事件自带的字段，有才显示。`自动转推理 = 是` 直接说明服务端做了切换
- **接口** — 走的哪个后端接口和哪条通道，例如 `f/conversation · HTTP SSE · WebSocket`
- **状态** — 已发送 → 已移交后台 → 已收到模型标识 → 回复结束

## 两种窗口分别是怎么抓的

发送接口有两个，`/backend-api/conversation` 和 `/backend-api/f/conversation`，两个都盯着。

**但接口名不等于窗口类型** —— 实测 chat 窗口现在也走 `f/conversation`，所以卡片上不显示「chat / work」标签，避免给出错误信息。想知道走了哪条路，展开看「接口」那一行。

回复通道有两种，都覆盖：

| | 直连 | 后台任务 |
|---|---|---|
| 回复通道 | HTTP SSE 直接流回来 | SSE 先返回 `stream_handoff` + `turn_exchange_id`，正文改走 `ws.chatgpt.com` |
| 取哪个字段 | `message.metadata.model_slug`、`server_ste_metadata.model_slug` | 同左，但包在 WebSocket 帧的 `encoded_item` 里（明文或 base64 的内嵌 SSE） |

关联用的是 `turn_exchange_id` → `working_turn_id` → `parent_id` 这个顺序，都对不上才退回「同会话最近一次发送」并打 `≈`。不按时间就近瞎猜。

### work 窗口的完整链路（2026-09 实测）

```
POST /backend-api/f/conversation
  └ SSE: {"type":"stream_handoff",
          "turn_exchange_id":"xxxxxxxx-…",
          "options":[{"type":"resume_sse_endpoint","topic_id":"conversation-turn-xxxxxxxx-…"},
                     {"type":"subscribe_ws_topic", "topic_id":"conversation-turn-xxxxxxxx-…"}]}

续流（服务端动态指定，SSE 或 WS topic 二选一）
  └ 帧里 "encoded_item":"data: {…}"  ← 明文 SSE 套在字符串里
      └ {"type":"server_ste_metadata","metadata":{"model_slug":"gpt-5.6-terra-wm", …}}
```

要点：

- 续流地址**不是固定路径**，由 `stream_handoff` 的 `options` 动态下发，所以插件不认端点、只认 content-type
- WebSocket 是**用户级持久连接**（`ws.chatgpt.com/p13/ws/user/{uid}`），页面加载时就建好，靠 topic 订阅分发。只有 `document_start` 注入的扩展抓得到它的构造
- work 的 STE 在**整轮结束时**才发。长任务（联网搜索那种）要等几分钟，期间显示 `···` 是正常的
- work 窗口如果是直接流式回答（不移交后台），STE 跟 chat 一样在主流里

### STE 事件的真实形态（2026-09 实测）

chat 窗口抓到的样子：

```
data: {"type":"server_ste_metadata","metadata":{
  "model_slug":"gpt-5-6-thinking",
  "requested_model_experience":"thinking",
  "did_auto_switch_to_reasoning":false,
  "is_autoswitcher_enabled":false,
  "auto_switcher_race_winner":null,
  "cluster_region":"westus3"}}
```

注意 `model_slug` 在 `metadata` 子对象里，不是顶层平铺；标识自己靠的是 `type` 值，SSE 的 `event:` 名只有 `delta_encoding` 和 `delta`。

work 窗口的 STE 字段更全，实测有：`model_slug`、`product_experience`（`work` / `chat`，**这是区分两种窗口的权威来源**，比猜接口可靠）、`requested_model_experience`、`did_auto_switch_to_reasoning`、`is_autoswitcher_enabled`、`auto_switcher_race_winner`、`is_search`、`tool_invoked`、`tool_name`、`plan_type`、`cluster_region`、`server_ttfvt_ms`、`fast_convo`、`warmup_state`。

同一轮里 message 侧有三个 slug 字段，全部等于请求值，一个都不能当执行证据：`model_slug`、`resolved_model_slug`、`default_model_slug`。（`resolved_model_slug` 实测还在，社区说它被撤掉了，至少 chat 流里没有。）

形态不固定，所以三条路一起认，命中任意一条就算：

1. 外层键名是 `server_ste_metadata`（嵌在 message.metadata 里的老形态）
2. SSE 的 `event:` 名或事件的 `type` 值是 `server_ste_metadata`
3. 对象自带 STE 的特征字段（`requested_model_experience`、`did_auto_switch_to_reasoning`、`is_autoswitcher_enabled`、`server_ttfvt_ms`、`turn_use_case`）

另外还认 delta 补丁形态 —— `{"p":"/message/metadata/model_slug","o":"replace","v":"..."}`。这种事件里 model_slug 是 `p` 的**字符串值**而不是键名，按键名找会整个漏掉。

## 安装

1. Chrome 地址栏输入 `chrome://extensions/`。
2. 打开右上角「开发者模式」。
3. 点「加载已解压的扩展程序」，选**本目录**（含 manifest.json 的那层）。
4. **把旧的两个扩展停用**：`ChatGPT Codex Usage Meter` 和 `Work 模型证据核对`。功能已经并进来了，同时开着会出现两张卡片、网络钩子叠三层。
5. 刷新 `https://chatgpt.com/`。**这步不能省** —— 采集器必须在页面建立 WebSocket 之前装好。

## 抓不到东西时

OpenAI 随时可能改字段位置。展开明细 → 点「显示字段路径」，会列出这次实际命中的 JSON 路径，例如：

```
message.metadata.model_slug
encoded_item.message.metadata.server_ste_metadata.model_slug
```

它还会列出这一轮出现过的**事件名**。如果里面没有 `server_ste_metadata` 之类的东西，说明这条链路压根没发这个事件，或者它换了名字 —— 把事件名列表发给我，改 `model.js` 顶部 `STE_NAME` / `STE_HINTS` 那几行就行。

其他常见情况：

- 卡片整个不出现 → 扩展没装上，或者忘了刷新页面。
- 额度是 `--` → 当前账号读不到 `/backend-api/codex/usage`，点一下卡片空白处重试。
- 一直停在 `···` → 回复还没结束。STE 在流的最末尾，思考久的轮次要等。
- 结束了还是 `?` → 这条链路没发 STE 事件。展开看「事件」那行有哪些事件名。

## 它能证明什么，不能证明什么

**能**：网页发出去的是哪个 model，服务端在流末尾的 STE 遥测里报告执行的是哪个 model，两者对不对得上 —— 也就是能看出有没有被重路由。

**不能**：证明服务器内部真正跑的是哪套权重。响应里的名字是服务端自己说的。全部一致也不能排除隐藏路由；名字不同也不等于就被降级了 —— 别名、子任务、工具调用都会让标识不一样。这是一个**对账工具**，不是鉴定工具。

## 隐私

- 只在 `https://chatgpt.com/*` 运行，只申请 `storage`（存卡片外观和展开状态）。
- 不申请 debugger、cookie、历史记录权限，没有后台服务，不外发任何数据。
- 卡片只显示当前一轮；内存里最多留 6 条，纯粹是给晚到的 WebSocket 帧留关联余地，刷新就没了。
- 采集过程中会读到响应流，但只留下模型名和内存里的关联 ID，不保留对话正文、请求头、Cookie。
- fetch/XHR/WebSocket 都是旁路只读：不改请求参数、不改认证头、不阻塞页面。

## 文件

| 文件 | 世界 | 作用 |
|---|---|---|
| `bridge.js` | MAIN | 额度采集（原插件，未改动） |
| `widget.js` | ISOLATED | 卡片本体 + 外观设置（原插件，只换了齿轮图标） |
| `model.js` | MAIN | 模型采集：fetch / XHR / WebSocket 旁路 + SSE 解析 + 轮次关联 |
| `model-ui.js` | ISOLATED | 往卡片上追加 `mdl` 那一块 |

不想要模型功能时，把 manifest 里的 `model.js` 和 `model-ui.js` 删掉就退回原来的纯额度挂件。

## 开发验证

```
node tests/model.test.cjs
```

38 项，用合成数据跑 `model.js`，不联网、不碰浏览器。覆盖：STE 的三种形态（`type` 值 / `event:` 名 / 嵌套键）、真实抓包形态（`metadata.model_slug`）、重路由、整条流没有 STE、work 的 handoff + `encoded_item`、delta 补丁形态、正文噪声隔离、兜底通道不建记录、只留当前一轮。

改完 `model.js` 先跑这个。尤其是**兜底通道不建记录**那组 —— v0.5.0 就是在那里翻的车：`f/conversation/prepare` 和遥测上报都带 body，被当成发送后会把当前这一轮挤掉。

## 版本

v0.6.0 — `mdl` 一行拆成 `req` / `run` 两行，请求与实际执行分开显示，不一致时 run 行橙色加粗；「回显」改名「消息层标识」并默认隐藏，只在与请求不符时出现。

v0.5.1 — 修 v0.5.0 的两个回归：兜底通道会把任何带 body 的 POST（`f/conversation/prepare`、`/ces/v1/m` 遥测）当成一次发送并挤掉当前轮；`clone()` 在判断 content-type 之前执行，等于对每个同源响应白缓冲一遍。另外静态资源与遥测路径直接排除，界面模型名改认 `composer-pill`（旧的 `SliderTriggerModelLabel` 已失效）。

v0.5.0 — work 窗口链路打通并实测验证：STE 包在续流帧的 `encoded_item` 里，整轮结束时才发；续流地址动态下发，改为同源 event-stream 全兜底；补 `product_experience` 等 STE 字段，并用它显示可靠的 chat/work 标签。

v0.4.2 — work 窗口实测：移交后台后前端按 `resume_sse_endpoint` 事件给的地址续流，端点不固定，而且续流请求走的是页面早期缓存的 fetch 引用。改成**不认端点认内容** —— backend-api 下任何 event-stream 响应都过一遍解析器（普通 JSON 接口不碰）。扩展注入在 document_start，早于页面缓存 fetch，所以覆盖得到。

v0.4.1 — 按真实抓包校准：STE 的 model_slug 在 metadata 子对象里、靠 type 值标识；补 auto_switcher_race_winner 与 cluster_region；补收 resolved_model_slug / intended_default_model_slug（归回显）；补 delta 补丁形态解析。

v0.4.0 — **修了一个会让结果失真的错**：之前把 message 事件的 model_slug 当成「实际执行」，那其实是请求回显，导致永远显示一致、测不出重路由。现在只认流末尾 server_ste_metadata 事件，回显降级为参考项；STE 三重识别；显示自动切换等 STE 字段；抓不到 STE 时明说「没抓到」而不是拿回显顶上；诊断增加事件名列表。

v0.3.1 — 只看当前一轮，不再堆历史；去掉不准确的 chat/work 标签（chat 也走 f/conversation）；修 mdl 行文字下沿被裁；齿轮图标换成几何对称的版本，与中心圆同心。

v0.3.0 — 额度挂件 + 模型对账合并版。
