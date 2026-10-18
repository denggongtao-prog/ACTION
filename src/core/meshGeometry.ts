import type { MeshBounds, MeshPoint, PreparedMesh } from './meshTypes';
import { InputError } from './types';

const MAX_TRIANGLES = 200000;
const MAX_PAIR_CHECKS = 2000000;
type Triangle = [MeshPoint, MeshPoint, MeshPoint];
type Node = { bounds: MeshBounds; left?: Node; right?: Node; ids?: number[] };
type Index = { root: Node; boxes: MeshBounds[]; tolerance: number; validated?: boolean; closed?: boolean };
const indices = new WeakMap<PreparedMesh, Index>();
const sub = (a:MeshPoint,b:MeshPoint):MeshPoint => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot = (a:MeshPoint,b:MeshPoint) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a:MeshPoint,b:MeshPoint):MeshPoint => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length = (v:MeshPoint) => Math.hypot(...v);
const lerp = (a:MeshPoint,b:MeshPoint,t:number):MeshPoint => [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
const emptyBounds = ():MeshBounds => ({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});
function include(bounds:MeshBounds,p:MeshPoint) { for(let a=0;a<3;a++){bounds.min[a]=Math.min(bounds.min[a],p[a]);bounds.max[a]=Math.max(bounds.max[a],p[a]);} }
function overlaps(a:MeshBounds,b:MeshBounds,e=0) { return a.min.every((v,i)=>v<=b.max[i]+e && a.max[i]>=b.min[i]-e); }
function boundsDistance2(b:MeshBounds,p:MeshPoint) { let d=0;for(let a=0;a<3;a++)d+=Math.max(b.min[a]-p[a],0,p[a]-b.max[a])**2;return d; }
function finitePoint(p:MeshPoint) { return p.length===3 && p.every(Number.isFinite); }
function rayHitsBounds(bounds:MeshBounds,point:MeshPoint,direction:MeshPoint,eps:number) {
  let near=0,far=Infinity;
  for(let a=0;a<3;a++){
    if(direction[a]===0){if(point[a]<bounds.min[a]-eps||point[a]>bounds.max[a]+eps)return false;continue;}
    const t0=(bounds.min[a]-eps-point[a])/direction[a],t1=(bounds.max[a]+eps-point[a])/direction[a];
    near=Math.max(near,Math.min(t0,t1));far=Math.min(far,Math.max(t0,t1));if(near>far)return false;
  }
  return true;
}

export function triangleAt(mesh:PreparedMesh,index:number):Triangle {
  if(!Number.isInteger(index)||index<0||index>=mesh.triangles.length/9)throw new Error('三角面索引越界');
  const o=index*9,t=mesh.triangles;
  return [[t[o],t[o+1],t[o+2]],[t[o+3],t[o+4],t[o+5]],[t[o+6],t[o+7],t[o+8]]];
}

function getIndex(mesh:PreparedMesh):Index {
  const cached=indices.get(mesh);if(cached)return cached;
  const count=mesh.triangles.length/9;
  if(!count||!Number.isInteger(count))throw new Error('网格必须包含完整三角面');
  if(count>MAX_TRIANGLES)throw new Error('碰撞网格超过200000三角面预算，请简化模型');
  if(!finitePoint(mesh.bounds.min)||!finitePoint(mesh.bounds.max)||mesh.bounds.min.some((v,a)=>v>mesh.bounds.max[a]))throw new Error('网格包围盒 bounds 无效');
  const extent=Math.max(...mesh.bounds.max.map((v,a)=>v-mesh.bounds.min[a]),1);
  const magnitude=Math.max(...mesh.bounds.min.map(Math.abs),...mesh.bounds.max.map(Math.abs),1);
  const tolerance=Math.max(extent*1e-10,magnitude*Number.EPSILON*32);
  const boxes:MeshBounds[]=[];
  for(let i=0;i<count;i++) {
    const tri=triangleAt(mesh,i),b=emptyBounds();
    for(const p of tri){if(!finitePoint(p))throw new Error('网格含非有限 finite 顶点');include(b,p);}
    if(b.min.some((v,a)=>v<mesh.bounds.min[a]-tolerance||b.max[a]>mesh.bounds.max[a]+tolerance))throw new Error('网格包围盒 bounds 未覆盖所有顶点');
    if(length(cross(sub(tri[1],tri[0]),sub(tri[2],tri[0])))<=tolerance*Math.max(length(sub(tri[1],tri[0])),length(sub(tri[2],tri[0]))))throw new Error('网格含退化 degenerate 三角面');
    boxes.push(b);
  }
  function build(ids:number[]):Node {
    const b=emptyBounds();for(const id of ids){include(b,boxes[id].min);include(b,boxes[id].max);}
    if(ids.length<=8)return {bounds:b,ids};
    const sizes=b.max.map((v,a)=>v-b.min[a]),axis=sizes.indexOf(Math.max(...sizes));
    ids.sort((a,c)=>(boxes[a].min[axis]+boxes[a].max[axis])-(boxes[c].min[axis]+boxes[c].max[axis]) || a-c);
    const middle=ids.length>>1;
    return {bounds:b,left:build(ids.slice(0,middle)),right:build(ids.slice(middle))};
  }
  const index={root:build(Array.from({length:count},(_,i)=>i)),boxes,tolerance};indices.set(mesh,index);return index;
}

export function meshTolerance(mesh:PreparedMesh) { return getIndex(mesh).tolerance; }

/** BVH broad phase. Returned indices refer to flat groups of nine coordinates. */
export function queryMeshTriangles(mesh:PreparedMesh,bounds:MeshBounds):number[] {
  if(!finitePoint(bounds.min)||!finitePoint(bounds.max)||bounds.min.some((v,a)=>v>bounds.max[a]))throw new Error('查询包围盒 bounds 无效');
  const index=getIndex(mesh),result:number[]=[],stack=[index.root];let budget=MAX_PAIR_CHECKS;
  while(stack.length){if(--budget<0)throw new InputError('网格查询预算耗尽，无法证明分离',undefined,'MESH_QUERY_BUDGET');const n=stack.pop()!;
    if(!overlaps(n.bounds,bounds,index.tolerance))continue;
    if(n.ids){for(const id of n.ids)if(overlaps(index.boxes[id],bounds,index.tolerance))result.push(id);}
    else {stack.push(n.left!,n.right!);}
  }
  return result;
}

// Ericson's Voronoi-region triangle closest-point calculation.
function closestTriangle(p:MeshPoint,[a,b,c]:Triangle):MeshPoint {
  const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);
  if(d1<=0&&d2<=0)return a;
  const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return b;
  const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0)return lerp(a,b,d1/(d1-d3));
  const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return c;
  const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0)return lerp(a,c,d2/(d2-d6));
  const va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0)return lerp(b,c,(d4-d3)/(d4-d3+d5-d6));
  const inv=1/(va+vb+vc),v=vb*inv,w=vc*inv;
  return [a[0]+ab[0]*v+ac[0]*w,a[1]+ab[1]*v+ac[1]*w,a[2]+ab[2]*v+ac[2]*w];
}

