import { t } from "./i18n";
import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { createRenderer, prepareMarkdown } from "./markdown";
import { htmlToMarkdown, fileAsBase64 } from "./conversion";
import { splitFrontMatter } from "./metadata";
import { editorActions, registerRichEditor } from "./Editor";
import { useApp, type Buffer } from "./store";
import { readAsset, writeAsset } from "./api";
import { resolveLink, relativeLink, parentPath, displayError, type Settings } from "./types";
import { sourceBoundary } from "./richSelection";

type Block = { id:string; source:string; editable:boolean };
export function markdownBlocks(text:string,settings?:Pick<Settings,"markdownExtensions"|"rawHtml">):Block[] {
  const front=splitFrontMatter(text);const lines=text.split("\n");const starts=[0];for(let i=0;i<text.length;i++)if(text[i]==="\n")starts.push(i+1);
  const tokens=createRenderer(false,{rawHtml:settings?.rawHtml,extensions:settings?.markdownExtensions}).parse(prepareMarkdown(text),{});
  const ranges=tokens.filter(t=>t.level===0&&t.map).map(t=>({from:starts[t.map![0]]??text.length,to:starts[t.map![1]]??text.length,type:t.type}));
  if(front.header)ranges.unshift({from:0,to:front.header.length,type:"frontmatter"});
  const blocks:Block[]=[];let offset=0;
  for(const range of ranges){if(range.from<offset)continue;if(range.from>offset)blocks.push({id:crypto.randomUUID(),source:text.slice(offset,range.from),editable:false});
    const source=text.slice(range.from,range.to);const supported=["paragraph_open","heading_open","bullet_list_open","ordered_list_open","blockquote_open","table_open","hr"].includes(range.type);
    const opaque=/\[\[|\[\^|\$|^\*\[|<[a-z]|\\\n/m.test(source)||range.type==="html_block";
    blocks.push({id:crypto.randomUUID(),source,editable:supported&&!opaque});offset=range.to;
  }
  if(offset<text.length)blocks.push({id:crypto.randomUUID(),source:text.slice(offset),editable:false});
  if(!blocks.length)blocks.push({id:crypto.randomUUID(),source:lines.join("\n"),editable:true});
  return blocks;
}
function BlockEditor({block,change,settings,workspace,path,readOnly}: {block:Block;change(source:string):void;settings:Settings;workspace:string;path:string;readOnly:boolean}) {
  const element=useRef<HTMLDivElement>(null);const last=useRef(block.source);const [sourceMode,setSourceMode]=useState(false);
  useEffect(()=>{const node=element.current;if(!node)return;if(!node.contains(document.activeElement)||last.current!==block.source){node.innerHTML=DOMPurify.sanitize(createRenderer(settings.math,{rawHtml:settings.rawHtml,extensions:settings.markdownExtensions}).render(prepareMarkdown(block.source)));last.current=block.source;}
    let cancelled=false;for(const image of node.querySelectorAll("img")){const resolved=resolveLink(path,image.getAttribute("data-local-src")??"");if(resolved)void readAsset(workspace,resolved).then(url=>{if(!cancelled)image.src=url;}).catch(()=>{});}
    return()=>{cancelled=true;};
  },[block.source,settings.math,settings.rawHtml,settings.markdownExtensions,workspace,path,sourceMode]);
  const blank=!block.source.trim();
  function sync(){if(!element.current)return;const suffix=block.source.match(/\n*$/)?.[0]??"";const next=htmlToMarkdown(element.current.innerHTML)+suffix;last.current=next;change(next);}
  async function pasteImages(files:File[],range:Range){try{for(const file of files){const asset=await writeAsset(workspace,parentPath(path),`paste-${crypto.randomUUID()}.${file.type.includes("jpeg")?"jpg":"png"}`,await fileAsBase64(file));const node=element.current;if(!node?.contains(range.commonAncestorContainer)||!useApp.getState().sessions[workspace]?.documents[path]){useApp.getState().setNotice(asset);continue;}const image=document.createElement("img");image.dataset.localSrc=relativeLink(path,asset);image.alt=file.name||"image";image.src=await readAsset(workspace,asset);range.deleteContents();range.insertNode(image);range.setStartAfter(image);range.collapse(true);sync();}await useApp.getState().refresh(workspace);}catch(e){useApp.getState().setNotice(displayError(e));}}
  function table(action:"add-row"|"delete-row"|"add-column"|"delete-column"){const node=element.current;const selection=window.getSelection();const cell=selection?.anchorNode?.parentElement?.closest("td,th") as HTMLTableCellElement|undefined;const grid=cell?.closest("table")??node?.querySelector("table");if(!grid||!node?.contains(grid))return;const row=cell?.parentElement as HTMLTableRowElement|undefined;const rows=[...grid.rows];const index=cell?.cellIndex??(rows[0]?.cells.length??1)-1;
    if(action==="add-row"){const next=grid.insertRow((row?.rowIndex??rows.length-1)+1);for(let i=0;i<(rows[0]?.cells.length??1);i++)next.insertCell().textContent=" ";}
    if(action==="delete-row"&&row&&row.rowIndex>0&&rows.length>1)grid.deleteRow(row.rowIndex);
    if(action==="add-column")for(const r of rows){const next=document.createElement(r.rowIndex===0?"th":"td");next.textContent=" ";r.insertBefore(next,r.cells[index+1]??null);}
    if(action==="delete-column"&&(rows[0]?.cells.length??0)>1)for(const r of rows)if(r.cells[index])r.deleteCell(index);
    sync();
  }
  if(blank&&!block.editable)return <div className="rich-gap" aria-hidden="true"/>;
  return <div className={`rich-block ${block.editable?"editable":"opaque"}`}>
    {sourceMode?<textarea className="source-input" aria-label={t("保留 Markdown 源码块")} value={block.source} readOnly={readOnly} onChange={e=>change(e.target.value)}/>:<div ref={element} contentEditable={block.editable&&!readOnly} suppressContentEditableWarning role={block.editable?"textbox":undefined} aria-label={block.editable?t("富文本段落"):undefined} data-rich-block={block.id} spellCheck={useApp.getState().settings.spellcheck} onInput={sync} onPaste={e=>{if(readOnly)return;const files=[...(e.clipboardData?.files??[])].filter(f=>f.type.startsWith("image/"));const selection=window.getSelection();if(files.length&&selection?.rangeCount){e.preventDefault();void pasteImages(files,selection.getRangeAt(0).cloneRange());return;}const html=e.clipboardData.getData("text/html");if(html){e.preventDefault();const template=document.createElement("template");template.innerHTML=DOMPurify.sanitize(html,{FORBID_TAGS:["script","style","iframe","object","embed","form"]});for(const image of template.content.querySelectorAll("img")){image.dataset.localSrc=image.getAttribute("src")??"";image.removeAttribute("src");image.removeAttribute("srcset");}document.execCommand("insertHTML",false,template.innerHTML);sync();}}} onDoubleClick={()=>{if(!block.editable&&!readOnly)setSourceMode(true);}}/>}
    {!readOnly&&block.editable&&block.source.includes("|")&&<div className="rich-table-tools">{[["add-row","添加表格行"],["delete-row","删除表格行"],["add-column","添加表格列"],["delete-column","删除表格列"]].map(([action,title])=><button key={action} className="secondary" onMouseDown={e=>e.preventDefault()} onClick={()=>table(action as Parameters<typeof table>[0])}>{t(title)}</button>)}</div>}
    {!readOnly&&<button className="rich-source-toggle" onClick={()=>setSourceMode(!sourceMode)}>{sourceMode?t("呈现"):t("源码")}</button>}
  </div>;
}
export default function RichEditor({workspace,buffer,settings,readOnly=false}:{workspace:string;buffer:Buffer;settings:Settings;readOnly?:boolean}) {
  const [blocks,setBlocks]=useState(()=>markdownBlocks(buffer.text,settings));const blocksRef=useRef(blocks);const written=useRef(buffer.text);const root=useRef<HTMLDivElement>(null);const savedRange=useRef<Range>();const settingsRef=useRef(settings);settingsRef.current=settings;
  const [searching,setSearching]=useState(false);const [search,setSearch]=useState("");const [replacement,setReplacement]=useState("");const searchInput=useRef<HTMLInputElement>(null);
  function locateSelection(){
    const range=savedRange.current;const end=blocksRef.current.reduce((n,b)=>n+b.source.length,0);
    if(!range||!root.current?.contains(range.startContainer)||!root.current.contains(range.endContainer))return {from:end,to:end};
    function boundary(node:Node,position:number,isEnd:boolean){const element=node.nodeType===Node.ELEMENT_NODE?node as Element:node.parentElement;const blockElement=element?.closest<HTMLElement>("[data-rich-block]");const index=blocksRef.current.findIndex(b=>b.id===blockElement?.dataset.richBlock);if(index<0||!blockElement)return isEnd?end:0;const offset=blocksRef.current.slice(0,index).reduce((n,b)=>n+b.source.length,0);return offset+sourceBoundary(blocksRef.current[index].source,blockElement,node,position,isEnd,settingsRef.current.markdownExtensions);}
    const from=boundary(range.startContainer,range.startOffset,false);return {from,to:range.collapsed?from:Math.max(from,boundary(range.endContainer,range.endOffset,true))};
  }
  useEffect(()=>{if(buffer.text!==written.current){const next=markdownBlocks(buffer.text,settingsRef.current);blocksRef.current=next;setBlocks(next);written.current=buffer.text;savedRange.current=undefined;}},[buffer.text]);
  useEffect(()=>{const next=markdownBlocks(written.current,settings);blocksRef.current=next;setBlocks(next);savedRange.current=undefined;},[settings.markdownExtensions,settings.rawHtml]);
  function change(id:string,source:string){const next=blocksRef.current.map(b=>b.id===id?{...b,source}:b);const text=next.map(b=>b.source).join("");written.current=text;blocksRef.current=next;setBlocks(next);editorActions.replaceDocument(workspace,buffer.path,text);}
  useEffect(()=>registerRichEditor(workspace,buffer.path,{
    select:()=>savedRange.current?.toString()??"",
    range:()=>locateSelection(),
    insert(text,before,after,replace){
      if(readOnly)return;
      const range=savedRange.current;const node=range?.commonAncestorContainer;const element=node?.nodeType===Node.ELEMENT_NODE?node as Element:node?.parentElement;
      const blockElement=element?.closest<HTMLElement>("[data-rich-block]");
      if(!range||!blockElement||!root.current?.contains(blockElement)) {const block=blocksRef.current[blocksRef.current.length-1];if(block)change(block.id,block.source+"\n"+before+text+after+"\n");return;}
      const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);blockElement.focus();
      if(before==="**"&&after==="**")document.execCommand("bold");else if(before==="*"&&after==="*")document.execCommand("italic");
      else if(before==="- "&&!after)document.execCommand("insertUnorderedList");else if(before==="1. "&&!after)document.execCommand("insertOrderedList");
      else{const selected=replace?text:range.toString()||text;const options=settingsRef.current;document.execCommand("insertHTML",false,DOMPurify.sanitize(createRenderer(options.math,{rawHtml:options.rawHtml,extensions:options.markdownExtensions}).render(before+selected+after)));}
      const block=blocksRef.current.find(b=>b.id===blockElement.dataset.richBlock);if(block)change(block.id,htmlToMarkdown(blockElement.innerHTML)+(block.source.match(/\n*$/)?.[0]??""));
    },
    focus:()=>root.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus(),
    command(name){if(name==="selectAll"){const elements=root.current?.querySelectorAll<HTMLElement>("[data-rich-block]");if(elements?.length){const range=document.createRange();range.setStart(elements[0],0);range.setEnd(elements[elements.length-1],elements[elements.length-1].childNodes.length);window.getSelection()?.removeAllRanges();window.getSelection()?.addRange(range);savedRange.current=range;}return;}if(readOnly)return;const {from,to}=locateSelection();editorActions.sourceCommand(workspace,buffer.path,name,from,to);},
    find(){setSearching(true);requestAnimationFrame(()=>searchInput.current?.focus());},
  }),[workspace,buffer.path,readOnly]);
  return <div className="rich-editor markdown-preview" ref={root} style={{fontFamily:settings.previewFontFamily,fontSize:settings.previewFontSize,lineHeight:settings.lineHeight,maxWidth:settings.previewWidth||undefined}} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();e.stopPropagation();e.shiftKey?editorActions.redo(workspace):editorActions.undo(workspace);}}} onMouseUp={()=>{const selection=window.getSelection();if(selection?.rangeCount)savedRange.current=selection.getRangeAt(0).cloneRange();}} onKeyUp={()=>{const selection=window.getSelection();if(selection?.rangeCount)savedRange.current=selection.getRangeAt(0).cloneRange();}}>
    {searching&&<div className="inline-options rich-search"><input ref={searchInput} aria-label={t("查找文本")} value={search} onChange={e=>setSearch(e.target.value)}/><input aria-label={t("替换文本")} value={replacement} onChange={e=>setReplacement(e.target.value)}/><span>{search?buffer.text.split(search).length-1:0} {t("处匹配")}</span><button disabled={!search||!buffer.text.includes(search)||readOnly} onClick={()=>editorActions.replaceDocument(workspace,buffer.path,buffer.text.replace(search,replacement))}>{t("替换")}</button><button disabled={!search||!buffer.text.includes(search)||readOnly} onClick={()=>editorActions.replaceDocument(workspace,buffer.path,buffer.text.replaceAll(search,replacement))}>{t("全部替换")}</button><button onClick={()=>setSearching(false)}>{t("关闭查找")}</button></div>}
    <p className="rich-help">{t("直接编辑段落与表格。特殊语法保留源码，双击可编辑。")}</p>
    {blocks.map(block=><BlockEditor key={block.id} block={block} change={source=>change(block.id,source)} settings={settings} workspace={workspace} path={buffer.path} readOnly={readOnly}/>)}
    {!readOnly&&<button className="secondary" onClick={()=>{const next={id:crypto.randomUUID(),source:t("\n\n新段落\n"),editable:true};const all=[...blocksRef.current,next];blocksRef.current=all;setBlocks(all);written.current=all.map(b=>b.source).join("");editorActions.replaceDocument(workspace,buffer.path,written.current);}}>{t("添加段落")}</button>}
  </div>;
}
