import { test, expect, type Page } from "@playwright/test";
import { openSettings } from "./support";

const errors=new WeakMap<Page,string[]>();
test.beforeEach(async({page})=>{const list:string[]=[];errors.set(page,list);page.on("pageerror",error=>list.push(error.message));await page.goto("/tests/ui/fixture.html");await expect(page.getByRole("tablist",{name:"工作目录页签"})).toBeVisible();});
test.afterEach(async({page})=>{expect(errors.get(page)).toEqual([]);});

test("HTML 导出独立包含公式字体、wikilink 图片、图表和附件，并保留笔记链接",async({page})=>{
  const result=await page.evaluate(async()=>{
    const module="/src/export.ts";const {exportHtml}=await import(module);
    const canvas=document.createElement("canvas");canvas.width=20;canvas.height=20;canvas.getContext("2d")!.fillRect(0,0,20,20);const image=canvas.toDataURL("image/png");
    const io={readAsset:async(_workspace:string,path:string)=>path.endsWith("png")?image:"data:audio/wav;base64,AA==",resolveNoteLink:async(_workspace:string,_from:string,target:string)=>({path:target.startsWith("Second")?"Second.md":"picture.png",fragment:target.includes("#")?"details":"",candidates:[]})};
    const source="# Export\n\n$x^2+1$\n\n![[picture.png]]\n\n[[Second#Details]]\n\n[audio](sound.wav)\n\n```mermaid\nflowchart LR\nA[Alpha] --> B[Beta]\n```\n\n<script>window.bad=true</script>";
    const html=await exportHtml("notes","first.md",source,["first.md","Second.md"],"html",io);
    const parsed=new DOMParser().parseFromString(html,"text/html");
    const pdfHtml=await exportHtml("notes","first.md","[[Second]]",["first.md","Second.md"],"pdf",io);
    return {fonts:html.includes("data:font/woff2;base64,"),externalFonts:/url\(fonts\//.test(html),math:!!parsed.querySelector(".katex"),image:parsed.querySelector("img")?.getAttribute("src"),diagram:!!parsed.querySelector("svg"),diagramText:parsed.querySelector("svg")?.textContent,links:[...parsed.querySelectorAll("a")].map(a=>a.getAttribute("href")),script:!!parsed.querySelector("script"),pdfLink:pdfHtml.includes('href="Second.pdf"')};
  });
  expect(result.fonts).toBe(true);expect(result.externalFonts).toBe(false);expect(result.math).toBe(true);expect(result.image).toMatch(/^data:image\/png/);expect(result.diagram).toBe(true);expect(result.diagramText).toContain("Alpha");expect(result.links).toContain("Second.html#details");expect(result.links).toContain("data:audio/wav;base64,AA==");expect(result.script).toBe(false);expect(result.pdfLink).toBe(true);
});

test("PDF 阅读器渲染本地两页文档，切换页码和缩放后能切换到新文档",async({page})=>{
  await page.evaluate(async()=>{
    const module="/src/components/Media.tsx";const {PdfViewer}=await import(module);
    function pdf(pages:number){let source="%PDF-1.4\n";const kids=Array.from({length:pages},(_,i)=>`${3+i*2} 0 R`).join(" ");const objects=["<< /Type /Catalog /Pages 2 0 R >>",`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`];for(let i=0;i<pages;i++){objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 ${3+pages*2} 0 R >> >> /Contents ${4+i*2} 0 R >>`);const stream=`BT /F1 24 Tf 30 100 Td (MarkFolio ${i+1}) Tj ET`;objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);}objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(source.length);source+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const xref=source.length;source+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,"0")} 00000 n \n`).join("")+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return "data:application/pdf;base64,"+btoa(source);}
    const render=Reflect.get(window,"mountTestComponent")(PdfViewer,{url:pdf(2)});Reflect.set(window,"replaceTestPdf",()=>render({url:pdf(1)}));
  });
  const reader=page.locator("#component-test");await expect(reader.getByText("1 / 2",{exact:true})).toBeVisible();
  await expect.poll(()=>reader.locator("canvas").evaluate(node=>node.getContext("2d")!.getImageData(0,0,node.width,node.height).data.some((value:number,index:number)=>index%4!==3&&value<100))).toBe(true);
  await reader.getByRole("button",{name:"下一页",exact:true}).click();await expect(reader.getByText("2 / 2",{exact:true})).toBeVisible();
  await reader.getByRole("slider",{name:"PDF 缩放"}).fill("2");
  await page.evaluate(()=>Reflect.get(window,"replaceTestPdf")());await expect(reader.getByText("1 / 1",{exact:true})).toBeVisible();await expect(reader.getByRole("button",{name:"下一页",exact:true})).toBeDisabled();
});

test("格式菜单、待办显示选项与 Tab 焦点设置实际作用于编辑器",async({page})=>{
  await page.locator(".cm-content").focus();await page.keyboard.press("Control+b");await expect(page.locator(".cm-content")).toContainText("**加粗文本**");
  await openSettings(page);const dialog=page.getByRole("dialog",{name:"设置",exact:true});
  await dialog.getByRole("button",{name:"编辑器",exact:true}).click();await dialog.locator('[data-setting="tabMovesFocus"] input').check();await dialog.locator('[data-setting="layoutCycle"] select').selectOption("editor-preview");await dialog.getByRole("button",{name:"确定",exact:true}).click();
  await page.locator(".cm-content").focus();await page.keyboard.press("Tab");await expect(page.locator(".cm-content")).not.toBeFocused();
  await page.keyboard.press("Control+l");await expect(page.getByRole("button",{name:"仅编辑",exact:true})).toHaveClass(/active/);await page.keyboard.press("Control+l");await expect(page.getByRole("button",{name:"仅预览",exact:true})).toHaveClass(/active/);
});

test("导出包含普通附件和 Fountain 剧本，未导出的笔记正文不被隐式嵌入",async({page})=>{
  const result=await page.evaluate(async()=>{
    const module="/src/export.ts";const {exportHtml}=await import(module);const requests:string[]=[];
    const io={readAsset:async(_workspace:string,path:string)=>{requests.push(path);return "data:application/octet-stream;base64,AAE=";},resolveNoteLink:async()=>({path:"private.md",fragment:"",candidates:[]})};
    const html=await exportHtml("notes","test.md","[package](sample.zip)\n\n[[private]]\n\n```fountain\nINT. LIBRARY - DAY\n\nALICE\nHello.\n```",["test.md"],"html",io);
    const parsed=new DOMParser().parseFromString(html,"text/html");return {requests,download:parsed.querySelector('a[download="sample.zip"]')?.getAttribute("href"),script:parsed.querySelector(".fountain-script")?.textContent,heading:parsed.querySelector(".fountain-script h3")?.textContent,privateHref:[...parsed.querySelectorAll("a")].find(a=>a.textContent==="private")?.getAttribute("href")};
  });
  expect(result.requests).toEqual(["sample.zip"]);expect(result.download).toMatch(/^data:application\/octet-stream/);expect(result.privateHref).toBeNull();expect(result.script).toContain("Hello.");expect(result.heading).toBe("INT. LIBRARY - DAY");
});
