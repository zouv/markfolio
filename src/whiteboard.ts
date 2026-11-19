export type Shape = { id:string;type:"pen"|"rectangle"|"ellipse"|"text";color:string;width:number;points:[number,number][];text?:string };
export function validateWhiteboard(value: unknown): Shape[] {
  const data = value as {format?:unknown;shapes?:unknown};
  if(!data || data.format!=="markfolio-whiteboard" || !Array.isArray(data.shapes) || data.shapes.length>10000) throw new Error("白板文件无效");
  const ids=new Set<string>();let count=0;
  for(const shape of data.shapes as Shape[]){
    if(!shape || typeof shape.id!=="string" || shape.id.length>80 || ids.has(shape.id) || !["pen","rectangle","ellipse","text"].includes(shape.type) || !/^#[a-f\d]{6}$/i.test(shape.color) || !Number.isFinite(shape.width) || shape.width<1 || shape.width>40 || !Array.isArray(shape.points) || !shape.points.length || shape.points.length>100000 || shape.text!==undefined && (typeof shape.text!=="string" || shape.text.length>10000))throw new Error("白板文件无效");
    ids.add(shape.id);count+=shape.points.length;if(count>200000)throw new Error("白板文件无效");
    for(const point of shape.points)if(!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite)||point[0]<0||point[0]>1200||point[1]<0||point[1]>700)throw new Error("白板文件无效");
  }
  return data.shapes as Shape[];
}
