# MarkFolio · 接力状态

## 状态快照

- 最近更新：2026-11-26；分支 main；版本 0.5.0；远程 origin = https://github.com/zouv/markfolio.git。
- 0.5.0 已发布：GitHub Release `v0.5.0`（https://github.com/zouv/markfolio/releases/tag/v0.5.0）已上传 Release/Debug zip、MSI、NSIS 与 SHA256SUMS；tag `v0.5.0` 指向发布提交。0.4.1 的 AHK 修复并入 0.5.0，未单独发布。
- 本轮交付：Markdown 实时预览/富文本统一编辑、仅预览铺满、页签/文档列表/工作目录右键菜单与完整路径复制、可视化移动目录选择器、紧凑布局、侧栏工作区标题与文档列表交互优化。
- 最后验证：`sh manager.sh check`（fmt/clippy/tsc）、44 项 Node、32 项 Rust 集成（+2 项默认忽略，单线程）、53 项界面测试、`npm run web:build`、完整 `sh manager.sh package` 与 `sh check-docs.sh --strict` 均通过。Rust 并行全套仍偶发本地 API socket `10053`，单线程通过。
- 0.4.0 及更早的原生验收仍独立待补；0.5.0 真实桌面验收待用户完成。

## 当前任务

无进行中任务。0.5.0 已交付，等待用户桌面验收；验收发现问题时再开新任务。

## 待验收

- [ ] 0.5.0 安装包/免安装包可启动、版本显示 0.5.0，真实目录保存/冲突/编码行为正常。
- [ ] 编辑体验：Markdown 实时预览、富文本工具栏、复杂块点击进源码、仅预览铺满、选区可见。
- [ ] 右键菜单：复制完整路径写入系统剪贴板、资源管理器打开目录、目录/空白菜单、菜单打开时右键另一项直接切换、移动目录选择器。
- [ ] 布局：中间栏/标题区紧凑、侧栏工作区名与分隔线、暗色主题标题/目录名可读。
- [ ] 旧任务：0.2.0/0.4.0 原生操作验收（真实目录、原生菜单/窗口/托盘等）仍暂停。

## 下一步

1. 用户验收 0.5.0；通过后按需发 0.5.1 / 0.6.0。
2. 若验收发现问题，在 HANDOFF 新开任务并更新 ROADMAP/CHANGELOG。
3. 不自动重启被用户关闭的应用；真实桌面/DPI/外部互通未测项不得写成已验证。

## 进行中（旧任务）

- [ ] 暂停：0.2.0/0.4.0 原生验收（真实目录/保存冲突、原生菜单/文件操作、退出与插件入口）。

## 续作位置

- 实时预览：`src/livePreview.ts` 的 `buildDecorations`/`livePreview`；块级 widget 必须走 StateField，不要在 ViewPlugin 里返回 block 装饰。
- 编辑器命令：`src/Editor.tsx` 的 `editorActions.format`/`toggleInline`/`toggleLinePrefix`/`toggleCodeBlock`；`capture`/`insertCaptured` 仍用于异步插入。
- 布局：`src/App.tsx` 的 `.view-modes` 与 `.editing-layout`；`src/Preview.tsx` 的 `maxWidth` 在 preview 布局下省略；紧凑布局在 `src/styles.css` 的 `.list-heading`/`.search-box`/`.sort-bar`/`.selection-bar`/`.document-navigation`/`.document-title`/`.pane-label`/`.format-toolbar`。
- 右键菜单与完整路径：`FileTabs.tsx`/`DocumentList.tsx`/`TitleBar.tsx`；完整路径走 `api.copyEntryPath` → Rust `external::copy_path`（arboard 写系统剪贴板，不返回绝对路径）；相对路径前端直接复制。
- 移动目录选择：`src/components/DirectoryPicker.tsx`（按需 `list_directory`、只列文件夹、禁用被移动项自身及子目录）；`App.tsx` 的 `submitEntry` 对 move/batch-move 调 `operateFiles(...,"move",目标目录)`。
- 两栏笔记菜单：`src/components/NoteMenuItems.tsx` 是唯一来源；`DocumentList.tsx` 与 `FileTree.tsx` 都复用它。文档列表空白区右键新建笔记走 `run("file.new")`；文件树目录左键同时 `setFolder` + `expand`，空白区菜单固定根目录。
- 菜单与排序：右键菜单用 window `pointerdown` 捕获 + Escape 关闭（不要全屏 context-backdrop）；排序用自定义 `.sort-menu`（不要原生 select）；活动行背景必须透明以露出选区。
- 测试：`tests/ui/editor.spec.ts`、`tests/ui/menus.spec.ts`；`appModule` 通过 `performance` 资源 URL 复用应用模块实例，避免 Vite 热更新产生双实例。
- 外部 AHK：只向 `Tauri Window` 投递关闭消息；`lib.rs` 的 `on_window_event` 在 `Focused(true)` 且可见时只 `window.show()`；不要恢复无可见性检查的版本。
- 标题栏/应用菜单/页签/快速搜索/托盘/打包：见上一轮 HANDOFF 条目；本轮只给工作目录页签菜单加了“在资源管理器中打开目录”。
- Rust 依赖新增 `arboard = "3"`（仅用于完整路径写系统剪贴板）；新增 IPC `copy_entry_path` 已同步 commands.rs/lib.rs/api.ts/契约测试。
- 版本唯一来源 `src-tauri/Cargo.toml`（当前 0.5.0）；0.4.0 使用自有 SDK，不假设可直接安装 Obsidian 插件。

<!-- vibe-coding-starter 2026-11-11.1 · 文档体系版本标记 -->
