import type { Job, Vec3 } from './types';
import { InputError } from './types';
import type { PreparedMesh } from './meshTypes';
import type { Bounds, CollisionSample, DistanceWitness, Point3 } from './collisionTypes';
import { tuple } from './collisionTypes';
import { add, sub, normalize, convexDistance, triangleSupport } from './convex';
import { closestPointOnMesh, pointInsideMesh, triangleAt } from './meshGeometry';
import { componentTranslation } from './machine';
import type { DexelStock } from './stock';

const origin:Point3=[0,0,0];
const blank=():DistanceWitness=>({lower:Infinity,upper:Infinity,tool:[0,0,0],obstacle:[0,0,0],normal:[0,0,1],converged:true});
const shiftBounds=(b:Bounds,s:Point3):Bounds=>({min:add(b.min,s),max:add(b.max,s)});
const boxGap=(a:Bounds,b:Bounds)=>Math.hypot(...a.min.map((v,i)=>Math.max(0,v-b.max[i],b.min[i]-a.max[i])));
const inBox=(p:Point3,b:Bounds)=>p.every((v,i)=>v>=b.min[i]&&v<=b.max[i]);
function boxCorners(b:Bounds):Point3[] {
  const [x,y,z]=b.min,[xx,yy,zz]=b.max;
  return [[x,y,z],[xx,y,z],[xx,yy,z],[x,yy,z],[x,y,zz],[xx,y,zz],[xx,yy,zz],[x,yy,zz]];
}
function boxTriangles(b:Bounds):Point3[][] {
  const p=boxCorners(b);
  return [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,4,7],[0,7,3],[1,2,6],[1,6,5],[0,1,5],[0,5,4],[3,7,6],[3,6,2]].map(t=>t.map(i=>p[i]));
}
function boundaryPoint(p:Point3,b:Bounds):Point3 {
  const q=p.map((v,i)=>Math.max(b.min[i],Math.min(b.max[i],v))) as Point3;
  if(!inBox(p,b))return q;
  let distance=Infinity,axis=0,value=b.min[0];
  for(let i=0;i<3;i++)for(const face of [b.min[i],b.max[i]])if(Math.abs(p[i]-face)<distance){distance=Math.abs(p[i]-face);axis=i;value=face;}
  q[axis]=value;return q;
}
function overlapWitness(tool:Point3,obstacle:Point3):DistanceWitness {
  return {lower:0,upper:0,tool,obstacle,normal:normalize(sub(tool,obstacle)),converged:true};
}
function worldTriangle(m:PreparedMesh,id:number,shift:Point3,count:()=>void):Point3[] {
  count();return triangleAt(m,id).map(p=>add(p,shift));
}
function* vertices(m:PreparedMesh,shift:Point3,count:()=>void):Generator<Point3> {
  const seen=new Set<string>();
  for(let i=0;i<m.triangles.length;i+=3){
    count();
    const p:Point3=[m.triangles[i]+shift[0],m.triangles[i+1]+shift[1],m.triangles[i+2]+shift[2]],key=p.join(',');
    if(!seen.has(key)){seen.add(key);yield p;}
  }
}
function meshDistance(a:PreparedMesh,sa:Point3,b:PreparedMesh,sb:Point3,count:()=>void):DistanceWitness {
  count();const ba=shiftBounds(a.bounds,sa),bb=shiftBounds(b.bounds,sb);
  if(boxGap(ba,bb)===0){
    // Every component contributes vertices; checking triangle zero alone misses disconnected solids.
    if(b.closed)for(const p of vertices(a,sa,count)){
      count();if(pointInsideMesh(b,sub(p,sb))){count();return overlapWitness(p,add(closestPointOnMesh(b,sub(p,sb)).point,sb));}
    }
    if(a.closed)for(const p of vertices(b,sb,count)){
      count();if(pointInsideMesh(a,sub(p,sa))){count();return overlapWitness(add(closestPointOnMesh(a,sub(p,sa)).point,sa),p);}
    }
  }
  let best=blank(),lower=Infinity;
  for(let ia=0;ia<a.triangles.length/9;ia++){
    const ta=worldTriangle(a,ia,sa,count);
    for(let ib=0;ib<b.triangles.length/9;ib++){
      const tb=worldTriangle(b,ib,sb,count);count();
      const d=convexDistance(triangleSupport(ta),triangleSupport(tb));
      lower=Math.min(lower,d.lower);if(d.upper<best.upper)best=d;
      if(best.upper<=1e-8)return {...best,lower:0};
    }
  }
  return {...best,lower:Math.min(lower,best.upper)};
}
function meshBoxDistance(mesh:PreparedMesh,shift:Point3,box:Bounds,count:()=>void):DistanceWitness {
  count();
  if(boxGap(shiftBounds(mesh.bounds,shift),box)===0){
    for(const p of vertices(mesh,shift,count)){count();if(inBox(p,box))return overlapWitness(p,boundaryPoint(p,box));}
    if(mesh.closed)for(const corner of boxCorners(box)){
      count();if(pointInsideMesh(mesh,sub(corner,shift))){count();return overlapWitness(add(closestPointOnMesh(mesh,sub(corner,shift)).point,shift),corner);}
    }
  }
  // Use box FACE triangles rather than a solid support function so the stock witness
  // always lies on its surface, including triangle/box crossings without contained vertices.
  const faces=boxTriangles(box);let best=blank(),lower=Infinity;
  for(let id=0;id<mesh.triangles.length/9;id++){
    const triangle=worldTriangle(mesh,id,shift,count);
    for(const face of faces){
      count();const d=convexDistance(triangleSupport(triangle),triangleSupport(face));
      lower=Math.min(lower,d.lower);if(d.upper<best.upper)best=d;
      if(best.upper<=1e-8)return {...best,lower:0};
    }
  }
  return {...best,lower:Math.min(lower,best.upper)};
}
function stockDistance(mesh:PreparedMesh,shift:Point3,job:Job,stock:DexelStock,count:()=>void):CollisionSample|null {
  const exact=job.stock.kind==='box'&&stock.stats().removedVolumeMm3===0;
  const meta={objects:[] as string[],kind:'MACHINE_STOCK',method:'stock_cell' as const,potential:!exact||!mesh.closed,error:exact?0:'unknown' as const};
  if(exact){
    const box:Bounds={min:stock.min as Point3,max:stock.min.map((v,i)=>v+stock.size[i]) as Point3};
    return {...meshBoxDistance(mesh,shift,box,count),...meta};
  }
  let best:DistanceWitness=blank(),lower=Infinity,found=false;
  const meshBounds=shiftBounds(mesh.bounds,shift);
  // A full XY cell with every live Z interval is the declared conservative stock proxy.
  for(let y=0;y<stock.ny;y++)for(let x=0;x<stock.nx;x++){
    count();const column=stock.getColumn(x,y);
    for(let k=0;k<column.length;k+=2){
      count();found=true;
      const b:Bounds={min:[stock.min[0]+x*stock.dx,stock.min[1]+y*stock.dy,column[k]],max:[stock.min[0]+(x+1)*stock.dx,stock.min[1]+(y+1)*stock.dy,column[k+1]]};
      const gap=boxGap(meshBounds,b);
      if(gap>=best.upper){lower=Math.min(lower,gap);continue;}
      const d=meshBoxDistance(mesh,shift,b,count);lower=Math.min(lower,d.lower);if(d.upper<best.upper)best=d;
      if(best.upper===0)return {...best,lower:0,...meta};
    }
  }
  return found?{...best,lower:Math.min(lower,best.upper),...meta}:null;
}
/**
 * Evaluate every explicitly configured pair in machine_reference (table-zero) mm.
 * The obstacle witness for a stock pair is always a stock/prism boundary point.
 * If a separate display stock has removal but this conservative stock is unchanged,
 * callers must also mark the returned stock sample potential / unknown.
 */
