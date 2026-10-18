import { InputError } from './types';
import type { Job, StockStats, Tool, Vec3 } from './types';
import { cuttingTipOffset,requireRadialProfile } from './toolProfile';
import { toolAxis } from './toolAxis';
export const TILE_SIZE = 16;
export const MAX_CELLS = 160000;
const EPS = 1e-9;
type SideSweep = { signature: string; x: number; z: number; low: number; high: number; end: number };
type CarveEdit = { x: number; y: number; values: number[]; removed: number };
export function subtractIntervals(intervals: readonly number[], low: number, high: number): number[] {
  if (high <= low) return [...intervals];
  const result: number[] = [];
  for (let k = 0; k < intervals.length; k += 2) {
    const a = intervals[k], b = intervals[k + 1];
    if (high <= a || low >= b) result.push(a, b);
    else {
      if (low > a + EPS) result.push(a, Math.min(low, b));
      if (high < b - EPS) result.push(Math.max(high, a), b);
    }
  }
  return result;
}
function intervalLength(values: readonly number[]) {
  let length = 0;
  for (let i = 0; i < values.length; i += 2) length += values[i + 1] - values[i];
  return length;
}
export class DexelStock {
  readonly nx: number; readonly ny: number; readonly dx: number; readonly dy: number;
  readonly min: number[]; readonly size: number[]; readonly tilesX: number; readonly tilesY: number;
  private columns: number[][] = [];
  private dirty = new Set<number>();
  private full = true; private removed = 0; private endpoints = 0; private revision = 0;
  private initialColumns:number[][]|null=null;
  private initialVolume:number|null=null;
  private sideSweep?:SideSweep;
  constructor(spec: Job['stock'], cellSize = .5,private conservative=false) {
    if (!Number.isFinite(cellSize) || cellSize < .1 || cellSize > 5) throw new InputError('材料格距应在0.1至5 mm之间');
    this.min = [...spec.minCornerInW]; this.size = [...spec.sizeMm];
    if (this.size.length !== 3 || this.min.length !== 3 || this.size.some(x => !Number.isFinite(x) || x <= 0) || this.min.some(x => !Number.isFinite(x))) throw new InputError('毛坯尺寸或原点无效');
    this.nx = Math.ceil(this.size[0] / cellSize); this.ny = Math.ceil(this.size[1] / cellSize);
    if (this.nx * this.ny > MAX_CELLS) throw new InputError('材料网格超过160000单元，请增大格距');
    this.dx = this.size[0] / this.nx; this.dy = this.size[1] / this.ny;
    this.tilesX = Math.ceil(this.nx / TILE_SIZE); this.tilesY = Math.ceil(this.ny / TILE_SIZE);
    this.reset();
  }
  reset() {
    this.sideSweep=undefined;
    this.columns = this.initialColumns?this.initialColumns.map(c=>[...c]):Array.from({ length: this.nx * this.ny }, () => [this.min[2], this.min[2] + this.size[2]]);
    this.endpoints = this.columns.reduce((n,c)=>n+c.length,0); this.removed = 0; this.full = true; this.revision++;
    this.dirty = new Set(Array.from({ length: this.tilesX * this.tilesY }, (_, i) => i));
  }
  initialize(columns:number[][]){
    if(columns.length!==this.nx*this.ny||columns.some(c=>c.length%2||c.length>64||c.some((v,i)=>!Number.isFinite(v)||(i>0&&v<=c[i-1]))))throw new InputError('网格毛坯区间无效',undefined,'INVALID_STOCK');
    if(columns.reduce((n,c)=>n+c.length,0)>1000000)throw new InputError('网格毛坯端点预算超限',undefined,'STOCK_BUDGET');
    this.initialColumns=columns.map(c=>[...c]);this.initialVolume=columns.reduce((n,c)=>n+intervalLength(c)*this.dx*this.dy,0);this.reset();
  }
  save(){return {columns:this.columns.map(c=>[...c]),removed:this.removed,sideSweep:this.sideSweep?{...this.sideSweep}:undefined};}
  restore(saved:{columns:number[][];removed:number;sideSweep?:SideSweep}){this.sideSweep=saved.sideSweep?{...saved.sideSweep}:undefined;this.columns=saved.columns.map(c=>[...c]);this.removed=saved.removed;this.endpoints=this.columns.reduce((n,c)=>n+c.length,0);this.full=true;this.revision++;this.dirty=new Set(Array.from({length:this.tilesX*this.tilesY},(_,i)=>i));}
  getColumn(x: number, y: number): readonly number[] {
    if (x < 0 || x >= this.nx || y < 0 || y >= this.ny) return [];
    return this.columns[x + y * this.nx];
  }
  private mark(x: number, y: number) {
    for (const [xx, yy] of [[x, y], [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (xx >= 0 && yy >= 0 && xx < this.nx && yy < this.ny) this.dirty.add(Math.floor(xx / TILE_SIZE) + Math.floor(yy / TILE_SIZE) * this.tilesX);
    }
  }
  carveLine(from: Vec3, to: Vec3, tool: Tool,extraMarginMm=0): number {
    const axis=toolAxis(tool);
    if(tool.type==='profile_endmill'){
      requireRadialProfile(tool);
      if(axis.z!==1)throw new InputError('径向剖面成形刀仅支持+Z刀轴',undefined,'PROFILE_TOOL_AXIS');
      if(Math.abs(to.z-from.z)>EPS&&Math.hypot(to.x-from.x,to.y-from.y)>EPS)throw new InputError('剖面刀仅支持等Z平面切削或纯Z进给，混合XY/Z路径尚不支持',undefined,'PROFILE_TOOL_PATH');
    }
    if(axis.y===-1)return this.carveSideLine(from,to,tool,extraMarginMm);
    this.sideSweep=undefined;
    const margin=this.conservative?Math.hypot(this.dx,this.dy)/2+extraMarginMm:0;
    const radius = tool.diameterMm / 2-margin, vx = to.x - from.x, vy = to.y - from.y, vz = to.z - from.z;
    if(radius<=0)return 0;
    const lengthXY = Math.hypot(vx, vy), squared = lengthXY * lengthXY;
    const x0 = Math.max(0, Math.ceil((Math.min(from.x, to.x) - radius - this.min[0]) / this.dx - .5));
    const x1 = Math.min(this.nx - 1, Math.floor((Math.max(from.x, to.x) + radius - this.min[0]) / this.dx - .5));
    const y0 = Math.max(0, Math.ceil((Math.min(from.y, to.y) - radius - this.min[1]) / this.dy - .5));
    const y1 = Math.min(this.ny - 1, Math.floor((Math.max(from.y, to.y) + radius - this.min[1]) / this.dy - .5));
    const edits: CarveEdit[] = [];
    let endpointDelta = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const previous = this.getColumn(x, y); if (!previous.length) continue;
      const ux = this.min[0] + (x + .5) * this.dx - from.x, uy = this.min[1] + (y + .5) * this.dy - from.y;
      let lowT = 0, highT = 1, nearestT = 0;
      if (lengthXY < EPS) { if (Math.hypot(ux, uy) > radius + EPS) continue; }
      else {
        const perpendicular = (ux * vy - uy * vx) / lengthXY;
        if (Math.abs(perpendicular) > radius + EPS) continue;
        const middle = (ux * vx + uy * vy) / squared;
        const half = Math.sqrt(Math.max(0, radius * radius - perpendicular * perpendicular)) / lengthXY;
        lowT = Math.max(0, middle - half); highT = Math.min(1, middle + half);
        if (lowT > highT) continue;
        nearestT = Math.max(lowT, Math.min(highT, middle));
      }
      const bottomAt = (t: number) => from.z + vz * t + cuttingTipOffset(tool, Math.hypot(ux - vx * t, uy - vy * t)+margin);
      let lowZ: number;
      if (tool.type === 'flat_endmill') lowZ = from.z + Math.min(vz * lowT, vz * highT);
      else if (lengthXY < EPS || Math.abs(vz) < EPS) lowZ = Math.min(bottomAt(lowT), bottomAt(highT), bottomAt(nearestT));
      else {
        let left = lowT, right = highT;
        for (let k = 0; k < 36; k++) {
          const a = left + (right - left) / 3, b = right - (right - left) / 3;
          if (bottomAt(a) <= bottomAt(b)) right = b; else left = a;
        }
        lowZ = Math.min(bottomAt(lowT), bottomAt(highT), bottomAt((left + right) / 2));
      }
      const highZ = from.z + Math.max(vz * lowT, vz * highT) + tool.cuttingLengthMm;
      if (!Number.isFinite(lowZ) || highZ <= lowZ + EPS) continue;
      const values = subtractIntervals(previous, lowZ, highZ);
      const removed = intervalLength(previous) - intervalLength(values);
      if (removed <= EPS) continue;
      if (values.length > 64) throw new InputError('单列材料超过32个区间，请简化程序或调整分辨率', undefined, 'STOCK_BUDGET');
      endpointDelta += values.length - previous.length;
      edits.push({ x, y, values, removed });
    }
    return this.commitCarve(edits,endpointDelta);
  }
  private commitCarve(edits:CarveEdit[],endpointDelta:number):number {
    if (this.endpoints + endpointDelta > 1000000) throw new InputError('材料区间总端点超过1000000', undefined, 'STOCK_BUDGET');
    let removed = 0;
    for (const edit of edits) {
      this.columns[edit.x + edit.y * this.nx] = edit.values; removed += edit.removed * this.dx * this.dy;
      this.mark(edit.x, edit.y);
    }
    if (edits.length) { this.endpoints += endpointDelta; this.removed += removed; this.revision++; }
    return removed;
  }
  private carveSideLine(from:Vec3,to:Vec3,tool:Tool,extraMarginMm:number):number {
    if(Math.abs(to.x-from.x)>EPS||Math.abs(to.z-from.z)>EPS)throw new InputError('侧钻切削仅支持沿Y刀轴的直线进退刀',undefined,'SIDE_TOOL_PATH');
    if(tool.type==='ball_endmill')throw new InputError('侧钻材料去除仅支持钻头或平底刀',undefined,'SIDE_TOOL_SHAPE');
    const radius=tool.diameterMm/2,length=tool.cuttingLengthMm;
    const signature=JSON.stringify([tool.toolId,tool.type,radius,length,this.conservative?extraMarginMm:0]);
    const previous=this.sideSweep;
    const continuous=previous&&previous.signature===signature&&Math.abs(previous.x-from.x)<EPS&&Math.abs(previous.z-from.z)<EPS&&Math.abs(previous.end-from.y)<EPS;
    const low=continuous?Math.min(previous.low,from.y,to.y):Math.min(from.y,to.y);
    const high=continuous?Math.max(previous.high,from.y,to.y):Math.max(from.y,to.y);
    const sweep:SideSweep={signature,x:from.x,z:from.z,low,high,end:to.y};
    // Intersect the swept solid over the entire XY cell. Every removed Z point
    // is therefore absent throughout the cell, including its four corners.
    const extra=this.conservative?Math.max(0,extraMarginMm):0;
    const halfX=this.conservative?this.dx/2+extra:0;
    const halfY=this.conservative?this.dy/2+extra:0;
    const x0=Math.max(0,Math.ceil((from.x-radius+halfX-this.min[0])/this.dx-.5));
    const x1=Math.min(this.nx-1,Math.floor((from.x+radius-halfX-this.min[0])/this.dx-.5));
    const y0=Math.max(0,Math.ceil((low-length+halfY-this.min[1])/this.dy-.5));
    const y1=Math.min(this.ny-1,Math.floor((high-halfY-this.min[1])/this.dy-.5));
    const edits:CarveEdit[]=[];
    let endpointDelta=0;
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const column=this.getColumn(x,y);if(!column.length)continue;
      const centerY=this.min[1]+(y+.5)*this.dy;
      const axial=Math.min(length,high-centerY-halfY);
      if(axial<0)continue;
      const sectionRadius=tool.type==='drill'?Math.min(radius,axial*Math.tan(59*Math.PI/180)):radius;
      const radialX=Math.abs(this.min[0]+(x+.5)*this.dx-from.x)+halfX;
      if(radialX>=sectionRadius)continue;
      const halfZ=Math.sqrt(Math.max(0,sectionRadius*sectionRadius-radialX*radialX))-extra;
      if(halfZ<=EPS)continue;
      const values=subtractIntervals(column,from.z-halfZ,from.z+halfZ);
      const removed=intervalLength(column)-intervalLength(values);
      if(removed<=EPS)continue;
      if(values.length>64)throw new InputError('单列材料超过32个区间，请简化程序或调整分辨率',undefined,'STOCK_BUDGET');
      endpointDelta+=values.length-column.length;
      edits.push({x,y,values,removed});
    }
    const removed=this.commitCarve(edits,endpointDelta);
    this.sideSweep=sweep;
    return removed;
  }
  stats(): StockStats {
    const initial = this.initialVolume??this.size[0] * this.size[1] * this.size[2];
    const removedVolumeMm3 = Math.min(initial, Math.max(0, this.removed));
    return { representation: 'z_dexel', revision: this.revision, cellSizeMm: [this.dx, this.dy], grid: [this.nx, this.ny], initialVolumeMm3: initial, removedVolumeMm3, remainingVolumeMm3: initial - removedVolumeMm3, remainingFraction: initial?(initial - removedVolumeMm3) / initial:0 };
  }
  takeDirty() {
    const result = { full: this.full, revision: this.revision, tileIds: [...this.dirty] };
    this.dirty.clear(); this.full = false; return result;
  }
  restoreDirty(update:{full:boolean;tileIds:number[]}){
    this.full=this.full||update.full;
    for(const id of update.tileIds)this.dirty.add(id);
  }
}

