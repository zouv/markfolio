# MarkFolio · 代码链路图谱

## 0. 架构

React 在 Tauri 的本地 WebView 内运行；Rust 管理用户选定的目录、文件、监听、索引和设置。Markdown 文件是正文来源。SQLite 只存可重建搜索索引，不用数据库替代文档，不提供同步、持久历史版本或自动备份。

## 0.5 作用域路由

| 任务 | 必读 | 可忽略 | 入口 |
|---|---|---|---|
| 主布局、标题栏、页签、文件操作 | src/App.tsx、src/components/TitleBar.tsx、FileTabs.tsx、src/commands.ts | 打包 | §2.1 |
| 编辑、保存、会话 | src/Editor.tsx、src/store.ts、src/types.ts | 插件安装 | §2.1、§3 |
| 快速搜索、文件页签 | src/components/NoteManagement.tsx、FileTabs.tsx、src/store.ts | 打包 | §2.1、§3 |
| Markdown 预览与链接 | src/Preview.tsx、src/markdown.ts | 打包 | §2.1 |
| 文件、搜索、监听、IPC | library/files/index/links/crypto.rs、commands.rs、src/api.ts、tests/ | CSS | §2.2、§4 |
| 导入导出、桌面、本地服务 | transfer/desktop/native_menu/external/ai/api_server.rs、对应 components | 编辑内核 | §2.2 |
| 插件 | src/plugins/、docs/04-插件开发.md | 打包 | §2.3 |
| 测试与发布 | manager.sh、scripts/、src-tauri/build.rs、Cargo.toml | 业务组件 | §6、§7 |

## 1. 文件职责

| 位置 | 职责 |
|---|---|
| src/main.tsx、App.tsx | React 挂载、主布局、对话框调度、自动保存、原生事件 |
| src/components/TitleBar.tsx | 自绘标题栏：应用菜单、工作目录页签排序/关闭、窗口命令与缩放手柄 |
| src/components/MenuBar.tsx | 标题栏菜单栏：读取 menu.json 渲染文件/编辑/视图等下拉菜单，复用命令启用与勾选状态 |
| src/components/FileTabs.tsx | 列表+编辑器顶部的文档页签栏：切换、关闭、右键菜单与未打开状态 |
| src/components/AboutDialog.tsx | 关于对话框：应用图标、名称、版本、说明、焦点循环与关闭路径 |
| src/commands.ts、shortcuts.ts | 稳定核心命令 ID、快捷键规范化与冲突校验 |
| src/fileOperations.ts、settings.ts | 批量文件操作与变更摘要、设置草稿差量合并和搜索目录 |
| src/components/ | 文件树、设置、冲突比较、按钮及插件面板 |
| src/store.ts、types.ts | 工作区独立会话、文档缓冲、保存队列、类型与相对路径 |
| src/Editor.tsx | CodeMirror 6、撤销缓存、编辑操作、设置重配 |
| src/markdown.ts、Preview.tsx | Markdown 解析、标题锚点、任务切换、附件与图表渲染 |
| src/api.ts | 所有 IPC 的唯一 TypeScript 封装 |
| src/plugins/sdk.ts、runtime.ts、isolated.ts、public/plugin-frame.* | SDK 1/2、工作区实例、默认隔离 Worker/iframe 与显式可信 ESM、生命周期 |
| src/metadata.ts、conversion.ts、RichEditor.tsx、editorWidgets.ts | Front Matter 保留式修改、HTML 转换、分块富文本、就地图片/公式 |
| src/components/NoteManagement、DocumentList、Media、TransferDialog | 属性/标签/跨目录快速搜索、列表、附件/垃圾箱、导入导出 |
| src/components/AdvancedSettings、DesktopTools、Integrations、OcrDialog、Whiteboard | 高级设置、更新/锁定、AI/API、离线 OCR、画板 |
| src-tauri/src/library.rs | 工作区授权根、最近打开记录、文件编码、冲突检测、索引、插件安装、设置 |
| src-tauri/src/commands.rs、lib.rs | 异步 IPC、原生对话框、命令注册、窗口与菜单 |
| src-tauri/src/menu_state.rs | 隐藏原生菜单的可用/勾选状态与快捷键更新 |
| src-tauri/src/files/index/links/crypto.rs | 附件/垃圾箱、可重建索引、链接维护、本地加密 |
| src-tauri/src/transfer/plugin_service.rs | 格式转换、插件安装/仓库与文件权限校验 |
| src-tauri/src/desktop/native_menu/external/ai/api_server.rs | 托盘/窗口/更新、菜单、外部编辑、凭据与 AI、本地认证服务 |
| tests/、src-tauri/tests/ | 契约、保存队列、插件清理、真实文件测试 |
| src/styles.css、print.css | 主题、布局、打印 |
| docs/icons/、public/markfolio-icon.png、src-tauri/icons/ | 图标矢量源、生成脚本、应用内图标与各平台生成图标 |
| manager.sh、scripts/、*.bat | 模板运行、检查、事务打包入口 |
| docs/、根文档、.claude/ | 使用说明、AI 协作规则、计划与接力状态 |