export function closestPointOnMesh(mesh:PreparedMesh,point:MeshPoint):{point:MeshPoint;distance:number;triangleIndex:number} {
  if(!finitePoint(point))throw new Error('查询点必须有限 finite');
  const index=getIndex(mesh);let best=Infinity,witness:MeshPoint=[0,0,0],triangleIndex=-1,budget=MAX_PAIR_CHECKS;
  const stack=[index.root];while(stack.length){if(--budget<0)throw new InputError('网格距离查询预算耗尽',undefined,'MESH_QUERY_BUDGET');const n=stack.pop()!;
    if(boundsDistance2(n.bounds,point)>best)continue;
    if(n.ids)for(const id of n.ids){const p=closestTriangle(point,triangleAt(mesh,id)),d=dot(sub(p,point),sub(p,point));if(d<best){best=d;witness=p;triangleIndex=id;}}
    else {const l=n.left!,r=n.right!;if(boundsDistance2(l.bounds,point)<boundsDistance2(r.bounds,point))stack.push(r,l);else stack.push(l,r);}
  }
  return {point:witness,distance:Math.sqrt(best),triangleIndex};
}

function pointOnTriangle(p:MeshPoint,tri:Triangle,eps:number) { return length(sub(p,closestTriangle(p,tri)))<=eps; }
function segmentPointDistance(p:MeshPoint,a:MeshPoint,b:MeshPoint) { const ab=sub(b,a);return length(sub(p,lerp(a,b,Math.max(0,Math.min(1,dot(sub(p,a),ab)/dot(ab,ab)))))); }
function key(p:MeshPoint) { return p.map(v=>v===0?0:v).join(','); }

