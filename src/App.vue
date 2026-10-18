<script setup lang="ts">
import { computed, nextTick,onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import {version as engineVersion} from '../package.json';
import { PhCube, PhPlay, PhPause, PhArrowCounterClockwise, PhSkipForward, PhUploadSimple, PhArrowSquareOut, PhCrosshair, PhStack, PhCode, PhCaretRight, PhCheck, PhWarningCircle, PhEye, PhDownloadSimple } from '@phosphor-icons/vue';
import Viewport from './components/Viewport.vue';
import { demoJob } from './lib/demo';
import { SimulationClient } from './lib/client';
import { attachEmbed } from './lib/embed';
import { validateJob } from './core/job';
import { parseProgram } from './core/gcode';
import { capabilities } from './core/protocol';
import type { Identity, Envelope, CommandReply } from './core/protocol';
import type { Job, Snapshot, StockUpdate } from './core/types';
import { scenarioOptions,scenarioJob } from './lib/scenarios';
import { taskToJson,taskFromJson } from './lib/taskJson';
import { sha256 } from './core/hash';
import {incidentCsv} from './lib/incidentExport';
import {caseOptions,caseDefinition,caseJob} from './lib/caseLibrary';
import {exchangePhaseLabels,sideExchangePhaseLabels,toolMagazineLayout,isVerticalTool} from './core/toolExchange';
const viewport=ref<InstanceType<typeof Viewport>>();
const snapshot=shallowRef<Snapshot|null>(null),currentJob=shallowRef<Job>(window.parent===window?caseJob('O0001'):demoJob());
const code=ref(currentJob.value.program.text),appliedCode=ref(''),error=ref(''),loading=ref(false),connected=ref(false);
const fileInput=ref<HTMLInputElement>(),codeInput=ref<HTMLInputElement>(),gutter=ref<HTMLDivElement>(),editor=ref<HTMLTextAreaElement>();
const stockCell=ref(.5),cutMode=ref<'cut'|'dry_run'>('cut');
const scenarioId=ref('normal'),taskJson=ref(taskToJson(currentJob.value)),seekLine=ref(1),modelRole=ref<'target'|'fixture'|'stock'|'machine'>('target');
const developmentScenarios=scenarioOptions.filter(option=>option.id!=='exchange');
const libraryId=ref('O0001');
const activeCase=computed(()=>caseOptions.some(c=>c.id===currentJob.value.program.programId)&&caseDefinition(currentJob.value.program.programId).programText===appliedCode.value?caseDefinition(currentJob.value.program.programId):null);
const collisionEnabled=ref(true),persistenceWarning=ref('');
const stopOnCollision=ref(currentJob.value.simulation?.stopOnCollision??true),selectedIncidentId=ref('');
const collisionRecords=computed(()=>snapshot.value?.incidents??(snapshot.value?.incident?[snapshot.value.incident]:[]));
const shownIncident=computed(()=>collisionRecords.value.find(i=>i.eventId===selectedIncidentId.value)??snapshot.value?.incident);
const historyRuns=ref<{identity:Identity;state:string;interrupted:boolean;eventCount:number}[]>([]);
const events=ref<{title:string;detail:string;time:string}[]>([]);
const identity=ref<Identity|null>(null),importedName=ref(''),draftName=ref('O1001.nc');
let client:SimulationClient,embed:ReturnType<typeof attachEmbed>|null=null,eventSeq=0;
const emittedTools=new Set<string>();
const incidentEvents=new Map<string,Record<string,unknown>>();
let lastState='',lastProgress=0,alive=true;
let halted=false,graphicsFault='';
const isEmbedded=window.parent!==window;
const lines=computed(()=>code.value.split(/\r\n|\n|\r/));
const dirty=computed(()=>code.value!==appliedCode.value);
const stateText=computed(()=>({IDLE:'等待任务',LOADING:'载入中',READY:'就绪',RUNNING:'运行中',TOOL_CHANGING:'换刀中',PAUSED:'已暂停',PAUSED_COLLISION:'碰撞暂停',INDETERMINATE:'检查未确定',COMPLETED:'已完成',ERROR:'运行故障'}[loading.value?'LOADING':snapshot.value?.state??'IDLE']));
const running=computed(()=>['RUNNING','TOOL_CHANGING'].includes(snapshot.value?.state??''));
const canControl=computed(()=>!loading.value&&!error.value&&!dirty.value&&!!snapshot.value&&snapshot.value.state!=='IDLE');
const canRun=computed(()=>canControl.value&&['READY','PAUSED'].includes(snapshot.value?.state??''));
const verificationText=computed(()=>{
  if(snapshot.value?.verification==='collision_detected')return snapshot.value.state==='PAUSED_COLLISION'?'已因碰撞或越程暂停':snapshot.value.state==='COMPLETED'?'动画已完成，存在碰撞提示':'已记录碰撞提示，动画可继续';
  return {not_checked:'碰撞尚未检测',in_progress:'正在检查配置范围',fully_checked:'已完成配置范围检查',collision_detected:'存在碰撞提示',indeterminate:'无法确定检查结果'}[snapshot.value?.verification??'not_checked'];
});
const activeTool=computed(()=>currentJob.value.tools.find(t=>t.toolNumber===snapshot.value?.activeTool));
const magazine=computed(()=>toolMagazineLayout(currentJob.value.tools));
const sideExchange=computed(()=>{const f=snapshot.value?.toolExchange;return !!f&&currentJob.value.tools.some(t=>[f.fromTool,f.toTool].includes(t.toolNumber)&&!isVerticalTool(t));});
const exchangeTools=computed(()=>{const f=snapshot.value?.toolExchange;return f?[f.fromTool,f.toTool].map(n=>currentJob.value.tools.find(t=>t.toolNumber===n)!):[];});
const cuttingLabel=computed(()=>({idle:'待加工',cutting:'正在切削',air_cut:'空切',rapid:'快速移动',spindle_off:'主轴未转动',direction_mismatch:'主轴方向不符',dry_run:'空运行'}[snapshot.value?.cuttingState??'idle']));
const motionCount=computed(()=>{try{const job=currentJob.value,[x,y,z]=job.initialPositionMm;return parseProgram(appliedCode.value||code.value,job.tools,job.initialAxisPositionMm?undefined:{x,y,z},job).filter(i=>i.kind==='motion').length;}catch{return 0;}});
function log(title:string,detail:string){events.value.unshift({title,detail,time:new Date().toLocaleTimeString('zh-CN',{hour12:false})});events.value=events.value.slice(0,20);}
function updateHistory(){historyRuns.value=(embed?.history()??[]).map(run=>({identity:run.identity,state:run.state,interrupted:run.interrupted,eventCount:run.events.length}));persistenceWarning.value=embed?.persistenceError??'';}
function focusSource(line:number){nextTick(()=>{if(!editor.value)return;const offset=lines.value.slice(0,line-1).reduce((n,text)=>n+text.length+1,0);editor.value.focus();editor.value.setSelectionRange(offset,offset+(lines.value[line-1]?.length??0));editor.value.scrollTop=Math.max(0,(line-4)*24);if(gutter.value)gutter.value.scrollTop=editor.value.scrollTop;});}
function fatal(message:string){
  if(!alive||halted)return;
  halted=true;
  client?.request('PAUSE').catch(()=>{});
  error.value=message;loading.value=false;
  if(snapshot.value)snapshot.value={...snapshot.value,state:'ERROR'};
  embed?.emit('ERROR',{message,verification:'indeterminate'});embed?.markState('ERROR');updateHistory();log('运行异常',message);
}
function acceptSnapshot(next:Snapshot,stockUpdate?:StockUpdate|null){
  if(halted||!alive)return;
  if(stockUpdate){try{viewport.value?.applyStock(stockUpdate);}catch(e){fatal('材料表面更新失败：'+(e as Error).message);return;}}
  snapshot.value=next;
  if(loading.value)return;
  embed?.markState(next.state);
  for(const event of next.events){
    const key=(identity.value?.runId??'local')+':'+event.instructionId;
    if(!emittedTools.has(key)){
      emittedTools.add(key);log(event.capability==='configured_tool_change'?'配置轨迹换刀':'逻辑换刀','第'+event.physicalLine+'行 · T'+event.toolNumber+' 已装入主轴');
      embed?.emit('TOOL_CHANGE',{...event,eventId:crypto.randomUUID(),eventSeq:++eventSeq});
    }
  }
  const now=performance.now();
  for(const incident of next.incidents??(next.incident?[next.incident]:[]))if(!incidentEvents.has(incident.eventId)){
    const payload=embed?.emit(incident.type,{...incident})??{...incident};incidentEvents.set(incident.eventId,payload);
    const warning=incident.type==='COLLISION'&&currentJob.value.simulation?.stopOnCollision===false;
    log(incident.type==='LIMIT'?'轴超限':incident.type==='INDETERMINATE'?'检查未确定':warning?'碰撞提示':'碰撞停止','第'+incident.source.physicalLine+'行 · '+incident.collisionType);
    if(!warning)focusSource(incident.source.physicalLine);updateHistory();
  }
  if(['RUNNING','TOOL_CHANGING'].includes(next.state)&&now-lastProgress>100){lastProgress=now;embed?.emit('PROGRESS',{...next,events:[]});}
  if(next.state==='COMPLETED'&&lastState!=='COMPLETED'){
    log('加工仿真完成','切除 '+(next.stock?.removedVolumeMm3??0).toFixed(1)+' mm³ · '+verificationText.value);embed?.emit('COMPLETED',{...next,events:[]});updateHistory();
  }
  lastState=next.state;
}
async function loadTask(raw:unknown,nextIdentity?:Identity){
  if(loading.value)throw new Error('正在载入任务，请稍候');
  if(graphicsFault)throw new Error(graphicsFault);
  halted=false;
  loading.value=true;error.value='';
  try{
    if(snapshot.value?.state==='RUNNING')await client.request('PAUSE');
    const job=validateJob(raw,true);
    const [x,y,z]=job.initialPositionMm;
    const instructions=parseProgram(job.program.text,job.tools,job.initialAxisPositionMm?undefined:{x,y,z},job);
    if(!viewport.value)throw new Error('三维视窗未初始化');
    const meshes=await viewport.value.load(job,instructions.filter(i=>i.kind==='motion'));
    const validated=validateJob(job,true);job.stock=validated.stock;job.preparedMeshes=meshes;
    if(halted||!alive)throw new Error(error.value||'任务载入已取消');
    identity.value=nextIdentity??{jobId:identity.value?.jobId??'local-preview',revision:(identity.value?.revision??0)+1,runId:crypto.randomUUID()};
    emittedTools.clear();incidentEvents.clear();selectedIncidentId.value='';eventSeq=0;lastState='';
    await client.load(job);
    if(halted||!alive)throw new Error(error.value||'任务载入已取消');
    currentJob.value=job;code.value=job.program.text;appliedCode.value=job.program.text;
    draftName.value=job.program.programId+(activeCase.value?'.txt':'.nc');
    if(activeCase.value)libraryId.value=job.program.programId;
    stockCell.value=job.simulation?.stockCellMm??.5;cutMode.value=job.simulation?.mode??'cut';
    collisionEnabled.value=job.simulation?.checkCollisions!==false;stopOnCollision.value=job.simulation?.stopOnCollision??true;taskJson.value=taskToJson(job);seekLine.value=1;
    loading.value=false;embed?.markState('READY');updateHistory();log('任务就绪',job.program.programId+' · '+instructions.filter(i=>i.kind==='motion').length+' 段刀路');
    return {state:snapshot.value,capabilities,...identity.value};
  }catch(e){
    loading.value=false;
    const line=(e as {physicalLine?:number}).physicalLine;
    fatal((line?'程序第'+line+'行：':'')+(e as Error).message);
    throw e;
  }
}
async function control(type:string,payload?:unknown){
  if(!canControl.value)throw new Error('请先载入有效任务并应用程序修改');
  if(type==='SEEK_LINE'&&(running.value||!Number.isInteger(payload)||Number(payload)<1||Number(payload)>lines.value.length))throw new Error('请暂停后输入有效回看行号');
  if(type==='RESET'||type==='SEEK_LINE'){
    identity.value={...identity.value!,runId:crypto.randomUUID()};emittedTools.clear();incidentEvents.clear();selectedIncidentId.value='';lastState='';eventSeq=0;
  }
  const state=await client.request(type,payload);
  return {state,...identity.value};
}
async function command(message:Envelope):Promise<CommandReply>{
  if(message.type==='LOAD_JOB'){
    if(running.value)throw new Error('运行中不能载入任务，请先暂停');
    const result=await loadTask(validateJob(message.payload),{jobId:message.jobId!,revision:message.revision!,runId:message.runId!});
    return {type:'JOB_READY',payload:result};
  }
  if(message.type==='GET_STATE')return {type:'STATE',payload:{state:snapshot.value,...identity.value}};
  if(message.type==='GET_REPORT')return {type:'REPORT',payload:report()};
  const state=await control(message.type,message.type==='SET_SPEED'?message.payload.speed:message.type==='SEEK_LINE'?message.payload.physicalLine:undefined);
  return {type:['RESET','SEEK_LINE'].includes(message.type)?'STATE':'COMMAND_ACK',payload:state};
}
function report():Record<string,unknown>{
  const job=currentJob.value;
  return {caseSource:activeCase.value?{id:activeCase.value.id,assumptions:activeCase.value.assumptions,features:activeCase.value.features}:null,engineVersion,...identity.value,programId:job.program.programId,state:snapshot.value,capabilities,verification:snapshot.value?.verification??'not_checked',collisions:incidentEvents.size?[...incidentEvents.values()]:snapshot.value?.incidents??[],events:events.value.map(event=>({title:event.title,detail:event.detail,time:event.time})),inputManifest:{program:{programId:job.program.programId,sha256:job.program.sha256,lineEnding:job.program.lineEnding,physicalLines:job.program.text.split(/\r\n|\n|\r/).length},toolTableSha256:sha256(JSON.stringify(job.tools)),machineProfileSha256:sha256(JSON.stringify(job.machineProfile??null)),workOffsetsMm:job.workOffsetsMm,toolLengthOffsetsMm:job.toolLengthOffsetsMm,toolLengthReferenceMm:job.toolLengthReferenceMm,cutterRadiusOffsetsMm:job.cutterRadiusOffsetsMm,simulation:job.simulation,assets:(job.preparedMeshes??[]).map(mesh=>({objectId:mesh.objectId,role:mesh.role,sha256:mesh.sha256,triangleCount:mesh.triangles.length/9,closed:mesh.closed})),coverage:snapshot.value?.coverage},reliableRun:embed?.report(),history:embed?.history(),persistenceError:embed?.persistenceError};
}
function safely(action:()=>Promise<unknown>){action().catch(e=>{if((e as {code?:string}).code==='STALE_RUN')return;const line=(e as {physicalLine?:number}).physicalLine;error.value=(line?'程序第'+line+'行：':'')+(e as Error).message;});}
function programDraft(){return {programId:currentJob.value.program.programId,text:code.value};}
function applyCode(){safely(()=>loadTask({...currentJob.value,program:programDraft()}));}
function applySettings(){safely(()=>loadTask({...currentJob.value,program:programDraft(),simulation:{...currentJob.value.simulation,stockCellMm:stockCell.value,arcChordToleranceMm:currentJob.value.simulation?.arcChordToleranceMm??.02,mode:cutMode.value,checkCollisions:collisionEnabled.value,stopOnCollision:stopOnCollision.value}}));}
function loadScenario(){safely(()=>loadTask(scenarioJob(scenarioId.value)));}
function loadExchangeDemo(){const job=scenarioJob('exchange');job.simulation!.stopOnCollision=false;safely(()=>loadTask(job));}
function loadLibraryCase(){safely(()=>loadTask(caseJob(libraryId.value)));}
function applyTask(){safely(async()=>loadTask(taskFromJson(taskJson.value)));}
function onScroll(event:Event){if(gutter.value)gutter.value.scrollTop=(event.target as HTMLTextAreaElement).scrollTop;}
function download(){
  const url=URL.createObjectURL(new Blob([JSON.stringify(report(),null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='cnc-preview-report.json';a.click();URL.revokeObjectURL(url);
}
function downloadIncidents(){
  const url=URL.createObjectURL(new Blob([incidentCsv(collisionRecords.value,identity.value)],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='cnc-collision-records.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function importModel(event:Event){
  const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;
  try{
    if(file.size>32*1024*1024)throw new Error('模型超过32MB');
    const format=file.name.split('.').pop()?.toLowerCase();
    if(format!=='glb'&&format!=='stl')throw new Error('请选择GLB或STL文件');
    const asset={objectId:'imported-'+modelRole.value,role:modelRole.value,format:format as 'glb'|'stl',unit:'mm' as const,buffer:await file.arrayBuffer(),poseInM:{translationMm:[0,0,0],quaternionXYZW:[0,0,0,1]}};
    await loadTask({...currentJob.value,program:programDraft(),stock:modelRole.value==='stock'?{...currentJob.value.stock,kind:'mesh',assetId:asset.objectId}:currentJob.value.stock,assets:[...currentJob.value.assets.filter(a=>a.objectId!==asset.objectId),asset]});
    importedName.value=file.name;
  }catch(e){error.value=(e as Error).message;}
  (event.target as HTMLInputElement).value='';
}
async function importCode(event:Event){
  const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;
  if(file.size>512000){error.value='G代码文件超过512KB';return;}
  try{code.value=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());draftName.value=file.name;applyCode();}catch(e){error.value='程序文件必须为有效UTF-8：'+(e as Error).message;}
  (event.target as HTMLInputElement).value='';
}
onMounted(()=>{
  client=new SimulationClient(acceptSnapshot,fatal);
  embed=attachEmbed(async message=>{connected.value=true;return command(message);},()=>identity.value?{...identity.value}:null,{key:'cnc-sim-reliable-v1:'+window.location.pathname+':'+(new URLSearchParams(location.search).get('instanceId')??'default')});
  updateHistory();if(!isEmbedded)safely(()=>loadTask(currentJob.value));
});
function visibility(){if(document.hidden&&running.value)client.request('PAUSE').catch(()=>{});}
document.addEventListener('visibilitychange',visibility);
onBeforeUnmount(()=>{alive=false;embed?.dispose();client?.dispose();document.removeEventListener('visibilitychange',visibility);});
</script>

<template>
  <div class="lab-shell">
    <header class="app-header">
      <a class="brand" href="./" aria-label="铣削仿真实验室"><span class="brand-symbol"><PhCube :size="23" weight="bold"/></span><span>铣削仿真实验室<small>MILLING SIMULATION LAB</small></span></a>
      <nav class="header-links"><span class="version-label">三轴铣床 / 切削与碰撞检查</span><a v-if="!isEmbedded" href="./host.html" target="_blank" rel="noopener">上位网页联调 <PhArrowSquareOut :size="15"/></a><span v-else class="connection-label"><i/>{{ connected?'上位网页已连接':'等待上位网页下发' }}</span></nav>
    </header>
    <div class="project-bar"><div><span class="project-index">01</span><span>实验工作台</span><PhCaretRight :size="13"/><span class="muted">{{ currentJob.program.programId }}</span></div><span class="session-text">单位 mm<span class="separator">/</span>工件偏置与独立H表<span class="separator">/</span>固定刀轴 Z / Y侧头</span></div>
    <div class="scenario-bar library-bar"><label>案例库<select v-model="libraryId" aria-label="原始案例" :disabled="loading||running"><option v-for="option in caseOptions" :key="option.id" :value="option.id">{{ option.label }}</option></select></label><button class="primary-button" :disabled="loading||running" @click="loadLibraryCase">载入案例</button><button class="outline-button" :disabled="loading||running" @click="loadExchangeDemo">换刀演示</button><details class="task-settings"><summary>任务配置</summary><div><p class="helper">配置刀具、毛坯、模型、工件偏置、H表、机床运动链与换刀轨迹。应用后恢复毛坯。</p><textarea v-model="taskJson" aria-label="完整任务JSON" spellcheck="false" :readonly="running||loading"/><button class="outline-button" :disabled="loading||running" @click="applyTask">应用完整任务</button></div></details></div>
    <details class="development-tests" data-testid="development-tests"><summary>开发测试</summary><div class="scenario-bar"><span class="helper">用于功能验证和故障复现</span><label>实验场景<select v-model="scenarioId" aria-label="实验场景" :disabled="loading||running"><option v-for="option in developmentScenarios" :key="option.id" :value="option.id">{{ option.label }}</option></select></label><button class="outline-button" :disabled="loading||running" @click="loadScenario">载入场景</button></div></details>
    <details v-if="activeCase" class="case-information" data-testid="case-information"><summary>{{ activeCase.id }} · {{ activeCase.label }} · 参数与原始资料</summary><div><p>保留CAM原程序。以下补充参数用于教学仿真；配置范围通过不代表客户机床标定通过。</p><ul><li v-for="note in activeCase.assumptions" :key="note">{{ note }}</li></ul><p class="case-documents"><a v-for="document in activeCase.documents" :key="document.url" :href="document.url" target="_blank" rel="noopener">{{ document.label }}</a></p><p>毛坯：{{ currentJob.stock.sizeMm.join(' × ') }} mm；H表：{{ JSON.stringify(currentJob.toolLengthOffsetsMm) }}；刀长基准：{{ currentJob.toolLengthReferenceMm??0 }} mm；D半径表：{{ JSON.stringify(currentJob.cutterRadiusOffsetsMm) }}。在“任务配置”修改后应用。</p></div></details>
    <main class="workspace">
      <aside class="left-panel">
        <section class="panel-section"><div class="section-heading"><h2>实验资源</h2><span>SCENE</span></div>
          <div class="resource-row"><PhCube :size="18"/><div><b>初始毛坯</b><small>{{ currentJob.stock.sizeMm.map(n=>Number(n.toFixed(3))).join(' × ') }} mm</small></div><span class="tiny-tag">{{ currentJob.stock.kind==='mesh'?'网格':'块料' }}</span></div>
          <div class="resource-row"><PhStack :size="18"/><div><b>参考模型</b><small><span data-testid="model-count">{{ currentJob.assets.length }}</span> 个外部模型</small></div></div>
          <div v-if="importedName" class="imported-file">{{ importedName }}</div>
          <button class="outline-button full" :disabled="loading||running" @click="fileInput?.click()"><PhUploadSimple :size="16"/>导入参考模型</button>
          <label class="model-role">模型用途<select v-model="modelRole" aria-label="模型用途" :disabled="loading||running"><option value="target">目标零件显示</option><option value="fixture">夹具碰撞</option><option value="stock">闭合模型毛坯</option><option value="machine">机床部件</option></select></label>
          <input ref="fileInput" data-testid="model-file" class="visually-hidden" type="file" accept=".glb,.stl" @change="importModel">
          <p class="helper">GLB / STL · 毫米单位<br>机床部件需在任务配置中指定轴链。</p>
        </section>
        <section class="panel-section"><div class="section-heading"><h2>刀具库</h2><span>{{ String(currentJob.tools.length).padStart(2,'0') }}</span></div>
          <div v-for="tool in currentJob.tools" :key="tool.toolNumber" class="tool-item" :class="{selected:snapshot?.activeTool===tool.toolNumber}">
            <div class="tool-number">T{{ tool.toolNumber }}</div><div class="tool-detail"><b>{{ tool.type==='ball_endmill'?'球头铣刀':tool.type==='profile_endmill'?'成形轮廓刀':tool.type==='drill'?(tool.axisDirection?.y===-1?'侧头麻花钻':'麻花钻'):'平底立铣刀' }}</b><small>Ø{{ tool.diameterMm }} · 刃长 {{ tool.cuttingLengthMm }}</small></div><PhCheck v-if="snapshot?.activeTool===tool.toolNumber" :size="15"/>
          </div>
          <div class="tool-note"><span>主轴刀具</span><b data-testid="active-tool">T{{ snapshot?.activeTool||currentJob.tools[0].toolNumber }}</b></div>
          <div class="tool-note"><span>预选刀具</span><b>T{{ snapshot?.selectedTool||currentJob.tools[0].toolNumber }}</b></div>
        </section>
        <section class="panel-section process-section"><div class="section-heading"><h2>能力状态</h2><span>0.3</span></div>
          <div class="capability"><PhCheck :size="15"/><span>坐标偏置与刀长补偿</span></div><div class="capability"><PhCheck :size="15"/><span>逻辑及配置轨迹换刀</span></div><div class="capability"><PhCheck :size="15"/><span>多区间材料去除</span></div><div class="capability"><PhCheck :size="15"/><span>路径碰撞与首触回传</span></div>
          <p class="helper">毛坯按设置格距离散。平底、球头与钻尖采用各自的切削包络。</p>
        </section>
      </aside>
      <section class="center-panel">
        <div class="view-header"><div><span class="status-dot" :class="{moving:running}"/><strong data-testid="state" :data-instruction-index="snapshot?.instructionIndex">{{ stateText }}</strong><span v-if="collisionRecords.length" class="collision-count" data-testid="collision-warning-count">{{ collisionRecords.length }} 条提示</span><span class="view-mode">{{ currentJob.simulation?.mode==='dry_run'?'空运行':(running?cuttingLabel:'切削仿真') }}</span></div><div class="view-buttons"><button title="显示或隐藏刀路" aria-label="显示或隐藏刀路" @click="viewport?.togglePath()"><PhEye :size="17"/></button><button title="俯视" aria-label="俯视" @click="viewport?.setTop()"><PhStack :size="17"/></button><button title="恢复视角" aria-label="恢复视角" @click="viewport?.resetView()"><PhCrosshair :size="17"/></button></div></div>
        <div class="view-wrap"><Viewport ref="viewport" :snapshot="snapshot" :highlight-incident="shownIncident" @fatal="message=>{graphicsFault=message;fatal(message)}"/><div class="view-caption"><span>XYZ · 右手坐标</span><span>鼠标旋转 / 滚轮缩放</span></div><div class="scene-label"><span class="scene-mark"/>参数化示意场景</div>
          <div v-if="loading" class="view-overlay"><div class="loading-line"/><b>正在准备实验</b><span>校验程序、模型与刀路</span></div>
        </div>
          <div v-if="snapshot?.toolExchange" class="tool-exchange-status" data-testid="tool-exchange-animation" :data-progress="snapshot.toolExchange.progress" :data-phase="snapshot.toolExchange.phase" role="status">
            <div class="exchange-cycle">
            <strong>{{ sideExchange?'侧头装卸':'伞形刀库换刀' }} · T{{ snapshot.toolExchange.fromTool }} → T{{ snapshot.toolExchange.toTool }}</strong>
            <span>{{ (sideExchange?sideExchangePhaseLabels:exchangePhaseLabels)[snapshot.toolExchange.phase] }} · {{ Math.round(snapshot.toolExchange.progress*100) }}%</span>
            <progress :value="snapshot.toolExchange.progress" max="1"/>
            </div><div class="exchange-specs">
            <span v-if="!sideExchange" data-testid="magazine-dimensions">{{ magazine.pocketCount }} 工位 · 刀盘外廓 Ø{{ (magazine.outerRadiusMm*2).toFixed(1) }} mm</span>
            <span v-for="tool in exchangeTools" :key="tool.toolNumber" class="exchange-tool-dimension">T{{ tool.toolNumber }} · 刀径 Ø{{ tool.diameterMm }} · 总长 {{ tool.gaugeLengthMm+tool.holder.lengthMm }}<br>刀柄 Ø{{ tool.holder.diameterMm }} × {{ tool.holder.lengthMm }} mm</span>
            </div>
            <small>{{ sideExchange?'侧头需专用适配机构，此处展示装卸示意':'刀库机构为教学设计，机构运动未纳入碰撞检查' }}</small>
          </div>
        <div class="material-summary"><div><span>已切除</span><b data-testid="removed-volume">{{ (snapshot?.stock?.removedVolumeMm3??0).toFixed(1) }}</b><small>mm³</small></div><div><span>剩余材料</span><b data-testid="remaining-percent">{{ ((snapshot?.stock?.remainingFraction??1)*100).toFixed(1) }}</b><small>%</small></div><div><span>实际格距</span><b data-testid="actual-cell">{{ (snapshot?.stock?.cellSizeMm??[.5,.5]).map(n=>n.toFixed(2)).join(' × ') }}</b><small>mm</small></div></div>
        <div class="dro"><div v-for="axis in ['x','y','z'] as const" :key="axis"><span>{{ axis.toUpperCase() }}</span><b :data-testid="'position-'+axis">{{ (snapshot?.position[axis]??0).toFixed(3) }}</b><small>mm</small></div></div>
        <div class="transport"><div class="transport-buttons">
          <button class="primary-button" :disabled="!canRun" @click="safely(()=>control(snapshot?.state==='PAUSED'?'RESUME':'START'))"><PhPlay :size="17" weight="fill"/>{{ snapshot?.state==='PAUSED'?'继续':'开始' }}</button>
          <button class="outline-button" :disabled="!canControl||!running" @click="safely(()=>control('PAUSE'))"><PhPause :size="17" weight="fill"/>暂停</button>
          <button class="icon-button" aria-label="单步" title="按程序块单步" :disabled="!canRun" @click="safely(()=>control('STEP'))"><PhSkipForward :size="18"/></button>
          <button class="icon-button" aria-label="重置" title="重置" :disabled="!canControl" @click="safely(()=>control('RESET'))"><PhArrowCounterClockwise :size="18"/></button>
        </div><label class="speed-label">倍率<select aria-label="回放倍率" :disabled="!canControl" :value="snapshot?.speed??1" @change="safely(()=>control('SET_SPEED',Number(($event.target as HTMLSelectElement).value)))"><option :value=".25">0.25×</option><option :value="1">1×</option><option :value="2">2×</option><option :value="5">5×</option><option :value="10">10×</option><option :value="20">20×</option></select></label></div>
        <div class="material-controls"><label>加工模式<select v-model="cutMode" aria-label="加工模式" :disabled="loading||running"><option value="cut">切削仿真</option><option value="dry_run">空运行</option></select></label><label>格距<select v-model="stockCell" aria-label="材料格距" :disabled="loading||running"><option v-if="![.25,.5,1,2].includes(stockCell)" :value="stockCell">{{ stockCell }} mm</option><option :value=".25">0.25 mm</option><option :value=".5">0.5 mm</option><option :value="1">1 mm</option><option :value="2">2 mm</option></select></label><label><input v-model="collisionEnabled" type="checkbox" aria-label="连续碰撞检查" :disabled="loading||running">碰撞检查</label><label>碰撞处理<select v-model="stopOnCollision" aria-label="碰撞处理" :disabled="loading||running||!collisionEnabled"><option :value="false">提示并继续动画</option><option :value="true">碰撞即暂停</option></select></label><button class="outline-button" :disabled="loading||running" @click="applySettings">应用设置</button><small>应用后恢复毛坯</small></div>
        <div class="replay-controls"><label>回看到源行<input v-model.number="seekLine" type="number" min="1" :max="lines.length" aria-label="回看源行" :disabled="running||loading"></label><button class="text-button" :disabled="!canControl||running" @click="safely(()=>control('SEEK_LINE',seekLine))">重新演算到此行</button><span>使用检查点向前重放，生成新运行</span></div>
        <div class="timeline"><div class="timeline-track"><span :style="{width:((snapshot?.progress??0)*100)+'%'}"/></div><div><span>程序进度 {{ Math.round((snapshot?.progress??0)*100) }}%</span><span>{{ ((snapshot?.elapsedMs??0)/1000).toFixed(1) }} / {{ ((snapshot?.totalMs??0)/1000).toFixed(1) }} s <small>仿真时长</small></span></div></div>
        <section class="activity-panel"><div class="section-heading"><h2>执行记录</h2><button class="text-button" @click="download"><PhDownloadSimple :size="14"/>导出报告</button></div><div class="activity-list"><div v-for="(event,index) in events.slice(0,4)" :key="index" class="activity-row"><time>{{ event.time }}</time><b>{{ event.title }}</b><span>{{ event.detail }}</span></div><p v-if="!events.length" class="helper">载入任务后显示执行记录。</p></div></section>
      </section>
      <aside class="program-panel">
        <div class="section-heading program-heading"><h2><PhCode :size="17"/>加工程序</h2><button class="text-button" :disabled="running||loading" @click="codeInput?.click()"><PhUploadSimple :size="14"/>导入</button><input ref="codeInput" class="visually-hidden" type="file" accept=".nc,.gcode,.tap,.txt" @change="importCode"></div>
        <div class="file-tab"><span class="file-dot"/>{{ draftName }}<span v-if="dirty" class="dirty-dot" title="有未应用的修改"/><small>{{ lines.length }} 行</small></div>
        <div class="code-editor"><div ref="gutter" class="line-numbers" aria-hidden="true"><span v-for="(_,i) in lines" :key="i" :class="{active:snapshot?.physicalLine===i+1}">{{ i+1 }}</span></div><textarea ref="editor" aria-label="G代码程序" :value="code" :readonly="running||loading" spellcheck="false" @input="code=($event.target as HTMLTextAreaElement).value" @scroll="onScroll"/></div>
        <div class="editor-actions"><span>{{ dirty?'程序已修改':'程序已应用' }}</span><button class="outline-button" :disabled="loading||running" @click="applyCode">应用程序</button></div>
        <div v-if="error" role="alert" class="error-box"><PhWarningCircle :size="17"/><span>{{ error }}</span></div>
        <button v-if="collisionRecords.length" class="outline-button" @click="downloadIncidents">导出碰撞CSV</button><details v-if="collisionRecords.length" class="collision-records" open><summary>碰撞与检查记录（{{ collisionRecords.length }}）</summary><div><button v-for="incident in collisionRecords" :key="incident.eventId" :aria-label="'定位第'+incident.source.physicalLine+'行'" :class="{selected:shownIncident?.eventId===incident.eventId}" @click="selectedIncidentId=incident.eventId;focusSource(incident.source.physicalLine)">L{{ incident.source.physicalLine }} · {{ incident.collisionType }}</button></div></details><div v-if="shownIncident" class="collision-detail" :class="{warning:currentJob.simulation?.stopOnCollision===false&&shownIncident.type==='COLLISION'}" data-testid="collision-detail"><strong>{{ shownIncident.collisionType }}</strong><p v-if="currentJob.simulation?.stopOnCollision===false&&shownIncident.type==='COLLISION'">{{ snapshot?.state==='COMPLETED'?'碰撞提示 · 动画已完成':'碰撞仅提示 · 动画继续' }}，记录已保留</p><p>源行 L{{ shownIncident.source.physicalLine }}<span v-if="shownIncident.source.blockNumber!==null"> / N{{ shownIncident.source.blockNumber }}</span> · {{ shownIncident.objects.join(' / ') }}</p><p v-if="shownIncident.contact">机床坐标 mm：{{ shownIncident.contact.point.map(n=>n.toFixed(3)).join(', ') }}<br>工件坐标：{{ shownIncident.contact.pointInWork.map(n=>n.toFixed(3)).join(', ') }}<br>{{ shownIncident.classification==='potential_collision'?'保守边界疑似接触':'几何接触' }} · 误差界 {{ shownIncident.contact.positionErrorBoundMm }} mm</p><p v-else>{{ shownIncident.detail??('轴限位：'+shownIncident.limit?.axis.toUpperCase()) }}</p><small data-testid="collision-event-id">{{ shownIncident.eventId }}</small></div>
        <section class="program-status"><div><span>执行源行</span><b>{{ snapshot?.physicalLine?'L'+snapshot.physicalLine:'—' }}</b></div><div><span>刀路段数</span><b>{{ motionCount }}</b></div><div><span>主轴转速</span><b>{{ snapshot?.spindleOn?snapshot.spindleRpm:0 }} <small>rpm</small></b></div><div><span>刀具直径</span><b>{{ activeTool?.diameterMm??'—' }} <small>mm</small></b></div></section>
        <div class="verification-note" data-testid="verification"><PhWarningCircle :size="18"/><div><b>{{ verificationText }}</b><p>检查刀具、剩余材料、已载入夹具与配置的机床对象对。保守边界命中单独标记，未配置的部件不在覆盖范围内。</p></div></div>
        <div v-if="persistenceWarning" class="error-box" role="alert">事件持久化不可用：{{ persistenceWarning }}</div>
        <details v-if="historyRuns.length" class="run-history"><summary>历史运行与中断记录（{{ historyRuns.length }}）</summary><p v-for="run in historyRuns.slice(-4).reverse()" :key="run.identity.runId">{{ run.identity.jobId }} / r{{ run.identity.revision }} · {{ run.interrupted?'interrupted':run.state }} · {{ run.eventCount }} 个事件</p></details>
      </aside>
    </main>
    <footer class="app-footer"><span><i/>{{ isEmbedded?'嵌入模式':'独立实验' }}<span class="separator">/</span>浏览器内计算</span><span>内核 {{engineVersion}}<span class="separator">/</span>配置范围连续检查</span></footer>
  </div>
</template>
