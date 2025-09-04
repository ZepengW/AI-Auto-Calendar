# SJTU Auto Calendar (Chrome 扩展)

将原 Tampermonkey 油猴脚本迁移为 MV3 Chrome 扩展：

功能：
- 定时（`chrome.alarms`）抓取 `calendar.sjtu.edu.cn` 事件并生成 ICS 上传至自建 Radicale
- 右键菜单 / Popup / 快捷键（Ctrl+Shift+P 在页面内）选中文本 -> 调用 LLM 解析 -> 上传为独立日历 (LLM-Parsed)
- Options 页面配置 Radicale / LLM 参数
- 系统通知与页面内 toast
 - Popup 中的 “日程解析” 若当前标签未注入 content script，会自动打开 `https://my.sjtu.edu.cn/ui/calendar` 并在加载后弹出输入窗口；同样支持在 `calendar.sjtu.edu.cn` 域内直接弹出。
 - 独立自由文本解析页面 `parse.html`：支持批量输入 -> LLM 解析 -> 人工勾选/编辑 -> 上传

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

## 与油猴版本差异
- 使用 `chrome.storage.local` 替换 GM_* API
- 跨标签 BroadcastChannel 锁被简化；同步由后台 service worker 统一调度
- UI 设置面板改为标准 Options Page
- LLM 解析在后台执行，结果通过通知与 content script toast 展示

## 后续改进建议
- 加入构建工具 (Rollup / Vite) 以支持模块化与压缩
- 增加错误追踪与重试策略，区分 401 自动刷新登录
- 支持更多 LLM Provider & 可配置解析 Prompt
- 增加导出/导入配置按钮
- 增加日志查看 (chrome://extensions -> service worker 日志)

## 简单测试
1. 在 Options 设置 Radicale & LLM Key (Agent + Key + API URL)
2. Popup 点击 “日程解析” -> 打开新标签 `parse.html`
3. 输入多条自然语言事件描述 -> 调用 LLM 解析 -> 勾选需要上传 -> 上传
4. 任意注入页面选中文本 -> 右键“日程解析”/快捷键 Ctrl+Shift+P -> 快速解析并上传
5. Popup 点击 “立即同步” 校历 -> 生成/更新 `SJTU-<account>.ics`

## 图标
请自行添加 `icons/icon16.png` `icon48.png` `icon128.png`。
