import { test, expect, type Page } from "@playwright/test";
import { openSettings } from "./support";

test.beforeEach(async({page})=>{await page.goto("/tests/ui/fixture.html");await expect(page.getByRole("tablist",{name:"工作目录页签"})).toBeVisible();});

async function source(page: Page) {
  return page.evaluate(async()=>{const {useApp}=await import("/src/store.ts");const state=useApp.getState();return state.sessions.notes.documents[state.sessions.notes.file].text;});
}
async function appModule(page: Page): Promise<string> {
  return page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name).find((name) => name.includes("/src/Editor.tsx")) ?? "/src/Editor.tsx");
}
async function select(page: Page, from: number, to = from) {
  const url = await appModule(page);
  await page.evaluate(async({url,from,to})=>{const {codeMirror}=await import(/* @vite-ignore */ url);const view=codeMirror.view.EditorView.findFromDOM(document.querySelector(".cm-editor")!);view.dispatch({selection:{anchor:from,head:to}});view.focus();},{url,from,to});
  await page.waitForTimeout(150);
}
async function setEditor(page: Page, text: string, editorMode: "markdown"|"rich" = "rich", mode: "editor"|"split"|"preview" = "editor") {
  await page.evaluate(async({text,editorMode,mode})=>{const {useApp}=await import("/src/store.ts");const state=useApp.getState();state.edit("notes",state.sessions.notes.file,text);state.updateSettings({editorMode,mode});},{text,editorMode,mode});
  await page.waitForTimeout(300);
  if (mode !== "preview") await select(page, text.length);
  await page.waitForTimeout(200);
}