## 2. 常见入口

### 2.1 界面与会话

| 改什么 | 入口 |
|---|---|
| 菜单与工具栏行为 | TitleBar 的应用菜单/最近打开子菜单/窗口命令；MenuBar 的分组下拉（menu.json）；App 的 dispatchRef.current、menuSignature；coreCommands；menu_state::update |
| 工作目录页签 | TitleBar：order/active、closeWorkspace、moveWorkspace、右键菜单；+ 调用 openWorkspace 后插入到右侧 |
| 文档页签 | FileTabs：session.documents 为页签集合、session.file 为活动项；store::closeDocument；editorActions.prune |
| 快速搜索 | NoteManagement::QuickOpen、App 的 nav.quickOpen；跨工作目录 catalog/树回退、实时过滤与高亮 |
| 关于对话框 | AboutDialog；应用菜单 app.about 打开，closeAbout 恢复焦点；第三方资源入口打开独立 ToolWindow |
| 新建、移动、删除、复制、多选 | App::submitEntry、FileTree；fileOperations::operateFiles/moveEntry；store::selectFiles |
| 自定义快捷键 | shortcuts::normalizeShortcut/validateShortcuts/effectiveShortcut；SettingsContent 的 keymap；App 的 keyboard（WebView 统一处理） |
| 保存、目录状态 | createAppStore 的 save、refresh、openDocument、closeWorkspace、closeDocument、moveWorkspace、persistSettings；flushDocuments |
| 文本编辑与撤销 | Editor、editorActions；状态缓存键为工作区 ID + 相对路径；capture/insertCaptured 保存并映射原选区，失败返回 false |
| 富文本、表格、独立排序 | RichEditor、richSelection::sourceBoundary、tableEditing::editTable；settings::noteSortFor/noteSortPatch |
| Markdown 渲染 | createRenderer、prepareMarkdown、createTOC、toggleTask；Preview |
| 选项、插件配置 | SettingsDialog::apply、settingsDraftPatch/settingsCatalog；store::applySettings；即时布局操作用 updateSettings |
| 冲突处理 | ConflictDialog::keepMine、store.reload；保存仍验证磁盘版本 |

### 2.2 Rust

Library::open/resolve/list/read/write/create/rename/delete/duplicate 是文件入口；reindex/search 管理检索；attach 管理 notify 监听；plugins/install_plugin 管理插件文件；external_link 校验 HTTPS 与允许的网站。

commands::access 将阻塞文件操作移入 spawn_blocking，再锁定 SharedLibrary。commands.rs 不写界面逻辑；native_menu 从 scripts/sync-menu.mjs 生成的 menu.json 建隐藏原生菜单（不注册加速键），可见的应用菜单由 TitleBar 渲染。文件模块实现通过 Library，保持授权与版本校验。

### 2.3 插件

contextFor 绑定实例工作区；synchronizePlugins 对照启用状态，创建、停止或取消实例；pendingCleanup 在异步载入期间也及时清理。importPlugin 从本地安装的自包含 ESM 创建定义；重新安装会卸载旧实例；SDK 通过 editor.codeMirror 提供宿主 state/view 模块供扩展复用。processPluginBlocks 执行代码块渲染。

## 3. 重点链路

