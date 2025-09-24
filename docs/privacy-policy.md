# 隐私权政策 / Privacy Policy

最后更新 / Last updated: 2025-09-24

本隐私政策适用于浏览器扩展 “AI Auto Calendar”（以下简称“本扩展”）。
This privacy policy applies to the browser extension “AI Auto Calendar” (the “Extension”).

---

## 简介 / Overview
本扩展用于将用户提供或来源配置的日程信息（网页文本、会议邀请、结构化接口返回等）解析为标准日历事件，并合并上传到用户选择的日历（如 Radicale 或 Google 日历）。
The Extension converts user‑provided or source‑configured schedule information (webpage text, meeting invites, structured API responses) into structured calendar events and merges them into the user’s selected calendar (e.g., Radicale or Google Calendar).

我们秉持“最小权限、按需访问、就地处理”的原则：不注入页面内容脚本（当前版本）、不跟踪浏览历史、只在需要时访问用户配置的站点/服务，绝大部分数据停留在用户浏览器本地。
We follow the principles of least privilege, on‑demand access, and local processing: no content script injection (current version), no browsing history tracking, and only accessing user‑configured sites/services when needed. Most data remains local in the user’s browser.

更多权限用途说明请见 / For detailed permissions, see: `docs/permissions.md`
开源仓库 / Source & docs: https://github.com/ZepengW/AI-Auto-Calendar

---

## 我们处理的数据 / Data We Process
- 用户输入或选中的文本（仅在用户主动解析时处理）
  User input or selected text (processed only when the user explicitly triggers parsing)
- 用户配置（服务器地址、解析节点 API Key/模型名、任务调度等），存储在浏览器本地 storage（`chrome.storage.local`）
  User settings (server endpoints, parser API keys/models, task schedules), stored locally in `chrome.storage.local`
- Google 授权令牌（仅当用户添加 Google 服务器并同意授权时），存储在浏览器本地
  Google OAuth tokens (only after the user adds a Google server and consents), stored locally
- 任务运行日志（时间戳、成功/失败、增量条数等非敏信息），存储在浏览器本地
  Task logs (timestamps, success/failure, counts), stored locally

我们不从用户处收集或保存浏览历史，也不将上述数据上传到我们的自有服务器。
We do not collect or store browsing history, nor do we send the above data to our own servers.

---

## 数据如何使用 / How We Use Data
- 将用户提供的文本/接口返回提交到所选解析方式（LLM/智能体或 JSON 映射），生成结构化事件。
  Send user text/API responses to the selected parser (LLM/agent or JSON mapping) to generate structured events.
- 将事件合并上传到用户选择的日历服务器（Radicale/Google）。
  Merge and upload events to the user’s selected calendar backend (Radicale/Google).
- 不向我们自有服务器传输数据；数据在用户浏览器与目标第三方服务之间直接交互。
  No data is sent to our own servers; data flows directly between the user’s browser and third‑party services.

---

## 第三方服务与共享 / Third‑Party Services & Sharing
- Google Calendar API：用于列出/创建事件与 OAuth 授权；遵循 Google API Services User Data Policy。
  Google Calendar API: for listing/creating events and OAuth; complies with the Google API Services User Data Policy.
- LLM/智能体服务（如智谱/百炼/OpenAI 兼容）：仅在用户选择该解析方式时使用，并将用户提供的文本提交到对应服务以生成事件。
  LLM/Agent providers (e.g., Zhipu/Bailian/OpenAI‑compatible): used only if the user selects that mode; user text is submitted to the provider to generate events.
- 除为实现上述功能外，我们不与任何第三方分享或出售用户数据。
  We do not sell or share data with third parties beyond what is required to provide the functionality above.

---

## 存储与保留 / Storage & Retention
- 所有配置、令牌与日志存储于浏览器本地（`chrome.storage.local`）。
  All settings, tokens, and logs are stored locally (`chrome.storage.local`).
- 我们不在自有服务器存储用户数据。
  We do not store user data on our own servers.
- 用户可随时在浏览器中清除扩展数据，或卸载扩展以删除本地数据。
  Users may clear extension data at any time or uninstall the Extension to delete local data.

---

## 用户控制 / User Control
- 撤销 Google 授权：访问 https://myaccount.google.com/permissions 撤销本扩展的访问。
  Revoke Google access at https://myaccount.google.com/permissions
- 清除本地数据：在扩展设置中清除，或卸载扩展。
  Clear local data via extension settings or by uninstalling the Extension.
- 站点权限：用户自定义站点通过“可选主机权限”按需申请；用户可在请求弹窗中拒绝或在浏览器设置中撤回。
  Site access: optional host permissions are requested just‑in‑time for user‑defined sites; users can decline or revoke them in the browser.

---

## 安全 / Security
- 当前版本不注入页面内容脚本，不跟踪浏览历史。
  No content script injection in the current version; no browsing history tracking.
- 仅访问用户配置的站点/服务；权限按需申请，遵循最小权限原则。
  Access only user‑configured sites/services; permissions are requested on‑demand following the least‑privilege principle.

---

## 变更 / Changes
我们可能会不时更新本政策；变更后将更新“最后更新”日期。
We may update this policy from time to time; the “Last updated” date will be adjusted accordingly.

---

## 联系方式 / Contact
如对本政策有任何问题或请求，请联系：your-email@example.com
For inquiries or requests regarding this policy, please contact: your-email@example.com
