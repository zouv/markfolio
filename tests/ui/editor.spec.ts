import { test, expect } from "@playwright/test";

test.beforeEach(async ({page})=>{await page.goto("/tests/ui/fixture.html");});
test("富文本编辑保留特殊源码，撤销和查找替换修改同一份 Markdown",async({page})=>{
  const original="---\ncustom: [1, 2]\n---\n# Title\n\nPlain paragraph.\n\n```md\n[[preserve-code]]\n```\n\n$$x^2$$\n";
  await page.evaluate(async text=>{const path="/src/store.ts";const {useApp}=await import(path);const state=useApp.getState();state.edit("notes",state.sessions.notes.file,text);state.updateSettings({editorMode:"rich",mode:"editor"});},original);
  const paragraph=page.getByRole("textbox",{name:"富文本段落"}).nth(1);
  await paragraph.fill("Edited paragraph.");
  let text=await page.evaluate(async()=>{const path="/src/store.ts";const {useApp}=await import(path);const state=useApp.getState();return state.sessions.notes.documents[state.sessions.notes.file].text;});
  expect(text).toContain("custom: [1, 2]");expect(text).toContain("[[preserve-code]]");expect(text).toContain("$$x^2$$");expect(text).toContain("Edited paragraph.");
  await paragraph.press("Control+z");
  await expect(page.getByRole("textbox",{name:"富文本段落"}).nth(1)).toContainText("Plain paragraph.");
  await page.keyboard.press("Control+f");
  await page.getByRole("textbox",{name:"查找文本",exact:true}).fill("Plain");
  await page.getByRole("textbox",{name:"替换文本",exact:true}).fill("Replaced");
  await page.getByRole("button",{name:"全部替换",exact:true}).click();
  await expect(page.getByRole("textbox",{name:"富文本段落"}).nth(1)).toContainText("Replaced paragraph.");
});
test("富文本表格添加行列并且可撤销",async({page})=>{
  await page.evaluate(async()=>{const path="/src/store.ts";const {useApp}=await import(path);const state=useApp.getState();state.edit("notes",state.sessions.notes.file,"| A | B |\n| --- | --- |\n| 1 | 2 |\n");state.updateSettings({editorMode:"rich",mode:"editor"});});
  await expect(page.locator(".rich-editor table tr")).toHaveCount(2);
  await page.getByRole("button",{name:"添加表格行",exact:true}).click();
  await expect(page.locator(".rich-editor table tr")).toHaveCount(3);
  await page.getByRole("button",{name:"添加表格列",exact:true}).click();
  await expect(page.locator(".rich-editor table tr").first().locator("th")).toHaveCount(3);
  await page.locator(".rich-editor [contenteditable=true]").press("Control+z");
  await expect(page.locator(".rich-editor table tr").first().locator("th")).toHaveCount(2);
});
test("HTML 粘贴转换为 Markdown，脚本与事件处理器被移除",async({page})=>{
  await page.locator(".cm-content").focus();
  await page.locator(".cm-content").evaluate(element=>{const data=new DataTransfer();data.setData("text/html",'<p><strong>Safe paste</strong><script>window.__bad=true</script><img src=x onerror="window.__bad=true"></p>');element.dispatchEvent(new ClipboardEvent("paste",{clipboardData:data,bubbles:true,cancelable:true}));});
  const result=await page.evaluate(async()=>{const path="/src/store.ts";const {useApp}=await import(path);const state=useApp.getState();return {text:state.sessions.notes.documents[state.sessions.notes.file].text,bad:Reflect.get(window,"__bad")};});
  expect(result.text).toContain("**Safe paste**");expect(result.text).not.toContain("<script>");expect(result.text).not.toContain("onerror=");expect(result.bad).toBeUndefined();
});
test("切换语言保留用户文档内容，并翻译设置及选择提示",async({page})=>{
  await page.getByRole("button",{name:"设置",exact:true}).click();const dialog=page.getByRole("dialog",{name:"设置",exact:true});
  await dialog.locator('[data-setting="locale"] select').selectOption("en");await dialog.getByRole("button",{name:"确定",exact:true}).click();
  await expect(page.locator("html")).toHaveAttribute("lang","en");await expect(page.getByText("1 items selected",{exact:true})).toBeVisible();
  await expect(page.getByRole("tab",{name:/我的笔记/})).toBeVisible();await expect(page.locator(".cm-content")).toContainText("我的笔记的本地文档");
  await page.getByRole("button",{name:"Settings",exact:true}).click();await expect(page.getByRole("dialog",{name:"Settings",exact:true})).toBeVisible();
});
test("白板关闭时保留未保存修改，确认后才关闭",async({page})=>{
  await page.getByRole("button",{name:"命令面板",exact:true}).click();await page.getByRole("textbox",{name:"搜索命令"}).fill("白板");await page.locator(".palette-results button").filter({hasText:"白板"}).first().click();
  const canvas=page.locator(".whiteboard-canvas");await canvas.click({position:{x:100,y:100}});
  const reject=(dialog:import("@playwright/test").Dialog)=>void dialog.dismiss();page.once("dialog",reject);
  await page.getByRole("button",{name:"关闭工具"}).click();await expect(canvas).toBeVisible();
  page.once("dialog",dialog=>void dialog.accept());await page.getByRole("button",{name:"关闭工具"}).click();await expect(canvas).toHaveCount(0);
});
test("离线 OCR 能使用随应用打包的模型识别生成图片",async({page})=>{
  test.setTimeout(60000);
  const result=await page.evaluate(async()=>{
    const module="/src/ocr.ts";const {createLocalOcrWorker}=await import(module);
    const canvas=document.createElement("canvas");canvas.width=1100;canvas.height=170;const context=canvas.getContext("2d")!;context.fillStyle="white";context.fillRect(0,0,1100,170);context.fillStyle="black";context.font="70px Arial";context.fillText("MARKFOLIO 2026",30,110);
    const worker=await createLocalOcrWorker("eng");
    try{return (await worker.recognize(canvas.toDataURL("image/png"))).data.text;}finally{await worker.terminate();}
  });
  expect(result.toUpperCase()).toContain("MARKFOLIO");expect(result).toContain("2026");
});
test("富文本重复文字与跨段落选区写回对应源码位置",async({page})=>{
  const original="alpha **same** / same tail.\n\nNext **block** same.\n";
  async function setup(){await page.evaluate(async text=>{const module="/src/store.ts";const {useApp}=await import(module);const state=useApp.getState();state.edit("notes",state.sessions.notes.file,text);state.updateSettings({editorMode:"rich",mode:"editor"});},original);await expect(page.locator(".rich-editor [data-rich-block]")).toHaveCount(2);await expect(page.locator(".rich-editor")).toContainText("/ same tail.");}
  await setup();
  const changed=await page.evaluate(async()=>{
    const paragraph=document.querySelector(".rich-editor [data-rich-block] p")!;const node=[...paragraph.childNodes].find(node=>node.textContent?.includes(" / same"))!;
    const range=document.createRange();range.setStart(node,3);range.setEnd(node,7);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);paragraph.dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));
    const editor="/src/Editor.tsx",store="/src/store.ts";const {editorActions}=await import(editor);const {useApp}=await import(store);const target=editorActions.capture("notes")!;editorActions.insertCaptured(target,"TARGET");const state=useApp.getState();return state.sessions.notes.documents[state.sessions.notes.file].text;
  });
  expect(changed).toBe("alpha **same** / TARGET tail.\n\nNext **block** same.\n");
  await setup();
  const across=await page.evaluate(async()=>{
    const strong=document.querySelectorAll(".rich-editor strong");const range=document.createRange();range.setStart(strong[0].firstChild!,1);range.setEnd(strong[1].firstChild!,3);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);strong[0].dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));
    const editor="/src/Editor.tsx",store="/src/store.ts";const {editorActions}=await import(editor);const {useApp}=await import(store);editorActions.insertCaptured(editorActions.capture("notes")!,"CROSS");const state=useApp.getState();return state.sessions.notes.documents[state.sessions.notes.file].text;
  });
  const from=original.indexOf("same")+1,to=original.indexOf("block")+3;expect(across).toBe(original.slice(0,from)+"CROSS"+original.slice(to));
});
test("异步插入书签跟随输入且保留原文档目标",async({page})=>{
  const value=await page.evaluate(async()=>{
    const editor="/src/Editor.tsx",store="/src/store.ts";const {editorActions}=await import(editor);const {useApp}=await import(store);
    const state=useApp.getState(),path=state.sessions.notes.file;const target=editorActions.capture("notes")!;
    editorActions.insert("notes","typed ");useApp.getState().activate("work");editorActions.insertCaptured(target,"delayed ");
    return {original:useApp.getState().sessions.notes.documents[path].text,other:useApp.getState().sessions.work.documents[useApp.getState().sessions.work.file].text};
  });
  expect(value.original).toContain("typed delayed #");expect(value.other).not.toContain("delayed");
});
test("Markdown 扩展开关同步影响预览和富文本并保留源文件",async({page})=>{
  const original="==highlight== and ~sub~ and ^sup^.\n";
  await page.evaluate(async text=>{const store="/src/store.ts";const {useApp}=await import(store);const state=useApp.getState();state.edit("notes",state.sessions.notes.file,text);state.updateSettings({mode:"split",editorMode:"markdown"});},original);
  await expect(page.locator(".markdown-preview mark")).toHaveCount(1);
  await page.evaluate(async()=>{const store="/src/store.ts";const {useApp}=await import(store);const state=useApp.getState();state.updateSettings({markdownExtensions:{...state.settings.markdownExtensions,mark:false},editorMode:"rich"});});
  await expect(page.locator(".markdown-preview mark")).toHaveCount(0);await expect(page.locator(".rich-editor")).toContainText("==highlight==");await expect(page.locator(".rich-editor sub")).toHaveCount(1);
  await page.evaluate(async()=>{const store="/src/store.ts";const {useApp}=await import(store);const state=useApp.getState();state.updateSettings({markdownExtensions:{...state.settings.markdownExtensions,mark:true}});});
  await expect(page.locator(".rich-editor mark")).toHaveCount(1);
  expect(await page.evaluate(async()=>{const store="/src/store.ts";const {useApp}=await import(store);const state=useApp.getState();return state.sessions.notes.documents[state.sessions.notes.file].text;})).toBe(original);
});

