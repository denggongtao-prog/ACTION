import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const sdkPath='../examples/host-integration/cnc-sim-client.js';
const {CncSimClient}=await import(sdkPath);
let frame:any,client:any,sent:any[],storage:Map<string,string>;
const identity={jobId:'sdk-job',revision:1,runId:'sdk-run'};
beforeEach(()=>{
  vi.useFakeTimers();sent=[];storage=new Map();
  vi.stubGlobal('window',new EventTarget());vi.stubGlobal('location',new URL('https://host.example.edu/'));
  vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)});
  frame=new EventTarget();frame.contentWindow={postMessage:(message:any)=>sent.push(message)};frame.src='';
  client=new CncSimClient(frame,'https://sim.example.edu/index.html');client.connected=true;client.context={...identity};
});
describe('第02轮：释放与异步隔离',()=>{
  it('保存尚未完成时释放，不再确认或向业务派发事件',async()=>{
    let finish!:(fresh:boolean)=>void;client.persistEvent=()=>new Promise(resolve=>{finish=resolve;});client.onEvent=vi.fn();
    receive('COMPLETED',{eventId:'event-1',eventSeq:1});await Promise.resolve();client.dispose();finish(true);await client.eventQueue;
    expect(sent).toHaveLength(0);expect(client.onEvent).not.toHaveBeenCalled();
  });
  it('释放幂等，拒绝重连和后续请求',async()=>{
    client.dispose();client.dispose();await expect(client.connect()).rejects.toThrow('释放');await expect(client.getState()).rejects.toThrow('释放');expect(frame.src).toBe('');
  });
});
afterEach(()=>{client.dispose();vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});
function receive(type:string,payload:any={},extra:any={}){
  client._receive({origin:'https://sim.example.edu',source:frame.contentWindow,data:{protocol:'cnc-sim',version:'1.0',type,messageId:crypto.randomUUID(),channelId:client.channelId,...identity,payload,...extra}});
}
describe('第01轮：SDK输入边界',()=>{
  it.each([
    ['START',[],{}],['UNKNOWN',{},{}],['START',{}, {timeoutMs:0}],['START',{}, {timeoutMs:NaN}],
    ['START',{}, {retries:-1}],['START',{}, {retries:.5}],['START',{}, {identity:{jobId:'x',revision:0,runId:'x'}}],
    ['SET_SPEED',{speed:21},{}],['SEEK_LINE',{physicalLine:0},{}],['START',{bad:()=>{}},{}]
  ])('无效请求%s在本地拒绝，未发送且未遗留pending',async(type,payload,options)=>{
    await expect(client.request(type,payload,options)).rejects.toBeInstanceOf(Error);expect(sent).toHaveLength(0);expect(client.pending.size).toBe(0);
  });
  it('未连接时loadJob不会覆盖当前身份',async()=>{
    client.connected=false;await expect(client.loadJob({})).rejects.toThrow();expect(client.identity).toEqual(identity);
  });
});
describe('第03轮：握手与重连',()=>{
  it('首次和重复connect均返回SIM_READY信封',async()=>{
    client.connected=false;const first=client.connect();frame.dispatchEvent(new Event('load'));receive('SIM_READY',{engineVersion:'test'});
    expect(await client.connect()).toEqual(await first);expect((await first).type).toBe('SIM_READY');
  });
  it('iframe重载重新握手超时会结束重试并通知断连',async()=>{
    client.onError=vi.fn();client.onConnectionChange=vi.fn();frame.dispatchEvent(new Event('load'));
    expect(client.onConnectionChange).toHaveBeenCalledWith('connecting');await vi.advanceTimersByTimeAsync(15001);
    expect(client.onConnectionChange).toHaveBeenLastCalledWith('disconnected');expect(client.onError).toHaveBeenCalledOnce();
    const count=sent.length;await vi.advanceTimersByTimeAsync(2000);expect(sent).toHaveLength(count);
  });
});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
describe('第04轮：顺序控制',()=>{
  it('连续RESET与调速等待新身份再发送',async()=>{
    const resetting=client.reset(),speed=client.setSpeed(2);await flush();expect(sent.map(m=>m.type)).toEqual(['RESET']);
    receive('STATE',{state:{state:'READY'}},{runId:'after-reset',replyTo:sent[0].messageId});await resetting;await flush();
    expect(sent[1].runId).toBe('after-reset');receive('COMMAND_ACK',{state:{state:'READY'}},{runId:'after-reset',replyTo:sent[1].messageId});await speed;
  });
  it('失败命令不会阻断队列中的下一条命令',async()=>{
    const first=client.reset().catch((e:any)=>e.code),second=client.setSpeed(2);await flush();
    receive('COMMAND_ERROR',{code:'COMMAND_ERROR',message:'拒绝重置'},{replyTo:sent[0].messageId});expect(await first).toBe('COMMAND_ERROR');await flush();
    expect(sent.at(-1).type).toBe('SET_SPEED');receive('COMMAND_ACK',{}, {replyTo:sent.at(-1).messageId});await second;
  });
  it('重载后丢弃原页面队列，不能重放控制命令',async()=>{
    const results=Promise.allSettled([client.reset(),client.setSpeed(2)]);await flush();frame.dispatchEvent(new Event('load'));await results;
    expect(sent.filter(m=>m.type==='SET_SPEED')).toHaveLength(0);
  });
});
describe('第05轮：事件降级和回调隔离',()=>{
  it('无eventId的持久化故障交给业务并报告降级，不确认',()=>{
    client.onEvent=vi.fn();client.onError=vi.fn();receive('ERROR',{code:'EVENT_PERSISTENCE_FAILED',message:'存储不可用',delivery:{durable:false}});
    expect(client.onEvent).toHaveBeenCalledOnce();expect(client.onError).toHaveBeenCalledWith(expect.objectContaining({code:'EVENT_PERSISTENCE_FAILED'}));expect(sent).toHaveLength(0);
  });
  it('业务回调抛异常不能破坏消息处理，错误回调自身异常也隔离',async()=>{
    client.onMessage=()=>{throw new Error('业务显示失败');};client.onError=vi.fn();
    const pending=client.request('GET_STATE');expect(()=>receive('STATE',{state:{}},{replyTo:sent[0].messageId})).not.toThrow();await pending;
    expect(client.onError).toHaveBeenCalledOnce();client.onError=()=>{throw new Error('日志失败');};expect(()=>receive('PROGRESS',{})).not.toThrow();
  });
  it('畸形信封和数组payload不交给业务',()=>{
    client.onMessage=vi.fn();receive('PROGRESS',[]);receive('PROGRESS',{}, {messageId:''});receive('PROGRESS',{}, {version:'2.0'});expect(client.onMessage).not.toHaveBeenCalled();
  });
});
describe('第10轮：异步保存的跨页面恢复',()=>{
  it('旧页面保存挂起时，新页面事件使用新队列，不被旧Promise阻塞',async()=>{
    let finish!:(fresh:boolean)=>void;client.onEvent=vi.fn();client.persistEvent=()=>new Promise(resolve=>{finish=resolve;});
    receive('COMPLETED',{eventId:'old-event',eventSeq:1});await flush();const oldQueue=client.eventQueue;
    frame.dispatchEvent(new Event('load'));receive('SIM_READY',{});client.persistEvent=()=>true;
    receive('COMPLETED',{eventId:'new-event',eventSeq:1},{runId:'new-run'});await flush();expect(client.onEvent).toHaveBeenCalledOnce();
    expect(client.onEvent.mock.calls[0][0].payload.eventId).toBe('new-event');finish(true);await oldQueue;expect(client.onEvent).toHaveBeenCalledOnce();
  });
  it('释放后保存失败不再触发旧页面错误回调',async()=>{
    let reject!:(error:Error)=>void;client.onError=vi.fn();client.persistEvent=()=>new Promise((_resolve,no)=>{reject=no;});
    receive('COMPLETED',{eventId:'old-event',eventSeq:1});await flush();const queue=client.eventQueue;client.dispose();reject(new Error('旧保存失败'));await queue;
    expect(client.onError).not.toHaveBeenCalled();
  });
});
