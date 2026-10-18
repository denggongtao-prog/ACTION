import { it,expect } from 'vitest';
import { validateJob } from '../src/core/job';
import { demoJob } from '../src/lib/demo';
import { Playback } from '../src/core/playback';
it('规范化完整任务坐标、H表和碰撞参数，拒绝未知配置',()=>{
  const raw={...demoJob(),dialectId:'milling-basic-v1',workOffsetsMm:{G54:[100,200,300]},toolLengthOffsetsMm:{1:50},simulation:{stockCellMm:.5,arcChordToleranceMm:.02,mode:'cut',checkCollisions:true,contactLocalizationMm:.025}};
  const task=validateJob(raw);
  expect(task.workOffsetsMm?.G54).toEqual({x:100,y:200,z:300});
  expect(task.toolLengthOffsetsMm?.['1']).toBe(50);
  expect(task.simulation?.checkCollisions).toBe(true);
  expect(task.program.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(()=>validateJob({...raw,toolLengthOffsetsMm:{'1.2':20}})).toThrow();
  expect(validateJob({...raw,simulation:{...raw.simulation,stopOnCollision:false}}).simulation?.stopOnCollision).toBe(false);
});
it('初始轴位置任务规范化后可以再次下发，刀尖与轴坐标保持一致',()=>{
  const raw:any={...demoJob(),machineProfileId:'vmc-xyz-demo-v1',initialAxisPositionMm:[10,20,80]};delete raw.initialPositionMm;
  const normalized=validateJob(raw);
  expect(normalized.initialPositionMm).toEqual([10,20,30]);expect(()=>validateJob(normalized)).not.toThrow();
  const other=validateJob({...raw,initialAxisPositionMm:[10,20,90]});
  expect(other.initialPositionMm).toEqual([10,20,40]);expect(()=>validateJob(other)).not.toThrow();
  const playback=new Playback();expect(()=>playback.load(other)).not.toThrow();expect(playback.snapshot().position).toEqual({x:10,y:20,z:40});
  expect(()=>validateJob({...raw,initialPositionMm:[0,0,0]})).toThrow();
});
it('命名演示机床配置可以解析，未知配置不能被静默忽略',()=>{
  const raw={...demoJob(),machineProfileId:'vmc-xyz-demo-v1'};
  expect(validateJob(raw).machineProfile?.axes.x.carrier).toBe('table');
  expect(()=>validateJob({...raw,machineProfileId:'missing-profile'})).toThrow();
});