test("Markdown 实时预览：非活动行渲染，活动行显示源码", async ({ page }) => {
  const original = "# 标题\n\n普通 **加粗** 和 *斜体*，行内 `代码`，~~删除~~。\n\n- [ ] 待办\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n";
  await setEditor(page, original, "markdown");
  await expect(page.locator(".cm-live-h1")).toHaveCount(1);
  expect(await page.locator(".cm-live-h1").evaluate((element) => [...element.querySelectorAll("span")].every((span) => getComputedStyle(span).textDecorationLine === "none"))).toBe(true);
  await expect(page.locator(".cm-live-strong")).toContainText("加粗");
  await expect(page.locator(".cm-live-em")).toContainText("斜体");
  await expect(page.locator(".cm-live-code")).toContainText("代码");
  await expect(page.locator(".cm-live-strike")).toContainText("删除");
  await expect(page.locator(".cm-live-task input")).toHaveCount(1);
  await expect(page.locator(".cm-live-table")).toHaveCount(1);
  const inactive = await page.locator(".cm-content").textContent();
  expect(inactive).not.toContain("**加粗**");
  expect(inactive).not.toContain("`代码`");
  // 点击段落：只有活动行显示 Markdown 标记
  await page.locator(".cm-line").filter({ hasText: "普通" }).click();
  await expect(page.locator(".cm-content")).toContainText("**加粗**");
  await expect(page.locator(".cm-live-marker").first()).toBeVisible();
  expect(await page.locator(".cm-activeLine").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  await page.keyboard.press("End");
  await page.keyboard.type("新增");
  expect(await source(page)).toBe(original.replace("~~删除~~。", "~~删除~~。新增"));
});

test("渲染标题时不保留标题标记后的空格", async ({ page }) => {
  await setEditor(page, "## 1130\n\n正文。\n", "markdown");
  const heading = page.locator(".cm-live-h2");
  await expect(heading).toHaveCount(1);
  expect((await heading.textContent())?.startsWith("1130")).toBe(true);
});

test("富文本模式可直接编辑每一行并写回 Markdown", async ({ page }) => {
  const original = "# 标题\n\n普通段落。\n";
  await setEditor(page, original, "rich");
  await page.locator(".cm-line").filter({ hasText: "普通段落" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type("新增");
  expect(await source(page)).toBe("# 标题\n\n普通段落。新增\n");
});

test("富文本模式：隐藏标记，工具栏按选区切换样式并写回 Markdown", async ({ page }) => {
  const original = "普通段落。\n\n第二段。\n";
  await setEditor(page, original, "rich");
  expect(await page.locator(".cm-content").textContent()).not.toContain("**");
  const from = original.indexOf("段落");
  await select(page, from, from + 2);
  await page.getByRole("button", { name: "加粗", exact: true }).click();
  expect(await source(page)).toBe("普通**段落**。\n\n第二段。\n");
  await page.keyboard.press("Control+z");
  expect(await source(page)).toBe(original);

  await select(page, 0);
  await page.getByRole("button", { name: "标题", exact: true }).click();
  expect(await source(page)).toBe("## 普通段落。\n\n第二段。\n");
  await page.getByRole("button", { name: "标题", exact: true }).click();
  expect(await source(page)).toBe(original);

  await select(page, 0);
  await page.getByRole("button", { name: "待办", exact: true }).click();
  expect(await source(page)).toBe("- [ ] 普通段落。\n\n第二段。\n");
  await page.getByRole("button", { name: "待办", exact: true }).click();
  expect(await source(page)).toBe(original);

  await select(page, 0, 2);
  await page.getByRole("button", { name: "插入链接", exact: true }).click();
  expect(await source(page)).toContain("[普通](链接地址)");
});

test("复杂块渲染为只读，点击进入源码编辑", async ({ page }) => {
  const table = "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n末尾。\n";
  await setEditor(page, table, "rich");
  await expect(page.locator(".cm-live-table")).toHaveCount(1);
  await page.locator(".cm-live-table").click({ position: { x: 20, y: 10 } });
  await expect(page.locator(".cm-live-table")).toHaveCount(0);
  await expect(page.locator(".cm-live-table-source")).toHaveCount(3);

  const code = "```js\nconst x = 1;\n```\n\n末尾。\n";
  await setEditor(page, code, "rich");
  await expect(page.locator(".cm-live-codeblock")).toHaveCount(1);
  await page.locator(".cm-live-codeblock").click();
  await expect(page.locator(".cm-live-codeblock")).toHaveCount(0);
  await expect(page.locator(".cm-live-codeblock-source")).toHaveCount(3);

  const math = "$$\nx^2\n$$\n\n末尾。\n";
  await setEditor(page, math, "markdown");
  await expect(page.locator(".cm-live-math")).toHaveCount(1);
  await page.locator(".cm-live-math").click();
  await expect(page.locator(".cm-live-math-source")).toHaveCount(3);

  const front = "---\ntitle: 示例\n---\n\n末尾。\n";
  await setEditor(page, front, "markdown");
  await expect(page.locator(".cm-live-frontmatter")).toHaveCount(1);
  await page.locator(".cm-live-frontmatter").click();
  await expect(page.locator(".cm-live-frontmatter-source")).toHaveCount(3);
});

test("待办复选框直接写回 Markdown", async ({ page }) => {
  const original = "- [ ] 待办一\n- [x] 待办二\n";
  await setEditor(page, original, "rich");
  await page.locator(".cm-live-task input").first().click();
  expect(await source(page)).toBe("- [x] 待办一\n- [x] 待办二\n");
});

test("仅预览：预览铺满整宽，隐藏 Markdown/富文本切换", async ({ page }) => {
  await setEditor(page, "# 标题\n\n正文。\n", "markdown", "preview");
  await expect(page.locator(".editor-pane")).toHaveCount(0);
  await expect(page.getByTitle("Markdown / 富文本切换")).toHaveCount(0);
  const widths = await page.evaluate(() => ({
    preview: document.querySelector(".markdown-preview")?.getBoundingClientRect().width ?? 0,
    panes: document.querySelector(".editing-panes")?.getBoundingClientRect().width ?? 0,
  }));
  expect(widths.panes).toBeGreaterThan(0);
  expect(Math.abs(widths.preview - widths.panes)).toBeLessThanOrEqual(1);
});

test("表格后没有空行时，后续段落保持可编辑且行点击不串行", async ({ page }) => {
  const original = "| A | B |\n| --- | --- |\n| 1 | 2 |\n后续段落。\n\n## 标题\n\n正文。\n";
  await setEditor(page, original, "markdown");
  await expect(page.locator(".cm-live-table")).toHaveCount(1);
  await expect(page.locator(".cm-line").filter({ hasText: "后续段落。" })).toHaveCount(1);
  const heading = page.locator(".cm-line").filter({ hasText: "标题" });
  const box = await heading.boundingBox();
  expect(box).not.toBeNull();
  // 点击标题行右侧空白处应落在标题行，而不是上方的表格
  await page.mouse.click(box!.x + box!.width - 40, box!.y + box!.height / 2);
  await page.keyboard.type("X");
  expect(await source(page)).toBe(original.replace("## 标题", "## 标题X"));
});

test("代码块与分隔线后的行号与正文对齐，点击标题行不会串到下一行", async ({ page }) => {
  const original = "```js\nconst x = 1;\n```\n\n---\n\n## 设置\n\n段落。\n";
  await setEditor(page, original, "markdown");
  await expect(page.locator(".cm-live-codeblock")).toHaveCount(1);
  await expect(page.locator(".cm-live-rule")).toHaveCount(1);
  const heading = page.locator(".cm-line").filter({ hasText: "设置" });
  const gutter = page.locator(".cm-lineNumbers .cm-gutterElement").filter({ hasText: /^7$/ });
  const headingBox = await heading.boundingBox();
  const gutterBox = await gutter.boundingBox();
  expect(headingBox).not.toBeNull();
  expect(gutterBox).not.toBeNull();
  expect(Math.abs(gutterBox!.y - headingBox!.y)).toBeLessThanOrEqual(1);
  await page.mouse.click(headingBox!.x + headingBox!.width - 40, headingBox!.y + headingBox!.height / 2);
  await page.keyboard.type("X");
  expect(await source(page)).toBe(original.replace("## 设置", "## 设置X"));
});

test("HTML 粘贴转换为 Markdown，脚本与事件处理器被移除", async ({ page }) => {
  await page.locator(".cm-content").focus();
  await page.locator(".cm-content").evaluate(element => { const data = new DataTransfer(); data.setData("text/html", '<p><strong>Safe paste</strong><script>window.__bad=true</script><img src=x onerror="window.__bad=true"></p>'); element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })); });
  const result = await page.evaluate(async () => { const { useApp } = await import("/src/store.ts"); const state = useApp.getState(); return { text: state.sessions.notes.documents[state.sessions.notes.file].text, bad: Reflect.get(window, "__bad") }; });
  expect(result.text).toContain("**Safe paste**"); expect(result.text).not.toContain("<script>"); expect(result.text).not.toContain("onerror="); expect(result.bad).toBeUndefined();
});

