# MarkFolio

以本地 Markdown 文件为中心的文档管理工具。界面参考 Joplin，使用真实文件目录和多个工作目录页签，支持独立插件扩展。

## 用途 / 动机

直接管理本地 Markdown 文件，使用 Joplin 风格布局，同时打开多个工作目录，并通过独立插件扩展日常笔记功能。
## 当前可用功能

- 本地目录与 Markdown 原文件直接编辑，多个工作目录同时打开并保持独立会话。
- 三栏布局、原生菜单、可调面板、编辑/并排/预览、主题与编辑器选项。
- 格式工具、撤销、查找替换、自动保存、外部修改冲突处理，以及支持的 UTF 编码/换行保留。
- 文件与目录创建、重命名、移动、回收站、附件、内部链接、HTTPS 外部链接与工作目录内检索。
- 文档列表多选、批量移动/删除与复制笔记；设置搜索、应用/取消、自定义快捷键和原生菜单状态联动。
- 表格、任务勾选、脚注、代码高亮、公式和 Mermaid 预览；按工作目录启用的插件 SDK 与示例插件。

当前版本仍需原生界面验收，完整 Joplin 菜单/设置/交互复刻尚未完成。富文本、标签、高级搜索和剪贴板图片等见 [ROADMAP.md](ROADMAP.md)。不提供同步、持久版本历史或自动备份；不能直接安装未修改的 Obsidian 插件。

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
| `test-ui` | 使用已安装 Chrome 验证设置、多选与快捷键界面；采用独立临时浏览器资料 |
| `check` | `cargo fmt --check` + `cargo clippy -D warnings` + tsc |
| `package` | 出包到 `dist/dev`（Debug 调试包）与 `dist/release`（`unpack/` + 免安装 zip + 安装包 + SHA256SUMS；首次很慢；`--skip-build` 复用已有构建） |
| `clean` | 清理 `dist/`、`src-tauri/target`、`.runtime`（`--all` 连 `node_modules`） |
| `check-docs` | 文档体系机械体检（同 `sh check-docs.sh`） |
| `help` | 显示帮助 |

## Windows 直接运行

打包完成后，直接运行 dist/release/unpack/markfolio.exe，或使用 dist/release 中的安装包。第一次打开后点击“打开工作目录”选择笔记文件夹，使用顶部加号打开更多目录。插件安装与使用方法见 [docs/04-插件开发.md](docs/04-插件开发.md)。

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
