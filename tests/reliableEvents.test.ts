import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReliableEventStore } from '../src/lib/reliableEvents';
import { attachEmbed } from '../src/lib/embed';
import type { Envelope, Identity } from '../src/core/protocol';

class MemoryStorage {
  data=new Map<string,string>();
  fail=false;
  getItem(key:string){return this.data.get(key)??null;}
  setItem(key:string,value:string){if(this.fail)throw new Error('quota');this.data.set(key,value);}
}
const identity:Identity={jobId:'job',revision:1,runId:'run-1'};
const channel={channelId:'channel-1',origin:'https://host.example.edu'};
function setup(options:Record<string,unknown>={}) {
  const storage=new MemoryStorage();let now=100;let id=0;
  const store=new ReliableEventStore({storage,now:()=>now,uuid:()=>`id-${++id}`,retryMs:1000,...options});
  return {storage,store,advance:(ms:number)=>{now+=ms;}};
}

describe('可靠事件与运行记录',()=>{
  it('碰撞提示持久保存但不将正在运行任务标为暂停',()=>{
    const {store}=setup();store.markState(identity,'RUNNING');
    const event=store.enqueue('COLLISION',{response:'warn_continue',source:{physicalLine:95}},identity,channel);
    expect(store.report(identity)?.state).toBe('RUNNING');expect(event.payload.response).toBe('warn_continue');
    expect(store.report(identity)?.events).toHaveLength(1);
  });
  it('首次发送之前已经持久化，重传保持完整原始信封',()=>{
    const {store,storage,advance}=setup();
    const event=store.enqueue('COLLISION',{source:{physicalLine:17}},identity,channel);
    const received:Envelope[]=[];
    const send=(message:Envelope)=>{
      expect([...storage.data.values()][0]).toContain(message.payload.eventId);
      received.push(message);
    };
    store.flush(channel,send);
    store.flush(channel,send);
    expect(received).toHaveLength(1);
    advance(1000);store.flush(channel,send);
    expect(received).toEqual([event,event]);
    expect(event.payload).toMatchObject({eventId:'id-1',eventSeq:1});
  });
  it('确认需匹配原身份与通道，重复ACK幂等且停止重传',()=>{
    const {store,advance}=setup();
    const event=store.enqueue('ERROR',{code:'WORKER_FAILURE'},identity,channel);
    expect(store.acknowledge({...identity,runId:'new'},event.payload.eventId as string,channel)).toBe(false);
    expect(store.acknowledge(identity,event.payload.eventId as string,{...channel,channelId:'other'})).toBe(false);
    expect(store.acknowledge(identity,event.payload.eventId as string,channel)).toBe(true);
    expect(store.acknowledge(identity,event.payload.eventId as string,channel)).toBe(true);
    advance(1000);
    const sent:Envelope[]=[];store.flush(channel,m=>sent.push(m));
    expect(sent).toEqual([]);
    expect(store.report(identity)?.events[0]?.acknowledgedAt).toBe(100);
  });
  it('重置后的新运行不改变旧事件身份，各运行序号独立',()=>{
    const {store}=setup();
    const mutable={...identity};const payload={source:{physicalLine:3}};
    const first=store.enqueue('TOOL_CHANGE',payload,mutable,channel);
    mutable.runId='run-2';payload.source.physicalLine=99;
    const second=store.enqueue('COMPLETED',{},mutable,channel);
    expect(store.report(identity)?.events[0]?.envelope).toEqual(first);
    expect(first.payload.source).toEqual({physicalLine:3});
    expect(first.runId).toBe('run-1');
    expect(second.payload.eventSeq).toBe(1);
    expect(store.acknowledge(identity,first.payload.eventId as string,channel)).toBe(true);
  });
  it.each(['READY','RUNNING','PAUSED','TOOL_CHANGING'])('重载把未完成的%s标记interrupted，不自动重发或完成',state=>{
    const {store,storage}=setup();
    store.markState(identity,state,{physicalLine:8});
    store.enqueue('TOOL_CHANGE',{stage:'installed'},identity,channel);
    const reloaded=new ReliableEventStore({storage,now:()=>200});
    expect(reloaded.report(identity)).toMatchObject({state:'interrupted',previousState:state,interrupted:true,details:{physicalLine:8}});
    const sent:Envelope[]=[];reloaded.flush(channel,m=>sent.push(m));
    expect(sent).toEqual([]);
    expect(()=>reloaded.markState(identity,'COMPLETED')).toThrow(/interrupted/);
  });
  it('已完成运行和原始eventId经重载仍能取回，读取返回防御性复制',()=>{
    const {store,storage}=setup();
    const event=store.enqueue('COMPLETED',{removedVolume:12},identity,channel);
    const reloaded=new ReliableEventStore({storage,now:()=>200});
    const report=reloaded.report(identity)!;report.events[0]!.envelope.payload.removedVolume=999;
    expect(reloaded.report(identity)).toMatchObject({state:'COMPLETED',interrupted:false});
    expect(reloaded.report(identity)?.events[0]?.envelope.payload).toMatchObject({eventId:event.payload.eventId,removedVolume:12});
  });
  it('通道切换不将旧事件发送给新的宿主会话',()=>{
    const {store}=setup();store.enqueue('COLLISION',{},identity,channel);
    const sent:Envelope[]=[];store.flush({...channel,channelId:'other'},m=>sent.push(m));
    store.flush({...channel,origin:'https://other.example.edu'},m=>sent.push(m));
    expect(sent).toEqual([]);
  });
  it('持久化失败不会发送或宣称记录成功，恢复后序号没有跳号',()=>{
    const {store,storage}=setup();storage.fail=true;
    expect(()=>store.enqueue('ERROR',{code:'X'},identity,channel)).toThrow(/persist/i);
    expect(store.history()).toEqual([]);
    const sent:Envelope[]=[];store.flush(channel,m=>sent.push(m));expect(sent).toEqual([]);
    storage.fail=false;
    expect(store.enqueue('LIMIT',{},identity,channel).payload.eventSeq).toBe(1);
  });
  it('ACK写入失败保留待发事件，不假装确认成功',()=>{
    const {store,storage}=setup();const event=store.enqueue('ERROR',{},identity,channel);
    storage.fail=true;
    expect(()=>store.acknowledge(identity,event.payload.eventId as string,channel)).toThrow(/persist/i);
    storage.fail=false;
    const sent:Envelope[]=[];store.flush(channel,m=>sent.push(m));expect(sent).toHaveLength(1);
  });
  it('达到容量时明确拒绝新事件，不丢弃未确认事件',()=>{
    const {store}=setup({maxEvents:2});
    store.enqueue('ERROR',{code:'one'},identity,channel);store.enqueue('ERROR',{code:'two'},identity,channel);
    expect(()=>store.enqueue('ERROR',{code:'three'},identity,channel)).toThrow(/capacity/i);
    expect(store.report(identity)?.events.map(e=>e.envelope.payload.code)).toEqual(['one','two']);
  });
  it('损坏的存储明确报错，不静默清空历史',()=>{
    const storage=new MemoryStorage();storage.data.set('cnc-sim-reliable-v1','{broken');
    expect(()=>new ReliableEventStore({storage})).toThrow(/persist/i);
    expect(storage.data.get('cnc-sim-reliable-v1')).toBe('{broken');
  });
  it('只淘汰已确认的终结运行，为当前事件保留有界空间',()=>{
    const {store}=setup({maxRuns:2,maxEvents:2});
    const first=store.enqueue('COMPLETED',{},identity,channel);
    store.acknowledge(identity,first.payload.eventId as string,channel);
    store.enqueue('ERROR',{}, {...identity,runId:'run-2'},channel);
    store.enqueue('ERROR',{}, {...identity,runId:'run-3'},channel);
    expect(store.history().map(r=>r.identity.runId)).toEqual(['run-2','run-3']);
  });
  it('不可序列化或非有限事件不能落盘为失真的可靠报告',()=>{
    const {store}=setup();
    expect(()=>store.enqueue('COLLISION',{contact:{x:Infinity}},identity,channel)).toThrow(/persist/i);
    expect(store.history()).toEqual([]);
  });
  it('畸形ACK持久记录不会被误判为已经确认',()=>{
    const {store,storage}=setup();store.enqueue('ERROR',{},identity,channel);
    const key='cnc-sim-reliable-v1',raw=JSON.parse(storage.data.get(key)!);
    raw.runs[0].events[0].acknowledgedAt=null;storage.data.set(key,JSON.stringify(raw));
    expect(()=>new ReliableEventStore({storage})).toThrow(/persist/i);
  });
});

