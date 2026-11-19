# MarkFolio 图标

图标定位：**暖黄色系 Markdown 文档 + Folio 纸张叠层**。

- 暖黄圆角底：采用 Markdown 常见的黄色品牌基调，传达轻量、可读的文档工具气质；
- 奶油色叠层纸张与右上折角：表示 folio（一叠纸页 / 文档册），也呼应本地 Markdown 原文件；
- 深琥珀 `M↓` 方块：放在页面左下角，作为 Markdown 标识，小尺寸下仍保留清晰轮廓。

## 文件

- `markfolio.svg`：可编辑矢量源，512 × 512 viewBox；无字体、脚本或外部依赖。
- `markfolio-1024.png`：大尺寸主图与复用源。
- `markfolio-{512,256,128,64,48,32,16}.png`：常用尺寸。
- `markfolio.ico`：Windows 多尺寸图标，含 16、24、32、48、64、128、256 px 七个 32 位 RGBA PNG 帧；24 px 帧仅内嵌于 ICO。
- `markfolio.icns`：macOS 图标，含 128、256、512、1024 px PNG 帧。
- `_build.py`：从 SVG 重新生成全部 PNG / ICO / ICNS，复制到 `src-tauri/icons/`，并把 256px 图标安装为 `public/markfolio-icon.png` 供应用内标题栏、欢迎页和关于对话框使用。

## 配色

- 圆角底：`#fffdf0` → `#ffe9a3` → `#ffd05a` 暖黄渐变；描边 `#e8ad20`。
- 叠层纸页：`#fff1bd` → `#ffd76d` 与 `#ffdf84`；描边 `#d9a01a`。
- 书页：`#fffef9` → `#fff6dc` 奶油白；描边 `#d3a33a`。
- 折角：`#ffd65c` → `#eda500`。
- `M↓` 方块：`#744405` 深琥珀底，`#fff8e6` 浅色笔画。

## 编辑与导出

- 本目录的 SVG 是唯一图形源；改完矢量后执行：

```bash
python docs/icons/_build.py
```

- 脚本用无头 Microsoft Edge 渲染 SVG（2048 × 2048），抠除洋红背景后按目标尺寸独立缩放，不逐级缩图。
- 需要 Python 3 + Pillow + NumPy，以及本机 Microsoft Edge；找不到 Edge 时用 `MARKFOLIO_EDGE` 指向 `msedge.exe`。
- headless Edge 的窗口高度会少约 92 px；脚本按 `RENDER + 200` 开窗后裁掉多余部分，避免底部被截断。
- 生成后会替换 `src-tauri/icons/` 下的 `32x32.png`、`128x128.png`、`128x128@2x.png`、`icon.png`、`icon.ico`、`icon.icns`，并写入 `public/markfolio-icon.png`。
- Tauri 只使用上述六个文件名；模板自带的 Windows Store / Android / iOS 图标已移除，需要移动端时用 `npx tauri icon docs/icons/markfolio-1024.png` 重新生成。
- `.png` / `.ico` / `.icns` 是普通二进制文件（`.gitattributes` 已标记 `binary`），不要改成 Git LFS 指针；提交前确认 `src-tauri/icons/` 与 `docs/icons/` 的输出一致。
