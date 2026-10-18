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
