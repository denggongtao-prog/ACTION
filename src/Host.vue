<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { demoJob } from './lib/demo';
import type { Envelope, Identity } from './core/protocol';
import { scenarioOptions,scenarioJob } from './lib/scenarios';
import { taskToJson,taskFromJson } from './lib/taskJson';
import type { CollisionEvent } from './core/collisionTypes';
import {caseOptions,caseJob} from './lib/caseLibrary';
import {criticalEventTypes} from './lib/reliableEvents';
const frame=ref<HTMLIFrameElement>(),connected=ref(false),loaded=ref(false),modelUrl=ref(''),unit=ref('mm');
const messages=ref<{type:string;payload:string;time:string}[]>([]);
const scenarioId=ref('normal'),programText=ref(''),taskJson=ref(taskToJson(demoJob())),collision=ref<CollisionEvent|null>(null),storageError=ref('');
const libraryId=ref('O0001');
const busy=ref(false),hostState=ref('IDLE'),speed=ref('1'),seekLine=ref(1);
const pending=new Map<string,{type:string;identity:Identity}>();
const sameIdentity=(a:Identity,b:Identity)=>a.jobId===b.jobId&&a.revision===b.revision&&a.runId===b.runId;
const pendingTimers=new Map<string,ReturnType<typeof setTimeout>>();
function clearPending(){for(const timer of pendingTimers.values())clearTimeout(timer);pendingTimers.clear();pending.clear();busy.value=false;}
const channelId=crypto.randomUUID();
let identity:Identity={jobId:'host-example',revision:1,runId:crypto.randomUUID()},timer:ReturnType<typeof setInterval>,handshakeTimeout:ReturnType<typeof setTimeout>;
function beginHandshake(){
  connected.value=false;loaded.value=false;hostState.value='IDLE';clearPending();collision.value=null;clearInterval(timer);clearTimeout(handshakeTimeout);
  send('HELLO');timer=setInterval(()=>send('HELLO'),400);
  handshakeTimeout=setTimeout(()=>{clearInterval(timer);storageError.value='握手超时，请检查仿真页面是否正常载入';},15000);
}
function send(type:string,payload:Record<string,unknown>={}){
  const control=!['HELLO','GET_STATE','GET_REPORT','PING'].includes(type);
  if(type!=='HELLO'&&!connected.value){storageError.value='请等待握手完成';return;}
  if(control&&busy.value){storageError.value='上一条控制命令尚未完成';return;}
  if(control){busy.value=true;storageError.value='';}
  const message:Envelope={protocol:'cnc-sim',version:'1.0',type,messageId:crypto.randomUUID(),channelId,...identity,payload};
  pending.set(message.messageId,{type,identity:{...identity}});if(pending.size>128){const first=pending.keys().next().value!;clearTimeout(pendingTimers.get(first));pendingTimers.delete(first);pending.delete(first);}
  if(type!=='HELLO')pendingTimers.set(message.messageId,setTimeout(()=>{pending.delete(message.messageId);pendingTimers.delete(message.messageId);if(control)busy.value=false;storageError.value=type+'应答超时，命令可能已执行，请查询状态';},type==='LOAD_JOB'?60000:15000));
  frame.value?.contentWindow?.postMessage(message,window.location.origin);
}
function load(custom=false,caseId?:string){
  if(busy.value)return;
  let job;try{job=caseId?caseJob(caseId):custom?taskFromJson(taskJson.value):scenarioJob(scenarioId.value);}catch(e){storageError.value=(e as Error).message;return;}
  identity={...identity,revision:identity.revision+1,runId:crypto.randomUUID()};loaded.value=false;
  if(modelUrl.value.trim())job.assets=[...job.assets.filter(a=>a.objectId!=='host-fixture'),{objectId:'host-fixture',role:'fixture',format:modelUrl.value.toLowerCase().split('?')[0].endsWith('.stl')?'stl':'glb',unit:unit.value as 'mm'|'m',url:modelUrl.value.trim(),poseInM:{translationMm:[0,0,0],quaternionXYZW:[0,0,0,1]}}];
  collision.value=null;programText.value=job.program.text;taskJson.value=taskToJson(job);send('LOAD_JOB',job as unknown as Record<string,unknown>);
}
function acknowledge(message:Envelope){
  const eventId=message.payload.eventId;
  if(typeof eventId!=='string')return true;
  const key='cnc-host-events-v1';
  try{
    const previous=JSON.parse(localStorage.getItem(key)??'[]') as Envelope[];
    const duplicate=previous.some(m=>m.payload.eventId===eventId);
    if(!duplicate){previous.push(message);localStorage.setItem(key,JSON.stringify(previous.slice(-256)));}
    frame.value?.contentWindow?.postMessage({protocol:'cnc-sim',version:'1.0',type:'EVENT_ACK',messageId:crypto.randomUUID(),channelId,jobId:message.jobId,revision:message.revision,runId:message.runId,payload:{eventId}},location.origin);
    return !duplicate;
  }catch(e){storageError.value='事件尚未持久保存，未发送ACK：'+(e as Error).message;return true;}
}
function receive(event:MessageEvent){
  if(event.origin!==window.location.origin||event.source!==frame.value?.contentWindow)return;
  const m=event.data as Envelope;if(m?.protocol!=='cnc-sim'||m.version!=='1.0'||m.channelId!==channelId||typeof m.type!=='string'||typeof m.messageId!=='string'||!m.payload||typeof m.payload!=='object'||Array.isArray(m.payload))return;
  if(m.type==='SIM_READY'){connected.value=true;storageError.value='';clearInterval(timer);clearTimeout(handshakeTimeout);}
  const request=m.replyTo?pending.get(m.replyTo):undefined,command=request?.type,currentRequest=!!request&&sameIdentity(request.identity,identity);
  if(m.replyTo){pending.delete(m.replyTo);clearTimeout(pendingTimers.get(m.replyTo));pendingTimers.delete(m.replyTo);if(currentRequest&&command&&!['HELLO','GET_STATE','GET_REPORT','PING'].includes(command))busy.value=false;}
  if(currentRequest&&command==='LOAD_JOB'&&m.type==='JOB_READY'&&m.revision===identity.revision&&m.runId===identity.runId&&m.jobId===identity.jobId)loaded.value=true;
  if(currentRequest&&(m.type==='JOB_READY'||m.type==='STATE'||(m.type==='COMMAND_ERROR'&&(command==='LOAD_JOB'||m.payload.code==='STALE_RUN')))&&m.runId&&m.jobId&&m.revision)identity={jobId:m.jobId,revision:m.revision,runId:m.runId};
  if(currentRequest&&m.type==='STATE'&&['RESET','SEEK_LINE'].includes(command??''))collision.value=null;
  if(currentRequest&&m.type==='COMMAND_ERROR'&&command==='LOAD_JOB')loaded.value=false;
  if(currentRequest&&m.type==='COMMAND_ERROR')storageError.value=String(m.payload.message??'命令失败');
  const state=m.type==='PROGRESS'||m.type==='COMPLETED'?m.payload:m.payload.state;
  if(m.jobId===identity.jobId&&m.revision===identity.revision&&m.runId===identity.runId&&state&&typeof state==='object'&&'state'in state&&typeof state.state==='string')hostState.value=state.state;
  if(criticalEventTypes.has(m.type)&&typeof m.payload?.eventId==='string'&&!acknowledge(m))return;
  if(['COLLISION','LIMIT','INDETERMINATE'].includes(m.type)&&m.runId===identity.runId){collision.value=m.payload as unknown as CollisionEvent;}
  messages.value.unshift({type:m.type,payload:JSON.stringify(m.payload,null,2).slice(0,m.type==='REPORT'?100000:5000),time:new Date().toLocaleTimeString('zh-CN',{hour12:false})});messages.value=messages.value.slice(0,35);
}
onMounted(()=>{window.addEventListener('message',receive);beginHandshake();});
onBeforeUnmount(()=>{clearPending();clearInterval(timer);clearTimeout(handshakeTimeout);window.removeEventListener('message',receive);});
</script>
<template>
  <main class="host-shell"><header class="host-heading"><div><h1>上位网页联调</h1><p>通过真实 iframe 下发任务，查看仿真页面返回的消息。</p></div><span class="host-status" data-testid="host-status">{{ connected?'已连接':'正在握手' }}</span></header>
    <div class="host-layout"><aside class="host-controls"><h2>任务控制</h2><div><label>联调场景<select v-model="scenarioId" aria-label="联调场景"><option v-for="option in scenarioOptions" :key="option.id" :value="option.id">{{ option.label }}</option></select></label><label>联调案例<select v-model="libraryId" aria-label="联调案例"><option v-for="option in caseOptions" :key="option.id" :value="option.id">{{ option.label }}</option></select></label><button class="outline-button full" :disabled="!connected||busy" @click="load(false,libraryId)">下发案例</button><label>夹具模型URL<input v-model="modelUrl" aria-label="夹具模型URL" type="url" placeholder="可选：GLB / STL 的 HTTP 地址"></label><label>模型长度单位<select v-model="unit" aria-label="模型长度单位"><option value="mm">毫米 mm</option><option value="m">米 m</option></select></label><p class="helper">模型、刀具、坐标和机床配置通过同一LOAD_JOB下发。接收到关键事件后持久保存，再发送ACK。</p><div class="host-action-grid"><button class="primary-button" :disabled="!connected||busy" @click="load(false)">下发示例</button><button class="outline-button" :disabled="!loaded||busy" @click="send('START')">开始仿真</button><button class="outline-button" :disabled="!loaded||busy" @click="send('PAUSE')">暂停仿真</button><button class="outline-button" :disabled="!loaded||busy||hostState!=='PAUSED'" @click="send('RESUME')">继续仿真</button><button class="outline-button" :disabled="!loaded||busy||!['READY','PAUSED'].includes(hostState)" @click="send('STEP')">单步仿真</button><button class="outline-button" :disabled="!loaded||busy" @click="send('RESET')">重置任务</button><button class="outline-button" :disabled="!loaded" @click="send('GET_STATE')">查询状态</button><button class="outline-button" :disabled="!loaded||busy" @click="send('GET_REPORT')">获取报告</button></div><p class="helper" data-testid="host-execution-state">运行状态：{{hostState}}</p><label>回放倍率<select v-model="speed" aria-label="上位机倍率"><option v-for="value in ['0.25','0.5','1','2','5','10','20']" :key="value" :value="value">{{value}}×</option></select></label><button class="outline-button" :disabled="!loaded||busy" @click="send('SET_SPEED',{speed:Number(speed)})">应用倍率</button><label>回看源行<input v-model.number="seekLine" type="number" min="1" aria-label="上位机回看行号"></label><button class="outline-button" :disabled="!loaded||busy||['RUNNING','TOOL_CHANGING'].includes(hostState)" @click="send('SEEK_LINE',{physicalLine:seekLine})">回看源行</button><details class="host-task"><summary>自定义完整任务</summary><textarea v-model="taskJson" aria-label="上位网页任务JSON"/><button class="outline-button" :disabled="!connected||busy" @click="load(true)">下发自定义任务</button></details><div v-if="collision" class="collision-detail" data-testid="host-collision"><strong>{{ collision.collisionType }}</strong><p>原文件行：<b data-testid="host-source-line">{{ collision.source.physicalLine }}</b> · {{ collision.objects.join(' / ') }}</p><p v-if="collision.contact">机床坐标 mm：{{ collision.contact.point.map(n=>n.toFixed(3)).join(', ') }}</p><small>{{ collision.eventId }}</small></div><p v-if="storageError" role="alert">{{ storageError }}</p><details v-if="programText" open class="host-source"><summary>下发原程序</summary><div><p v-for="(line,index) in programText.split(/\r\n|\n|\r/)" :key="index" :class="{hit:collision?.source.physicalLine===index+1}"><span>{{ index+1 }}</span>{{ line }}</p></div></details></div><section class="host-log"><h2>通信事件</h2><div data-testid="event-log"><article v-for="(message,index) in messages" :key="index"><strong>{{ message.type }}</strong><small>{{ message.time }}</small><pre>{{ message.payload }}</pre></article></div></section></aside><iframe ref="frame" @load="beginHandshake" src="./index.html?instanceId=host-example" title="机床仿真页面" class="host-frame"/></div>
  </main>
</template>

