import { test } from "node:test";
import assert from "node:assert/strict";
import { readMetadata, updateMetadata, metadataPatch } from "../src/metadata.ts";
import { mergeWindowSettings } from "../src/settings.ts";
import { setLocale, t } from "../src/i18n.ts";
import { defaultSettings } from "../src/types.ts";
import { validateFields } from "../src/plugins/sdk.ts";
import { validateWhiteboard } from "../src/whiteboard.ts";
import { prepareMarkdown,createRenderer } from "../src/markdown.ts";
import { renderFountain } from "../src/fountain.ts";
import { inlinePreviewRanges } from "../src/editorWidgets.ts";
import { nextEditorLayout, settingsDraftPatch, noteSortFor, noteSortPatch } from "../src/settings.ts";
import { editTable } from "../src/tableEditing.ts";
import { visibleNotes } from "../src/components/NoteManagement.tsx";
import { documentStatistics } from "../src/noteTools.ts";

test("editing one note property preserves unknown YAML types, comments and the Markdown body", () => {
  const text = "---\r\n# keep this comment\r\ntitle: 'Original'\r\ncustom: { nested: [1, 2] }\r\ndue: 2030-01-02\r\ntype: journal\r\n---\r\n# Body\r\n\r\n[reference](note.md)\r\n";
  const base = readMetadata(text);
  assert.equal(updateMetadata(text,metadataPatch(base,base)),text);
  const changed = updateMetadata(text,metadataPatch(base,{...base,tags:["work"]}));
  assert.match(changed,/# keep this comment/);
  assert.match(changed,/type: journal/);
  assert.match(changed,/custom:.*nested/);
  assert.match(changed,/due: 2030-01-02/);
  assert.ok(changed.endsWith("# Body\r\n\r\n[reference](note.md)\r\n"));
  assert.deepEqual(readMetadata(changed).tags,["work"]);
  assert.doesNotThrow(()=>readMetadata("---\nvalue: *missing\n---\nbody"));
  assert.throws(()=>updateMetadata("---\n[broken\n---\nbody",{title:"X"}));
});
test("settings from stale windows merge only changed values and preserve other workspaces and plugin fields", () => {
  const base = {...defaultSettings,plugins:{a:{p:{enabled:true,data:{left:1,right:1},permissions:["editor"]}}},sessions:{a:{file:"a.md",folder:"",expanded:[""]}},activeWorkspace:"a"};
  const current = {...base,theme:"dark",plugins:{a:{p:{...base.plugins.a.p,data:{left:2,right:1}}}},sessions:{a:{...base.sessions.a,file:"b.md"}}};
  const proposed = {...base,fontSize:18,plugins:{a:{p:{...base.plugins.a.p,data:{left:1,right:2}}}}};
  const merged = mergeWindowSettings(current,base,proposed);
  assert.equal(merged.theme,"dark");assert.equal(merged.fontSize,18);
  assert.equal(merged.sessions.a.file,"b.md");
  assert.deepEqual(merged.plugins.a.p.data,{left:2,right:2});
  assert.deepEqual(merged.plugins.a.p.permissions,["editor"]);
  const draft={...base,markdownExtensions:{...base.markdownExtensions,mark:false}};
  const latest={...current,markdownExtensions:{...current.markdownExtensions,abbr:false}};
  assert.equal(settingsDraftPatch(latest,base,draft).markdownExtensions.abbr,false);
  assert.equal(settingsDraftPatch(latest,base,draft).markdownExtensions.mark,false);
});
test("application translations interpolate whole messages and leave unknown user content intact", () => {
  setLocale("en");
  try {assert.equal(t("已选 {0} 项",2),"2 items selected");assert.equal(t("我的私人文档"),"我的私人文档");}
  finally {setLocale("zh-CN");}
});
test("plugin form and whiteboard input reject prototype keys, duplicates and invalid drawing data", () => {
  assert.throws(()=>validateFields([{key:"constructor",label:"X",type:"text"}]));
  assert.throws(()=>validateFields([{key:"x",label:"X",type:"text"},{key:"x",label:"Again",type:"text"}]));
  assert.throws(()=>validateWhiteboard({format:"markfolio-whiteboard",shapes:[{id:"x",type:"pen",color:"url(evil)",width:3,points:[[1,2]]}]}));
  assert.throws(()=>validateWhiteboard({format:"markfolio-whiteboard",shapes:[{id:"x",type:"pen",color:"#333333",width:3,points:[[NaN,2]]}]}));
  assert.equal(validateWhiteboard({format:"markfolio-whiteboard",shapes:[]}).length,0);
});
test("wiki preprocessing and editor widgets preserve front matter, inline code, indented code and long fences", () => {
  const source="---\ncustom: '[[metadata]]'\n---\n[[note]]\n`[[inline]]`\n\n    [[indented]]\n\n````\n[[fenced]]\n```\n![hidden](hidden.png)\n````\n\n$$\nx^2 + y^2\n$$\n\n![real](real.png)\n";
  const prepared=prepareMarkdown(source);
  assert.ok(prepared.includes("markfolio-wiki:note"));assert.ok(prepared.includes("`[[inline]]`"));assert.ok(prepared.includes("    [[indented]]"));assert.ok(prepared.includes("[[fenced]]"));assert.ok(!prepared.includes("[[metadata]]"));
  const widgets=inlinePreviewRanges(source);assert.equal(widgets.length,2);assert.equal(widgets[0].kind,"math");assert.equal(widgets[0].source,"x^2 + y^2");assert.equal(widgets[1].source,"real.png");
});

test("todo filtering and sort direction keep pinned and unfinished notes at the top",()=>{
  const note=(path,patch={})=>({path,title:path,modified:1,created:1,size:1,metadata:{...readMetadata(""),...patch}});
  const session={info:{id:"workspace"},catalog:[note("a.md"),note("b.md",{todo:true}),note("c.md",{todo:true,completed:true}),note("z.md",{pinned:true})],documents:{},view:"all",tag:"",folder:""};
  const settings={...defaultSettings,reverseSort:true,showCompletedTodos:false};
  assert.deepEqual(visibleNotes(session,settings).map(n=>n.path),["z.md","b.md","a.md"]);
  assert.equal(nextEditorLayout("split","editor-preview"),"editor");
  assert.equal(nextEditorLayout("editor","editor-preview"),"preview");
  assert.equal(nextEditorLayout("preview","editor-preview"),"editor");
  const stats=documentStatistics("---\ntitle: test\n---\n中文 Hello\n");assert.equal(stats.characters,9);assert.equal(stats.bytes,new TextEncoder().encode("---\ntitle: test\n---\n中文 Hello\n").length);
});
test("disabled Markdown extensions retain literal text and Fountain renders script structure",()=>{
  const source="==marked== ~sub~ ^sup^ ++insert++\n";
  const enabled=createRenderer().render(source),disabled=createRenderer(false,{extensions:{mark:false,sub:false,sup:false,ins:false}}).render(source);
  assert.match(enabled,/<mark>marked<\/mark>/);assert.doesNotMatch(disabled,/<(?:mark|sub|sup|ins)>/);assert.match(disabled,/==marked==/);
  const script=renderFountain("INT. LIBRARY - DAY\n\nALICE\nHello.\n\nCUT TO:\n");assert.match(script,/<h3>INT\. LIBRARY - DAY<\/h3>/);assert.match(script,/<h4>ALICE<\/h4>/);assert.match(script,/<p>Hello\.<\/p>/);
});

test("table row and column operations preserve surrounding source, escaped pipes and alignment",()=>{
  const source="# Before\n\n| A | B |\n| :--- | ---: |\n| a\\|b | `x\\|y` |\n\nAfter *unchanged*.\n";
  const apply=(text,position,action)=>{const change=editTable(text,position,action);return text.slice(0,change.from)+change.insert+text.slice(change.to);};
  const column=apply(source,source.indexOf("`x"),"tableAddColumn");
  assert.ok(column.startsWith("# Before\n\n"));assert.ok(column.endsWith("\n\nAfter *unchanged*.\n"));
  assert.match(column,/\| :--- \| ---: \| --- \|/);assert.ok(column.includes("a\\|b"));assert.ok(column.includes("`x\\|y`"));
  const deleted=apply(column,column.indexOf("`x"),"tableDeleteColumn");assert.ok(!deleted.includes("`x\\|y`"));assert.ok(deleted.includes("a\\|b"));
  const row=apply(source,source.indexOf("a\\|b"),"tableAddRow");assert.ok(row.includes("|  |  |\n\nAfter"));
  assert.throws(()=>editTable(source,source.indexOf("| A"),"tableDeleteRow"));
  const one="| A |\n| --- |\n| X |";assert.throws(()=>editTable(one,one.indexOf("X"),"tableDeleteColumn"));
  assert.throws(()=>editTable(source,1,"tableAddRow"));
});

test("folder sort choices stay separate by directory and workspace, including concurrent settings drafts",()=>{
  const base={...defaultSettings,perFolderSort:true};
  let next={...base,...noteSortPatch(base,"a","docs","folder",{sort:"modified",reverseSort:true})};
  next={...next,...noteSortPatch(next,"b","docs","folder",{sort:"size"})};
  next={...next,...noteSortPatch(next,"a","other","folder",{sort:"created"})};
  assert.deepEqual(noteSortFor(next,"a","docs"),{sort:"modified",reverseSort:true});
  assert.equal(noteSortFor(next,"b","docs").sort,"size");assert.equal(noteSortFor(next,"a","other").sort,"created");
  assert.equal(noteSortFor(next,"a","docs","all").sort,base.sort);
  const draft={...base,...noteSortPatch(base,"c","notes","folder",{sort:"manual"})};
  const merged={...next,...settingsDraftPatch(next,base,draft)};
  assert.equal(noteSortFor(merged,"a","docs").sort,"modified");assert.equal(noteSortFor(merged,"c","notes").sort,"manual");
  const global=noteSortPatch({...merged,perFolderSort:false},"a","docs","folder",{reverseSort:true});assert.deepEqual(global,{reverseSort:true});
});
