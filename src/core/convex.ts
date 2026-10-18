import type { Tool } from './types';
import type { Bounds,DistanceWitness,Point3 } from './collisionTypes';
import { drillTipHeight,requireRadialProfile } from './toolProfile';
import { toolLocalToWorld,toolWorldToLocal } from './toolAxis';
export type Support=(direction:Point3)=>Point3;
export type ToolPart='cutter'|'shaft'|'holder';
export const add=(a:Point3,b:Point3):Point3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
export const sub=(a:Point3,b:Point3):Point3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export const mul=(a:Point3,s:number):Point3=>[a[0]*s,a[1]*s,a[2]*s];
export const dot=(a:Point3,b:Point3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const norm=(a:Point3)=>Math.hypot(...a);
export const normalize=(a:Point3):Point3=>norm(a)>1e-12?mul(a,1/norm(a)):[0,0,1];
export function boxSupport(bounds:Bounds):Support{return d=>d.map((v,i)=>v>=0?bounds.max[i]:bounds.min[i]) as Point3;}
export function triangleSupport(p:Point3[]):Support{return d=>p.reduce((a,b)=>dot(a,d)>=dot(b,d)?a:b);}
export function partDimensions(tool:Tool,part:ToolPart){
  if(part==='holder')return {r:tool.holder.diameterMm/2,low:tool.gaugeLengthMm,high:tool.gaugeLengthMm+tool.holder.lengthMm};
  if(part==='shaft')return {r:tool.shaftDiameterMm/2,low:tool.cuttingLengthMm,high:tool.gaugeLengthMm};
  return {r:tool.diameterMm/2,low:0,high:tool.cuttingLengthMm};
}
export function toolSupport(tool:Tool,part:ToolPart,tip:Point3):Support{
  const {r,low,high}=partDimensions(tool,part);
  const profile=part==='cutter'&&tool.type==='profile_endmill'?requireRadialProfile(tool):undefined;
  return direction=>{
    const local=toolWorldToLocal(tool,{x:direction[0],y:direction[1],z:direction[2]});
    const d:Point3=[local.x,local.y,local.z];
    const xy=Math.hypot(d[0],d[1]);
    const rim:Point3=xy>1e-15?[r*d[0]/xy,r*d[1]/xy,d[2]>=0?high:low]:[0,0,d[2]>=0?high:low];
    let p=rim;
    if(profile){
      // A linear radial segment attains each linear support maximum at an
      // endpoint. Maximizing over all profile circles gives its convex hull.
      let best=-Infinity;
      for(const sample of profile){
        const score=xy*sample.radiusMm+d[2]*sample.zMm;
        if(score>best){
          best=score;
          p=xy>1e-15?[sample.radiusMm*d[0]/xy,sample.radiusMm*d[1]/xy,sample.zMm]:[0,0,sample.zMm];
        }
      }
    }
    if(part==='cutter'&&tool.type==='ball_endmill'&&d[2]<0){
      const length=norm(d);p=length>1e-15?[r*d[0]/length,r*d[1]/length,r+r*d[2]/length]:[0,0,0];
    }
    if(part==='cutter'&&tool.type==='drill'&&d[2]<0){
      const h=drillTipHeight(tool),cone:Point3=[rim[0],rim[1],h];
      p=dot(cone,d)>0?cone:[0,0,0];
    }
    const world=toolLocalToWorld(tool,{x:p[0],y:p[1],z:p[2]});
    return add([world.x,world.y,world.z],tip);
  };
}
type Vertex={v:Point3;a:Point3;b:Point3};
function solve(matrix:number[][],values:number[]):number[]|null{
  const n=values.length,m=matrix.map((row,i)=>[...row,values[i]]);
  for(let c=0;c<n;c++){
    let pivot=c;for(let r=c+1;r<n;r++)if(Math.abs(m[r][c])>Math.abs(m[pivot][c]))pivot=r;
    if(Math.abs(m[pivot][c])<1e-18)return null;
    [m[c],m[pivot]]=[m[pivot],m[c]];const v=m[c][c];for(let k=c;k<=n;k++)m[c][k]/=v;
    for(let r=0;r<n;r++)if(r!==c){const f=m[r][c];for(let k=c;k<=n;k++)m[r][k]-=f*m[c][k];}
  }
  return m.map(row=>row[n]);
}
function closest(vertices:Vertex[]){
  let best=Infinity,selected:Vertex[]=[],weights:number[]=[],point:Point3=[0,0,0];
  for(let mask=1;mask<(1<<vertices.length);mask++){
    const subset=vertices.filter((_,i)=>mask&(1<<i));if(subset.length>4)continue;
    const base=subset[0].v,edges=subset.slice(1).map(p=>sub(p.v,base));
    const x=edges.length?solve(edges.map(a=>edges.map(b=>dot(a,b))),edges.map(a=>-dot(a,base))):[];
    if(!x)continue;
    const w=[1-x.reduce((s,v)=>s+v,0),...x];if(w.some(v=>v< -1e-9))continue;
    const p=subset.reduce((sum,v,i)=>add(sum,mul(v.v,w[i])),[0,0,0] as Point3),distance=dot(p,p);
    if(distance<best){best=distance;selected=subset;weights=w;point=p;}
  }
  return {vertices:selected,weights,point};
}
/** GJK distance: upper from the simplex, certified lower from a separating support plane. */
export function convexDistance(a:Support,b:Support):DistanceWitness{
  const support=(d:Point3):Vertex=>{const aa=a(d),bb=b(mul(d,-1));return {v:sub(aa,bb),a:aa,b:bb};};
  let simplex=[support([1,0,0])],current=closest(simplex),lower=0,converged=false;
  for(let iteration=0;iteration<64;iteration++){
    const distance=norm(current.point);
    if(distance<1e-8){converged=true;break;}
    const next=support(mul(current.point,-1));
    lower=Math.max(lower,Math.max(0,dot(current.point,next.v)/distance-1e-9));
    if(distance-lower<1e-7){converged=true;break;}
    if(current.vertices.some(v=>norm(sub(v.v,next.v))<1e-11))break;
    simplex=[...current.vertices,next];current=closest(simplex);
  }
  const tool=current.vertices.reduce((sum,v,i)=>add(sum,mul(v.a,current.weights[i])),[0,0,0] as Point3);
  const obstacle=current.vertices.reduce((sum,v,i)=>add(sum,mul(v.b,current.weights[i])),[0,0,0] as Point3);
  const upper=norm(sub(tool,obstacle));
  return {lower:Math.min(lower,upper),upper,obstacle,tool,normal:normalize(sub(tool,obstacle)),converged};
}
