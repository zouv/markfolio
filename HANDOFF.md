# MarkFolio · 接力状态

## 状态快照

- 最近更新：2026-11-19；分支 main；版本 0.3.0；远程 origin = https://github.com/zouv/markfolio.git。
- 本轮程序名（`MarkFolio.exe`）、暖黄 folio 图标（含应用内图标）、自绘标题栏/文件页签/Ctrl+P 快速搜索与规范关于对话框（作者 @zouv）已完成并发布为 0.3.0；0.2.0 旧包原生验收仍暂停，0.3.0 待重新打包与验收。
- 最后验证：44 项 Node、31 项 Rust + 2 项默认忽略（真实 OneNote/PDF 此前已通过）、30 项界面测试通过；fmt/clippy/tsc、check-docs 通过；隔离测试实例已实测标题栏、页签、Ctrl+P、最大化/还原与应用菜单；界面测试覆盖关于对话框关闭路径与焦点循环。
- dist 现有 0.2.0 包仍是旧界面；需重新打包 0.3.0 后才能交付标题栏/页签/搜索/关于改动。

## 当前任务

无进行中任务。剩余：重新打包并做真实窗口/页签验收；0.2.0 旧包原生验收暂停。

## 进行中

- [ ] 重新运行 `sh manager.sh package`，核对 0.3.0 安装器/免安装包包含新标题栏、文件页签、Ctrl+P 与关于对话框。
- [ ] 等待用户验收自绘标题栏（拖动/双击最大化/边缘缩放/窗口命令）、工作目录页签与文件页签交互。

## 下一步

1. 打包前先跑 `sh manager.sh check`、`sh manager.sh test`、`sh manager.sh test-ui` 与 `sh check-docs.sh`；然后 `sh manager.sh package`。
2. 用真实窗口验收标题栏拖动/缩放、页签关闭/排序、Ctrl+P 跨目录搜索；发现问题后重跑检查与打包。

## 进行中（旧任务）

- [ ] 暂停：0.2.0 原生验收（真实目录/保存冲突、原生菜单/文件操作、退出与插件入口）与最终交付核对。

## 下一步（旧任务）

1. 恢复 0.2.0 原生验收，样本仅 `.runtime/`；物理 Esc 立即停输入，锁屏则提示解锁。
2. 验收后核对最终产物并完成交付；若验收发现需改源码，必须重跑 check/test/package 与包校验。

## 续作位置

- 标题栏：`src/components/TitleBar.tsx`；文件页签：`src/components/FileTabs.tsx`；快速搜索：`NoteManagement.tsx` 的 QuickOpen；store 动作 `moveWorkspace`/`closeDocument`。
- 窗口：主窗口与笔记窗口 `decorations=false`；capabilities 额外开放 minimize/toggle-maximize/start-dragging/start-resize-dragging；原生菜单保持挂载但隐藏且不注册加速键，快捷键统一由 App 的 keyboard 处理器执行。
- scripts/package.mjs 优先按 `mainBinaryName`、其次 Cargo `[[bin]]` 名称收集 target 二进制，并复制 README/CHANGELOG/ROADMAP/docs、示例、扩展和许可。
- docs/icons/ 是图标唯一源：`markfolio.svg` + `_build.py` 生成 PNG/ICO/ICNS 并安装到 `src-tauri/icons`；模板自带的 Store/Android/iOS 图标已移除。
- UI 测试：`tests/ui/titlebar.spec.ts` 覆盖标题栏/文件页签/Ctrl+P；`support.ts` 通过应用菜单打开设置；playwright 本地复用 Vite，webServer 超时 180s（首次资产同步约 1 分钟）。
- README/docs/00/02、ARCH、CHANGELOG 和 ROADMAP 已同步；原生验收与最终交付状态未完成。
- 版本唯一来源 `src-tauri/Cargo.toml`（当前 0.3.0）；远程 origin 已关联，发布时只改 Cargo.toml 并归档 CHANGELOG。
- 0.3.0 使用自有 SDK；不假设可直接安装 Obsidian 插件，不虚构真实 AI/更新/仓库服务。

<!-- vibe-coding-starter 2026-11-11.1 · 文档体系版本标记 -->