- 打开目录：原生选择 → canonical 根校验 → Library 按规范根路径摘要注册稳定 ID → 不含绝对根路径的 WorkspaceInfo → 独立 Session。重复目录激活，嵌套目录拒绝。每次打开同时把规范根写入最近列表（最多 10 条，去重置顶）。
- 打开最近：TitleBar 打开应用菜单时读取 `recent_workspaces`（只返回 id/name/available）→ 点击调用 `open_recent_workspace` → Rust 按 id 在持久化列表中查找根目录 → 重新 canonical 校验并走打开目录链路。已关闭的工作目录仍保留在最近列表，绝对根路径不回传网页。
- 编辑保存：CodeMirror 事务 → Buffer 的 text/dirty/revision → 每文档 Promise 队列 → SHA-256 基准版本比较 → 同目录临时文件 sync 与原子替换 → 更新 savedText。保存期间继续输入，完成后保留新的 dirty 内容。
- 外部修改：notify 发送工作区 ID → 防抖 refresh → 未修改缓冲刷新；有修改缓冲保留内容并标记冲突。用户比较后选择磁盘内容或用当前磁盘版本保存自己的内容。
- 批量操作：压缩祖先/子项重复选择 → 锁定源工作区的编辑与关闭 → 移动/复制先保存受影响缓冲，删除拒绝未保存项 → 逐项操作并报告部分失败 → 更新原工作区缓冲路径/选择/导航 → 刷新列表与索引。复制使用 create_new，保留原字节且不覆盖同名目标。
- 设置：打开时复制基线与草稿 → 搜索定位/快捷键校验 → 按实际编辑字段合并当前设置 → 串行写盘成功后应用；失败保留原状态。插件数据按字段合并，保留后台会话/插件变化；取消丢弃未应用草稿，插件安装独立立即执行。
- 菜单与快捷键：核心注册保留 coreCommands ID，插件命令带工作区命名空间 → 同一 overrides 用于应用菜单/命令面板/键盘 → 串行 update_menu 更新可用和勾选状态、先清旧绑定再设新绑定。自定义标题栏隐藏原生菜单，快捷键由 WebView 键盘处理器统一执行；原生菜单加速键关闭，避免同键触发两次；单独 Delete 仅作用于文件列表/树。
- 标题栏菜单栏：MenuBar 读取 `src-tauri/menu.json` 渲染分组 → 每个菜单项用 App 的 menuSignature 结果（id/enabled/checked/shortcut）显示状态 → 点击经同一 run/dispatch 执行；menu.json 同时供隐藏原生菜单使用，改菜单分组或标题时两处一起生效。
- 标题栏与窗口：主窗口 decorations=false → TitleBar 使用 data-tauri-drag-region 拖动/双击最大化 → 自绘最小化/最大化/关闭调用 window API → 边缘手柄 startResizeDragging；关闭仍进入 onCloseRequested 的保存/托盘/退出流程。
- 工作目录/文件页签：工作目录页签绑定 state.order/active，拖动经 moveWorkspace 重排；文件页签来自 session.documents，点击 openDocument，关闭先保存再删除缓冲并由 editorActions.prune 清理编辑器缓存。
- 快速搜索：Ctrl+P → QuickOpen 合并各工作目录 catalog（空索引回退文件树）→ 标题/路径/别名/标签模糊评分与高亮 → Enter 激活所属工作目录并打开笔记，#标题 跳转。
- 检索：扫描或文件事件 → 按 mtime 纳秒与大小跳过未变文件 → SQLite 事务更新 catalog → 字段/排除/OR/短语/通配/日期筛选和评分。索引可删除重建；不缓存加密正文。
- 插件：安装清单/入口/样式 → 默认停用 → 各工作区启用 → 命令/设置/面板/编辑扩展注册 → 停用或关闭时清理。所有异步写入带原工作区 ID。
- 导出：exportHtml 净化与渲染 → 内嵌本地附件/字体/图表/乐谱/剧本 → 保留选中笔记的 HTML/PDF 链接，不嵌入未选正文 → Rust 校验目标与写盘。transfer.rs 使用 htmd 转换 HTML/ENEX/OneNote。
- AI/API：完整服务地址规范化摘要决定凭据身份；AI 请求与插入绑定发送时原笔记。LocalApi 只监听本机，绑定启动工作目录，停止/关闭目录使令牌失效，响应按 Content-Length 并半关闭发送端。
- 多窗口退出：prepare-exit 广播 → 每窗口保存/关闭保护 → exit_response 汇总；任一拒绝或超时取消退出。
- 外部链接：页面先检查 HTTPS → 首次允许该网站 → 持久化主机名单 → Rust 再校验协议与精确主机 → 固定系统程序打开浏览器。附件仍限制在工作目录。

