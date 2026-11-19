# MarkFolio · 接力状态

## 状态快照

- 最近更新：2026-11-19；分支 main；版本 0.2.0。
- 代码实现和文档同步完成；Windows 新版打包完成，原生验收被用户物理 Esc 中止，尚未完成。
- 最后验证：43 项 Node、33 项 Rust（31 通用+真实 OneNote/PDF）、23 项界面全部通过；fmt/clippy/TypeScript 通过。第三方收集器已生成 654 项依赖声明及相关源码。
- dist 已发布 0.2.0 Release/Debug、MSI/NSIS 和免安装包，仍需最终产物核对。

## 当前任务

完成用户授权的全部开发和 Windows 交付。范围：最终打包、合成数据原生验证、产物清单/版本/SHA-256 和文档收尾。同步/历史/备份/云分享排除；第三方具体插件源码及外部服务由用户提供。

## 进行中

- [x] manager.sh package 完整构建 0.2.0 Release/Debug 与 MSI/NSIS；打包包含使用文档/示例/剪藏/许可。
- [ ] 运行新程序验证真实目录/保存冲突、原生菜单/文件操作、窗口关闭/退出与插件入口，样本仅 .runtime；上次启动被 Esc 中止。
- [ ] 检查交付版本、Release/Debug 文件清单、zip/安装包 SHA-256；严格文档检查，更新 ROADMAP/HANDOFF 实际状态。

## 下一步

1. 0.2.0 完整打包已成功。所有运行/测试/构建统一 manager.sh；原生验收后同步最终完成文档到安装器及免安装包。
2. 原设置已恢复并验证 SHA-256 一致，当前无 MarkFolio 进程；.runtime/native-validation.json 记录合成目录和恢复信息。继续原生验收时重新发现窗口，若需测试设置先另存当时状态；物理 Esc 立即停输入，锁屏则提示解锁。
3. 校验最终产物并收尾。若原生验收发现需改源码，必须重跑相关检查及完整构建。

## 续作位置

- scripts/third-party.mjs 从 npm/Cargo 锁定依赖收集许可/署名和 MPL/EPL 当前包源码；public/third-party/ 生成且忽略，依赖缺许可阻止构建。
- scripts/package.mjs 复制 README/CHANGELOG/ROADMAP/docs、示例、扩展和许可；bundle.resources 同样带安装版资源。
- .runtime/verify-package.ps1 已按新版产物更新，尚待执行。自动/界面/文件测试已通过，不需无故重复。
- README/docs/01/02/03/04、ARCH 和 CHANGELOG 已同步；ROADMAP 已区分产物生成完成与原生验收/交付核对未完成，包内完成状态仍待最终更新。
- 0.2.0 使用自有 SDK；不假设可直接安装 Obsidian 插件，不虚构真实 AI/更新/仓库服务。

<!-- vibe-coding-starter 2026-11-11.1 · 文档体系版本标记 -->