export function machinePairDistance(job:Job,stock:DexelStock,axis:Vec3,count:()=>void,stage='motion'):CollisionSample|null {
  let best:CollisionSample|null=null,lower=Infinity;
  const meshes=(job.preparedMeshes??[]).filter(m=>m.role==='machine'||m.role==='fixture');
  const shift=(mesh:PreparedMesh)=>mesh.role==='machine'&&job.machineProfile?tuple(componentTranslation(mesh.objectId,axis,job.machineProfile)):origin;
  for(const pair of job.machineProfile?.collisionPairs??[]){
    const a=meshes.find(m=>m.objectId===pair[0]),b=meshes.find(m=>m.objectId===pair[1]);
    const stockIndex=pair.indexOf(job.stock.objectId),mesh=stockIndex===0?b:stockIndex===1?a:undefined;
    if(stockIndex>=0?!mesh:!a||!b)throw new InputError('检查对象对缺少网格：'+pair.join('/'),undefined,'MISSING_COLLISION_MODEL');
    if(job.machineProfile?.collisionExclusions?.some(e=>pair.every(id=>e.objects.includes(id))&&(!e.stages||e.stages.includes(stage))))continue;
    const sample=stockIndex>=0?stockDistance(mesh!,shift(mesh!),job,stock,count):{
      ...meshDistance(a!,shift(a!),b!,shift(b!),count),objects:[] as string[],kind:'MACHINE_PAIR',method:'mesh_witness' as const,potential:!a!.closed||!b!.closed,error:0,
    };
    if(!sample)continue;
    sample.objects=[...pair];lower=Math.min(lower,sample.lower);
    if(!best||sample.upper<best.upper)best=sample;
  }
  return best?{...best,lower:Math.min(lower,best.upper)}:null;
}