test("切换语言保留用户文档内容，并翻译设置与列表标签", async ({ page }) => {
  await openSettings(page); const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await dialog.locator('[data-setting="locale"] select').selectOption("en"); await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en"); await expect(page.getByTitle("Sort by")).toBeVisible();
  await expect(page.getByRole("tab", { name: /我的笔记/ })).toBeVisible(); await expect(page.locator(".cm-content")).toContainText("我的笔记的本地文档");
  await openSettings(page, true);
});

test("白板关闭时保留未保存修改，确认后才关闭", async ({ page }) => {
  await page.keyboard.press("Control+Shift+P"); await page.getByRole("textbox", { name: "搜索命令" }).fill("白板"); await page.locator(".palette-results button").filter({ hasText: "白板" }).first().click();
  const canvas = page.locator(".whiteboard-canvas"); await canvas.click({ position: { x: 100, y: 100 } });
  const reject = (dialog: import("@playwright/test").Dialog) => void dialog.dismiss(); page.once("dialog", reject);
  await page.getByRole("button", { name: "关闭工具" }).click(); await expect(canvas).toBeVisible();
  page.once("dialog", dialog => void dialog.accept()); await page.getByRole("button", { name: "关闭工具" }).click(); await expect(canvas).toHaveCount(0);
});

test("离线 OCR 能使用随应用打包的模型识别生成图片", async ({ page }) => {
  test.setTimeout(60000);
  const result = await page.evaluate(async () => {
    const module = "/src/ocr.ts"; const { createLocalOcrWorker } = await import(module);
    const canvas = document.createElement("canvas"); canvas.width = 1100; canvas.height = 170; const context = canvas.getContext("2d")!; context.fillStyle = "white"; context.fillRect(0, 0, 1100, 170); context.fillStyle = "black"; context.font = "70px Arial"; context.fillText("MARKFOLIO 2026", 30, 110);
    const worker = await createLocalOcrWorker("eng");
    try { return (await worker.recognize(canvas.toDataURL("image/png"))).data.text; } finally { await worker.terminate(); }
  });
  expect(result.toUpperCase()).toContain("MARKFOLIO"); expect(result).toContain("2026");
});

