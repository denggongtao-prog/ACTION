import { pointAt } from './gcode';
import { DexelStock } from './stock';
import { createStockUpdate } from './stockMesh';
import { InputError } from './types';
import type { CuttingState, Instruction, Job, Motion, Vec3 } from './types';
import type { CollisionEvent } from './collisionTypes';
import { CollisionKernel } from './collision';
import { initializeMeshStock } from './meshStock';
import { validateSolidMesh } from './meshGeometry';
function segmentsFor(move:Motion,tolerance:number) {
  if(!move.arc)return 1;
  const angle=Math.min(Math.PI/8,2*Math.acos(Math.max(-1,1-Math.min(tolerance,move.arc.radius)/move.arc.radius)));
  const count=Math.max(1,Math.ceil(Math.abs(move.arc.sweep)/Math.max(angle,1e-10)));
  if(count>4096)throw new InputError('圆弧材料计算超过4096段，请放宽弦高或拆分程序',move.source.physicalLine,'PATH_BUDGET');
  return count;
}
export class MaterialSimulation {
  readonly stock:DexelStock;
  readonly collisionStock:DexelStock;
  readonly collision:CollisionKernel;
  cuttingState:CuttingState='idle';
  private points=new Map<number,Vec3[]>();
  private arcErrors=new Map<number,number>();
  private vertexCounts=new Map<number,number>();
  private lastMotionLine?:number;
  private clearedTip?:{point:Vec3;toolNumber:number};
  private warnedInstructions=new Set<number>();
  private sourceError(error:unknown):Error {
    if(error instanceof InputError){error.physicalLine??=this.lastMotionLine;return error;}
    return new InputError(error instanceof Error?error.message:String(error),this.lastMotionLine,'MATERIAL_FAILURE');
  }
  constructor(private job:Job,instructions:Instruction[]){
    const cell=job.simulation?.stockCellMm??.5;
    const tolerance=Math.min(job.simulation?.arcChordToleranceMm??.02,cell/8);
    let count=0;
    for(const move of instructions){
      if(move.kind!=='motion')continue;
      const n=segmentsFor(move,tolerance);count+=n;
      if(count>100000)throw new InputError('材料路径超过100000段，请拆分程序',move.source.physicalLine,'PATH_BUDGET');
      if(move.arc){
        this.points.set(move.id,Array.from({length:n+1},(_,i)=>pointAt(move,i/n)));
        const end=move.arc.startAngle+move.arc.sweep;
        const endpointError=Math.hypot(move.to.x-move.arc.centerX-move.arc.radius*Math.cos(end),move.to.y-move.arc.centerY-move.arc.radius*Math.sin(end));
        this.arcErrors.set(move.id,move.arc.radius*(1-Math.cos(Math.abs(move.arc.sweep)/n/2))+endpointError+1e-10);
      }
    }
    const offset=job.workOffsetsMm?.G54??{x:0,y:0,z:0};
    const spec={...job.stock,minCornerInW:job.stock.minCornerInW.map((v,i)=>v+[offset.x,offset.y,offset.z][i])};
    this.stock=new DexelStock(spec,cell);this.collisionStock=new DexelStock(spec,cell,true);
    if(job.stock.kind==='mesh'){
      const mesh=job.preparedMeshes?.find(m=>m.objectId===job.stock.assetId&&m.role==='stock');
      if(!mesh)throw new InputError('网格毛坯尚未预处理',undefined,'MISSING_STOCK_MESH');
      validateSolidMesh(mesh);
      const initialized=initializeMeshStock(mesh,this.stock.nx,this.stock.ny,this.stock.dx,this.stock.dy,this.stock.min as [number,number,number],this.stock.size as [number,number,number]);
      this.stock.initialize(initialized.columns);this.collisionStock.initialize(initialized.conservativeColumns);
    }
    const bytes=(job.preparedMeshes??[]).reduce((n,m)=>n+m.triangles.byteLength*4,0)+job.assets.reduce((n,a)=>n+(a.buffer?.byteLength??0)*2,0)+this.stock.nx*this.stock.ny*512+2400000*72+32*1048576;
    if(bytes>(job.simulation?.maxMemoryMb??512)*1048576)throw new InputError('预计几何资源超过内存预算，请简化模型或提高预算',undefined,'MEMORY_BUDGET');
    this.collision=new CollisionKernel(job,this.collisionStock,this.stock);
  }
  reset(){this.stock.reset();this.collisionStock.reset();this.collision.queries=0;this.cuttingState='idle';this.lastMotionLine=undefined;this.clearedTip=undefined;this.warnedInstructions.clear();}
  save(){return {stock:this.stock.save(),conservative:this.collisionStock.save(),clearedTip:this.clearedTip?structuredClone(this.clearedTip):undefined,warnedInstructions:[...this.warnedInstructions]};}
  restore(saved:ReturnType<MaterialSimulation['save']>){this.stock.restore(saved.stock);this.collisionStock.restore(saved.conservative);this.clearedTip=saved.clearedTip?structuredClone(saved.clearedTip):undefined;this.warnedInstructions=new Set(saved.warnedInstructions);}
  consumeMotion(move:Motion,t0:number,t1:number,onWarning?:(warning:CollisionEvent)=>void):{safeT:number;incident?:CollisionEvent;warnings:CollisionEvent[]} {
    const warnings:CollisionEvent[]=[];
    const steps=Math.max(1,Math.ceil(move.lengthMm/.5));
    if(steps>100000)throw new InputError('材料路径细分超过预算',move.source.physicalLine,'PATH_BUDGET');
    for(let k=Math.min(steps-1,Math.floor(t0*steps));k<Math.min(steps,Math.ceil(t1*steps)||1);k++){
      const a=Math.max(t0,k/steps),b=Math.min(t1,(k+1)/steps);if(b<a)continue;
      const tool=this.job.tools.find(t=>t.toolNumber===move.toolNumber)!;
      const previous=this.clearedTip;
      // A same-tool vertical withdrawal is contained in the preceding cutter at every stock Z.
      const vertical=tool.axisDirection?.y!==-1&&!!previous&&Math.abs(move.to.x-previous.point.x)<1e-10&&Math.abs(move.to.y-previous.point.y)<1e-10&&Math.abs(move.from.x-previous.point.x)<1e-10&&Math.abs(move.from.y-previous.point.y)<1e-10&&move.from.z>=previous.point.z-1e-10&&move.to.z>=move.from.z&&previous.point.z+tool.cuttingLengthMm>=this.stock.min[2]+this.stock.size[2];
      const side=tool.axisDirection?.y===-1&&!!previous&&Math.abs(move.to.x-previous.point.x)<1e-10&&Math.abs(move.to.z-previous.point.z)<1e-10&&Math.abs(move.from.x-previous.point.x)<1e-10&&Math.abs(move.from.z-previous.point.z)<1e-10&&move.from.y<=previous.point.y+1e-10&&move.to.y<=move.from.y&&previous.point.y-tool.cuttingLengthMm<=this.stock.min[1];
      const cleared=!!previous&&previous.toolNumber===move.toolNumber&&!move.arc&&(vertical||side);
      // Once first contact is reported, finish this illustrative instruction; subsequent instructions are checked afresh.
      const hit=this.job.simulation?.checkCollisions===false?null:this.warnedInstructions.has(move.id)?this.collision.findLimits(move,a,b):this.collision.find(move,a,b,cleared);
      if(hit){
        if(hit.event.type==='COLLISION'&&this.job.simulation?.stopOnCollision===false){
          this.warnedInstructions.add(move.id);warnings.push(hit.event);onWarning?.(hit.event);
          const limit=this.collision.findLimits(move,a,b);
          if(limit){if(limit.safeT>a)this.carve(move,a,limit.safeT);return {safeT:limit.safeT,incident:limit.event,warnings};}
        }
        else {if(hit.safeT>a)this.carve(move,a,hit.safeT);return {safeT:hit.safeT,incident:hit.event,warnings};}
      }
      this.carve(move,a,b);
    }
    return {safeT:t1,warnings};
  }
  private carve(move:Motion,t0:number,t1:number) {
    if(this.job.simulation?.mode==='dry_run'){this.cuttingState='dry_run';return;}
    if(move.mode==='rapid'){this.cuttingState='rapid';return;}
    if(!move.spindleOn||move.spindleRpm<=0){this.cuttingState='spindle_off';return;}
    const tool=this.job.tools.find(t=>t.toolNumber===move.toolNumber)!;
    if(move.spindleDirection!==(tool.requiredSpindleDirection??'CW')){this.cuttingState='direction_mismatch';return;}
    this.lastMotionLine=move.source.physicalLine;
    try{
    const before=this.stock.stats().removedVolumeMm3;
    const points=this.points.get(move.id);
    const carveLine=(a:Vec3,b:Vec3)=>{this.stock.carveLine(a,b,tool);this.collisionStock.carveLine(a,b,tool,this.arcErrors.get(move.id)??0);};
    if(!points)carveLine(pointAt(move,t0),pointAt(move,t1));
    else{
      const n=points.length-1;
      for(let k=Math.min(n-1,Math.floor(t0*n));k<Math.min(n,Math.ceil(t1*n));k++){
        const start=Math.max(t0,k/n),end=Math.min(t1,(k+1)/n);if(end<=start)continue;
        const a=points[k],b=points[k+1];
        const lerp=(t:number):Vec3=>{const u=t*n-k;return {x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u,z:a.z+(b.z-a.z)*u};};
        carveLine(lerp(start),lerp(end));
      }
    }
    this.cuttingState=this.stock.stats().removedVolumeMm3>before+1e-9?'cutting':'air_cut';
    this.clearedTip={point:pointAt(move,t1),toolNumber:move.toolNumber};
    }catch(error){throw this.sourceError(error);}
  }
  takeUpdate(){try{return createStockUpdate(this.stock,this.vertexCounts);}catch(error){throw this.sourceError(error);}}
}

