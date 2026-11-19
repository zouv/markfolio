import { t } from "./i18n";
import { StateField,type Extension } from "@codemirror/state";
import { Decoration,EditorView,WidgetType,type DecorationSet } from "@codemirror/view";
import katex from "katex";
import DOMPurify from "dompurify";
import { readAsset,resolveNoteLink } from "./api";
import { resolveLink } from "./types";
import { createRenderer } from "./markdown";
import { splitFrontMatter } from "./metadata";
export function inlinePreviewRanges(text:string):{position:number;kind:"image"|"math";source:string}[] {
  const lines=text.split("\n"),starts=[0];for(let i=0;i<text.length;i++)if(text[i]==="\n")starts.push(i+1);
  const excluded=new Set<number>();
  const front=splitFrontMatter(text);if(front.header)for(let i=0;i<front.header.split("\n").length-1;i++)excluded.add(i);
  for(const token of createRenderer().parse(text,{}))if(["fence","code_block"].includes(token.type)&&token.map)for(let i=token.map[0];i<token.map[1];i++)excluded.add(i);
  const ranges:{position:number;kind:"image"|"math";source:string}[]=[];
  for(let i=0;i<lines.length&&ranges.length<150;i++) {
    if(excluded.has(i))continue;const line=lines[i];
    if(/^\s*\$\$/.test(line)) {
      const inline=/^\s*\$\$([\s\S]+?)\$\$\s*$/.exec(line);
      if(inline){ranges.push({position:starts[i]+line.length,kind:"math",source:inline[1]});continue;}
      if(/^\s*\$\$\s*$/.test(line)){let end=i+1;while(end<lines.length&&!excluded.has(end)&&!/^\s*\$\$\s*$/.test(lines[end]))end++;if(end<lines.length&&!excluded.has(end)){ranges.push({position:starts[end]+lines[end].length,kind:"math",source:lines.slice(i+1,end).join("\n")});i=end;continue;}}
    }
    const image=/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)|!\[\[([^\]]+)\]\]/.exec(line);
    if(image)ranges.push({position:starts[i]+line.length,kind:"image",source:(image[1]??image[2]??image[3]).split("|")[0]});
  }
  return ranges;
}
class InlineWidget extends WidgetType {
  cancelled=false;
  constructor(readonly workspace:string,readonly path:string,readonly kind:"image"|"math",readonly source:string){super();}
  eq(other:InlineWidget){return this.source===other.source&&this.kind===other.kind&&this.workspace===other.workspace&&this.path===other.path;}
  toDOM(){const element=document.createElement("div");element.className="editor-inline-preview";
    if(this.kind==="math")element.innerHTML=DOMPurify.sanitize(katex.renderToString(this.source,{throwOnError:false,trust:false,displayMode:true}));
    else{const image=document.createElement("img");image.alt=t("本地图片");element.append(image);const path=resolveLink(this.path,this.source);const promise=path?Promise.resolve(path):resolveNoteLink(this.workspace,this.path,this.source,true).then(link=>link.path);void promise.then(path=>readAsset(this.workspace,path)).then(url=>{if(!this.cancelled){image.src=url;image.onload=()=>EditorView.findFromDOM(element)?.requestMeasure();}}).catch(()=>{image.alt=t("图片文件不存在");});}
    return element;
  }
  destroy(){this.cancelled=true;}
  ignoreEvent(){return true;}
}
export function inlinePreviewExtension(workspace:string,path:string,math=true):Extension {
  function decorations(text:string):DecorationSet {
    return Decoration.set(inlinePreviewRanges(text).filter(range=>math||range.kind!=="math").map(range=>Decoration.widget({widget:new InlineWidget(workspace,path,range.kind,range.source),side:1,block:true}).range(range.position)),true);
  }
  return StateField.define<DecorationSet>({create:state=>decorations(state.doc.toString()),update:(value,transaction)=>transaction.docChanged?decorations(transaction.newDoc.toString()):value,provide:field=>EditorView.decorations.from(field)});
}
