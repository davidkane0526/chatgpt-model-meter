# 模型 · 额度监测 for ChatGPT v0.7.4

> 非官方第三方扩展，与 OpenAI 无隶属、合作或官方认可关系。
> Unofficial third-party extension. Not affiliated with or endorsed by OpenAI.

在 chatgpt.com 左上角显示 Work / Codex 的 5 小时、7 天剩余额度，以及请求 model 与服务端 STE 遥测报告的 model_slug。


## Language

The gear menu now includes **Language: Auto / 中文 / English**. Auto follows the browser language: Chinese browsers use Chinese; other languages use English.

## v0.7.1 修复

- 不再假定 `primary_window = 5h`、`secondary_window = 7d`。
- 现在按 `limit_window_seconds` 识别额度窗口：`18000` 秒 = 5h，`604800` 秒 = 7d。
- 兼容 Pro / Plus 等账号把周额度放进 `primary_window`，或只返回周额度的情况。

## v0.7.0 新增

右上角齿轮 → 显示设置：

- **显示模型路由**：默认开启。关闭后隐藏 req / run 区域并暂停模型流解析，只保留额度条。
- **默认隐藏**：默认关闭。开启后卡片平时只显示 `Work / Codex` 小块；鼠标移上去展开，移开自动收回。

## 安装

1. 解压 ZIP。
2. 打开 `chrome://extensions/`。
3. 开启「开发者模式」。
4. 选择「加载已解压的扩展程序」。
5. 选择解压后的 `chatgpt-model-meter-v0.7.3` 文件夹。
6. 停用旧版模型/额度插件，避免重复网络钩子。
7. 刷新 ChatGPT 页面。

## 模型标识说明

`req` 是网页请求体发出的 model；`run` 是流末尾 `server_ste_metadata.model_slug`。两者不一致只表示“请求标识与 STE 报告标识不一致”，不能单独证明服务器内部实际加载了哪套权重。

本扩展不上传对话内容，不申请 Cookie、debugger 或历史记录权限。


## 版本

v0.7.3 — 默认隐藏模式新增约 5px 外沿缓冲区；鼠标只离开展开卡片/设置面板几像素时保持展开，继续移远后再收起。

v0.7.2 — 修复默认隐藏模式下设置面板缝隙误收起。


v0.7.4 — Added Auto / 中文 / English interface language support.
