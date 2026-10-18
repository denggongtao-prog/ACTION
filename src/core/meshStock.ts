import type { MeshPoint, MeshStockColumns, PreparedMesh } from './meshTypes';
import { meshTolerance, queryMeshTriangles, triangleAt, validateSolidMesh } from './meshGeometry';

function unionIntervals(intervals:number[][],eps:number):number[] {
  intervals.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const out:number[]=[];
  for(const [lo,hi] of intervals){if(hi<=lo)continue;if(out.length&&lo<=out[out.length-1]+eps)out[out.length-1]=Math.max(out[out.length-1],hi);else out.push(lo,hi);}
  return out;
}

function clipFootprint(triangle:MeshPoint[],x0:number,y0:number,x1:number,y1:number):MeshPoint[] {
  let polygon=triangle;
  for(const [axis,bound,direction] of [[0,x0,1],[0,x1,-1],[1,y0,1],[1,y1,-1]]){
    const next:MeshPoint[]=[];
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],da=(a[axis]-bound)*direction,db=(b[axis]-bound)*direction;
      if(da>=0)next.push(a);
      if((da<0&&db>0)||(da>0&&db<0)){
        const t=da/(da-db);next.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t]);
      }
    }
    polygon=next;if(!polygon.length)break;
  }
  return polygon;
}

/** The display/removal representation samples centers; collision uses the full-cell superset. */
export function initializeMeshStock(mesh:PreparedMesh,nx:number,ny:number,dx:number,dy:number,min:MeshPoint,size:MeshPoint):MeshStockColumns {
  validateSolidMesh(mesh);const eps=meshTolerance(mesh);
  if(!Number.isInteger(nx)||!Number.isInteger(ny)||nx<=0||ny<=0||nx*ny>160000||![dx,dy,...min,...size].every(Number.isFinite)||dx<=0||dy<=0||size.some(v=>v<=0))throw new Error('材料网格参数无效或超过160000单元预算');
  if(Math.abs(nx*dx-size[0])>eps||Math.abs(ny*dy-size[1])>eps||mesh.bounds.min.some((v,a)=>v<min[a]-eps||mesh.bounds.max[a]>min[a]+size[a]+eps))throw new Error('材料网格范围 bounds 未覆盖网格毛坯');
  const columns:number[][]=[],conservativeColumns:number[][]=[],boundaryCells:boolean[]=[];
  let endpointCount=0,conservativeEndpointCount=0,queryBudget=5000000;
  const zMin=min[2],zMax=zMin+size[2];
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const x0=min[0]+x*dx,y0=min[1]+y*dy,cx=x0+dx/2,cy=y0+dy/2;
    const candidates=queryMeshTriangles(mesh,{min:[x0,y0,zMin],max:[x0+dx,y0+dy,zMax]});
    queryBudget-=candidates.length;if(queryBudget<0)throw new Error('网格毛坯初始化查询预算耗尽，请简化模型或增大格距');
    const hits:{z:number;sign:number}[]=[],envelopes:number[][]=[];
    for(const id of candidates){
      const [a,b,c]=triangleAt(mesh,id),ux=b[0]-a[0],uy=b[1]-a[1],vx=c[0]-a[0],vy=c[1]-a[1],det=ux*vy-uy*vx;
      // Each included z is achieved by this surface somewhere inside this exact
      // cell. Whole-triangle bounds would give an unbounded vertical overfill.
      const clipped=clipFootprint([a,b,c],x0,y0,x0+dx,y0+dy);
      if(clipped.length){const lo=Math.min(...clipped.map(p=>p[2])),hi=Math.max(...clipped.map(p=>p[2]));envelopes.push([Math.max(zMin,lo-eps),Math.min(zMax,hi+eps)]);}
      // Vertical faces contribute to the footprint envelope but not to Z crossings.
      if(Math.abs(det)<=eps*Math.max(Math.hypot(ux,uy),Math.hypot(vx,vy)))continue;
      const px=cx-a[0],py=cy-a[1],u=(px*vy-py*vx)/det,v=(ux*py-uy*px)/det,baryEps=eps/Math.max(Math.hypot(ux,uy),Math.hypot(vx,vy));
      if(u< -baryEps||v< -baryEps||u+v>1+baryEps)continue;
      hits.push({z:a[2]+u*(b[2]-a[2])+v*(c[2]-a[2]),sign:Math.sign(det)});
    }
    hits.sort((a,b)=>a.z-b.z);const crossings:number[]=[];
    for(let k=0;k<hits.length;){let j=k+1,positive=hits[k].sign>0,negative=hits[k].sign<0;
      while(j<hits.length&&Math.abs(hits[j].z-hits[k].z)<=eps){positive ||=hits[j].sign>0;negative ||=hits[j].sign<0;j++;}
      // Opposing faces at the same height are a tangency, not two crossings.
      if(!(positive&&negative))crossings.push(hits[k].z);k=j;
    }
    if(crossings.length%2)throw new Error('网格毛坯Z射线奇偶异常，拒绝不确定的材料初始化');
    const values:number[]=[];for(let k=0;k<crossings.length;k+=2){const lo=Math.max(zMin,crossings[k]),hi=Math.min(zMax,crossings[k+1]);if(hi>lo+eps){values.push(lo,hi);envelopes.push([lo,hi]);}}
    const conservative=unionIntervals(envelopes,eps);
    if(values.length>64||conservative.length>64)throw new Error('网格毛坯单列超过32区间预算');
    endpointCount+=values.length;conservativeEndpointCount+=conservative.length;
    if(endpointCount>1000000||conservativeEndpointCount>1000000)throw new Error('网格毛坯超过1000000端点预算');
    columns.push(values);conservativeColumns.push(conservative);boundaryCells.push(candidates.length>0);
  }
  return {columns,conservativeColumns,boundaryCells,errorMm:Math.hypot(dx,dy)+2*eps};
}
