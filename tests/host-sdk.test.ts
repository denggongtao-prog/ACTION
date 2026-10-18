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
