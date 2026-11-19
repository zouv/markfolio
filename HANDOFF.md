# MarkFolio · 接力状态

## 状态快照

- 最近更新：2026-11-19；分支 main；版本 0.2.0。
- 本轮程序名（`MarkFolio.exe`）与暖黄 folio 图标已完成并重新打包核对；0.2.0 原生验收仍被用户物理 Esc 中止，尚未完成。
- 最后验证：44 项 Node、31 项 Rust + 2 项默认忽略（真实 OneNote/PDF 此前已通过）、23 项界面此前通过；fmt/clippy/tsc、完整打包、包校验（4 个产物 / 1070 个包内文件 / 654 项依赖）与 check-docs 通过。
- dist 已发布 0.2.0 Release/Debug、MSI/NSIS 和免安装包，程序名为 `MarkFolio.exe`；原生验收仍未完成。

## 当前任务

无进行中任务。剩余：0.2.0 原生验收暂停（见下）。

## 进行中

- [ ] 暂停：0.2.0 原生验收（真实目录/保存冲突、原生菜单/文件操作、退出与插件入口）与最终交付核对。

## 下一步

1. 恢复 0.2.0 原生验收，样本仅 `.runtime/`；物理 Esc 立即停输入，锁屏则提示解锁。
2. 验收后核对最终产物并完成交付；若验收发现需改源码，必须重跑 check/test/package 与包校验。

## 续作位置

- scripts/third-party.mjs 从 npm/Cargo 锁定依赖收集许可/署名和 MPL/EPL 当前包源码；public/third-party/ 生成且忽略，依赖缺许可阻止构建。
- scripts/package.mjs 优先按 `mainBinaryName`、其次 Cargo `[[bin]]` 名称收集 target 二进制，并复制 README/CHANGELOG/ROADMAP/docs、示例、扩展和许可。
- docs/icons/ 是图标唯一源：`markfolio.svg` + `_build.py` 生成 PNG/ICO/ICNS 并安装到 `src-tauri/icons`；模板自带的 Store/Android/iOS 图标已移除。
- .runtime/verify-package.ps1 已按 `MarkFolio.exe`/0.2.0 更新并执行通过，结果在 .runtime/package-verification.json。
- README/docs/00/02、ARCH、CHANGELOG 和 ROADMAP 已同步；原生验收与最终交付状态未完成。
- 0.2.0 使用自有 SDK；不假设可直接安装 Obsidian 插件，不虚构真实 AI/更新/仓库服务。

<!-- vibe-coding-starter 2026-11-11.1 · 文档体系版本标记 -->
