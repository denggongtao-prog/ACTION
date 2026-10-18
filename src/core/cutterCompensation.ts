import {InputError} from './types';
import type {Instruction,Motion,Vec3} from './types';
import {tipToAxis} from './machine';
import type {MachineProfile} from './machineTypes';
const TAU=2*Math.PI,EPS=1e-7;
const cross=(a:Vec3,b:Vec3)=>a.x*b.y-a.y*b.x;
const delta=(a:Vec3,b:Vec3):Vec3=>({x:b.x-a.x,y:b.y-a.y,z:b.z-a.z});
const distance=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.y-b.y);
function sweep(a:number,b:number,sign:number){const d=((b-a)%TAU+TAU)%TAU;return sign>0?d:(d<EPS?0:d-TAU);}
function tangent(move:Motion,end:boolean):Vec3{
  if(!move.arc){const d=delta(move.from,move.to),n=Math.hypot(d.x,d.y);return {x:d.x/n,y:d.y/n,z:0};}
  const a=move.arc.startAngle+(end?move.arc.sweep:0),s=Math.sign(move.arc.sweep);return {x:-Math.sin(a)*s,y:Math.cos(a)*s,z:0};
}
function offsetCurve(move:Motion):Motion{
  const comp=move.cutterCompensation!,amount=(comp.side==='left'?1:-1)*comp.radiusMm;
  const result=structuredClone(move);
  if(move.arc){
    const a=move.arc,r=a.radius-Math.sign(a.sweep)*amount;
    if(r<=EPS)throw new InputError('刀补半径不小于凹圆弧半径，无法无过切加工',move.source.physicalLine,'CUTTER_COMP_GOUGE');
    result.arc={...a,radius:r};
    for(const key of ['from','to'] as const)result[key]={x:a.centerX+(move[key].x-a.centerX)*r/a.radius,y:a.centerY+(move[key].y-a.centerY)*r/a.radius,z:move[key].z};
  }else{
    const t=tangent(move,false),shift={x:-t.y*amount,y:t.x*amount};
    for(const key of ['from','to'] as const)result[key]={x:move[key].x+shift.x,y:move[key].y+shift.y,z:move[key].z};
  }
  return result;
}
function parameter(move:Motion,p:Vec3){
  if(!move.arc){const d=delta(move.from,move.to);return ((p.x-move.from.x)*d.x+(p.y-move.from.y)*d.y)/(d.x*d.x+d.y*d.y);}
  const a=move.arc,angle=Math.atan2(p.y-a.centerY,p.x-a.centerX);
  if(distance(p,move.from)<EPS)return 0;if(distance(p,move.to)<EPS)return 1;
  return sweep(a.startAngle,angle,Math.sign(a.sweep))/a.sweep;
}
function intersections(a:Motion,b:Motion):Vec3[]{
  const point=(x:number,y:number):Vec3=>({x,y,z:a.to.z});
  if(!a.arc&&!b.arc){const u=delta(a.from,a.to),v=delta(b.from,b.to),det=cross(u,v);if(Math.abs(det)<1e-12)return [];
    const t=cross(delta(a.from,b.from),v)/det;return [point(a.from.x+u.x*t,a.from.y+u.y*t)];}
  if(!a.arc||!b.arc){
    const line=a.arc?b:a,circle=(a.arc?a:b).arc!,d=delta(line.from,line.to),x=line.from.x-circle.centerX,y=line.from.y-circle.centerY;
    const aa=d.x*d.x+d.y*d.y,bb=2*(x*d.x+y*d.y),cc=x*x+y*y-circle.radius**2,disc=bb*bb-4*aa*cc;
    if(disc< -1e-6)return [];const root=Math.sqrt(Math.max(0,disc));return [(-bb-root)/(2*aa),(-bb+root)/(2*aa)].map(t=>point(line.from.x+d.x*t,line.from.y+d.y*t));
  }
  const x=b.arc.centerX-a.arc.centerX,y=b.arc.centerY-a.arc.centerY,d=Math.hypot(x,y),r=a.arc.radius,s=b.arc.radius;
  if(d<EPS||d>r+s+EPS||d<Math.abs(r-s)-EPS)return [];
  const along=(r*r-s*s+d*d)/(2*d),height=Math.sqrt(Math.max(0,r*r-along*along)),cx=a.arc.centerX+x*along/d,cy=a.arc.centerY+y*along/d;
  return [point(cx-y*height/d,cy+x*height/d),point(cx+y*height/d,cy-x*height/d)];
}
function trim(move:Motion,from:Vec3,to:Vec3):Motion{
  const result={...move,from:{...from},to:{...to}};
  if(move.arc){const a=move.arc,start=Math.atan2(from.y-a.centerY,from.x-a.centerX),end=Math.atan2(to.y-a.centerY,to.x-a.centerX);
    const turn=distance(from,to)<EPS&&Math.abs(a.sweep)>TAU-EPS?a.sweep:sweep(start,end,Math.sign(a.sweep));
    result.arc={...a,startAngle:start,sweep:turn};
  }
  return result;
}
/** G17 look-ahead offsets: trimmed inner joins and tangent round outer joins.
 * Original blocks stay untouched. Every inserted corner inherits the following source block. */
