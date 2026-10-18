import { parseProgram,pointAt } from './gcode';
import type { Instruction,Job,Motion,Snapshot,State,Vec3 } from './types';
import type { CollisionEvent } from './collisionTypes';
import { InputError } from './types';
import { MaterialSimulation } from './material';
import { axisToTip,tipToAxis } from './machine';
import {exchangePhase} from './toolExchange';
type Checkpoint={index:number;elapsedMs:number;position:Vec3;activeTool:number;selectedTool:number;spindleRpm:number;spindleOn:boolean;coolant:{mist:boolean;flood:boolean};incidents:CollisionEvent[];eventSeq:number;material:ReturnType<MaterialSimulation['save']>};
const isToolChangeMotion=(i:Instruction|undefined)=>(i?.kind==='motion'&&['move_to_change','return_from_change'].includes(i.contactStage??''))||(i?.kind==='tool_change'&&(i.durationMs??0)>0);
const instructionDuration=(i:Instruction)=>i.kind==='motion'||i.kind==='dwell'||i.kind==='tool_change'?i.durationMs??0:0;
export class Playback {
  private job:Job|null=null;
  instructions:Instruction[]=[];
  private state:State='IDLE';
  private index=0;private partialMs=0;private elapsedMs=0;private speed=1;
  private position:Vec3={x:0,y:0,z:30};
  private activeTool=0;private selectedTool=0;private spindleRpm=0;private spindleOn=false;
  private line:number|null=null;private snapshotSeq=0;private eventSeq=0;
  private events:Snapshot['events']=[];private incidents:CollisionEvent[]=[];
  private coolant={mist:false,flood:false};
  private material:MaterialSimulation|null=null;
  private checkpoints:Checkpoint[]=[];
  private initialChecked=false;
  private isRunning(){return this.state==='RUNNING'||this.state==='TOOL_CHANGING';}
  private materialOperation<T>(operation:()=>T):T {
    try{return operation();}catch(error){
      this.state='ERROR';this.spindleOn=false;this.events=[];
      if(error instanceof InputError){error.physicalLine??=this.line??undefined;this.line=error.physicalLine??this.line;}
      throw error;
    }
  }
  load(job:Job){
    if(this.isRunning())throw new InputError('运行中不能加载新任务');
    const [x,y,z]=job.initialPositionMm;
    const instructions=parseProgram(job.program.text,job.tools,job.initialAxisPositionMm?undefined:{x,y,z},job);
    const material=new MaterialSimulation(job,instructions);
    for(const mesh of job.preparedMeshes??[]){
      if(mesh.role==='machine'&&!job.machineProfile?.components?.some(c=>c.objectId===mesh.objectId)&&job.simulation?.checkCollisions!==false)throw new InputError('机床模型必须配置运动部件：'+mesh.objectId,undefined,'MISSING_KINEMATICS');
    }
    if(job.simulation?.checkCollisions!==false){
      const meshes=job.preparedMeshes??[];
      for(const component of job.machineProfile?.components??[])if(!meshes.some(m=>m.objectId===component.objectId&&m.role==='machine'))throw new InputError('机床部件缺少碰撞网格：'+component.objectId,undefined,'MISSING_COLLISION_MODEL');
      const checkedIds=new Set([job.stock.objectId,...meshes.filter(m=>['fixture','machine'].includes(m.role)).map(m=>m.objectId)]);
      for(const pair of job.machineProfile?.collisionPairs??[])if(pair.some(id=>!checkedIds.has(id)))throw new InputError('检查对象对缺少碰撞网格：'+pair.join('/'),undefined,'MISSING_COLLISION_MODEL');
      const exclusionIds=new Set([...checkedIds,...job.tools.flatMap(t=>['cutter','shaft','holder'].map(part=>t.toolId+':'+part))]);
      for(const exclusion of job.machineProfile?.collisionExclusions??[])if(exclusion.objects.some(id=>!exclusionIds.has(id)))throw new InputError('排除对象不存在：'+exclusion.objects.join('/'),undefined,'INVALID_EXCLUSION');
    }
    this.job=structuredClone(job);this.instructions=instructions;this.material=material;return this.reset();
  }
  reset(){
    if(!this.job)throw new InputError('尚未加载任务');
    this.index=0;this.partialMs=0;this.elapsedMs=0;this.line=null;this.events=[];this.incidents=[];this.eventSeq=0;this.checkpoints=[];this.initialChecked=false;
    const [x,y,z]=this.job.initialPositionMm;
    this.position=this.job.initialAxisPositionMm?axisToTip(this.job.initialAxisPositionMm,this.job.tools[0].gaugeLengthMm,this.job.machineProfile):{x,y,z};
    this.activeTool=this.job.tools[0].toolNumber;this.selectedTool=this.activeTool;
    this.materialOperation(()=>this.material?.reset());this.spindleOn=false;this.spindleRpm=0;this.coolant={mist:false,flood:false};this.state='READY';return this.snapshot();
  }
  private checkInitial(){
    if(this.initialChecked)return true;this.initialChecked=true;
    if(this.job!.simulation?.checkCollisions===false)return true;
    const first=this.instructions[0];this.line=first.source.physicalLine;
    const tip={...this.position},move:Motion={kind:'motion',id:first.id,source:first.source,from:tip,to:tip,mode:'linear',lengthMm:0,durationMs:0,feedMmMin:0,toolNumber:this.activeTool,spindleOn:false,spindleRpm:0,spindleDirection:'CW',contactStage:'initial_assembly',workFrame:'G54',workOffsetMm:this.job!.workOffsetsMm?.G54};
    const result=this.materialOperation(()=>this.material!.consumeMotion(move,0,1,warning=>this.recordWarnings([warning])));

    if(result.incident){this.stop(result.incident);return false;}return true;
  }
  start(){if(this.state!=='READY')throw new InputError('只有就绪任务可以开始');this.state='RUNNING';this.events=[];this.checkInitial();}
  pause(){if(this.isRunning())this.state='PAUSED';}
  resume(){if(this.state!=='PAUSED')throw new InputError('只有普通暂停任务可以恢复，碰撞后需重置或载入新修订');const next=this.instructions[this.index];this.state=isToolChangeMotion(next)?'TOOL_CHANGING':'RUNNING';}
  setSpeed(speed:number){if(!Number.isFinite(speed)||speed<.25||speed>20)throw new InputError('倍率必须在0.25至20之间');this.speed=speed;}
  private stop(incident:CollisionEvent){
    incident.response='pause';
    incident.eventSeq=++this.eventSeq;incident.simulationTimeMs=this.elapsedMs;
    this.incidents.push(incident);this.state=incident.type==='INDETERMINATE'?'INDETERMINATE':'PAUSED_COLLISION';this.spindleOn=false;
  }
  private recordWarnings(warnings:CollisionEvent[]){
    for(const warning of warnings){warning.response='warn_continue';warning.eventSeq=++this.eventSeq;
      const instruction=this.instructions.find(i=>i.id===warning.source.instructionId);
      const hitT=warning.contact?.pathParameterBracket[1]??0;
      warning.simulationTimeMs=this.elapsedMs+(instruction?.kind==='motion'?instruction.durationMs*hitT-this.partialMs:0);
      this.incidents.push(warning);
    }
  }
  private motion(i:Motion,targetT:number){
    const startT=i.durationMs?this.partialMs/i.durationMs:0;
    const result=this.materialOperation(()=>this.material!.consumeMotion(i,startT,targetT,warning=>this.recordWarnings([warning])));

    const nextMs=i.durationMs*result.safeT;
    this.elapsedMs+=Math.max(0,nextMs-this.partialMs);this.partialMs=nextMs;this.position=pointAt(i,result.safeT);
    if(result.incident){this.stop(result.incident);return false;}return true;
  }
  private finishInstruction(i:Instruction){
    this.line=i.source.physicalLine;
    if(i.kind==='motion')this.position={...i.to};
    if(i.kind==='tool_select')this.selectedTool=i.toolNumber;
    if(i.kind==='tool_change'){
      this.activeTool=i.toolNumber;this.spindleOn=false;
      if(i.position)this.position={...i.position};
      if(this.job!.simulation?.checkCollisions!==false){
        const tip={...this.position};
        const clamp:Motion={kind:'motion',id:i.id,source:i.source,from:tip,to:tip,mode:'rapid',lengthMm:0,durationMs:0,feedMmMin:0,toolNumber:i.toolNumber,spindleOn:false,spindleRpm:0,spindleDirection:'CW',contactStage:'clamp_new',workFrame:i.workFrame,workOffsetMm:i.workOffsetMm};
        const result=this.materialOperation(()=>this.material!.consumeMotion(clamp,0,1,warning=>this.recordWarnings([warning])));

        if(result.incident){this.stop(result.incident);return;}
      }
      this.events.push({type:'TOOL_CHANGE',toolNumber:i.toolNumber,physicalLine:i.source.physicalLine,instructionId:i.id,capability:i.capability??'logical_tool_change',contactStage:i.contactStage??'clamp_new'});
    }
    if(i.kind==='spindle'){this.spindleRpm=i.rpm;this.spindleOn=i.on;}
    if(i.kind==='coolant')this.coolant={mist:i.mist,flood:i.flood};
    if(i.kind==='stop'&&(!i.optional||this.job!.optionalStop))this.state='PAUSED';
    if(i.kind==='end'){this.state='COMPLETED';this.spindleOn=false;}
    this.index++;this.partialMs=0;
    if(this.index%50===0&&this.material&&!['PAUSED_COLLISION','INDETERMINATE','ERROR'].includes(this.state)){
      this.checkpoints.push({index:this.index,elapsedMs:this.elapsedMs,position:{...this.position},activeTool:this.activeTool,selectedTool:this.selectedTool,spindleRpm:this.spindleRpm,spindleOn:this.spindleOn,coolant:{...this.coolant},incidents:structuredClone(this.incidents),eventSeq:this.eventSeq,material:this.material.save()});
      if(this.checkpoints.length>2)this.checkpoints.shift();
    }
  }
  advance(realMs:number){
    this.events=[];if(!this.isRunning())return this.snapshot();
    if(!Number.isFinite(realMs)||realMs<0)throw new InputError('时间增量无效');
    let remaining=realMs*this.speed;
    while(this.index<this.instructions.length&&this.isRunning()){
      const i=this.instructions[this.index];this.line=i.source.physicalLine;
      this.state=isToolChangeMotion(i)?'TOOL_CHANGING':'RUNNING';
      const duration=instructionDuration(i);
      const consumed=Math.min(remaining,Math.max(0,duration-this.partialMs));
      if(i.kind==='motion'){
        if(!this.motion(i,duration?(this.partialMs+consumed)/duration:1))break;
      }else{this.partialMs+=consumed;this.elapsedMs+=consumed;}
      remaining-=consumed;
      if(this.partialMs+1e-7>=duration)this.finishInstruction(i);else break;
    }
    if(this.index>=this.instructions.length&&!['PAUSED_COLLISION','INDETERMINATE','ERROR'].includes(this.state)){this.state='COMPLETED';this.spindleOn=false;}
    return this.snapshot();
  }
  step(){
    if(this.state!=='READY'&&this.state!=='PAUSED')throw new InputError('单步需要就绪或普通暂停状态');
    this.events=[];this.state='PAUSED';if(!this.checkInitial())return this.snapshot();const physicalLine=this.instructions[this.index]?.source.physicalLine;
    while(this.index<this.instructions.length&&this.instructions[this.index].source.physicalLine===physicalLine){
      const i=this.instructions[this.index];this.line=i.source.physicalLine;
      if(i.kind==='motion'&&!this.motion(i,1))break;
      if(i.kind==='dwell'||i.kind==='tool_change')this.elapsedMs+=Math.max(0,instructionDuration(i)-this.partialMs);
      this.finishInstruction(i);
      if(i.kind==='stop'||i.kind==='end'||this.state!=='PAUSED')break;
    }
    if(this.index>=this.instructions.length&&!['PAUSED_COLLISION','INDETERMINATE','ERROR'].includes(this.state)){this.state='COMPLETED';this.spindleOn=false;}
    return this.snapshot();
  }
  seekLine(line:number){
    if(this.isRunning()||!Number.isInteger(line)||line<1||line>this.job!.program.text.split(/\r\n|\n|\r/).length)throw new InputError('回看行号无效，运行时请先暂停');
    const checkpoint=[...this.checkpoints].reverse().find(c=>(this.instructions[c.index]?.source.physicalLine??Infinity)<=line);
    const checkpoints=this.checkpoints;this.reset();this.checkpoints=checkpoints;
    if(checkpoint){this.index=checkpoint.index;this.elapsedMs=checkpoint.elapsedMs;this.position={...checkpoint.position};this.activeTool=checkpoint.activeTool;this.selectedTool=checkpoint.selectedTool;this.spindleRpm=checkpoint.spindleRpm;this.spindleOn=checkpoint.spindleOn;this.coolant={...checkpoint.coolant};this.incidents=structuredClone(checkpoint.incidents).map(incident=>({...incident,eventId:crypto.randomUUID()}));this.eventSeq=checkpoint.eventSeq;this.material!.restore(checkpoint.material);this.initialChecked=true;}
    while(this.index<this.instructions.length&&this.instructions[this.index].source.physicalLine<=line&&['READY','PAUSED'].includes(this.state))this.step();
    if(this.state==='READY')this.state='PAUSED';return this.snapshot();
  }
  snapshot():Snapshot{
    const totalMs=this.instructions.reduce((n,i)=>n+instructionDuration(i),0);
    const checked=!!this.material&&this.job?.simulation?.checkCollisions!==false;
    const verification:Snapshot['verification']=!checked?'not_checked':this.state==='INDETERMINATE'||this.state==='ERROR'?'indeterminate':this.incidents.length?'collision_detected':this.state==='COMPLETED'?'fully_checked':'in_progress';
    const tool=this.job?.tools.find(t=>t.toolNumber===this.activeTool);
    const current=this.instructions[this.index],toolChangeStage=isToolChangeMotion(current)&&current?.kind==='motion'?current.contactStage:undefined;
    const progress=current?.kind==='tool_change'&&current.durationMs?Math.min(1,this.partialMs/current.durationMs):0;
    const toolExchange:Snapshot['toolExchange']=current?.kind==='tool_change'&&!!current.durationMs&&['TOOL_CHANGING','PAUSED'].includes(this.state)?{instructionId:current.id,source:current.source,fromTool:current.fromToolNumber??this.activeTool,toTool:current.toolNumber,oldTip:{...this.position},newTip:{...(current.position??this.position)},progress,...exchangePhase(progress),illustrative:true}:undefined;
    const instructionCount=this.instructions.length;
    return {state:this.state,position:{...this.position},activeTool:this.activeTool,selectedTool:this.selectedTool,spindleRpm:this.spindleRpm,spindleOn:this.spindleOn,physicalLine:this.line,instructionIndex:this.index,progress:this.state==='COMPLETED'?1:totalMs?this.elapsedMs/totalMs:0,elapsedMs:this.elapsedMs,totalMs,speed:this.speed,verification,materialRemoval:!!this.material&&this.job?.simulation?.mode!=='dry_run',stock:this.material?.stock.stats(),cuttingState:this.isRunning()?this.material?.cuttingState:'idle',events:[...this.events],snapshotSeq:++this.snapshotSeq,axisPosition:tool?tipToAxis(this.position,tool.gaugeLengthMm,this.job?.machineProfile):undefined,coolant:{...this.coolant},toolChangeStage:toolExchange?.phase??toolChangeStage,toolExchange,instructionCount,incident:this.incidents.at(-1),incidents:[...this.incidents],coverage:{collisionResponse:this.job?.simulation?.stopOnCollision===false?'warn_continue':'pause',warningScope:this.job?.simulation?.stopOnCollision===false?'first_contact_per_instruction':undefined,method:checked?'conservative_sweep_refinement':'not_checked',pairs:['cutter/stock:invalid_cut','shaft/stock','holder/stock',...(this.job?.preparedMeshes??[]).filter(m=>['fixture','machine'].includes(m.role)).map(m=>'tool/'+m.objectId),...(this.job?.machineProfile?.collisionPairs??[]).map(p=>p.join('/'))],machineComponents:this.job?.machineProfile?.components?.map(c=>c.objectId)??[],stock:this.job?.stock.kind??'box',geometryQueries:this.material?.collision.queries??0}};
  }
  takeStockUpdate(){return this.materialOperation(()=>this.material?.takeUpdate()??null);}
}
