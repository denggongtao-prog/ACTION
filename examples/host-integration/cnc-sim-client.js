/** Reference host adapter for protocol 1.0. No framework or third-party dependencies. */
export const CRITICAL_EVENTS=new Set(['COLLISION','LIMIT','INDETERMINATE','ERROR','TOOL_CHANGE','COMPLETED']);
const COMMANDS=new Set(['LOAD_JOB','START','PAUSE','RESUME','STEP','RESET','SEEK_LINE','SET_SPEED','GET_STATE','GET_REPORT','EVENT_ACK','PING']);
const validId=value=>typeof value==='string'&&!!value.trim()&&value.length<=128;
const validIdentity=value=>value&&validId(value.jobId)&&Number.isSafeInteger(value.revision)&&value.revision>0&&validId(value.runId);
export class CncSimClient {
  constructor(frame,url,{onMessage=()=>{},onEvent=()=>{},onError=console.error,onConnectionChange=()=>{},persistEvent}={}){
    this.frame=frame;this.url=new URL(url,location.href);this.origin=this.url.origin;
    this.channelId=crypto.randomUUID();this.context=null;this.connected=false;this.loaded=false;this.disposed=false;this.epoch=0;
    this.pending=new Map();this.revisions=new Map();this.eventQueue=Promise.resolve();this.commandQueue=Promise.resolve();
    this.onMessage=onMessage;this.onEvent=onEvent;this.onError=onError;
    this.onConnectionChange=onConnectionChange;this.connectionState='disconnected';
    this.persistEvent=persistEvent??(message=>{
      const key='cnc-host-manual-events:'+this.origin,events=JSON.parse(localStorage.getItem(key)??'[]');
      const duplicate=events.some(e=>e.jobId===message.jobId&&e.revision===message.revision&&e.runId===message.runId&&e.payload.eventId===message.payload.eventId);
      if(!duplicate){events.push(message);localStorage.setItem(key,JSON.stringify(events));}
      return !duplicate;
    });
    this.receive=event=>this._receive(event);
    this.frameLoaded=()=>{
      if(this.disposed)return;this.epoch++;
      this.commandQueue=Promise.resolve();this.eventQueue=Promise.resolve();
      this.loaded=false;this._rejectPending(new Error('IFRAME_RELOADED：请重新查询历史或载入任务'));this._beginHandshake();
      clearInterval(this.helloTimer);this._hello();this.helloTimer=setInterval(()=>this._hello(),400);
    };
    window.addEventListener('message',this.receive);frame.addEventListener('load',this.frameLoaded);
  }
  get identity(){return this.context?structuredClone(this.context):null;}
  connect(){
    if(this.disposed)return Promise.reject(new Error('连接已释放'));
    if(this.connected)return Promise.resolve(this.readyMessage);
    if(this.handshake)return this.handshake.promise;
    let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
    this.handshake={promise,resolve,reject};this._beginHandshake();
    this.frame.src=this.url.href;return promise;
  }
  _error(error){try{Promise.resolve(this.onError(error)).catch(()=>{});}catch{/* A failing logger must not break transport. */}}
  _notify(name,value){try{Promise.resolve(this[name](value)).catch(error=>this._error(error));}catch(error){this._error(error);}}
  _connection(state){this.connectionState=state;this.connected=state==='connected';this._notify('onConnectionChange',state);}
  _beginHandshake(){
    this._connection('connecting');clearTimeout(this.handshakeTimer);
    this.handshakeTimer=setTimeout(()=>{
      clearInterval(this.helloTimer);this._connection('disconnected');
      const error=new Error('HELLO超时：检查来源白名单、iframe地址和CSP');
      if(this.handshake){this.handshake.reject(error);this.handshake=null;}else this._error(error);
    },15000);
  }
  _envelope(type,payload={},identity=this.context){
    return {protocol:'cnc-sim',version:'1.0',type,messageId:crypto.randomUUID(),channelId:this.channelId,...identity,payload};
  }
  _post(message){this.frame.contentWindow.postMessage(message,this.origin);}
  _hello(){this._post(this._envelope('HELLO',{},null));}
  _adopt(message){
    if(validIdentity(message)){
      this.context={jobId:message.jobId,revision:message.revision,runId:message.runId};
      this.revisions.set(message.jobId,Math.max(message.revision,this.revisions.get(message.jobId)??0));
    }
  }
  _receive(event){
    if(this.disposed)return;
    if(event.origin!==this.origin||event.source!==this.frame.contentWindow)return;
    const m=event.data;if(!m||m.protocol!=='cnc-sim'||m.version!=='1.0'||m.channelId!==this.channelId||!validId(m.messageId)||!validId(m.type)||!m.payload||typeof m.payload!=='object'||Array.isArray(m.payload))return;
    if(m.type==='SIM_READY'){
      this.ready=m.payload;this.readyMessage=m;this._connection('connected');clearInterval(this.helloTimer);clearTimeout(this.handshakeTimer);
      if(this.handshake){this.handshake.resolve(m);this.handshake=null;}
    }
    // ACK only critical EVENT TYPES. COMMAND_ACK also contains eventId and must never be ACKed again.
    if(CRITICAL_EVENTS.has(m.type)){
      if(m.payload.delivery?.durable===false)this._error(Object.assign(new Error(m.payload.delivery.message??m.payload.message??'事件持久化已降级'),{code:'EVENT_PERSISTENCE_FAILED'}));
      if(m.payload.eventId===undefined){this._notify('onEvent',m);return;}
      if(!validId(m.payload.eventId)||!validIdentity(m)||!Number.isSafeInteger(m.payload.eventSeq)||m.payload.eventSeq<1)return;
      const epoch=this.epoch;
      this.eventQueue=this.eventQueue.then(async()=>{
        if(this.disposed||epoch!==this.epoch)return;
        const fresh=await this.persistEvent(structuredClone(m)); // Failure => no ACK; server retains/retries.
        if(this.disposed||epoch!==this.epoch)return;
        this._post(this._envelope('EVENT_ACK',{eventId:m.payload.eventId},{jobId:m.jobId,revision:m.revision,runId:m.runId}));
        if(fresh!==false)this._notify('onEvent',m);
      }).catch(error=>{if(!this.disposed&&epoch===this.epoch)this._error(error);});return;
    }
    const pending=this.pending.get(m.replyTo);
    if(pending){
      clearTimeout(pending.timer);this.pending.delete(m.replyTo);
      if(['JOB_READY','STATE'].includes(m.type)||(m.type==='COMMAND_ERROR'&&(pending.type==='LOAD_JOB'||m.payload.code==='STALE_RUN')))this._adopt(m);
      if(m.type==='JOB_READY')this.loaded=true;
      if(m.type==='STATE')this.loaded=!!m.payload.state;
      if(m.type==='COMMAND_ERROR'){
        const identity=typeof m.jobId==='string'&&Number.isSafeInteger(m.revision)&&typeof m.runId==='string'?{jobId:m.jobId,revision:m.revision,runId:m.runId}:null;
        pending.reject(Object.assign(new Error(m.payload.message),m.payload,{identity}));
      }else pending.resolve(m);
    }
    this._notify('onMessage',m);
  }
  _validateRequest(type,payload,identity,timeoutMs,retries){
    const invalid=message=>{throw Object.assign(new Error(message),{code:'INVALID_INPUT'});};
    if(!COMMANDS.has(type))invalid('不支持的命令：'+type);
    if(!payload||typeof payload!=='object'||Array.isArray(payload))invalid('payload必须是对象');
    if(type!=='PING'&&!validIdentity(identity))invalid('任务身份不完整或无效');
    if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>120000)invalid('timeoutMs应为1至120000');
    if(!Number.isInteger(retries)||retries<0||retries>3)invalid('retries应为0至3整数');
    if(type==='SET_SPEED'&&(!Number.isFinite(payload.speed)||payload.speed<.25||payload.speed>20))invalid('倍率应为0.25至20');
    if(type==='SEEK_LINE'&&(!Number.isSafeInteger(payload.physicalLine)||payload.physicalLine<1))invalid('物理行号应为正整数');
    if(type==='EVENT_ACK'&&!validId(payload.eventId))invalid('eventId无效');
  }
  async request(type,payload={}, {identity=this.context,timeoutMs=15000,retries=1}={}){
    if(this.disposed)throw new Error('连接已释放');
    if(!this.connected)return Promise.reject(new Error('请先完成HELLO握手'));
    this._validateRequest(type,payload,identity,timeoutMs,retries);
    // Keep an immutable copy and no transfer list, so a retry can reuse exactly the same bytes/messageId.
    const message=structuredClone(this._envelope(type,payload,identity));
    return new Promise((resolve,reject)=>{
      let attempt=0;
      const record={type,resolve,reject,timer:null};
      const send=()=>{
        try{this._post(message);}catch(error){this.pending.delete(message.messageId);reject(error);return;}
        record.timer=setTimeout(()=>{
          if(attempt++<retries)send();else{this.pending.delete(message.messageId);reject(new Error(`${type}超时：服务端可能已执行，请查询状态对账`));}
        },timeoutMs);
      };
      this.pending.set(message.messageId,record);send();
    });
  }
  _enqueue(work){
    const epoch=this.epoch;
    const task=this.commandQueue.then(()=>{
      if(this.disposed)throw new Error('连接已释放');
      if(epoch!==this.epoch)throw new Error('IFRAME_RELOADED：已取消旧页面排队操作');
      return work();
    });
    this.commandQueue=task.catch(()=>{});return task;
  }
  async loadJob(job,options={}){
    const input=structuredClone(job),config=structuredClone(options);
    return this._enqueue(()=>this._loadJob(input,config));
  }
  async _loadJob(job,{jobId='manual-example',revision,runId=crypto.randomUUID()}={}){
    if(!this.connected)throw new Error('请先完成HELLO握手');
    const nextRevision=revision??Math.max(this.revisions.get(jobId)??0,this.context?.jobId===jobId?this.context.revision:0)+1;
    this._validateRequest('LOAD_JOB',job,{jobId,revision:nextRevision,runId},60000,1);structuredClone(job);
    this.context={jobId,revision:nextRevision,runId};this.revisions.set(jobId,nextRevision);this.loaded=false;
    return this.request('LOAD_JOB',job,{timeoutMs:60000});
  }
  start(){return this._enqueue(()=>this.request('START'));}
  pause(){return this._enqueue(()=>this.request('PAUSE'));}
  resume(){return this._enqueue(()=>this.request('RESUME'));}
  step(){return this._enqueue(()=>this.request('STEP'));}
  reset(){return this._enqueue(()=>this.request('RESET'));}
  seekLine(physicalLine){return this._enqueue(()=>this.request('SEEK_LINE',{physicalLine}));}
  setSpeed(speed){return this._enqueue(()=>this.request('SET_SPEED',{speed}));}
  _read(type,identity,followCurrent){
    return this.request(type,{}, {identity}).catch(error=>{
      // A lost RESET/SEEK reply can leave local identity stale. Only retry reads, once.
      // Explicit historical queries must remain historical queries and may legitimately fail.
      if(followCurrent&&error.code==='STALE_RUN'&&this.context)return this.request(type,{}, {identity:this.context});
      throw error;
    });
  }
  getState(identity){return this._enqueue(()=>this._read('GET_STATE',identity??this.context,identity===undefined));}
  getReport(identity){return this._enqueue(()=>this._read('GET_REPORT',identity??this.context,identity===undefined));}
  _rejectPending(error){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
  dispose(){
    if(this.disposed)return;this.disposed=true;this.epoch++;
    window.removeEventListener('message',this.receive);this.frame.removeEventListener('load',this.frameLoaded);clearInterval(this.helloTimer);clearTimeout(this.handshakeTimer);
    if(this.handshake){this.handshake.reject(new Error('连接已释放'));this.handshake=null;}
    this._rejectPending(new Error('连接已释放'));this._connection('disposed');
  }
}