test("跨格式标记的选区写回对应源码位置，失效书签不会写入其他笔记", async ({ page }) => {
  const original = "alpha **same** / same tail.\n\nNext **block** same.\n";
  await setEditor(page, original, "markdown");
  const from = original.indexOf("same"), to = from + 4;
  await select(page, from, to);
  const url = await appModule(page);
  const changed = await page.evaluate(async (url) => {
    const editor = url, store = "/src/store.ts"; const { editorActions } = await import(/* @vite-ignore */ editor); const { useApp } = await import(store);
    const target = editorActions.capture("notes")!;
    editorActions.insertCaptured(target, "TARGET");
    return useApp.getState().sessions.notes.documents[useApp.getState().sessions.notes.file].text;
  }, url);
  expect(changed).toBe(original.slice(0, from) + "TARGET" + original.slice(to));
  const stale = await page.evaluate(async (url) => {
    const editor = url, store = "/src/store.ts"; const { editorActions } = await import(/* @vite-ignore */ editor); const { useApp } = await import(store);
    const target = editorActions.capture("notes")!; editorActions.discardCapture(target);
    const before = useApp.getState().sessions.notes.documents[useApp.getState().sessions.notes.file].text;
    const inserted = editorActions.insertCaptured(target, "must not insert");
    return { inserted, before, after: useApp.getState().sessions.notes.documents[useApp.getState().sessions.notes.file].text };
  }, url);
  expect(stale.inserted).toBe(false); expect(stale.after).toBe(stale.before);
});

test("异步插入书签跟随输入且保留原文档目标", async ({ page }) => {
  const url = await appModule(page);
  const value = await page.evaluate(async (url) => {
    const editor = url, store = "/src/store.ts"; const { editorActions } = await import(/* @vite-ignore */ editor); const { useApp } = await import(store);
    const state = useApp.getState(), path = state.sessions.notes.file; const target = editorActions.capture("notes")!;
    editorActions.insert("notes", "typed "); useApp.getState().activate("work"); editorActions.insertCaptured(target, "delayed ");
    return { original: useApp.getState().sessions.notes.documents[path].text, other: useApp.getState().sessions.work.documents[useApp.getState().sessions.work.file].text };
  }, url);
  expect(value.original).toContain("typed delayed #"); expect(value.other).not.toContain("delayed");
});

test("Markdown 扩展开关同步影响预览并保留源文件", async ({ page }) => {
  const original = "==highlight== and ~sub~ and ^sup^.\n";
  await setEditor(page, original, "markdown", "split");
  await expect(page.locator(".markdown-preview mark")).toHaveCount(1);
  await page.evaluate(async () => { const { useApp } = await import("/src/store.ts"); const state = useApp.getState(); state.updateSettings({ markdownExtensions: { ...state.settings.markdownExtensions, mark: false } }); });
  await expect(page.locator(".markdown-preview mark")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("==highlight==");
  await page.evaluate(async () => { const { useApp } = await import("/src/store.ts"); const state = useApp.getState(); state.updateSettings({ markdownExtensions: { ...state.settings.markdownExtensions, mark: true } }); });
  await expect(page.locator(".markdown-preview mark")).toHaveCount(1);
  expect(await source(page)).toBe(original);
});

test("源码表格菜单在当前单元格添加列，撤销恢复表格和外部正文", async ({ page }) => {
  const original = "# Before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter unchanged.\n";
  await setEditor(page, original, "markdown", "split");
  await page.locator(".cm-live-table").click({ position: { x: 20, y: 10 } });
  await select(page, original.indexOf("2"));
  await page.keyboard.press("Control+Shift+P"); await page.getByRole("textbox", { name: "搜索命令" }).fill("添加表格列"); await page.locator(".palette-results button").filter({ hasText: "添加表格列" }).click();
  await expect(page.locator(".preview-pane table tr").first().locator("th")).toHaveCount(3);
  await page.locator(".cm-content").press("Control+z");
  await expect(page.locator(".preview-pane table tr").first().locator("th")).toHaveCount(2);
  expect(await source(page)).toBe(original);
});

test("文档排序选择按工作目录隔离并在切回页签时恢复", async ({ page }) => {
  await page.evaluate(async () => { const store = "/src/store.ts"; const { useApp } = await import(store); useApp.getState().updateSettings({ perFolderSort: true }); });
  await page.locator(".sort-trigger").click();
  await page.getByRole("menuitemradio", { name: "修改时间", exact: true }).click();
  await page.getByRole("tab", { name: /工作文档/ }).click(); await expect(page.locator(".sort-trigger")).toContainText("名称");
  await page.locator(".sort-trigger").click();
  await page.getByRole("menuitemradio", { name: "大小", exact: true }).click();
  await page.getByRole("tab", { name: /我的笔记/ }).click(); await expect(page.locator(".sort-trigger")).toContainText("修改时间");
});
