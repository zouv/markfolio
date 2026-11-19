import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { createRenderer, prepareMarkdown } from "./markdown";
import { htmlToMarkdown } from "./conversion";
import { splitFrontMatter } from "./metadata";
import { editorActions, registerRichEditor } from "./Editor";
import { useApp, type Buffer } from "./store";
import { readAsset } from "./api";
import { resolveLink, type Settings } from "./types";

type Block = { id:string; source:string; editable:boolean };
export function markdownBlocks(text:string):Block[] {
  const front=splitFrontMatter(text);const lines=text.split("\n");const starts=[0];for(let i=0;i<text.length;i++)if(text[i]==="\n")starts.push(i+1);
  const tokens=createRenderer(false,{extended:true}).parse(prepareMarkdown(text),{});
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
function BlockEditor({block,change,math,workspace,path,readOnly}: {block:Block;change(source:string):void;math:boolean;workspace:string;path:string;readOnly:boolean}) {
  const element=useRef<HTMLDivElement>(null);const last=useRef(block.source);const [sourceMode,setSourceMode]=useState(false);
  useEffect(()=>{const node=element.current;if(!node)return;if(!node.contains(document.activeElement)||last.current!==block.source){node.innerHTML=DOMPurify.sanitize(createRenderer(math,{rawHtml:true}).render(prepareMarkdown(block.source)));last.current=block.source;}
    let cancelled=false;for(const image of node.querySelectorAll("img")){const resolved=resolveLink(path,image.getAttribute("data-local-src")??"");if(resolved)void readAsset(workspace,resolved).then(url=>{if(!cancelled)image.src=url;}).catch(()=>{});}
    return()=>{cancelled=true;};
  },[block.source,math,workspace,path,sourceMode]);
  const blank=!block.source.trim();
  if(blank&&!block.editable)return <div className="rich-gap" aria-hidden="true"/>;
  return <div className={`rich-block ${block.editable?"editable":"opaque"}`}>
    {sourceMode?<textarea className="source-input" aria-label="保留 Markdown 源码块" value={block.source} readOnly={readOnly} onChange={e=>change(e.target.value)}/>:<div ref={element} contentEditable={block.editable&&!readOnly} suppressContentEditableWarning role={block.editable?"textbox":undefined} aria-label={block.editable?"富文本段落":undefined} data-rich-block={block.id} spellCheck={useApp.getState().settings.spellcheck} onInput={()=>{if(!element.current)return;const suffix=block.source.match(/\n*$/)?.[0]??"";const next=htmlToMarkdown(element.current.innerHTML)+suffix;last.current=next;change(next);}} onDoubleClick={()=>{if(!block.editable&&!readOnly)setSourceMode(true);}}/>}
    {!readOnly&&<button className="rich-source-toggle" onClick={()=>setSourceMode(!sourceMode)}>{sourceMode?"呈现":"源码"}</button>}
  </div>;
}
export default function RichEditor({workspace,buffer,settings,readOnly=false}:{workspace:string;buffer:Buffer;settings:Settings;readOnly?:boolean}) {
  const [blocks,setBlocks]=useState(()=>markdownBlocks(buffer.text));const blocksRef=useRef(blocks);const written=useRef(buffer.text);const root=useRef<HTMLDivElement>(null);const savedRange=useRef<Range>();
  useEffect(()=>{if(buffer.text!==written.current){const next=markdownBlocks(buffer.text);blocksRef.current=next;setBlocks(next);written.current=buffer.text;}},[buffer.text]);
  function change(id:string,source:string){const next=blocksRef.current.map(b=>b.id===id?{...b,source}:b);const text=next.map(b=>b.source).join("");written.current=text;blocksRef.current=next;setBlocks(next);editorActions.replaceDocument(workspace,buffer.path,text);}
  useEffect(()=>registerRichEditor(workspace,buffer.path,{
    select:()=>savedRange.current?.toString()??"",
    insert(text,before,after,replace){
      const range=savedRange.current;const node=range?.commonAncestorContainer;const element=node?.nodeType===Node.ELEMENT_NODE?node as Element:node?.parentElement;
      const blockElement=element?.closest<HTMLElement>("[data-rich-block]");
      if(!range||!blockElement||!root.current?.contains(blockElement)) {const block=blocksRef.current[blocksRef.current.length-1];if(block)change(block.id,block.source+"\n"+before+text+after+"\n");return;}
      const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);blockElement.focus();
      if(before==="**"&&after==="**")document.execCommand("bold");else if(before==="*"&&after==="*")document.execCommand("italic");
      else if(before==="- "&&!after)document.execCommand("insertUnorderedList");else if(before==="1. "&&!after)document.execCommand("insertOrderedList");
      else{const selected=replace?text:range.toString()||text;document.execCommand("insertHTML",false,DOMPurify.sanitize(createRenderer().render(before+selected+after)));}
      const block=blocksRef.current.find(b=>b.id===blockElement.dataset.richBlock);if(block)change(block.id,htmlToMarkdown(blockElement.innerHTML)+(block.source.match(/\n*$/)?.[0]??""));
    },
    focus:()=>root.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus(),
  }),[workspace,buffer.path]);
  return <div className="rich-editor markdown-preview" ref={root} style={{fontFamily:settings.previewFontFamily,fontSize:settings.fontSize}} onMouseUp={()=>{const selection=window.getSelection();if(selection?.rangeCount)savedRange.current=selection.getRangeAt(0).cloneRange();}} onKeyUp={()=>{const selection=window.getSelection();if(selection?.rangeCount)savedRange.current=selection.getRangeAt(0).cloneRange();}}>
    <p className="rich-help">直接编辑段落与表格。特殊语法保留源码，双击可编辑。</p>
    {blocks.map(block=><BlockEditor key={block.id} block={block} change={source=>change(block.id,source)} math={settings.math} workspace={workspace} path={buffer.path} readOnly={readOnly}/>)}
    {!readOnly&&<button className="secondary" onClick={()=>{const next={id:crypto.randomUUID(),source:"\n\n新段落\n",editable:true};const all=[...blocksRef.current,next];blocksRef.current=all;setBlocks(all);written.current=all.map(b=>b.source).join("");editorActions.replaceDocument(workspace,buffer.path,written.current);}}>添加段落</button>}
  </div>;
}
