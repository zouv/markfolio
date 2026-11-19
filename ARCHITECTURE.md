# MarkFolio · 代码链路图谱

## 0. 架构

React 在 Tauri 的本地 WebView 内运行；Rust 管理用户选定的目录、文件、监听、索引和设置。Markdown 文件是正文来源。SQLite 只存可重建搜索索引，不用数据库替代文档，不提供同步、持久历史版本或自动备份。

## 0.5 作用域路由

| 任务 | 必读 | 可忽略 | 入口 |
|---|---|---|---|
| 主布局、菜单、文件操作 | src/App.tsx、src/commands.ts、src/components/ | 打包 | §2.1 |
| 编辑、保存、会话 | src/Editor.tsx、src/store.ts、src/types.ts | 插件安装 | §2.1、§3 |
| Markdown 预览与链接 | src/Preview.tsx、src/markdown.ts | 打包 | §2.1 |
| 文件、搜索、监听、IPC | src-tauri/src/library.rs、commands.rs、src/api.ts、tests/ | CSS | §2.2、§4 |
| 插件 | src/plugins/、docs/04-插件开发.md | 打包 | §2.3 |
| 测试与发布 | manager.sh、scripts/、src-tauri/build.rs、Cargo.toml | 业务组件 | §6、§7 |

## 1. 文件职责

| 位置 | 职责 |
|---|---|
| src/main.tsx、App.tsx | React 挂载、主布局、对话框调度、自动保存、原生事件 |
| src/commands.ts、shortcuts.ts | 稳定核心命令 ID、快捷键规范化与冲突校验 |
| src/fileOperations.ts、settings.ts | 批量文件操作与变更摘要、设置草稿差量合并和搜索目录 |
| src/components/ | 文件树、设置、冲突比较、按钮及插件面板 |
| src/store.ts、types.ts | 工作区独立会话、文档缓冲、保存队列、类型与相对路径 |
| src/Editor.tsx | CodeMirror 6、撤销缓存、编辑操作、设置重配 |
| src/markdown.ts、Preview.tsx | Markdown 解析、标题锚点、任务切换、附件与图表渲染 |
| src/api.ts | 所有 IPC 的唯一 TypeScript 封装 |
| src/plugins/sdk.ts、runtime.ts | SDK 1、工作区实例、注册表、可信 ESM 载入与生命周期 |
| src-tauri/src/library.rs | 工作区授权根、文件编码、冲突检测、索引、插件安装、设置 |
| src-tauri/src/commands.rs、lib.rs | 异步 IPC、原生对话框、命令注册、菜单 |
| src-tauri/src/menu_state.rs | 原生菜单可用/勾选状态与快捷键更新 |
| tests/、src-tauri/tests/ | 契约、保存队列、插件清理、真实文件测试 |
| src/styles.css、print.css | 主题、布局、打印 |
| assets/、src-tauri/icons/ | 独立图标源与各平台生成图标 |
| manager.sh、scripts/、*.bat | 模板运行、检查、事务打包入口 |
| docs/、根文档、.claude/ | 使用说明、AI 协作规则、计划与接力状态 |

## 2. 常见入口

### 2.1 界面与会话

| 改什么 | 入口 |
|---|---|
| 菜单与工具栏行为 | App 的 dispatchRef.current、menuSignature；coreCommands；lib.rs::menu、menu_state::update |
| 新建、移动、删除、复制、多选 | App::submitEntry、FileTree；fileOperations::operateFiles/moveEntry；store::selectFiles |
| 自定义快捷键 | shortcuts::normalizeShortcut/validateShortcuts/effectiveShortcut；SettingsContent 的 keymap；App 的 keyboard |
| 保存、目录状态 | createAppStore 的 save、refresh、openDocument、closeWorkspace、persistSettings；flushDocuments |
| 文本编辑与撤销 | Editor、editorActions；状态缓存键为工作区 ID + 相对路径，createEditorState/historyAction 支持初始预览模式下插入与撤销 |
| Markdown 渲染 | createRenderer、prepareMarkdown、createTOC、toggleTask；Preview |
| 选项、插件配置 | SettingsDialog::apply、settingsDraftPatch/settingsCatalog；store::applySettings；即时布局操作用 updateSettings |
| 冲突处理 | ConflictDialog::keepMine、store.reload；保存仍验证磁盘版本 |

### 2.2 Rust

Library::open/resolve/list/read/write/create/rename/delete/duplicate 是文件入口；reindex/search 管理检索；attach 管理 notify 监听；plugins/install_plugin 管理插件文件；external_link 校验 HTTPS 与允许的网站。

commands::access 将阻塞文件操作移入 spawn_blocking，再锁定 SharedLibrary。commands.rs 不写界面逻辑，lib.rs::run 只做初始化和注册，lib.rs::menu 建原生菜单。

### 2.3 插件

contextFor 绑定实例工作区；synchronizePlugins 对照启用状态，创建、停止或取消实例；pendingCleanup 在异步载入期间也及时清理。importPlugin 从本地安装的自包含 ESM 创建定义；重新安装会卸载旧实例；SDK 通过 editor.codeMirror 提供宿主 state/view 模块供扩展复用。processPluginBlocks 执行代码块渲染。

## 3. 重点链路

