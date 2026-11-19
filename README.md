# MarkFolio

以 Joplin 为界面和交互参照，以 Obsidian 的本地文件目录模型为数据基础，开发自己的 Markdown 文档管理应用。使用 Tauri 2 + Rust + React，直接编辑原文件，多个工作目录同时打开并以页签切换。

## 用途 / 动机

直接管理本地 Markdown 文件，使用 Joplin 风格布局，同时打开多个工作目录，并通过独立插件扩展日常笔记功能。
## 当前可用功能

- 本地目录与 Markdown 原文件直接编辑，多个工作目录同时打开并保持独立会话。
- 三栏布局、原生菜单、可调面板顺序/大小、编辑/并排/预览、主题、缩放、中文/English。
- Markdown/分块富文本、撤销、查找替换、HTML/图片粘贴、表格行列/选中行操作、自动保存、外部修改冲突处理与 UTF 编码/换行保留。
- 文件树、全部笔记、详细列表、多选、复制/移动、独立目录排序、应用垃圾箱恢复、附件管理、PDF/音视频、链接维护与独立笔记窗口。
- 标签、属性、待办/提醒/置顶、快速打开、字段/短语/日期/OR/排除检索和可重建的增量索引。
- 设置搜索、应用/取消、自定义快捷键与导入导出；Vim/Emacs、拼写检查、预览字体、CSS、Markdown 扩展开关。
- 公式、图表、脚注、上下标、定义列表、多行表格、自动目录、ABC/Fountain；JEX/RAW/ENEX/HTML/OneNote 转换及 Markdown/HTML/PDF 导出。
- SDK 2 默认隔离插件、按目录权限/启停、卸载/安全模式、仓库校验与命令/菜单/工具栏/面板/表单/列表扩展。
- 离线中英文 OCR、白板、本地密码锁定、托盘/全局唤起/深链、可配置更新与 AI、认证本地 API/MCP、浏览器剪藏扩展。

不提供同步、云分享、持久版本历史或自动备份；不能直接安装未修改的 Obsidian 插件。用户指定插件源码后再按 SDK 移植。验收结果和明确范围差异见 [ROADMAP.md](ROADMAP.md)。

## 快速开始

需要 Rust、Node.js 与各平台的 Tauri 系统依赖（见下文）。首次：

```bash
sh manager.sh setup   # 安装前端依赖（npm）
sh manager.sh dev           # tauri dev：Vite + Rust，改前端热更新；Ctrl-C 退出
sh manager.sh package # 出包到 dist/dev 与 dist/release（首次很慢）
```

只想预览界面、不跑 Rust：`sh manager.sh web`（浏览器打开 Vite 地址；IPC 不可用）。

## manager.sh 命令一览

所有命令都通过 `sh manager.sh <命令>` 执行（Windows 用 Git Bash），与 `sh manager.sh help` 一致：

| 命令 | 说明 |
|---|---|
| `setup` | 首次安装前端依赖（`npm`；有锁文件时用 frozen/ci） |
| `dev` | 开发模式：`tauri dev`（Vite + Rust，热更新） |
| `web` | 仅启动 Vite 预览前端（浏览器里，IPC 不可用） |
| `build` | 构建前端到 `dist/web/`（`tsc --noEmit` + `vite build`） |
| `test` | 跑 tsc + node 契约测试 + cargo test（全部跑完再汇总） |
| `test-ui` | 独立无头 Chrome 验证编辑、设置、排序、媒体、隔离插件与离线 OCR |
| `check` | `cargo fmt --check` + `cargo clippy -D warnings` + tsc；`--fix` 先整理 Rust 格式 |
| `package` | Release/Debug、安装器、免安装 zip、清单与 SHA256SUMS；附文档/插件示例/剪藏/许可；`--skip-build` 仅重新收集已有构建 |
| `clean` | 清理 `dist/`、`src-tauri/target`、`.runtime`（`--all` 连 `node_modules`） |
| `check-docs` | 文档体系机械体检（同 `sh check-docs.sh`） |
| `help` | 显示帮助 |

## Windows 直接运行

打包完成后，直接运行 dist/release/unpack/markfolio.exe，或使用 dist/release 中的安装包。第一次打开后点击“打开工作目录”选择笔记文件夹，使用顶部加号打开更多目录。插件安装与使用方法见 [docs/04-插件开发.md](docs/04-插件开发.md)。

