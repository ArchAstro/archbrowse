export const ESC = '\x1b';
export const graphicsQuery = `${ESC}_Ga=q,i=31,s=1,v=1,f=24;AAAA${ESC}\\`;
export const geometryQuery = `${ESC}[16t${ESC}[14t${ESC}[?1016$p`;
export const enterTerminal = `${ESC}[?1049h${ESC}[2J${ESC}[H${ESC}[?25l${ESC}[?1003h${ESC}[?1006h${ESC}[?2004h${ESC}[?1004h${ESC}[>31u`;
export const leaveTerminal = `${ESC}_Ga=d,d=I,i=101,q=2${ESC}\\${ESC}_Ga=d,d=I,i=102,q=2${ESC}\\${ESC}[<u${ESC}[?1016l${ESC}[?1006l${ESC}[?1003l${ESC}[?2004l${ESC}[?1004l${ESC}[?25h${ESC}[?1049l`;
/** Direct PNG transport; payload chunks are <=4096 bytes per the Kitty spec. */
export function encodeFrame(png: Buffer, columns: number, rows: number, id: 101 | 102 = 101) {
  const data = png.toString('base64');
  const chunks: string[] = [`${ESC}[?2026h${ESC}[H`];
  for (let offset = 0; offset < data.length; offset += 4096) {
    const more = offset + 4096 < data.length ? 1 : 0;
    const header = offset === 0 ? `a=T,f=100,t=d,i=${id},p=1,q=2,C=1,c=${columns},r=${rows},m=${more}` : `m=${more},q=2`;
    chunks.push(`${ESC}_G${header};${data.slice(offset, offset + 4096)}${ESC}\\`);
  }
  chunks.push(`${ESC}_Ga=d,d=I,i=${id === 101 ? 102 : 101},q=2${ESC}\\${ESC}[?2026l`);
  return chunks.join('');
}
export interface Geometry { columns: number; rows: number; cellWidth: number; cellHeight: number }
export function viewport(g: Geometry, mobile?: { width:number; height:number }) {
  return mobile ?? { width: Math.max(1, Math.round(g.columns * g.cellWidth)), height: Math.max(1, Math.round(g.rows * g.cellHeight)) };
}
export function point(x: number, y: number, pixel: boolean, g: Geometry, view: { width:number; height:number }) {
  return { x: Math.max(0, Math.min(view.width - 1, (pixel ? x - 1 : (x - .5) * g.cellWidth) * view.width / (g.columns * g.cellWidth))), y: Math.max(0, Math.min(view.height - 1, (pixel ? y - 1 : (y - .5) * g.cellHeight) * view.height / (g.rows * g.cellHeight))) };
}
/** Fit a fixed viewport into whole terminal cells, preserving aspect ratio. */
export function displayGeometry(g: Geometry, mobile?: { width:number; height:number }): Geometry {
  if (!mobile) return g;
  const scale = Math.min(g.columns*g.cellWidth/mobile.width, g.rows*g.cellHeight/mobile.height);
  return { ...g, columns:Math.max(1,Math.floor(mobile.width*scale/g.cellWidth)), rows:Math.max(1,Math.floor(mobile.height*scale/g.cellHeight)) };
}
