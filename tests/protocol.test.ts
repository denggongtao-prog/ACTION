import { describe, expect, it } from 'vitest';
import { ProtocolSession } from '../src/core/protocol';
import {version as engineVersion} from '../package.json';
const origin = 'https://teaching.example.edu';
const envelope = (type:string, messageId='m1') => ({ protocol:'cnc-sim', version:'1.0', type, messageId, channelId:'test-channel', jobId:'j1', revision:1, runId:'r1', payload:{} });
describe('iframe协议', () => {
  it('握手报告当前软件版本',async()=>{
    const session=new ProtocolSession([origin],async()=>({type:'STATE',payload:{}}));
    expect((await session.receive(envelope('HELLO'),origin,true))?.payload.engineVersion).toBe(engineVersion);
  });
  it('未授权来源或非父窗口不建立会话', async () => {
    let called=0; const s=new ProtocolSession([origin], async()=>{called++;return {type:'STATE',payload:{}}});
    expect(await s.receive(envelope('HELLO'), 'https://bad.example', true)).toBeUndefined();
    expect(await s.receive(envelope('HELLO'), origin, false)).toBeUndefined();
    expect(called).toBe(0);
  });
  it('握手后重复命令只执行一次，相同ID不同内容报冲突', async () => {
    let called=0; const s=new ProtocolSession([origin], async()=>{called++;return {type:'STATE',payload:{}}});
    await s.receive(envelope('HELLO'),origin,true);
    const a=await s.receive(envelope('GET_STATE','m2'),origin,true);
    const b=await s.receive(envelope('GET_STATE','m2'),origin,true);
    expect(a).toEqual(b); expect(called).toBe(1);
    const conflict=await s.receive(envelope('GET_REPORT','m2'),origin,true);
    expect(conflict?.type).toBe('COMMAND_ERROR');
  });
  it('没有握手时不执行控制命令', async () => {
    const s=new ProtocolSession([origin], async()=>{throw new Error('must not run')});
    expect(await s.receive(envelope('START'),origin,true)).toBeUndefined();
  });
  it('旧runId不能控制当前任务', async () => {
    const s=new ProtocolSession([origin],async()=>({type:'STATE',payload:{}}),()=>({jobId:'j1',revision:1,runId:'r2'}));
    await s.receive(envelope('HELLO'),origin,true);
    expect((await s.receive(envelope('START','m2'),origin,true))?.type).toBe('COMMAND_ERROR');
  });
  it('并发到达的控制命令按顺序完成', async () => {
    const order:string[]=[];
    const s=new ProtocolSession([origin],async m=>{ if(m.type==='LOAD_JOB')await new Promise(r=>setTimeout(r,5));order.push(m.type);return {type:'STATE',payload:{}}; });
    await s.receive(envelope('HELLO'),origin,true);
    await Promise.all([s.receive(envelope('LOAD_JOB','a'),origin,true),s.receive(envelope('GET_STATE','b'),origin,true)]);
    expect(order).toEqual(['LOAD_JOB','GET_STATE']);
  });
  it('协议版本和未知指令返回明确错误', async () => {
    const s=new ProtocolSession([origin],async()=>({type:'STATE',payload:{}}));
    await s.receive(envelope('HELLO'),origin,true);
    expect((await s.receive({...envelope('START','a'),version:'9.0'},origin,true))?.type).toBe('COMMAND_ERROR');
    expect((await s.receive(envelope('DELETE_EVERYTHING','b'),origin,true))?.type).toBe('COMMAND_ERROR');
  });
  it.each([{revision:1,runId:'old'},{revision:2,runId:'old'}])('拒绝过期任务载入 %j',async identity=>{
    let called=0;
    const s=new ProtocolSession([origin],async()=>{called++;return {type:'JOB_READY',payload:{}};},()=>({jobId:'j1',revision:2,runId:'new'}));
    await s.receive(envelope('HELLO'),origin,true);
    expect((await s.receive({...envelope('LOAD_JOB','stale'),...identity},origin,true))?.type).toBe('COMMAND_ERROR');
    expect(called).toBe(0);
  });
  it('跨任务切换后迟到的旧任务载入仍被拒绝',async()=>{
    let current:{jobId:string;revision:number;runId:string}|null=null;
    const s=new ProtocolSession([origin],async m=>{current={jobId:m.jobId!,revision:m.revision!,runId:m.runId!};return {type:'JOB_READY',payload:{}};},()=>current);
    await s.receive(envelope('HELLO'),origin,true);
    await s.receive(envelope('LOAD_JOB','a'),origin,true);
    await s.receive({...envelope('LOAD_JOB','b'),jobId:'j2'},origin,true);
    expect((await s.receive({...envelope('LOAD_JOB','c'),runId:'old'},origin,true))?.type).toBe('COMMAND_ERROR');
    expect(current).toMatchObject({jobId:'j2'});
  });
  it('ACK传入执行器，不再吞掉关键事件确认',async()=>{
    const received:string[]=[];
    const s=new ProtocolSession([origin],async m=>{received.push(m.type);return {type:'COMMAND_ACK',payload:{eventId:m.payload.eventId}};});
    await s.receive(envelope('HELLO'),origin,true);
    const reply=await s.receive({...envelope('EVENT_ACK','ack'),payload:{eventId:'event-1'}},origin,true);
    expect(received).toEqual(['EVENT_ACK']);
    expect(reply?.payload.eventId).toBe('event-1');
  });
  it('专用ACK验证器可确认旧运行事件，但旧控制指令仍拒绝',async()=>{
    const received:string[]=[];
    const s=new ProtocolSession([origin],async m=>{received.push(m.type);return {type:'STATE',payload:{}};},()=>({jobId:'j1',revision:1,runId:'r2'}),async m=>m.runId==='r1'&&m.payload.eventId==='event-1');
    await s.receive(envelope('HELLO'),origin,true);
    expect((await s.receive({...envelope('EVENT_ACK','ack'),payload:{eventId:'event-1'}},origin,true))?.type).toBe('COMMAND_ACK');
    expect((await s.receive({...envelope('EVENT_ACK','wrong'),payload:{eventId:'other'}},origin,true))?.type).toBe('COMMAND_ERROR');
    expect((await s.receive(envelope('START','start'),origin,true))?.type).toBe('COMMAND_ERROR');
    expect(received).toEqual([]);
  });
  it('无效HELLO不能绑定通道，事件克隆运行身份与内容',async()=>{
    const current={jobId:'j1',revision:1,runId:'r1'};
    const s=new ProtocolSession([origin],async()=>({type:'STATE',payload:{}}),()=>current);
    expect((await s.receive({...envelope('HELLO'),payload:[]},origin,true))?.type).toBe('COMMAND_ERROR');
    expect(s.event('STATE',{})).toBeNull();
    await s.receive(envelope('HELLO','valid'),origin,true);
    const payload={source:{physicalLine:7}};
    const event=s.event('COLLISION',payload);
    current.runId='r2';payload.source.physicalLine=9;
    expect(event?.runId).toBe('r1');
    expect(event?.payload.source).toEqual({physicalLine:7});
  });
  it('拒绝超安全整数revision和过长运行身份',async()=>{
    let called=0;
    const s=new ProtocolSession([origin],async()=>{called++;return {type:'STATE',payload:{}};});
    await s.receive(envelope('HELLO'),origin,true);
    expect((await s.receive({...envelope('START','revision'),revision:9007199254740992},origin,true))?.type).toBe('COMMAND_ERROR');
    expect((await s.receive({...envelope('START','identity'),runId:'x'.repeat(129)},origin,true))?.type).toBe('COMMAND_ERROR');
    expect(called).toBe(0);
  });
});

