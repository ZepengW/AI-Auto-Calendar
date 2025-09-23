# AI Auto Calendar（Chrome 扩展）

将“获取→解析→同步”三步打通的一体化日程自动化插件：

- 获取：HTTP 抓取接口数据，或直接在网页中选中文本，一键送入解析；也支持访问页面触发任务。
- 解析：可调用大模型（LLM/智能体）或使用 JSON 映射，将非/半结构化信息转成标准事件。
- 同步：把事件合并上传到多种日历服务器（Radicale、Google 日历 等）。

适合会议/课表/活动公告等“非结构化文本”“半结构化接口”的快速落地与自动同步。

— 案例直达 —
- 案例 1：任意文本→LLM 解析→上传到日历服务器（粘贴即用）
	- docs/tutorials/01-free-text-llm.md
- 案例 2：在网页中选中一段文本→右键解析并上传
	- docs/tutorials/02-web-selection.md
- 案例 3：HTTP 自动化拉取结构化数据（以上海交通大学“交我办日历”为例）→JSON 映射→同步
	- docs/tutorials/03-http-json-sjtu.md


## 功能特性
- 解析节点多样化
	- `zhipu_agent`（智谱应用/智能体 API）
	- `chatgpt_agent`（OpenAI 兼容 Chat Completions）
	- `bailian_agent`（阿里云百炼 Apps Completion）
	- `json_mapping`（面向结构化 JSON 的字段映射）
- 上传服务器可插拔
	- `radicale`（PUT 合并上传 .ics）
	- `google`（Google Calendar API，支持浏览器身份或 OAuth 授权）
- 任务化调度与触发
	- 定时间隔（每 N 分钟）、指定时刻（HH:mm 多时点）、访问页面触发（URL 前缀匹配）
	- 可选“预热”URL（打开后台页刷新登录态），支持等待毫秒
- 快捷操作与独立页面
	- 右键选中文本→“日程解析”
	- 弹窗粘贴自由文本→解析并上传/下载 ICS
	- 独立解析页 `parse.html`：可编辑事件、选择服务器、批量下载 ICS
- 权限与体验
	- 使用可选 Host 权限（on-demand 请求），仅在需要访问的域名上申请
	- 解析/任务/服务器均独立配置，互不影响


## 安装与载入
方式 A：Chrome 网上应用店（推荐）
- 在 Chrome Web Store 搜索 “AI Auto Calendar”（或使用本仓库发布页提供的链接），点击“添加至 Chrome”。

方式 B：开发者模式本地加载
1) Chrome 打开 `chrome://extensions`，开启“开发者模式”。
2) 选择“加载已解压的扩展程序”，指向本项目根目录。
3) 加载后，工具栏点击图标打开弹窗，或在右键菜单中看到“日程解析”。

可选：`config/dev.json` 可覆写部分默认配置（例如 Google Client ID）。


## 首次配置（必读）
1) 新建“上传服务器”节点（选一种）：
	 - Radicale：填写 `base`（如 `http://127.0.0.1:5232`）、`username`、`auth`（Basic 令牌，留空则匿名）。
	 - Google：保存后点击“Google 授权”（支持 Manifest Identity 或 OAuth2 PKCE），授权成功后可向目标日历写入事件。
	 - 可在“默认服务器”下拉框选择日常使用的目标。
2) 新建“解析节点”（选一种或多种）：
	 - 智谱/ChatGPT/百炼：填入对应 `apiKey`（以及模型/agentId 等）。
	 - JSON 映射：用于“结构化 JSON 列表” → “事件字段”的映射（字段名不统一也可通过映射表兼容）。
3) 授权站点权限：设置页顶部若提示“缺少访问权限”，一键“申请所需站点权限”。


## 典型用法速览（案例）
- 粘贴任意文本并上传
	1. 打开 `parse.html`，粘贴文本 → 选择解析节点/服务器 → 点击“解析”。
	2. 如有需要，在表格中修订标题/时间/地点 → “上传所选”或“下载 ICS”。
	3. 详见 docs/tutorials/01-free-text-llm.md
- 网页中框选一段内容解析
	1. 在网页选中一段邀请/活动文本 → 右键“日程解析”。
	2. 跳转解析页后同上操作。详见 docs/tutorials/02-web-selection.md
- HTTP 自动化拉取并同步（结构化接口）
	1. 设置 JSON 映射解析节点；新建“任务”，填入接口 URL、JSON 路径、调度方式与服务器。
	2. 任务按计划拉取 → 解析 → 合并上传。详见 docs/tutorials/03-http-json-sjtu.md


## 权限与隐私
- 可选 Host 权限：仅在需要访问的域名上申请。可通过设置页“授权”按钮一次性申请所有任务/解析器/服务器所需权限。
- 存储：所有本地配置保存在 `chrome.storage.local`，不上传到任何第三方。
- 网络：仅在你发起的解析/任务执行时访问配置的 API/页面。Google 授权令牌（若启用）保存在扩展本地配置中。

详细权限用途说明（上架材料）：`docs/permissions.md`


## 常见问题（FAQ）
- 解析失败/无事件？
	- LLM 输出非严格 JSON 时会被拒绝；可在“解析页”预览并手动修订字段再上传。
	- 对于结构化接口，优先使用 `json_mapping`，通过 JSON 路径直取再映射。
- 时间解析不准确？
	- 插件支持多种时间格式：`YYYY-MM-DD HH:mm`、ISO 带时区、`YYYYMMDDTHHmmssZ/+0800` 等。
	- 生成 ICS 默认以 UTC 存储（`Z`），日历客户端会按本地时区显示。
- Google 授权失败？
	- 确保设置页看到 `https://<扩展ID>.chromiumapp.org/` 作为回调地址。
	- 先尝试浏览器 Identity（无 client_secret），不成再改用 OAuth2（PKCE）。
- 没有看到权限弹窗？
	- 进入设置页顶部点击“申请所需站点权限”。


## 开发与贡献
- 代码风格：`eslint` + `prettier`
- 快速检查：
	- `npm run lint`
	- `npm run check-format`
- 构建：当前为纯 MV3 原生脚本，无打包步骤。


## 许可
本项目仅供学习与个人使用，请遵循目标站点/服务的使用条款与数据合规要求。

— 完整案例请见 `docs/tutorials/` 目录。