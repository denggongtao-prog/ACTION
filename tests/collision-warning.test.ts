import {describe,it,expect} from 'vitest';
import {Playback} from '../src/core/playback';
import {validateJob} from '../src/core/job';
import {demoJob} from '../src/lib/demo';
import {caseJob} from '../src/lib/caseLibrary';
function job(text='N350 G0 X60\nG1 Y2 F600\nN370 G0 X-60\nM30'){
  const raw=demoJob();return validateJob({...raw,program:{programId:'warn',text},initialPositionMm:[-60,0,-2],simulation:{...raw.simulation,stopOnCollision:false}});
}
describe('碰撞提示独立于动画执行',()=>{
  it('显式false保留检查，旧任务默认暂停，非法参数拒绝',()=>{
    expect(job().simulation?.stopOnCollision).toBe(false);expect(validateJob(demoJob()).simulation?.stopOnCollision).toBe(true);
    expect(()=>validateJob({...demoJob(),simulation:{stopOnCollision:'false'}})).toThrow(/布尔/);
  });
  it.each([.25,1,20])('倍率%s碰撞后完整运动，每动作只报首触，G0不去料',speed=>{
    const p=new Playback();p.load(job());p.setSpeed(speed);p.start();
    for(let k=0;k<5000&&['RUNNING','TOOL_CHANGING'].includes(p.snapshot().state);k++)p.advance(40);
    const s=p.snapshot();expect(s.state).toBe('COMPLETED');expect(s.progress).toBe(1);expect(s.position.x).toBe(-60);
    expect(s.verification).toBe('collision_detected');expect(s.incidents?.map(i=>i.source.physicalLine)).toEqual([1,3]);
    expect(s.incidents?.[0].source.blockNumber).toBe(350);expect(s.stock?.removedVolumeMm3).toBe(0);
  });
  it('初始重叠提示后仍执行，之后有效切削继续去料，重置清空',()=>{
    const raw=job('M3 S3000\nG1 X20 F600\nM30');raw.initialPositionMm=[0,0,-2];
    const p=new Playback();p.load(raw);p.start();p.advance(1e6);
    expect(p.snapshot().state).toBe('COMPLETED');expect(p.snapshot().incidents?.[0].contactStage).toBe('initial_assembly');
    expect(p.snapshot().stock!.removedVolumeMm3).toBeGreaterThan(100);expect(p.snapshot().verification).toBe('collision_detected');
    p.reset();expect(p.snapshot().incidents).toEqual([]);expect(p.snapshot().verification).toBe('in_progress');
  });
  it('夹紧碰撞仍记录原M6并完成后续动作和换刀事件',()=>{
    const raw=job('N700 T2 M6\nM3 S1000\nG1 Z50 F600\nM30');raw.initialPositionMm=[0,0,40];raw.tools[1].gaugeLengthMm=100;
    const p=new Playback();p.load(raw);p.start();p.advance(1e6);const s=p.snapshot();
    expect(s.state).toBe('COMPLETED');expect(s.incidents?.some(i=>i.contactStage==='clamp_new'&&i.source.blockNumber===700)).toBe(true);
    expect(s.events.filter(e=>e.type==='TOOL_CHANGE')).toHaveLength(1);expect(s.activeTool).toBe(2);expect(s.position.z).toBe(50);
  });
  it('暂停冻结提示和进度，源行单步与checkpoint回看保留碰撞前缀',()=>{
    const text=['G0 X60',...Array.from({length:60},(_,i)=>`G1 Y${i+1} F600`),'M30'].join('\n');
    const p=new Playback();p.load(job(text));p.start();p.advance(600);p.pause();const before=p.snapshot();p.advance(1e6);
    expect(p.snapshot().incidents).toEqual(before.incidents);expect(p.snapshot().position).toEqual(before.position);
    p.resume();p.advance(1e6);expect(p.snapshot().state).toBe('COMPLETED');expect(p.snapshot().incidents).toHaveLength(1);
    const oldEventId=p.snapshot().incidents![0].eventId;
    p.seekLine(55);expect(p.snapshot().state).toBe('PAUSED');expect(p.snapshot().incidents).toHaveLength(1);expect(p.snapshot().verification).toBe('collision_detected');
    expect(p.snapshot().incidents![0].eventId).not.toBe(oldEventId);
    p.step();expect(p.snapshot().incidents).toHaveLength(1);
  });
  it('O0008继续经过第95行，结束时仍能定位N910及原文件摘要',()=>{
    const raw=caseJob('O0008','http://localhost/');raw.simulation={...raw.simulation!,stopOnCollision:false};
    const p=new Playback();p.load(validateJob(raw));p.start();p.advance(1e9);const s=p.snapshot();
    expect(s.state).toBe('COMPLETED');expect(s.verification).toBe('collision_detected');expect(s.progress).toBe(1);
    const hit=s.incidents?.find(i=>i.source.physicalLine===95);expect(hit?.source.blockNumber).toBe(910);expect(hit?.source.programSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('同段已提示碰撞后，后续软限位仍会停止而不伪造完成',()=>{
    const raw=job('N10 G0 X60\nM30');
    raw.machineProfile={axes:{x:{direction:1,carrier:'tool',zeroMm:0,minMm:-100,maxMm:0},y:{direction:1,carrier:'tool',zeroMm:0,minMm:-100,maxMm:100},z:{direction:1,carrier:'tool',zeroMm:0,minMm:-200,maxMm:200}},rapidRateMmMin:6000,rapidMode:'linear'};
    const p=new Playback();p.load(raw);p.start();p.advance(1e6);
    expect(p.snapshot().state).toBe('PAUSED_COLLISION');expect(p.snapshot().incident?.type).toBe('LIMIT');expect(p.snapshot().incidents?.map(i=>i.type)).toEqual(['COLLISION','LIMIT']);
  });
  it('提示模式遇到无法确定的查询仍停止，不当作碰撞忽略',()=>{
    const raw=job('G1 X10 F600\nM30');raw.initialPositionMm=[-10,0,5];raw.simulation!.maxCollisionQueries=100;
    raw.preparedMeshes=[{objectId:'complex-fixture',role:'fixture',closed:false,triangles:new Float64Array(Array.from({length:200},()=>[0,-10,0,0,10,0,0,0,20]).flat()),bounds:{min:[0,-10,0],max:[0,10,20]},sha256:'test'}];
    const p=new Playback();p.load(raw);p.start();p.advance(1e6);expect(p.snapshot().state).toBe('INDETERMINATE');expect(p.snapshot().verification).toBe('indeterminate');
  });
  it('已检测碰撞之后材料计算失败，错误快照仍保留本动作的碰撞',()=>{
    const raw=job('M3 S1000\nG1 X2 Z-1 F600\nM30');raw.initialPositionMm=[0,0,-2];
    raw.tools[0]={...raw.tools[0],type:'profile_endmill',cuttingLengthMm:1,radialProfile:[{radiusMm:0,zMm:0},{radiusMm:5,zMm:1}]};
    const p=new Playback();p.load(raw);p.start();expect(()=>p.advance(1e6)).toThrow();
    expect(p.snapshot().state).toBe('ERROR');expect(p.snapshot().verification).toBe('indeterminate');
    expect(p.snapshot().incidents?.map(i=>i.source.physicalLine)).toEqual([1,2]);
  });
});