安装与免安装包都带使用说明、阅读时间插件、browser-extension/ 和 third-party/。“关于 MarkFolio”可查看依赖许可全文；相关组件源码一并提供。本项目自有代码未自行选择公开许可证。

真实 OneNote/PDF 转换验证可分别设置 MARKFOLIO_TEST_ONENOTE 为测试样本目录、MARKFOLIO_TEST_DESKTOP=1 后执行 test。验收目录在被忽略的 .runtime/；本次交付针对 Windows，其他平台需单独构建验收。

## 双击脚本（Windows）

根目录的 `.bat` 是资源管理器里双击用的快捷入口，纯 cmd 直连 `npm` / `cargo`，无需 Git Bash：

| 脚本 | 作用 |
|---|---|
| `setup.bat` | 安装前端依赖 |
| `dev.bat` | 启动 `tauri dev`（Ctrl+C 停止）；若应用正在运行会先强制关闭 |
| `build.bat` | 构建前端到 `dist/web/` |
| `test.bat` | 跑全部测试 |
| `package.bat` | 出包到 `dist/dev` 与 `dist/release`；若应用正在运行会先询问是否强制关闭 |
| `clean.bat` | 清理构建产物 |

设置环境变量 `MARKFOLIO_NO_PAUSE=1` 可跳过结尾暂停；非交互环境需要确认强制关闭运行中的实例时用 `MARKFOLIO_FORCE_CLOSE=1`。命令行入口仍是 `sh manager.sh <命令>`（需要 Git Bash）。

## 依赖与前置条件

- **Rust** stable（[rustup](https://rustup.rs/)）与 Cargo；`cargo fmt` / `cargo clippy` 组件。
- **Node.js** 20.19+ 或 22.12+（Vite 要求），随带 npm / pnpm / yarn（由 `--pm` 选择）；Tauri CLI 已作为本地 devDependency，无需全局安装。
- **平台依赖**（Tauri 2 要求）：
  - Windows：MSVC Build Tools + **WebView2 Runtime**（Windows 11 / 较新的 Windows 10 已自带；安装包默认用 `downloadBootstrapper` 兜底）。
  - macOS：Xcode Command Line Tools。
  - Linux：`webkit2gtk-4.1`、`libgtk-3`、`libayatana-appindicator3` 等，见 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)。
- 技术栈与选型理由见 [`docs/01-技术栈说明.md`](docs/01-技术栈说明.md)（单一信息源，勿在此重复维护）。

## 目录结构

```
src/                        # React + TypeScript 前端（main.tsx / App.tsx / api.ts / styles.css）
src-tauri/                  # Rust 后端与 Tauri 配置
  src/lib.rs                # Tauri Builder，IPC 命令在这里注册
  src/commands.rs           # #[tauri::command] 命令实现
  capabilities/default.json # 窗口权限（默认只有 core:default）
  tauri.conf.json           # 窗口 / CSP / 打包 / identifier / devUrl
  icons/                    # MarkFolio 生成图标，源文件在 assets/
tests/contract.test.mjs     # node:test：配置与 IPC 契约
scripts/                    # package.mjs / package-lib.mjs：出包、zip、SHA256 与事务发布
dist/                       # 前端构建产物在 dist/web（不入库）；打包产物在 dist/dev 与 dist/release
manager.sh                  # 统一管理脚本（所有命令的唯一来源）
*.bat                       # Windows 双击入口（纯 cmd，无需 Git Bash）
docs/                       # 使用/维护文档（面向人）
AGENTS.md                   # AI 工作规则（AI 开工先读）
ARCHITECTURE.md             # 代码链路图谱（面向 AI）
ROADMAP.md                  # 开发路线图（总体计划与完成度）
CHANGELOG.md                # 发布变更记录（按版本）
HANDOFF.md                  # 会话接力（进行中状态）
```

## 约定

- **版本号**只在 `src-tauri/Cargo.toml` 的 `version`；`tauri.conf.json` 不写 `version`，前端经 `app_info` 命令读取。
- **App 标识**在 `src-tauri/tauri.conf.json` 的 `identifier`，发布后不可改。
- **图标**源文件在 assets/：`npm run tauri icon path/to/icon.png`（1024×1024）会重写 `src-tauri/icons/`。
- **IPC 契约**由 `tests/contract.test.mjs` 校验：Rust 命令、`generate_handler!` 注册、前端 `invoke` 必须三方一致。

> AI 协作说明：本项目采用一套「AI 协作文档体系」，AI 代理开工请先读 [`AGENTS.md`](./AGENTS.md)。
