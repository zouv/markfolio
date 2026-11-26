# MarkFolio · 接力状态

## 状态快照

- 最近更新：2026-11-26；分支 main；版本 0.5.0（发版进行中）；远程 origin = https://github.com/zouv/markfolio.git。
- 0.5.0 发布进行中：版本与 CHANGELOG 已更新，0.4.1 的 AHK 修复并入 0.5.0，不再单独发布；待测试/打包/提交/推送/Release 上传。
- 本轮完成编辑体验重构与文件/目录菜单优化：Markdown 实时预览、富文本工具栏、仅预览铺满整宽；页签/文档列表/工作目录右键菜单；移动目录树选择器；中间栏与标题区紧凑化。改动未提交，等待用户验收。
- 最后验证：`sh manager.sh check`（fmt/clippy/tsc）、44 项 Node、32 项 Rust 集成（+2 项默认忽略，单线程）、53 项界面测试、`node scripts/third-party.mjs`、`npm run web:build`、完整 `node scripts/package.mjs --pm npm` 与 `sh check-docs.sh` 均通过。Rust 并行全套仍偶发本地 API socket `10053`，单线程通过。
- 0.4.0 已发布；0.5.0 发布中。
- 真实 AHK 物理验收仍是独立待验收项，不写成已验证。

## 当前任务

菜单与布局优化（功能已实现，待用户验收）：① 文件页签右键“复制完整路径”；② 文档列表右键复制名称/相对/完整路径与资源管理器定位；③ 移动/批量移动可视化目录选择器；④ 工作目录页签右键“在资源管理器中打开目录”；⑤ 中间栏与文档标题区紧凑化。

## 进行中

- [x] 文件页签右键：保留相对路径复制，新增“复制完整路径”。
- [x] 文档列表右键：复制名称、复制相对路径、复制完整路径、在资源管理器中定位，保留复制/移动/属性/回收站。
- [x] 移动/批量移动：新增 `DirectoryPicker` 目录树选择器，目标文件夹用选择代替手输；移动后保留文件名。
- [x] 工作目录页签右键：新增“在资源管理器中打开目录”。
- [x] 压缩 `.list-heading`/搜索/排序/选择栏与 `.document-navigation`/`.document-title`/pane label 的垂直空间。
- [x] Rust 新增 `copy_entry_path`（arboard 写系统剪贴板），绝对路径不回传网页；同步 `lib.rs`/`api.ts`/契约测试。
- [x] 修复 `package.bat` / `tauri build` 失败：arboard 带入的 `clipboard-win` 无许可文件，补 `licenses/overrides/BSL-1.0.txt` 并在 `scripts/third-party.mjs` 映射；完整打包流程通过。
- [x] 翻译、CHANGELOG、ARCH/README/docs、`tests/ui/menus.spec.ts` 与 `tests/contract.test.mjs` 通过。
- [x] 第三栏移除 MARKDOWN 标签；第二栏标题与篇数同行、排序行右对齐、移除选择操作栏与顶部新建笔记按钮；第二栏空白右键新建笔记。
- [x] 第一栏笔记右键复用 `NoteMenuItems` 与第二栏一致；目录/空白右键菜单、目录左键展开/收起、顶部新建文件夹改为显示/隐藏第二栏按钮。
- [x] 移除右键菜单“移入回收站”特殊样式；暗色主题标题/目录名可读；标题标记后的空格不再保留；活动行不再遮挡选区。
- [x] 第二栏排序/反转/摘要详情统一为按钮组，自定义排序菜单；侧栏顶部显示工作区名并移除根目录行/底部“本地工作目录”；右键菜单打开时可直接右键另一项切换。

## 待验收

- [ ] 文件页签/文档列表右键的“复制完整路径”在真实桌面写入系统剪贴板；相对路径与名称复制正确。
- [ ] 工作目录页签右键“在资源管理器中打开目录”能打开对应根目录。
- [ ] 移动/批量移动对话框的目录树可展开/选择，移动后文件与打开缓冲跟随；不能把文件夹移入自身。
- [ ] 中间栏列表头、搜索/排序/选择栏与文档标题区变紧凑，编辑区可视高度增加。
- [ ] 第三栏无 MARKDOWN；第二栏标题/篇数同行、排序控件统一、无选择操作栏；第一栏笔记菜单与第二栏一致，目录/空白菜单和目录左键展开正常，顶部按钮可切换第二栏。
- [ ] 暗色主题标题/目录名可读；标题渲染无前导空格；活动行不遮挡选区；右键菜单打开时右键另一项可直接切换。
- [ ] 编辑体验重构（上一任务）：仅预览铺满整宽且无 Markdown/富文本切换；Markdown 实时预览；富文本工具栏写回 Markdown；复杂块点击进源码。
- [ ] 0.5.0 发布：打包、提交、推送 main 与 v0.5.0、上传 GitHub Release 并核验资产。

## 下一步

1. 用户验收上述菜单/布局与编辑体验；确认后清理本任务计划痕迹并更新 ROADMAP/CHANGELOG。
2. 运行 `sh manager.sh package`，核验 SHA256 后提交、推送 main 与 v0.5.0，上传 Release。
3. 若需要发版，按 `[未发布]` 内容确定版本并执行 release 流程。

## 进行中（旧任务）

- [ ] 暂停：0.2.0 原生验收（真实目录/保存冲突、原生菜单/文件操作、退出与插件入口）。

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
