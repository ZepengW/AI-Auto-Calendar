# SJTU Auto Calendar (Chrome 扩展)

将原 Tampermonkey 油猴脚本迁移为 MV3 Chrome 扩展：

功能（V3 概览）：
- 校历抓取：定时（`chrome.alarms`）获取 `calendar.sjtu.edu.cn` 事件并生成 ICS 上传到自建 Radicale
- 多任务页面解析：自定义若干“HTTP_GET_JSON”任务，支持 周期/指定时间点 调度；支持 LLM 解析或 JSON 直接提取
- 右键/快捷键/Popup 自由文本解析：选中文本或粘贴自然语言 -> LLM -> 上传到 `LLM-Parsed` 日历（合并去重）
- Options 页面集中配置 Radicale / LLM / 多任务调度
- 通知 & 内部 toast 反馈执行结果
- `parse.html` 自由文本批量解析与手动确认上传
- 上传合并：所有写入日历均采取“现有 ICS 拉取 + 合并 + PUT”避免覆盖历史事件（冲突基于 标题+开始时间+结束时间+地点 签名）

## 目录结构
```
SJTU-Auto-Calendar/
  manifest.json
  options.html
  popup.html
  src/
    background.js
    content.js
    shared.js
  icons/ (放置 icon16.png, icon48.png, icon128.png)
```

## 开发与加载
1. `pnpm i` (可选，仅若后续加入打包工具；当前纯原生 JS 无需构建)
2. Chrome -> 扩展程序 -> 开发者模式 -> 加载已解压的扩展 -> 选择 `SJTU-Auto-Calendar` 目录
3. 打开 `my.sjtu.edu.cn/ui/calendar` 页面确认右下角是否出现操作（目前只注入 toast/快捷键与解析弹窗入口，可按 Ctrl+Shift+P）。
4. 右键选中文本，使用扩展图标菜单或右键菜单解析。

## 权限说明
- storage: 保存配置
- alarms: 定时同步
- notifications: 同步/解析提示
- contextMenus: 右键菜单
- host_permissions: 访问 SJTU 日历、Radicale、本地 LLM 或 API
 - optional_host_permissions: 动态申请用户自定义 Radicale 服务器地址（保存设置时自动请求）

### 自定义 Radicale 服务器与 CORS
1. 在 Options 中填入 `Radicale Base`（例如 `http://118.25.148.28:5232`）并保存，会自动申请该源的 host 权限。
2. 若上传时报 `No 'Access-Control-Allow-Origin'`：这是服务器未返回 CORS 允许头。解决方案：
   - 推荐：在 Radicale 前加一个反向代理 (Nginx/Caddy) 添加：
     `Access-Control-Allow-Origin: *`
     `Access-Control-Allow-Methods: GET, PUT, OPTIONS`
     `Access-Control-Allow-Headers: Authorization, Content-Type`
   - 或本地使用浏览器调试禁用 CORS 仅限测试，不建议生产。
3. 权限缺失提示：扩展会通知“缺少服务器权限”，重新到设置保存即可重新触发申请。

## 与油猴版本差异
- 使用 `chrome.storage.local` 替换 GM_* API
- 跨标签 BroadcastChannel 锁被简化；同步由后台 service worker 统一调度
- UI 设置面板改为标准 Options Page
- LLM 解析在后台执行，结果通过通知与 content script toast 展示
 - 新增 ICS 合并：上传前若目标为 `LLM-Parsed`，会先 GET 现有 ICS，解析合并后再 PUT

## LLM 合并策略说明
1. 读取远程 `LLM-Parsed.ics`（若不存在视为空）
2. 解析已有事件：提取 UID / SUMMARY / DTSTART / DTEND / LOCATION
3. 新事件标准化后计算签名：`title|startISO|endISO|location`（全部转小写）
4. 若签名冲突：使用新事件覆盖旧属性，保留旧 UID（若旧有 UID 新没有）
5. 重新生成 ICS 全量 PUT 回服务器

注意：
- 同一时间段同地点同标题视为同一事件（大小写不敏感）
- 若希望强制产生新条目，可微调标题或地点（例如加后缀）
- 目前未处理 RRULE/重复事件；如 LLM 返回重复规则需扩展