/** Reject intersections outside the triangles' common topological vertex/edge. */
function improperlyIntersects(a:Triangle,b:Triangle,eps:number):boolean {
  const shared=a.filter(p=>b.some(q=>key(p)===key(q)));
  const contacts:MeshPoint[]=[];
  const normalA=cross(sub(a[1],a[0]),sub(a[2],a[0])),normalB=cross(sub(b[1],b[0]),sub(b[2],b[0]));
  const na=length(normalA),nb=length(normalB);
  const da=b.map(p=>dot(sub(p,a[0]),normalA)/na),db=a.map(p=>dot(sub(p,b[0]),normalB)/nb);
  if(da.every(d=>d>eps)||da.every(d=>d< -eps)||db.every(d=>d>eps)||db.every(d=>d< -eps))return false;
  const coplanar=da.every(d=>Math.abs(d)<=eps)&&db.every(d=>Math.abs(d)<=eps);
  for(const p of a)if(pointOnTriangle(p,b,eps))contacts.push(p);
  for(const p of b)if(pointOnTriangle(p,a,eps))contacts.push(p);
  if(coplanar) {
    const axis=normalA.map(Math.abs).indexOf(Math.max(...normalA.map(Math.abs))),axes=[0,1,2].filter(v=>v!==axis);
    const cross2=(u:MeshPoint,v:MeshPoint)=>u[axes[0]]*v[axes[1]]-u[axes[1]]*v[axes[0]];
    for(let i=0;i<3;i++)for(let j=0;j<3;j++){
      const p=a[i],q=b[j],u=sub(a[(i+1)%3],p),v=sub(b[(j+1)%3],q),qp=sub(q,p),denom=cross2(u,v);
      if(Math.abs(denom)<=Number.EPSILON*length(u)*length(v)*16)continue;
      const t=cross2(qp,v)/denom,s=cross2(qp,u)/denom;
      if(t>=0&&t<=1&&s>=0&&s<=1)contacts.push(lerp(p,a[(i+1)%3],t));
    }
  } else {
    const edges=(from:Triangle,to:Triangle,distances:number[])=>{for(let i=0;i<3;i++){
      const j=(i+1)%3,d=distances[i],e=distances[j];
      if((d<0&&e>0)||(d>0&&e<0)) {const p=lerp(from[i],from[j],d/(d-e));if(pointOnTriangle(p,to,eps))contacts.push(p);}
    }};
    edges(a,b,db);edges(b,a,da);
  }
  return contacts.some(p=>shared.length===0 || (shared.length===1?length(sub(p,shared[0]))>eps:segmentPointDistance(p,shared[0],shared[1])>eps));
}

