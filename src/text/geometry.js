import { PolygonMeshBuilder, Vector2, VertexData } from '@babylonjs/core';
import earcut from 'earcut';
const contains = (ring, p) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside = !inside;
  }
  return inside;
};
export function contours(commands, steps) {
  const rings = [];
  let ring = [], point = [0, 0];
  const push = (x, y) => { point = [x,y]; if (!ring.length || ring.at(-1).x !== x || ring.at(-1).y !== y) ring.push(new Vector2(x,y)); };
  const close = () => {
    if (ring.length > 1 && ring[0].equals(ring.at(-1))) ring.pop();
    if (ring.length > 2) rings.push(ring);
    ring = [];
  };
  for (const {command, args: a} of commands) {
    if (command === 'moveTo') { close(); push(...a); }
    else if (command === 'lineTo') push(...a);
    else if (command === 'closePath') close();
    else if (command === 'quadraticCurveTo' || command === 'bezierCurveTo') {
      const start = point;
      for (let i=1; i<=steps; i++) {
        const t=i/steps, u=1-t;
        if (command === 'quadraticCurveTo') push(u*u*start[0]+2*u*t*a[0]+t*t*a[2],u*u*start[1]+2*u*t*a[1]+t*t*a[3]);
        else push(u*u*u*start[0]+3*u*u*t*a[0]+3*u*t*t*a[2]+t*t*t*a[4],u*u*u*start[1]+3*u*u*t*a[1]+3*u*t*t*a[3]+t*t*t*a[5]);
      }
    }
  }
  close();
  return rings;
}
export function textGeometry(font, options, scene) {
  const {text, size, depth, resolution, spacing, lineHeight, align} = options;
  const scale = size/font.unitsPerEm;
  const output = new VertexData();
  output.positions=[]; output.normals=[]; output.uvs=[]; output.indices=[];
  text.split('\n').forEach((line, lineIndex) => {
    const run = font.layout(line);
    const width = run.positions.reduce((sum,p)=>sum+p.xAdvance*scale,0) + Math.max(0,run.glyphs.length-1)*spacing;
    let x = align === 'center' ? -width/2 : align === 'right' ? -width : 0;
    run.glyphs.forEach((glyph,index) => {
      const pos = run.positions[index];
      const rings = contours(glyph.path.commands, resolution).map(ring => ring.map(p => new Vector2((p.x+pos.xOffset)*scale+x,(p.y+pos.yOffset)*scale-lineIndex*size*lineHeight)));
      const levels = rings.map((ring,i) => rings.filter((other,j)=>i!==j&&contains(other,ring[0])).length);
      rings.forEach((ring,i) => {
        if (levels[i]%2) return;
        const builder = new PolygonMeshBuilder('__text',ring,scene,earcut);
        rings.forEach((hole,j)=>{if(levels[j]===levels[i]+1&&contains(ring,hole[0]))builder.addHole(hole);});
        const data = builder.buildVertexData(depth);
        const offset = output.positions.length/3;
        for(let k=0;k<data.positions.length;k+=3) {
          output.positions.push(data.positions[k],data.positions[k+2],-data.positions[k+1]);
          output.normals.push(data.normals[k],data.normals[k+2],-data.normals[k+1]);
        }
        output.uvs.push(...data.uvs);
        for(const index of data.indices) output.indices.push(index+offset);
      });
      x += pos.xAdvance*scale+spacing;
    });
  });
  if (!output.positions.length) throw Error('This text has no usable outlines. Color-only fonts are not supported.');
  return output;
}