test("富文本关闭扩展、行内代码与删除线后的选区准确，失效书签不会写入其他笔记",async({page})=>{
  const result=await page.evaluate(async()=>{
    const store="/src/store.ts",editor="/src/Editor.tsx",mapping="/src/richSelection.ts",renderer="/src/markdown.ts";
    const {useApp}=await import(store),{editorActions}=await import(editor),{renderedSourceSpans}=await import(mapping),{createRenderer}=await import(renderer);
    const samples=[{source:"==same== / same",extensions:{mark:false},needle:" / same"},{source:"`==same==` / same",extensions:{},needle:" / same"},{source:"~same~ ^same^ ++same++ / same",extensions:{sub:false,sup:false,ins:false},needle:" / same"},{source:"~~same~~ / same",extensions:{},needle:" / same"}];
    const mapped=samples.map(({source,extensions,needle})=>{const node=document.createElement("div");node.innerHTML=createRenderer(false,{extensions}).render(source);const visible=node.textContent!;const spans=renderedSourceSpans(source,visible,extensions);const at=visible.indexOf(needle)+3;return {actual:source.slice(spans[at].from,spans[at+3].to),from:spans[at].from,expected:source.lastIndexOf("same")};});
    const state=useApp.getState(),path=state.sessions.notes.file;const target=editorActions.capture("notes")!;editorActions.discardCapture(target);const before=useApp.getState().sessions.notes.documents[path].text;
    return {mapped,inserted:editorActions.insertCaptured(target,"must not insert"),before,after:useApp.getState().sessions.notes.documents[path].text};
  });
  for(const value of result.mapped){expect(value.actual).toBe("same");expect(value.from).toBe(value.expected);}
  expect(result.inserted).toBe(false);expect(result.after).toBe(result.before);
});

