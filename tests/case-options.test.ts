import {it,expect} from 'vitest';
import {validateJob} from '../src/core/job';
import {demoJob} from '../src/lib/demo';
import {parseProgram} from '../src/core/gcode';
it('木工相对H表、独立D半径表和侧头方向必须完整保留',()=>{
  const raw=demoJob();raw.toolLengthOffsetsMm={'1':0,'2':35,'3':-25};raw.toolLengthReferenceMm=100;raw.cutterRadiusOffsetsMm={'1':3,'3':10};raw.tools[0].axisDirection={x:0,y:-1,z:0};
  const job=validateJob(raw);expect(job.toolLengthOffsetsMm?.['3']).toBe(-25);expect(job.toolLengthReferenceMm).toBe(100);expect(job.cutterRadiusOffsetsMm?.['3']).toBe(10);expect(job.tools[0].axisDirection).toEqual({x:0,y:-1,z:0});
});
it('禁止把D直径或任意倾斜侧头当作受支持刀形',()=>{
  const raw=demoJob();raw.cutterRadiusOffsetsMm={'1':-1};expect(()=>validateJob(raw)).toThrow();
  delete raw.cutterRadiusOffsetsMm;raw.tools[0].axisDirection={x:1,y:0,z:1};expect(()=>validateJob(raw)).toThrow(/方向/);
});
it('成形刀显式剖面保留，缺失/非单调/与包络不一致的剖面拒绝',()=>{
  const raw=demoJob();raw.tools=[{...raw.tools[0],type:'profile_endmill',diameterMm:20,cuttingLengthMm:20,radialProfile:[{zMm:0,radiusMm:2},{zMm:10,radiusMm:10},{zMm:20,radiusMm:10}]}];
  expect(validateJob(raw).tools[0].radialProfile).toEqual(raw.tools[0].radialProfile);
  const absent=structuredClone(raw);delete absent.tools[0].radialProfile;expect(()=>validateJob(absent)).toThrow(/剖面/);
  raw.tools[0].radialProfile![1].radiusMm=1;expect(()=>validateJob(raw)).toThrow(/剖面/);
});
it('G92源行运动携带实际工作原点平移，碰撞工件点才能反算原程序读数',()=>{
  const instructions=parseProgram('G92 X300 Y220 Z60\nG1 X160 Y120 F100',demoJob().tools,{x:300,y:135,z:60});
  const motion=instructions.find(i=>i.kind==='motion')!;
  expect(motion.workOffsetMm).toEqual({x:0,y:-85,z:0});expect(motion.to.y-motion.workOffsetMm!.y).toBe(120);
});