function validate(mesh:PreparedMesh,requireClosed:boolean) {
  const index=getIndex(mesh);
  if(index.validated){if(requireClosed&&(!mesh.closed||!index.closed))throw new Error('实体网格必须闭合 closed');return;}
  const edges=new Map<string,{count:number;orientation:number;face:number}>();
  const incident=new Map<string,number[]>(),adjacent:number[][]=Array.from({length:mesh.triangles.length/9},()=>[]);
  for(let i=0;i<mesh.triangles.length/9;i++){
    const tri=triangleAt(mesh,i),keys=tri.map(key);
    for(const k of keys){const faces=incident.get(k)??[];faces.push(i);incident.set(k,faces);}
    for(let e=0;e<3;e++) {const a=keys[e],b=keys[(e+1)%3],forward=a<b,k=forward?a+'|'+b:b+'|'+a;
      const edge=edges.get(k)??{count:0,orientation:0,face:i};
      if(edge.count===1){adjacent[edge.face].push(i);adjacent[i].push(edge.face);}
      edge.count++;edge.orientation+=forward?1:-1;edges.set(k,edge);
    }
  }
  // Two otherwise closed shells may touch only at one welded vertex. Edge counts
  // alone miss this nonmanifold case: each vertex must have one connected fan.
  for(const faces of incident.values()){
    const remaining=new Set(faces),stack=[faces[0]];remaining.delete(faces[0]);
    while(stack.length)for(const next of adjacent[stack.pop()!])if(remaining.delete(next))stack.push(next);
    if(remaining.size)throw new Error('网格顶点非流形 nonmanifold：面扇不连通');
  }
  let closed=true;
  for(const edge of edges.values()){
    if(edge.count>2)throw new Error('网格非流形 nonmanifold 边');
    if(edge.count===1)closed=false;
    if(edge.count===2&&edge.orientation!==0)throw new Error('网格面方向 winding 不一致');
  }
  if(requireClosed&&(!closed||!mesh.closed))throw new Error('实体网格必须闭合 closed');
  let budget=MAX_PAIR_CHECKS;
  for(let i=0;i<index.boxes.length;i++)for(const j of queryMeshTriangles(mesh,index.boxes[i]))if(j>i){
    if(--budget<0)throw new InputError('网格自交检查预算耗尽，无法可靠校验，拒绝使用',undefined,'MESH_QUERY_BUDGET');
    if(improperlyIntersects(triangleAt(mesh,i),triangleAt(mesh,j),index.tolerance))throw new Error('网格存在自交 intersect 或重叠面');
  }
  index.closed=closed;index.validated=true;
}

export function validateSolidMesh(mesh:PreparedMesh):void { validate(mesh,true); }
/** Open fixtures are surfaces only: no inside/outside or solid clearance claim. */
export function validateSurfaceMesh(mesh:PreparedMesh):void { validate(mesh,false); }
export function isClosedMesh(mesh:PreparedMesh):boolean { validateSurfaceMesh(mesh);return getIndex(mesh).closed===true; }

export function pointInsideMesh(mesh:PreparedMesh,point:MeshPoint):boolean {
  validateSolidMesh(mesh);
  if(!finitePoint(point))throw new Error('查询点必须有限 finite');
  const index=getIndex(mesh),eps=index.tolerance;
  if(point.some((v,a)=>v<mesh.bounds.min[a]-eps||v>mesh.bounds.max[a]+eps))return false;
  if(closestPointOnMesh(mesh,point).distance<=eps)return true;
  // Retry rays which hit a mesh edge. A degenerate ray never becomes a clear result.
  const directions:MeshPoint[]=[[1,.3713906763541037,.529177210903],[.217319,1,.694873],[.837491,.193719,1],[-1,.438173,.728193],[.317193,-1,.847191],[.713719,.293173,-1]];
  for(const direction of directions){let crossings=0,ambiguous=false;
    const rayBounds=emptyBounds();include(rayBounds,point);
    const travel=Math.hypot(...mesh.bounds.max.map((v,a)=>v-mesh.bounds.min[a]))*4+1;include(rayBounds,point.map((v,a)=>v+travel*direction[a]) as MeshPoint);
    for(const id of queryMeshTriangles(mesh,rayBounds)){
      if(!rayHitsBounds(index.boxes[id],point,direction,eps))continue;
      const [a,b,c]=triangleAt(mesh,id),e1=sub(b,a),e2=sub(c,a),h=cross(direction,e2),det=dot(e1,h);
      if(Math.abs(det)<=eps*Math.max(length(e1),length(e2))){ambiguous=true;break;}
      const s=sub(point,a),u=dot(s,h)/det,q=cross(s,e1),v=dot(direction,q)/det,t=dot(e2,q)/det;
      const baryEps=eps/Math.max(length(e1),length(e2));
      if(t<=eps||u< -baryEps||v< -baryEps||u+v>1+baryEps)continue;
      if(u<=baryEps||v<=baryEps||u+v>=1-baryEps){ambiguous=true;break;}
      crossings++;
    }
    if(!ambiguous)return crossings%2===1;
  }
  throw new InputError('包含查询射线退化，无法可靠判定实体内外',undefined,'MESH_QUERY_BUDGET');
}