test("源码表格菜单在当前单元格添加列，撤销恢复表格和外部正文",async({page})=>{
  const original="# Before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter unchanged.\n";
  await page.evaluate(async text=>{const store="/src/store.ts",editor="/src/Editor.tsx";const {useApp}=await import(store),{editorActions}=await import(editor);const state=useApp.getState();editorActions.replaceDocument("notes",state.sessions.notes.file,text);state.updateSettings({mode:"split",editorMode:"markdown"});},original);
  await page.locator(".cm-content").click();await page.keyboard.press("Control+Home");await page.keyboard.press("ArrowDown");await page.keyboard.press("ArrowDown");await page.keyboard.press("ArrowDown");await page.keyboard.press("ArrowDown");await page.keyboard.press("ArrowRight");
  await page.getByRole("button",{name:"命令面板",exact:true}).click();await page.getByRole("textbox",{name:"搜索命令"}).fill("添加表格列");await page.locator(".palette-results button").filter({hasText:"添加表格列"}).click();
  await expect(page.locator(".preview-pane table tr").first().locator("th")).toHaveCount(3);
  await page.locator(".cm-content").press("Control+z");
  await expect(page.locator(".preview-pane table tr").first().locator("th")).toHaveCount(2);
  expect(await page.evaluate(async()=>{const store="/src/store.ts";const {useApp}=await import(store);const state=useApp.getState();return state.sessions.notes.documents[state.sessions.notes.file].text;})).toBe(original);
});

test("文档排序选择按工作目录隔离并在切回页签时恢复",async({page})=>{
  await page.evaluate(async()=>{const store="/src/store.ts";const {useApp}=await import(store);useApp.getState().updateSettings({perFolderSort:true});});
  await page.getByRole("combobox",{name:"文档排序"}).selectOption("modified");
  await page.getByRole("tab",{name:/工作文档/}).click();await expect(page.getByRole("combobox",{name:"文档排序"})).toHaveValue("name");
  await page.getByRole("combobox",{name:"文档排序"}).selectOption("size");
  await page.getByRole("tab",{name:/我的笔记/}).click();await expect(page.getByRole("combobox",{name:"文档排序"})).toHaveValue("modified");
});