- 打开目录：原生选择 → canonical 根校验 → Library 按规范根路径摘要注册稳定 ID → 不含绝对根路径的 WorkspaceInfo → 独立 Session。重复目录激活，嵌套目录拒绝。
- 编辑保存：CodeMirror 事务 → Buffer 的 text/dirty/revision → 每文档 Promise 队列 → SHA-256 基准版本比较 → 同目录临时文件 sync 与原子替换 → 更新 savedText。保存期间继续输入，完成后保留新的 dirty 内容。
- 外部修改：notify 发送工作区 ID → 防抖 refresh → 未修改缓冲刷新；有修改缓冲保留内容并标记冲突。用户比较后选择磁盘内容或用当前磁盘版本保存自己的内容。
- 批量操作：压缩祖先/子项重复选择 → 锁定源工作区的编辑与关闭 → 移动/复制先保存受影响缓冲，删除拒绝未保存项 → 逐项操作并报告部分失败 → 更新原工作区缓冲路径/选择/导航 → 刷新列表与索引。复制使用 create_new，保留原字节且不覆盖同名目标。
- 设置：打开时复制基线与草稿 → 搜索定位/快捷键校验 → 按实际编辑字段合并当前设置 → 串行写盘成功后应用；失败保留原状态。插件数据按字段合并，保留后台会话/插件变化；取消丢弃未应用草稿，插件安装独立立即执行。
- 菜单与快捷键：核心注册保留 coreCommands ID，插件命令带工作区命名空间 → 同一 overrides 用于菜单/命令面板/键盘 → 串行 update_menu 更新可用和勾选状态、先清旧绑定再设新绑定。桌面核心组合键由原生菜单触发，插件/浏览器由页面处理；单独 Delete 仅作用于文件列表/树。
- 检索：扫描 Markdown → SQLite 事务重建 → 文件名和正文逐词、忽略大小写的子串匹配。支持中文短查询，最多 200 条。当前不是 FTS/BM25；大目录的增量索引优化待实现。
- 插件：安装清单/入口/样式 → 默认停用 → 各工作区启用 → 命令/设置/面板/编辑扩展注册 → 停用或关闭时清理。所有异步写入带原工作区 ID。
- 外部链接：页面先检查 HTTPS → 首次允许该网站 → 持久化主机名单 → Rust 再校验协议与精确主机 → 固定系统程序打开浏览器。附件仍限制在工作目录。

## 4. 接口契约

21 个 IPC：app_info、app_snapshot、open_workspace、close_workspace、save_settings、update_menu、list_directory、read_document、save_document、create_entry、rename_entry、delete_entry、duplicate_entry、rebuild_index、search_documents、read_asset、attach_file、list_plugins、install_plugin、open_local_file、open_external_link。

- 文件参数为 workspaceId + 相对 path；保存额外带 text、expectedVersion、encoding。Rust 使用 snake_case，IPC 使用 camelCase。
- Document 含 path/text/version/encoding/lineEnding；前端统一 LF，保存时恢复原 CRLF；支持 UTF-8、UTF-8 BOM、UTF-16 LE/BE BOM。
- WorkspaceInfo 只含 id/name/available。Snapshot 含 workspaces/settings；首次 settings 必须为空对象。
- AppError 含 code/message；NOT_FOUND 与 IO 分开，CONFLICT 暂停自动保存，其他暂时保存错误允许手动重试。
- Settings 的主题、编辑、布局是应用级；sessions 与 plugins 按工作区 ID 隔离；externalLinkHosts 存允许的网站主机。
- Settings.shortcuts 为 commandId → 组合键字符串；缺省用默认键，空字符串取消绑定。Session.selected/selectionAnchor/mutating 是内存内的工作区选择/操作状态。update_menu 接收 id/enabled/checked?/shortcut 数组；duplicate_entry 返回新文件的相对路径。
- SDK 公开接口以 sdk.ts 为准。permissions 是用途声明；同页面可信插件不具备进程或权限隔离。

## 6. 运维

- 命令唯一来源 manager.sh，README 与 Windows 脚本保持一致。
- 版本唯一来源 Cargo.toml；标识 dev.markfolio.app；Vite 端口读取 tauri.conf.json。
- 产物 dist/web、dist/dev、dist/release；用户设置、插件、索引在系统 app_data_dir。
- 运行时测试目录、日志及界面检查样本在被忽略的 .runtime；不捆绑真实用户文件。
- tests/ui 与 playwright.config.ts 使用独立无头 Chrome 检查合成 React 交互，结果在 .runtime/ui-results；不验证真实文件 IPC 或原生菜单加速键。

## 7. 长期约束与已知局限

- 普通文件不自动插入 ID/front matter；保留未知属性、支持的编码与换行类型。
- checked_relative 拒绝绝对路径、冒号、反斜杠和上级逃逸；canonical 校验防止链接越界。移动/删除选中的链接时操作目录项本身。
- 历史导航和会话内撤销是编辑功能，不是持久文件历史；临时替换文件完成后不保留旧版本。
- 后台结果必须绑定原工作区，禁止用当前全局目录决定写入位置。
- CodeMirror 实例按工作区/文档缓存，编辑期间只同步内容，不逐键重建视图。
- Windows 打包目录提升遇到暂时文件占用时有有限重试，并通过 scripts/move-package.ps1 做范围校验后使用原生移动；失败保留待发布目录并回滚旧产物。
- 打包收集安装器通过 package-lib::isInstallerForVersion 筛选当前完整版本，保留旧构建缓存但不将旧版安装器混入交付目录。
- 原生测试使用独立 tests/library.rs；build.rs 给测试链接 Tauri 的 Common Controls v6 资源，避免 Windows 的 TaskDialogIndirect 入口缺失。应用和库的自动空测试已关闭，真实文件测试仍全部执行。
- 搜索重建目前持有服务锁，超大目录需优化；可信插件可以访问同页面环境，不将声明式 permissions 宣称为安全沙箱。
- 独立实现，未复制 Joplin/Obsidian 核心；源码插件移植需按各许可证审查。

<!-- vibe-coding-starter 2026-11-11.1 · 文档体系版本标记 -->
