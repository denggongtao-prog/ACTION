import type { Job,Motion,Tool,Vec3 } from './types';
import { InputError } from './types';
import type { PreparedMesh } from './meshTypes';
import type { Bounds,CollisionEvent,DistanceWitness,PathHit,Point3,CollisionSample } from './collisionTypes';
import { tuple } from './collisionTypes';
import { convexDistance,toolSupport,partDimensions,triangleSupport,boxSupport,add,sub,mul,norm,normalize } from './convex';
import type { Support,ToolPart } from './convex';
import { closestPointOnMesh,pointInsideMesh,queryMeshTriangles,triangleAt } from './meshGeometry';
import { pointAt } from './gcode';
import { componentTranslation,findLimitViolation,tipToAxis,tableTranslation } from './machine';
import { DexelStock } from './stock';
import { pathBounds } from './pathBounds';
import { machinePairDistance } from './collisionMachine';
type Sample=CollisionSample;
const empty=():Sample=>({lower:Infinity,upper:Infinity,obstacle:[0,0,0],tool:[0,0,0],normal:[0,0,1],converged:true,objects:[],kind:'',method:'mesh_witness',potential:false,error:0});
const overlaps=(a:Bounds,b:Bounds)=>a.min.every((v,i)=>v<=b.max[i]+1e-8&&a.max[i]>=b.min[i]-1e-8);
const shifted=(b:Bounds,d:Point3):Bounds=>({min:add(b.min,d),max:add(b.max,d)});
function bboxDistance(a:Bounds,b:Bounds){return Math.hypot(...a.min.map((v,i)=>Math.max(0,v-b.max[i],b.min[i]-a.max[i])));}
function shapeBounds(tool:Tool,part:ToolPart,tip:Point3):Bounds{const support=toolSupport(tool,part,tip);const axes:Point3[]=[[1,0,0],[0,1,0],[0,0,1]];return {min:axes.map((d,i)=>support(mul(d,-1))[i]) as Point3,max:axes.map((d,i)=>support(d)[i]) as Point3};}
function cylinderBox(tool:Tool,part:ToolPart,tip:Point3,b:Bounds):DistanceWitness{
  if(tool.axisDirection?.y===-1||(part==='cutter'&&tool.type!=='flat_endmill'))return convexDistance(toolSupport(tool,part,tip),boxSupport(b));
  const d=partDimensions(tool,part),centerZ=tip[2]+(d.low+d.high)/2;
  const x=Math.max(b.min[0],Math.min(b.max[0],tip[0])),y=Math.max(b.min[1],Math.min(b.max[1],tip[1]));
  const radial=Math.hypot(x-tip[0],y-tip[1]),gapXY=Math.max(0,radial-d.r);
  const low=tip[2]+d.low,high=tip[2]+d.high;
  const obstacleZ=Math.max(b.min[2],Math.min(b.max[2],centerZ));
  const toolZ=Math.max(low,Math.min(high,obstacleZ));
  const direction=radial>1e-12?[(x-tip[0])/radial,(y-tip[1])/radial]:[1,0];
  const toolPoint:Point3=[tip[0]+direction[0]*Math.min(radial,d.r),tip[1]+direction[1]*Math.min(radial,d.r),toolZ];
  const obstacle:Point3=[x,y,obstacleZ],distance=Math.hypot(gapXY,obstacleZ-toolZ);
  if(distance<=1e-9&&obstacle.every((v,i)=>v>b.min[i]+1e-9&&v<b.max[i]-1e-9)){
    let gap=Infinity,chosenAxis=0,chosenFace=b.min[0];for(let i=0;i<3;i++)for(const face of [b.min[i],b.max[i]])if(Math.abs(obstacle[i]-face)<gap){gap=Math.abs(obstacle[i]-face);chosenAxis=i;chosenFace=face;}obstacle[chosenAxis]=chosenFace;
    const toward=normalize(sub(obstacle,[tip[0],tip[1],centerZ]));const boundary=toolSupport(tool,part,tip)(toward);toolPoint.splice(0,3,...boundary);
  }
  return {lower:distance,upper:distance,tool:toolPoint,obstacle,normal:normalize(sub(toolPoint,obstacle)),converged:true};
}
/** Every accepted interval has a separating-distance certificate. Unresolved leaves stop conservatively. */
export class CollisionKernel {
  queries=0;
  private localQueries=0;
  constructor(private job:Job,private stock:DexelStock,private displayStock:DexelStock=stock){}
  private count(){this.queries++;if(++this.localQueries>(this.job.simulation?.maxCollisionQueries??200000))throw new InputError('连续碰撞查询预算不足，区间无法证明安全',undefined,'COLLISION_BUDGET');}
  private meshShift(mesh:PreparedMesh,axis:Vec3):Point3{
    if(mesh.role!=='machine'||!this.job.machineProfile)return [0,0,0];
    return tuple(componentTranslation(mesh.objectId,axis,this.job.machineProfile));
  }
  private event(move:Motion,hitT:number,safeT:number,bracket:[number,number],sample:Sample):CollisionEvent{
    const tool=this.job.tools.find(t=>t.toolNumber===move.toolNumber)!;
    const tip=pointAt(move,hitT),safe=pointAt(move,safeT),axis=tipToAxis(tip,tool.gaugeLengthMm,this.job.machineProfile);
    const physicalShift=tuple(tableTranslation(axis,this.job.machineProfile));
    const safeShift=tuple(tableTranslation(tipToAxis(safe,tool.gaugeLengthMm,this.job.machineProfile),this.job.machineProfile));
    const offset=move.workOffsetMm??this.job.workOffsetsMm?.G54??{x:0,y:0,z:0};
    return {eventId:crypto.randomUUID(),eventSeq:0,type:'COLLISION',classification:sample.potential||sample.upper>1e-6?'potential_collision':'confirmed_collision',collisionType:sample.kind,objects:sample.objects,
      source:{...move.source,programId:this.job.program.programId,programSha256:this.job.program.sha256??'',instructionId:move.id,segmentIndex:Math.floor(safeT*Math.max(1,Math.ceil(move.lengthMm/.25)))},
      contact:{frame:'machine',workFrame:move.workFrame??'G54',unit:'mm',point:add(sample.obstacle,physicalShift),pointInWork:sub(sample.obstacle,tuple(offset)),toolPoint:add(sample.tool,physicalShift),normal:sample.normal,pointMethod:sample.method,positionErrorBoundMm:sample.error==='unknown'?'unknown':sample.error+move.lengthMm*(bracket[1]-bracket[0])*4,pathParameterBracket:bracket},
      activeToolNumber:move.toolNumber,simulationTimeMs:0,contactToolTipInM:add(tuple(tip),physicalShift),lastSafeToolTipInM:add(tuple(safe),safeShift),lastSafeVerified:bracket[0]!==bracket[1],contactStage:move.contactStage??(bracket[0]===bracket[1]?'initial_overlap':'motion'),verification:{method:'conservative_sweep_refinement',coverage:'configured_pairs',modelRevision:1},requiresAck:true};
  }
  /** Limits remain active even after a warning has ended pair checks for this instruction. */
  findLimits(move:Motion,t0:number,t1:number):PathHit|null{
    const profile=this.job.machineProfile;if(!profile)return null;
    const tool=this.job.tools.find(t=>t.toolNumber===move.toolNumber)!,localization=this.job.simulation?.contactLocalizationMm??.05;
    const search=(a:number,b:number,depth:number):PathHit|null=>{
      const mid=(a+b)/2,range=pathBounds(move,a,b);
      const v0=tipToAxis({x:range.min[0],y:range.min[1],z:range.min[2]},tool.gaugeLengthMm,profile),v1=tipToAxis({x:range.max[0],y:range.max[1],z:range.max[2]},tool.gaugeLengthMm,profile);
      if((['x','y','z'] as const).every(k=>Math.min(v0[k],v1[k])>=profile.axes[k].minMm-1e-8&&Math.max(v0[k],v1[k])<=profile.axes[k].maxMm+1e-8))return null;
      if(depth<32&&move.lengthMm*(b-a)*4>localization)return search(a,mid,depth+1)??search(mid,b,depth+1);
      const points=[a,mid,b].map(t=>({t,axis:tipToAxis(pointAt(move,t),tool.gaugeLengthMm,profile)}));
      const chosen=points.find(p=>findLimitViolation(p.axis,profile))??points[1],limit=findLimitViolation(chosen.axis,profile);
      const event=this.event(move,chosen.t,a,[a,b],empty());
      event.type=limit?'LIMIT':'INDETERMINATE';event.classification=limit?'limit':'indeterminate';event.collisionType=limit?'SOFT_LIMIT':'LIMIT_UNRESOLVED';event.contact=null;event.objects=[];
      if(limit)event.limit={axis:limit.axis,positionMm:limit.valueMm,rangeMm:[limit.minMm,limit.maxMm]};
      return {safeT:a,hitT:chosen.t,event};
    };
    return search(t0,t1,0);
  }
  find(move:Motion,t0:number,t1:number,cutterStockCleared=false):PathHit|null{
    this.localQueries=0;
    const tool=this.job.tools.find(t=>t.toolNumber===move.toolNumber)!;
    const meshes=(this.job.preparedMeshes??[]).filter(m=>m.role==='fixture'||m.role==='machine').sort((a,b)=>a.objectId.localeCompare(b.objectId));
    if(meshes.some(m=>m.role==='machine'&&!this.job.machineProfile?.components?.some(c=>c.objectId===m.objectId)))throw new InputError('机床碰撞模型缺少部件运动配置',move.source.physicalLine,'MISSING_KINEMATICS');
    const parts:ToolPart[]=['cutter',...(tool.gaugeLengthMm>tool.cuttingLengthMm?['shaft' as const]:[]),'holder'];
    const validCut=move.mode!=='rapid'&&move.spindleOn&&move.spindleRpm>0&&move.spindleDirection===(tool.requiredSpindleDirection??'CW');
    const middle=(t0+t1)/2,tipMiddle=tuple(pointAt(move,middle)),travel=move.lengthMm*(t1-t0)*4;
    const allBounds=parts.map(part=>shapeBounds(tool,part,tipMiddle));
    const broad:Bounds={min:[0,1,2].map(i=>Math.min(...allBounds.map(b=>b.min[i]))-travel) as Point3,max:[0,1,2].map(i=>Math.max(...allBounds.map(b=>b.max[i]))+travel) as Point3};
    const candidates=new Map<string,number[]>();
    for(const mesh of meshes){
      const shift=this.meshShift(mesh,tipToAxis(pointAt(move,middle),tool.gaugeLengthMm,this.job.machineProfile));
      const local=shifted(broad,mul(shift,-1));
      candidates.set(mesh.objectId,queryMeshTriangles(mesh,local));
    }
    const oracle=(t:number):Sample=>{
      this.count();
      const tip=tuple(pointAt(move,t)),axis=tipToAxis(pointAt(move,t),tool.gaugeLengthMm,this.job.machineProfile);
      let best=empty(),minimumLower=Infinity;
      const accept=(d:DistanceWitness,meta:Omit<Sample,keyof DistanceWitness>)=>{if(tool.type==='profile_endmill'&&meta.objects.includes(tool.toolId+':cutter'))meta={...meta,potential:true,error:'unknown'};minimumLower=Math.min(minimumLower,d.lower);if(d.upper<best.upper)best={...d,...meta};};
      for(const part of parts){
        const shape=toolSupport(tool,part,tip),bounds=shapeBounds(tool,part,tip);
        for(const mesh of meshes){
          if(this.job.machineProfile?.collisionExclusions?.some(e=>e.objects.includes(tool.toolId+':'+part)&&e.objects.includes(mesh.objectId)&&(!e.stages||e.stages.includes(move.contactStage??'motion'))))continue;
          const shift=this.meshShift(mesh,axis),localShape:Support=d=>sub(shape(d),shift);
          const separation=bboxDistance(bounds,shifted(mesh.bounds,shift));
          if(separation>move.lengthMm*(t1-t0)*2+1e-8){minimumLower=Math.min(minimumLower,separation);continue;}
          const indices=candidates.get(mesh.objectId)!;
          let meshLower=Infinity,meshBest:DistanceWitness|null=null;
          for(const id of indices){
            this.count();const triangle=triangleAt(mesh,id),d=convexDistance(localShape,triangleSupport(triangle));
            if(d.upper<1e-7){const u=sub(triangle[1],triangle[0]),v=sub(triangle[2],triangle[0]);let normal=normalize([u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]);const toward=sub(sub(tip,shift),d.obstacle);if(normal[0]*toward[0]+normal[1]*toward[1]+normal[2]*toward[2]<0)normal=mul(normal,-1);d.normal=normal;d.tool=localShape(mul(normal,-1));}
            meshLower=Math.min(meshLower,d.lower);
            if(!meshBest||d.upper<meshBest.upper)meshBest=d;
          }
          const dimensions=partDimensions(tool,part),height=(dimensions.low+dimensions.high)/2,axisDirection=tool.axisDirection??{x:0,y:0,z:1},center:Point3=[tip[0]+axisDirection.x*height-shift[0],tip[1]+axisDirection.y*height-shift[1],tip[2]+axisDirection.z*height-shift[2]];
          this.count();
          if(mesh.closed&&pointInsideMesh(mesh,center)){
            const witness=closestPointOnMesh(mesh,center),toolPoint=localShape(normalize(sub(witness.point,center)));
            meshBest={lower:0,upper:0,obstacle:witness.point,tool:toolPoint,normal:normalize(sub(center,witness.point)),converged:true};meshLower=0;
          }
          if(meshBest)accept({...meshBest,lower:meshLower,obstacle:add(meshBest.obstacle,shift),tool:add(meshBest.tool,shift)},{objects:[tool.toolId+':'+part,mesh.objectId],kind:part.toUpperCase()+'_'+mesh.role.toUpperCase(),method:'mesh_witness',potential:!mesh.closed,error:0});
        }
        if(part==='cutter'&&(validCut||cutterStockCleared))continue;
        const stockBounds:Bounds={min:this.stock.min as Point3,max:this.stock.min.map((v,i)=>v+this.stock.size[i]) as Point3};
        if(!overlaps(broad,stockBounds))continue;
        const kind=part==='cutter'?(move.mode==='rapid'?'RAPID_STOCK':move.spindleDirection!==(tool.requiredSpindleDirection??'CW')?'DIRECTION_STOCK':'SPINDLE_STOCK'):part.toUpperCase()+'_STOCK';
        const removed=this.displayStock.stats().removedVolumeMm3>0;
        const meta={objects:[tool.toolId+':'+part,this.job.stock.objectId],kind,method:'stock_cell' as const,potential:this.job.stock.kind==='mesh'||removed,error:removed?'unknown' as const:Math.hypot(this.stock.dx,this.stock.dy)+1e-6};
        const separation=bboxDistance(bounds,stockBounds);
        if(separation>move.lengthMm*(t1-t0)*2+1e-8){minimumLower=Math.min(minimumLower,separation);continue;}
        if(this.job.stock.kind==='box'&&this.stock.stats().removedVolumeMm3===0){this.count();accept(cylinderBox(tool,part,tip,stockBounds),{...meta,potential:false,error:0});continue;}
        const minX=Math.max(0,Math.floor((broad.min[0]-this.stock.min[0])/this.stock.dx)),maxX=Math.min(this.stock.nx-1,Math.floor((broad.max[0]-this.stock.min[0])/this.stock.dx));
        const minY=Math.max(0,Math.floor((broad.min[1]-this.stock.min[1])/this.stock.dy)),maxY=Math.min(this.stock.ny-1,Math.floor((broad.max[1]-this.stock.min[1])/this.stock.dy));
        for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
          const column=this.stock.getColumn(x,y);
          for(let k=0;k<column.length;k+=2){
            const box:Bounds={min:[this.stock.min[0]+x*this.stock.dx,this.stock.min[1]+y*this.stock.dy,column[k]],max:[this.stock.min[0]+(x+1)*this.stock.dx,this.stock.min[1]+(y+1)*this.stock.dy,column[k+1]]};
            const lower=bboxDistance(bounds,box);
            if(lower>=best.upper)continue;
            this.count();accept(cylinderBox(tool,part,tip,box),meta);
          }
        }
      }
      const pair=machinePairDistance(this.job,this.stock,axis,()=>this.count(),move.contactStage??'motion');
      if(pair){if(pair.kind==='MACHINE_STOCK'&&this.displayStock.stats().removedVolumeMm3>0){pair.potential=true;pair.error='unknown';}accept(pair,pair);}
      return {...best,lower:minimumLower};
    };
    try{
      const initial=oracle(t0);
      if(initial.upper<=1e-7)return {safeT:t0,hitT:t0,event:this.event(move,t0,t0,[t0,t0],initial)};
      const localization=this.job.simulation?.contactLocalizationMm??.05;
      const search=(a:number,b:number,depth:number):PathHit|null=>{
        const mid=(a+b)/2,d=oracle(mid),radius=move.lengthMm*(b-a)*2;
        if(d.lower>radius+1e-8)return null;
        if(depth>=32||move.lengthMm*(b-a)*4<=localization||b-a<1e-12){
          const samples=[{t:a,d:oracle(a)},{t:mid,d},{t:b,d:oracle(b)}].sort((x,y)=>x.d.upper-y.d.upper);
          const near=samples[0];if(!Number.isFinite(near.d.upper))return null;
          if(near.d.upper<=1e-7||depth>=32||move.lengthMm*(b-a)<1e-7||b-a<1e-12)return {safeT:a,hitT:near.t,event:this.event(move,near.t,a,[a,b],near.d)};
        }
        return search(a,mid,depth+1)??search(mid,b,depth+1);
      };
      let hit=search(t0,t1,0);
      const limit=this.findLimits(move,t0,t1);if(limit&&(!hit||limit.safeT<hit.safeT))hit=limit;
      return hit;
    }catch(error){
      if(!(error instanceof InputError)||!['COLLISION_BUDGET','MESH_QUERY_BUDGET'].includes(error.code))throw error;
      const incident=this.event(move,t0,t0,[t0,t1],empty());incident.type='INDETERMINATE';incident.classification='indeterminate';incident.collisionType=error.code;incident.contact=null;incident.detail=error.message;return {safeT:t0,hitT:t0,event:incident};
    }
  }
}
