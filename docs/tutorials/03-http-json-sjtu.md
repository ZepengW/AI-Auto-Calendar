# 案例 3：HTTP 自动化（结构化 JSON）→ 映射解析 → 同步（以上海交通大学“交我办日历”为例）

本教程演示如何配置“任务”，定时从 HTTP 接口拉取结构化数据，通过 JSON 路径直取 + 字段映射得到事件，自动同步到日历服务器。

> 说明：示例以 SJTU “交我办日历”相关接口为背景，实际接口请以你的场景为准；若接口返回的就是结构化 JSON，推荐优先使用 JSON 映射，速度更快、更稳定，无需调用 LLM。

## 前提
- 已添加“上传服务器”节点（Radicale 或 Google）并可正常上传。
- 已添加“解析节点：json_mapping”（字段映射解析器）。
- 已为目标接口域名授予可选 Host 权限（设置页顶部可一键申请）。

## 关键概念
- 任务（Task）：指定“数据 URL、解析器/JSON 路径、上传服务器、调度方式”的自动化单元。
- JSON 路径（多行）：用于在返回体中定位“事件列表”节点，支持：
  - 语法：`path = seg(.seg)*`，`seg = key | key[index] | key[*] | [index] | [*]`
  - 例如：`data.events[*]`、`data.schoolCalendar.events[*]`、`payload[0].items[*]`
- 字段映射（fieldMap）：把每个列表元素中的 `title/startTime/endTime/location/uid/description` 指向对应字段名集合（不区分单复数）。

## 步骤
1. 新建解析节点（或编辑现有 `json_mapping`）：
   - 在“设置 → 解析节点”新增，类型选择 `json_mapping`。
   - 在“字段映射”中填写：
     - title: 例如 `title,summary,name`
     - startTime: 例如 `startTime,begin,start`
     - endTime: 例如 `endTime,finish,end`
     - location: 例如 `location,place`
     - uid: 例如 `uid,id,eventId`（留空则自动生成）
     - description: 例如 `description,desc,detail`
   - “默认值”可留空或按需补全。
   - 保存解析器。

2. 新建任务：
   - 进入“设置 → 页面/接口任务 → 新增”。
   - 名称：如 `SJTU-Cal`；日历名称：如 `SJTU-<你的账号>`。
   - URL：填写接口地址（示例：`https://calendar.sjtu.edu.cn/api/event/list`）。
   - JSON 路径：例如 `data.events[*]`（可多行，每行一条）。
   - 解析器：选择刚才的 `json_mapping`（若不选，仍可走直取/LLM 兜底，推荐显式选择）。
   - 上传服务器：选择你的 Radicale/Google 目标。
   - 调度：
     - 勾选“间隔”并设为如 `60` 分钟，或
     - 勾选“时点”添加若干 `HH:mm`（每天固定时刻），或
     - 勾选“访问页面触发”，并设置 URL 前缀（如 `https://calendar.sjtu.edu.cn/api`）。
   - 预热（可选）：
     - 若接口需要登录态，可填入“预热 URL”（如: `my.sjtu.edu.cn`），勾选“静默打开”，设置“等待毫秒”（如 `3000`），便于刷新 Cookie。
   - 保存任务。

3. 试运行：
   - 在任务列表点击“运行”，观察顶部状态；
   - 或在“任务日志”面板查看最近的触发/结果日志（成功/失败、耗时、增加条数、模式等）。

## 成功判定
- 任务运行后，右上角会弹出通知，提示“完成/失败、新增数量、总量”。
- Radicale：浏览器控制台/服务端可见 PUT 请求；.ics 文件被合并写入。
- Google：目标日历新增或更新对应事件；插件会按 `title+start+end+location` 去重合并。

## 常见问题
- 无法访问接口：
  - 先在设置页“申请所需站点权限”；
  - 需要登录的系统请使用“预热 URL”打开登录页，让浏览器恢复 Cookie 后再抓取。
- JSON 路径找不到列表：
  - 用浏览器打开接口，复制完整 JSON 返回，粘贴到“解析页”启用“JSON 模式”试算路径；
  - 多行路径可覆盖多种返回结构，插件会收集到最多 200 条节点作为候选。
- 时间字段格式混杂：
  - 插件支持 `YYYY-MM-DD HH:mm`、`YYYY/MM/DD HH:mm`、ISO 带/不带时区、`YYYYMMDDTHHmmssZ/+0800` 等；
  - 仍解析失败时，可在“字段映射 → 默认值”中提供可回退值，或在上传前人工修订。
- Google 授权与日历选择：
  - 首次访问会 silent 获取浏览器令牌，不行再弹窗交互；
  - “日历名称”若不存在会尝试创建；也可在服务器节点中配置默认 `calendarId`。