export function applyCutterCompensation(input:Instruction[],tools:readonly {toolNumber:number;gaugeLengthMm?:number}[]=[],profile?:MachineProfile):Instruction[]{
  if(!input.some(i=>i.kind==='motion'&&i.cutterCompensation))return input;
  const result:Instruction[]=[],replacements=new Map<Motion,Motion[]>();
  const motions=input.filter((i):i is Motion=>i.kind==='motion');
  for(let at=0;at<motions.length;){
    const entry=motions[at],comp=entry.cutterCompensation;
    if(!comp||comp.side==='cancel'){at++;continue;}
    let end=at;while(end<motions.length&&motions[end].cutterCompensation&&motions[end].cutterCompensation!.side!=='cancel')end++;
    const active=motions.slice(at,end),xy=active.filter(m=>!!m.arc||distance(m.from,m.to)>EPS);
    if(!xy.length){at=end;continue;}
    if(xy[0].arc||distance(xy[0].from,xy[0].to)<comp.radiusMm-EPS)throw new InputError('刀补进入段需要不短于补偿半径的XY直线',xy[0].source.physicalLine,'CUTTER_COMP_ENTRY');
    if(active.some(m=>m.cutterCompensation!.side!==comp.side||m.cutterCompensation!.radiusMm!==comp.radiusMm))throw new InputError('刀补期间不可直接切换方向或D半径，请先G40',entry.source.physicalLine,'CUTTER_COMP_CHANGE');
    const curves=xy.map(offsetCurve),joins=new Map<number,Motion>();
    for(let k=0;k<curves.length-1;k++){
      const a=curves[k],b=curves[k+1],nominal=xy[k].to;
      if(Math.abs(a.to.z-b.from.z)>EPS)throw new InputError('当前刀补轮廓需要同一XY平面',b.source.physicalLine,'CUTTER_COMP_PLANE');
      if(distance(a.to,b.from)<1e-5){b.from={...a.to};continue;}
      const turn=cross(tangent(xy[k],true),tangent(xy[k+1],false)),side=comp.side==='left'?1:-1;
      if(turn*side>1e-7){
        const candidates=intersections(a,b).filter(p=>parameter(a,p)>=-EPS&&parameter(a,p)<=1+EPS&&parameter(b,p)>=-EPS&&parameter(b,p)<=1+EPS).sort((p,q)=>distance(p,nominal)-distance(q,nominal));
        if(!candidates.length)throw new InputError('刀补凹角无有效交点或相邻段过短',b.source.physicalLine,'CUTTER_COMP_GOUGE');
        const p=candidates[0];curves[k]=trim(a,a.from,p);curves[k+1]=trim(b,p,b.to);
      }else if(turn*side< -1e-7){
        const start=Math.atan2(a.to.y-nominal.y,a.to.x-nominal.x),last=Math.atan2(b.from.y-nominal.y,b.from.x-nominal.x),angle=sweep(start,last,Math.sign(turn));
        if(Math.abs(angle)>Math.PI+1e-5)throw new InputError('刀补转角无法安全衔接',b.source.physicalLine,'CUTTER_COMP_GOUGE');
        joins.set(k,{...b,from:{...a.to},to:{...b.from},mode:b.mode==='rapid'?'rapid':angle>0?'arc_ccw':'arc_cw',arc:{centerX:nominal.x,centerY:nominal.y,radius:comp.radiusMm,startAngle:start,sweep:angle},contactStage:'cutter_comp_corner'});
      }else throw new InputError('刀补路径反向或不连续',b.source.physicalLine,'CUTTER_COMP_GOUGE');
    }
    // The activating block ramps from the uncompensated start to the offset contour.
    curves[0]={...curves[0],from:{...xy[0].from},arc:undefined,mode:xy[0].mode};
    for(let k=0;k<xy.length;k++)replacements.set(xy[k],[curves[k],...(joins.has(k)?[joins.get(k)!]:[])]);
    let actual={...entry.from};
    for(const nominal of active){const assigned=replacements.get(nominal);if(assigned)actual={...assigned.at(-1)!.to};else{
      const vertical={...nominal,from:{...actual},to:{...actual,z:nominal.to.z}};replacements.set(nominal,[vertical]);actual={...vertical.to};
    }}
    const cancel=motions[end];if(cancel?.cutterCompensation?.side==='cancel'){
      if(cancel.arc||distance(cancel.from,cancel.to)<EPS)throw new InputError('G40退出需要XY直线段',cancel.source.physicalLine,'CUTTER_COMP_EXIT');
      replacements.set(cancel,[{...cancel,from:actual}]);end++;
    }
    at=end;
  }
  for(const item of input){
    const expanded=item.kind==='motion'?(replacements.get(item)??[item]):[item];
    for(const next of expanded){
      if(next.kind==='motion'){
        const a=next.arc;next.lengthMm=a?Math.hypot(a.radius*a.sweep,next.to.z-next.from.z):Math.hypot(next.to.x-next.from.x,next.to.y-next.from.y,next.to.z-next.from.z);
        next.durationMs=next.lengthMm/(next.mode==='rapid'?(profile?.rapidRateMmMin??6000):next.feedMmMin)*60000;
        const tool=tools.find(t=>t.toolNumber===next.toolNumber);
        if(tool){next.axisFrom=tipToAxis(next.from,tool.gaugeLengthMm??0,profile);next.axisTo=tipToAxis(next.to,tool.gaugeLengthMm??0,profile);}
      }
      result.push({...next,id:result.length} as Instruction);
    }
  }
  return result;
}
