import { readFileSync,writeFileSync } from "node:fs";
const source=readFileSync(new URL("../src/commands.ts",import.meta.url),"utf8");
const commands=[...source.matchAll(/\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]*)"\s*\]/g)].map(([,id,title,shortcut])=>({id,title,shortcut}));
const groups=[{name:"文件",commands:[]},{name:"编辑",commands:[]},{name:"视图",commands:[]},{name:"转到",commands:[]},{name:"笔记",commands:[]},{name:"工具",commands:[]},{name:"帮助",commands:[]}];
for(const command of commands){const id=command.id;const index=id==="app.about"?6:["app.quit","app.closeWindow"].includes(id)||id.startsWith("workspace.")||["folder.new","file.new","file.newTodo","file.save","file.print"].includes(id)?0:id.startsWith("edit.")||id.startsWith("format.")?1:id.startsWith("view.")?2:id.startsWith("nav.")||id.startsWith("focus.")?3:id.startsWith("file.")||id.startsWith("files.")?4:5;groups[index].commands.push(command);}
writeFileSync(new URL("../src-tauri/menu.json",import.meta.url),JSON.stringify(groups,null,2)+"\n");
