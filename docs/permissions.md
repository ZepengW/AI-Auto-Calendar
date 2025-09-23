# 权限说明 / Permissions

用于 Chrome 网上应用店上架的权限用途说明，覆盖 `permissions`、`host_permissions`、`optional_host_permissions` 与内容脚本匹配范围。
Explanation of all requested permissions for Chrome Web Store review, covering `permissions`, `host_permissions`, `optional_host_permissions`, and content script matches.

---

## 一、Permissions（通用权限 / General permissions）

### 1) storage
用于保存用户配置（上传服务器、解析节点、任务调度、授权状态等）与运行日志，存储在浏览器本地（chrome.storage.local），不会上传到第三方服务器。\
Stores user settings (servers, parsers, tasks, auth status) and run logs locally via chrome.storage.local. No data is sent to third-party services.

### 2) alarms
用于按计划触发任务（定时间隔/指定时点）和后台同步（例如定期从接口抓取并解析日程）。\
Schedules background jobs at intervals or specific times to fetch/parse/sync events.

### 3) notifications
在解析/同步完成或失败时，显示系统通知提醒用户（例如“新增 X 条事件”或“授权失败”）。\
Shows user-facing system notifications upon task completion/failure (e.g., "Added X events" or auth errors).

### 4) contextMenus
在网页右键菜单中提供“日程解析”入口，便于对选中文本一键解析与上传。\
Adds a right-click menu item ("Parse to calendar") to process selected text quickly.

### 5) scripting
在个别页面上需要动态注入内容脚本，以读取用户显式选中的文本或在采集失败时回退注入，从而抓取可见文本。仅在相关页面（或用户发起的操作）时使用。\
Dynamically injects content scripts when needed to read explicitly selected text or to capture visible text as a fallback. Only used on relevant pages or user-triggered flows.

### 6) identity
用于 Google Calendar 的浏览器身份授权（chrome.identity），在用户明确授权后获取访问令牌，以便代表用户写入其 Google 日历。令牌只保存在本地配置。\
Enables Google Calendar auth via chrome.identity. After explicit user consent, obtains access tokens to write to the user’s Google Calendar. Tokens are stored locally.

### 7) webNavigation
用于“访问页面触发”型任务（URL 前缀匹配）。仅检测用户访问是否匹配已配置前缀，用于触发任务；不读取页面内容，不记录浏览历史。\
Triggers tasks when the user navigates to URLs matching configured prefixes. Does not read page content or store browsing history; only used to detect eligible navigations.

---

## 二、host_permissions（预置主机权限 / Preconfigured hosts）

除以下预置主机外，其他站点均通过可选主机权限在运行时按需动态添加与授权（见下一节）。\
Besides the preconfigured hosts below, all other sites are dynamically added and authorized at runtime via optional host permissions (see next section).

### A) https://open.bigmodel.cn/*
调用智谱大模型/智能体 API，对非结构化文本进行日程抽取。仅在用户选择该解析节点时访问。
Calls Zhipu (BigModel) agent APIs to extract events from free text. Used only when this parser is selected.

### B) https://www.googleapis.com/* 与 https://oauth2.googleapis.com/*
Google Calendar API（创建/列出/写入事件）与 OAuth2 令牌交换/刷新。仅在用户添加 Google 服务器节点并授权后使用。
Google Calendar API for listing/creating events and OAuth2 token exchange/refresh, only after the user adds a Google server and grants access.

---

## 三、optional_host_permissions（动态主机权限 / Dynamic, on-demand）

### F) http://*/* 与 https://*/*
用于“用户自定义的任务 URL 或预热 URL”。扩展会在运行前按需弹窗申请对应站点权限（最小化授权），仅当用户配置了该站点的任务/预热时才申请；授权后只访问该被允许的站点。
Optional, on-demand origins for user-configured task URLs or warmup URLs. The extension requests just-in-time permission only when needed, and accesses only the granted origins.

---

## 四、内容脚本（无注入 / No content scripts）

扩展不在页面中注入内容脚本。右键菜单解析会将选中文本带入内置解析页处理；页面采集使用直接抓取 HTML 并剥离标签的方式实现。
The extension does not inject content scripts. The context menu flow passes the selected text to the built-in parse page; page capture is handled by fetching HTML and stripping tags.

---

## 五、合规与最小化原则（Compliance & Least-Privilege）

只在必要时请求权限：SJTU、Radicale、Google、Zhipu 等域名为默认能力或示例场景所需；用户自定义接口域名通过“可选主机权限”在使用前按需申请。
Request permissions only when necessary: fixed hosts cover default capabilities or example scenarios; user-defined sites are requested via optional permissions just-in-time.

不采集隐私：仅处理用户明确提供的文本、用户配置的接口返回或目标日历写入，不读取或存储用户的其他浏览数据。
No privacy-invasive collection: only processes user-provided text, user-configured API responses, or writes to the target calendar; it does not read or store other browsing data.

令牌本地存储：Google 授权令牌仅保存在本地扩展存储中，用户可随时撤销权限。
Tokens stored locally: Google OAuth tokens are stored in extension storage; users can revoke access anytime.

用户可见动作：右键菜单与解析页均为用户主动操作；定时任务需用户在设置中明确开启。
User-visible actions: context menu and parse page are user-triggered; scheduled tasks are explicitly configured by the user.