## 后续改进建议
- 加入构建工具 (Rollup / Vite) 以支持模块化与压缩
- 增加错误追踪与重试策略，区分 401 自动刷新登录
- 支持更多 LLM Provider & 可配置解析 Prompt
- 增加导出/导入配置按钮
- 增加日志查看 (chrome://extensions -> service worker 日志)

## V3 多任务模型

存储键：`pageTasks`，元素结构：

```
{
  id: string,
  name: string,            // 任务名称（展示）
  calendarName: string,    // 上传目标日历文件 (Radicale /<user>/<calendarName>.ics)
  enabled: boolean,
  scheduleType: 'interval' | 'times',
  intervalMinutes?: number,// scheduleType=interval 时有效
  times?: string[],        // scheduleType=times 时有效，格式 HH:mm
  mode: 'HTTP_GET_JSON',   // 预留未来扩展其它模式
  modeConfig: {
    url: string,
    jsonPaths: string,     // 多行路径：direct 下用于提取；llm 下用于预裁剪/降噪（若响应为 JSON）
    parseMode: 'llm' | 'direct' // llm: 先按 jsonPaths 预裁剪再送 LLM；direct: 路径提取失败自动回退 LLM
  }
}
```

闹钟命名：
- 周期任务：`PAGE_TASK_INTERVAL_<taskId>`
- 时间点任务：`PAGE_TASK_TIME_<taskId>_<index>` 每次触发后重新排下一天同一时间。

### 模式：HTTP_GET_JSON

1. GET 目标 URL（含 cookie 会话，可用于需登陆页的接口）
2. 若 parseMode=direct：按 `jsonPaths` 逐行提取候选节点集合 -> 识别事件；若结果为空 -> 自动回退 LLM（保证可用性）
3. 若 parseMode=llm：
  - 若响应是 JSON 且配置了 `jsonPaths`，先按路径抽取对象数组 => 生成一个“精简 JSON 片段”作为 LLM 输入 (降低噪声/字数)
  - 否则使用原始去标签文本前 4000 字
4. LLM 返回结构化事件数组；任何模式成功后进行合并上传到 `calendarName.ics`

### JSON 路径 DSL（轻量自定义语法）

任务中填写多行“路径”，每行一条：
- direct 模式：匹配到的对象或数组元素尝试识别事件
- llm 模式：匹配到的片段集合序列化为精简 JSON 送入 LLM（降低噪声）

支持的最小语法（不是完整 JSONPath）：

| 形式 | 含义 |
|------|------|
| `key` | 访问对象属性 |
| `key[数字]` | 访问数组属性的第 N 项 |
| `key[*]` | 展开该属性数组所有元素 |
| `[数字]` | 当前数组的第 N 项 |
| `[*]` | 展开当前数组所有元素 |

可级联：`a.b[0].c[*]`

展开(Flatten)规则：
1. 只有路径最后显式使用 `[*]` 或 `[数字]` 的时候，命中的数组会被展开为“其元素”。
2. 如果路径最后只是到达一个数组（例如 `data.events`），则整个数组作为一个整体片段被保留，不会自动拆散。
3. 这样可以保留逻辑上需要整体语义的列表，也可以在需要时显式展开。

示例：
```
data                # 整个 data 对象
data.events         # events 数组整体
data.events[*]      # events 中每个事件单独加入
data.events[0]      # 只取第 0 个事件
data.schoolCalendar.events[*]
```

direct 模式事件识别字段：
- 标题：`title` / `summary` / `name`
- 开始：`startTime` / `begin` / `start`
- 结束：`endTime` / `end` / `finish`
可选：`location` / `place`；`status`

时间解析顺序：`parseSJTUTime` -> `parseLLMTime` -> 原字符串（失败则跳过该事件）。

不支持的语法（直接忽略）：过滤 `[?()]`、范围 `[0:5]`、多索引 `[0,2]`、递归 `..`、任意表达式。

示例：针对 SJTU 日历接口返回：
```
{"status":200,"msg":"success","success":true,"data":{"schoolCalendar":{"weeks":[],"calendarId":"schoolCalendar","events":[{"titleEn":"开学","startTime":"2025-09-15 00:00","endTime":"2025-09-15 23:59","title":"开学"}]},"events":[{"eventId":"...","title":"子衿街...","startTime":"2025-09-10 20:00","endTime":"2025-09-10 21:00"}]}}
```
可配置路径示例：
```
data.events[*]
data.schoolCalendar.events[*]
```
两行合并得到所有事件；若只写 `data.events` 则会把数组整体作为一个片段（llm 模式下依然有效，但 direct 模式需要展开才能识别每个元素，故 direct 建议使用 `[*]`）。

### 任务示例

```
{
  id: "task-abc",
  name: "教务-校历",
  calendarName: "SJTU-SCHOOL",
  enabled: true,
  scheduleType: "times",
  times: ["08:30", "14:00"],
  mode: "HTTP_GET_JSON",
  modeConfig: {
    url: "https://calendar.sjtu.edu.cn/api/event/list?...",
    jsonPaths: "data.events[*]\ndata.schoolCalendar.events[*]",
    parseMode: "direct" // 或 "llm"（llm 下仍会读取上述路径裁剪上下文）
  }
}
```

### 迁移
- 旧版单任务字段与 `pageParseTasks` 会在后台首次运行时自动转换为上述结构 (id=legacy-single / migr-*)。
- 旧字段清理后不再写回（只保留 `pageTasks`）。

### Popup / Options 行为
- Options 中统一新增/编辑任务（支持 scheduleType 切换）。
- Popup 中可快速运行、编辑与新增；编辑字段与 Options 对齐。
- direct 模式无匹配或解析为空 -> 自动回退 LLM，保障最大可用性。


### 常见问题 (FAQ)

1. 路径写错/字段不存在 => 对应行忽略，不影响其他路径。
2. direct 解析为空 => 会自动回退 LLM；旧说明已过期。
3. 时间格式解析失败 => 事件被跳过；确认 JSON 是否含秒/时区，必要时扩展 `parseLLMTime`。
4. 需要更复杂筛选/计算 => 暂未内置表达式，可在后续版本加入 filter 语法（例如 `[?startTime>=...]`）。


## 简单测试
1. 在 Options 设置 Radicale & LLM Key (Agent + Key + API URL)
2. Popup 点击 “日程解析” -> 打开新标签 `parse.html`
3. 输入多条自然语言事件描述 -> 调用 LLM 解析 -> 勾选需要上传 -> 上传
4. 任意注入页面选中文本 -> 右键“日程解析”/快捷键 Ctrl+Shift+P -> 快速解析并上传
5. Popup 点击 “立即同步” 校历 -> 生成/更新 `SJTU-<account>.ics`

## 图标
请自行添加 `icons/icon16.png` `icon48.png` `icon128.png`。