## 4. 接口契约

IPC 清单由 commands.rs、lib.rs 与 api.ts 一致定义并由 tests/contract.test.mjs 核验；当前增加元数据/链接/附件/转换、插件文件服务、桌面/加密/AI/API 命令。新增命令必须三方一起改。

- 文件参数为 workspaceId + 相对 path；保存额外带 text、expectedVersion、encoding。Rust 使用 snake_case，IPC 使用 camelCase。
- `recent_workspaces` 返回 `{id,name,available}[]`（最近打开，最多 10 条，不含根路径）；`open_recent_workspace` 接收 `recentId`，只接受该列表内的 id。最近记录随 state.json 持久化；旧配置首次加载时用当前工作目录补齐。
- Document 含 path/text/version/encoding/lineEnding；前端统一 LF，保存时恢复原 CRLF；支持 UTF-8、UTF-8 BOM、UTF-16 LE/BE BOM。
- WorkspaceInfo 只含 id/name/available。Snapshot 含 workspaces/settings；首次 settings 必须为空对象。
- AppError 含 code/message；NOT_FOUND 与 IO 分开，CONFLICT 暂停自动保存，其他暂时保存错误允许手动重试。
- Settings 的主题、编辑、布局是应用级；sessions 与 plugins 按工作区 ID 隔离；externalLinkHosts 存允许的网站主机。
- Settings.folderSorts 是工作区 ID → 相对目录 → sort/reverseSort；perFolderSort 决定是否采用目录级排序，全部/待办等视图采用全局排序。配置草稿按嵌套字段差量合并。
- Settings.shortcuts 为 commandId → 组合键字符串；缺省用默认键，空字符串取消绑定。Session.selected/selectionAnchor/mutating 是内存内的工作区选择/操作状态。update_menu 接收 id/enabled/checked?/shortcut 数组；duplicate_entry 返回新文件的相对路径。
- SDK 公开接口以 sdk.ts 为准。默认隔离插件在 opaque iframe 的 Worker 执行，仅白名单消息转发；文件访问后端逐次校验工作区授予权限。trusted 模式拥有宿主页面能力，需要显式授权，不能当作沙箱。

## 6. 运维

- 命令唯一来源 manager.sh，README 与 Windows 脚本保持一致。
- 版本唯一来源 Cargo.toml；标识 dev.markfolio.app；Vite 端口读取 tauri.conf.json。
- 主可执行文件名为 MarkFolio：Cargo `[[bin]]` 与 `tauri.conf.json` 的 `mainBinaryName` 保持一致；scripts/package.mjs 优先按 mainBinaryName、其次 `[[bin]]` 名称从 target 收集产物。
- 产物 dist/web、dist/dev、dist/release；用户设置、插件、索引在系统 app_data_dir。
- scripts/sync-assets.mjs 从锁定包同步 OCR/PDF/公式字体，再调用 third-party.mjs 收集许可/署名和 MPL/EPL 组件包源码。public/third-party 为生成资源；许可证缺失阻止构建。
- scripts/package.mjs 在 Release/Debug 包中复制文档、插件示例、剪藏、第三方目录，并分别建立 unpack-manifest.json；安装器的 bundle.resources 带相同资源。
- 运行时测试目录、日志及界面检查样本在被忽略的 .runtime；不捆绑真实用户文件。
- 主窗口 `decorations=false`（笔记窗口同样自绘），TitleBar 负责拖动、最大化/还原、最小化、关闭与边缘缩放；capabilities 只额外开放这些窗口命令权限。原生菜单仍挂载但隐藏，且不注册加速键。
- tests/ui 与 playwright.config.ts 使用独立无头 Chrome 检查合成 React 交互，结果在 .runtime/ui-results；覆盖标题栏、文件页签、Ctrl+P、关于对话框与既有编辑器/插件流程，不验证真实文件 IPC 或原生窗口拖动。

