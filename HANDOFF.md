# MarkFolio · 接力状态

## 状态快照

- 最近更新：2026-11-20；分支 main；源码版本 0.4.0（已 bump，未提交）；远程 origin = https://github.com/zouv/markfolio.git。
- 本轮完成：标题栏新增独立菜单栏（MenuBar 读取 menu.json，位于应用图标右侧、页签左侧）；应用菜单“设置…”文案；修复文件列表宽度手柄错位；修复关闭到托盘时误报 `failed to send message to the webview`（hide 响应失败按隐藏成功处理）。
- 本轮前 0.3.0 程序名、暖黄图标、自绘标题栏/文件页签/Ctrl+P 快速搜索与关于对话框已完成；0.3.0 待重新打包与原生验收。
- 最后验证：44 项 Node、32 项 Rust + 2 项默认忽略、34 项界面测试通过；fmt/clippy/tsc、check-docs 通过。托盘误报修复已通过代码检查，真实窗口待重打包后复测。
- dist 现有 0.3.0 包；0.4.0 打包因 MarkFolio 运行实例占用而暂停。

## 当前任务

发布 0.4.0（进行中）：代码、版本号、CHANGELOG 与 Release Notes 已就绪；打包被运行中的 `src-tauri/target/debug/MarkFolio.exe` 阻塞，等待用户退出应用后重跑。

## 进行中

- [ ] 用户完全退出 MarkFolio 后运行 `sh manager.sh package`，核对 0.4.0 产物与 SHA256SUMS。
- [ ] 用新构建复测 AHK 前台关闭到托盘：恢复窗口后不再出现“关闭已取消：failed to send message to the webview”。
- [ ] 打包成功后提交、打 `v0.4.0` 标签、推送 main 并上传 GitHub Release。

## 待验收

- [ ] 应用菜单：无顶部图标/名称；“设置…”；“打开最近”二级菜单可列出并重新打开最近目录；关于项为“关于…”；退出为普通色并显示 `Alt+F4`。
- [ ] 标题栏菜单栏：应用图标右侧独立区域，文件/编辑/视图等分组可展开、执行并按状态勾选；窄窗口下不挤坏页签。
- [ ] 宽度手柄：左侧手柄只改目录栏宽度，第二个手柄在文件列表与编辑器之间，只改文件列表宽度。
- [ ] 设置 → 桌面：“关闭窗口时最小化到托盘”默认不勾选；勾选并应用后关闭主窗口应保存并隐藏到托盘，托盘/双击恢复。
- [ ] 关闭到托盘不再误报 `failed to send message to the webview`。

## 下一步

1. 退出所有 MarkFolio 实例（含托盘），运行 `sh manager.sh package`。
2. 打包成功后按 release 技能提交、打 `v0.4.0` 标签、推送并上传资产；随后清理本任务的 HANDOFF 记录。

## 进行中（旧任务）

- [ ] 暂停：0.2.0 原生验收（真实目录/保存冲突、原生菜单/文件操作、退出与插件入口）与最终交付核对。

## 下一步（旧任务）

1. 恢复 0.2.0 原生验收，样本仅 `.runtime/`；物理 Esc 立即停输入，锁屏则提示解锁。
2. 验收后核对最终产物并完成交付；若验收发现需改源码，必须重跑 check/test/package 与包校验。

## 续作位置

- 标题栏/应用菜单：`src/components/TitleBar.tsx`；标题栏菜单栏：`src/components/MenuBar.tsx`（读取 `src-tauri/menu.json`）；最近目录数据：`src-tauri/src/library.rs` 的 `recent`/`open_recent`/`remember`，IPC 为 `recent_workspaces`/`open_recent_workspace`；store 动作 `openRecentWorkspace`。
- 列宽手柄：`src/App.tsx` 中侧栏手柄调用 `resize(...,"sidebarWidth")`，文件列表手柄 order 为 `Math.min(listOrder, editorOrder)+1`、调用 `resize(...,"listWidth")`；回归测试在 `tests/ui/titlebar.spec.ts`。
- 文件页签：`src/components/FileTabs.tsx`；快速搜索：`NoteManagement.tsx` 的 QuickOpen；store 动作 `moveWorkspace`/`closeDocument`。
- 窗口：主窗口与笔记窗口 `decorations=false`；capabilities 额外开放 minimize/toggle-maximize/start-dragging/start-resize-dragging；原生菜单保持挂载但隐藏且不注册加速键，快捷键统一由 App 的 keyboard 处理器执行。
- 关闭到托盘：`minimizeToTray` + `tray` 同时为真时，App 的 onCloseRequested 先保存再 `hide()`；hide 的 IPC 响应失败要忽略（窗口已隐藏），否则会误报关闭取消；设置入口在 `AdvancedSettings.tsx` 的 desktop 标签。
- scripts/package.mjs 优先按 `mainBinaryName`、其次 Cargo `[[bin]]` 名称收集 target 二进制，并复制 README/CHANGELOG/ROADMAP/docs、示例、扩展和许可。
- docs/icons/ 是图标唯一源：`markfolio.svg` + `_build.py` 生成 PNG/ICO/ICNS 并安装到 `src-tauri/icons`；模板自带的 Store/Android/iOS 图标已移除。
- UI 测试：`tests/ui/titlebar.spec.ts` 覆盖标题栏/文件页签/Ctrl+P/应用菜单；`support.ts` 通过应用菜单打开设置；playwright 本地复用 Vite，webServer 超时 180s。
- 版本唯一来源 `src-tauri/Cargo.toml`（当前 0.4.0）；远程 origin 已关联，发布时只改 Cargo.toml 并归档 CHANGELOG。
- 0.4.0 使用自有 SDK；不假设可直接安装 Obsidian 插件，不虚构真实 AI/更新/仓库服务。

<!-- vibe-coding-starter 2026-11-11.1 · 文档体系版本标记 -->