describe('嵌入适配层持久化与恢复查询',()=>{
  afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
  function browser(storage:MemoryStorage) {
    const listeners=new Set<(event:MessageEvent)=>Promise<void>>();const sent:Envelope[]=[];
    const parent={postMessage:(message:Envelope,target:string)=>{expect(target).toBe(channel.origin);sent.push(message);}};
    vi.stubGlobal('window',{location:{origin:channel.origin,pathname:'/cnc/'},parent,localStorage:storage,addEventListener:(_type:string,listener:(event:MessageEvent)=>Promise<void>)=>listeners.add(listener),removeEventListener:(_type:string,listener:(event:MessageEvent)=>Promise<void>)=>listeners.delete(listener)});
    const receive=async(type:string,options:Partial<Envelope>={})=>{
      const data={protocol:'cnc-sim',version:'1.0',type,messageId:crypto.randomUUID(),...channel,...identity,payload:{},...options};
      for(const listener of listeners)await listener({data,origin:channel.origin,source:parent} as unknown as MessageEvent);
    };
    return {sent,receive,listeners};
  }
  it('真实适配层重传同信封，RESET后原身份ACK停止旧事件重发',async()=>{
    vi.useFakeTimers();
    const storage=new MemoryStorage(),page=browser(storage);let current={...identity};
    const embed=attachEmbed(async()=>({type:'STATE',payload:{}}),()=>current,{storage,key:'embed-test'});
    await page.receive('HELLO');
    const payload=embed.emit('COLLISION',{physicalLine:11});
    const event=page.sent.find(m=>m.type==='COLLISION')!;
    expect(payload.eventId).toBe(event.payload.eventId);
    await vi.advanceTimersByTimeAsync(1100);
    expect(page.sent.filter(m=>m.type==='COLLISION')).toEqual([event,event]);
    current={...identity,runId:'run-2'};
    await page.receive('EVENT_ACK',{payload:{eventId:payload.eventId}});
    await vi.advanceTimersByTimeAsync(1100);
    expect(page.sent.filter(m=>m.type==='COLLISION')).toHaveLength(2);
    embed.dispose();expect(page.listeners.size).toBe(0);
  });
  it('持久化故障显式标记不可可靠交付并发送错误通知',async()=>{
    const storage=new MemoryStorage(),page=browser(storage);
    const embed=attachEmbed(async()=>({type:'STATE',payload:{}}),()=>identity,{storage,key:'embed-test'});
    await page.receive('HELLO');storage.fail=true;
    const payload=embed.emit('COLLISION',{physicalLine:12});
    expect(payload.delivery).toMatchObject({durable:false,errorCode:'EVENT_PERSISTENCE_FAILED'});
    expect(embed.persistenceError).toBeTruthy();
    expect(page.sent.find(m=>m.type==='COLLISION')?.payload.delivery).toMatchObject({durable:false});
    expect(page.sent.find(m=>m.type==='ERROR')?.payload.code).toBe('EVENT_PERSISTENCE_FAILED');
    embed.dispose();
  });
  it('重载后可查询interrupted历史及原eventId，不调用不存在的内核运行',async()=>{
    const storage=new MemoryStorage();let page=browser(storage);
    let embed=attachEmbed(async()=>({type:'STATE',payload:{}}),()=>identity,{storage,key:'embed-test'});
    await page.receive('HELLO');embed.markState('RUNNING');const event=embed.emit('TOOL_CHANGE',{toolNumber:2});embed.dispose();
    page=browser(storage);
    embed=attachEmbed(async()=>{throw new Error('no simulation after reload');},()=>null,{storage,key:'embed-test'});
    await page.receive('HELLO',{channelId:'new-channel'});
    await page.receive('GET_REPORT',{channelId:'new-channel'});
    const reply=page.sent.find(m=>m.type==='REPORT');
    expect(reply?.payload.reliableRun).toMatchObject({state:'interrupted',interrupted:true});
    expect(embed.report(identity)?.events[0]?.envelope.payload.eventId).toBe(event.eventId);
    expect(page.sent.filter(m=>m.type==='TOOL_CHANGE')).toEqual([]);
    embed.dispose();
  });
  it('ACK持久化故障向宿主报错并保留可重发事件',async()=>{
    vi.useFakeTimers();const storage=new MemoryStorage(),page=browser(storage);
    const embed=attachEmbed(async()=>({type:'STATE',payload:{}}),()=>identity,{storage,key:'embed-test'});
    await page.receive('HELLO');const event=embed.emit('COLLISION',{physicalLine:12});
    storage.fail=true;await page.receive('EVENT_ACK',{payload:{eventId:event.eventId}});
    expect(page.sent.at(-1)?.type).toBe('COMMAND_ERROR');
    expect(embed.persistenceError).toBeTruthy();
    storage.fail=false;await vi.advanceTimersByTimeAsync(1100);
    expect(page.sent.filter(m=>m.type==='COLLISION')).toHaveLength(2);
    embed.dispose();
  });
});