## 7. 长期约束与已知局限

- 普通文件不自动插入 ID/front matter；保留未知属性、支持的编码与换行类型。
- checked_relative 拒绝绝对路径、冒号、反斜杠和上级逃逸；canonical 校验防止链接越界。移动/删除选中的链接时操作目录项本身。
- 历史导航和会话内撤销是编辑功能，不是持久文件历史；临时替换文件完成后不保留旧版本。
- 后台结果必须绑定原工作区，禁止用当前全局目录决定写入位置。
- CodeMirror 实例按工作区/文档缓存，编辑期间只同步内容，不逐键重建视图。
- Windows 打包目录提升遇到暂时文件占用时有有限重试，并通过 scripts/move-package.ps1 做范围校验后使用原生移动；失败保留待发布目录并回滚旧产物。
- 打包收集安装器通过 package-lib::isInstallerForVersion 筛选当前完整版本，保留旧构建缓存但不将旧版安装器混入交付目录。
- MSI 使用 zh-CN 构建，避免默认 en-US 1252 代码页无法保存中文文档文件名；NSIS 使用简体中文/英文。
- 原生测试使用独立 tests/library.rs；build.rs 给测试链接 Tauri 的 Common Controls v6 资源，避免 Windows 的 TaskDialogIndirect 入口缺失。应用和库的自动空测试已关闭，真实文件测试仍全部执行。
- 搜索重建持有服务锁，极大目录的首次扫描可能需要等待；索引/已保存缓冲可限量。隔离 CSP/实际权限及生命周期由界面和 Rust 验证；可信模式仍拥有同页面完整能力。
- 富文本仅规范化修改的块，特殊语法保留原源码；选区映射使用语法范围，扩展开关与行内代码决定是否隐藏标记。Fountain 预览/导出共用 fountain-js。
- 图标由 docs/icons/_build.py 从 markfolio.svg 生成：无头 Edge 按 2048 渲染、洋红抠图后独立缩放；headless Edge 窗口高度比 `--window-size` 少约 92 px，脚本多开窗后再裁剪，避免底部截断。改图标后重跑脚本并核对 src-tauri/icons 与 docs/icons 输出一致。
- 自定义标题栏下不要把快捷键交回原生菜单：WebView2 会先消费 Ctrl+P 等浏览器快捷键，且原生菜单加速键已关闭；核心命令统一走 App 的 keyboard 处理器，避免重复或漏触发。应用菜单的“退出”只显示系统级 `Alt+F4`，不再默认绑定 `Ctrl+Q`；`Alt+F4` 触发的是窗口关闭流程（受“关闭窗口时最小化到托盘”影响），菜单项本身仍直接请求退出。
- `menu.json` 是菜单分组/标题的唯一来源：Rust 隐藏原生菜单与 React MenuBar 都读取它；新增核心命令时同时更新 coreCommands（执行/快捷键）与 menu.json（菜单位置），否则菜单栏不会出现该项。
- `.workspace-columns` 内文件列表手柄的 `order` 必须取 `Math.min(listOrder, editorOrder) + 1`，不能写死为 1；写死会让手柄落到侧栏与文件列表之间，拖动时看似调整左栏、实际改变文件列表宽度。
- 标题栏空白区用 data-tauri-drag-region="deep"；按钮、role=tab、菜单和窗口缩放手柄必须保持可交互或显式标记 data-tauri-drag-region="false"，否则会误触窗口拖动。
- 关闭到托盘时不要 `await window.hide()` 并把拒绝当成失败：WebView2 隐藏后可能无法回传该 IPC 响应，隐藏实际已生效；应忽略 hide 的响应错误，否则会误报“关闭已取消：failed to send message to the webview”。
- 文件页签栏放在 list+editor 的 workspace-main 内，默认位于第 2+3 栏顶部；layoutOrder 仍控制 list/editor 顺序，关闭页签前先保存，避免静默丢失未保存内容。
- 独立实现，未复制 Joplin/Obsidian 核心；源码插件移植需按各许可证审查。

<!-- vibe-coding-starter 2026-11-11.1 · 文档体系版本标记 -->
