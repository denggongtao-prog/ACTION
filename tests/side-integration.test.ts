import {it,expect} from 'vitest';
import {demoJob} from '../src/lib/demo';
import {Playback} from '../src/core/playback';
import {validateJob} from '../src/core/job';
function job(text:string){const raw=demoJob();raw.tools=[{...raw.tools[0],type:'drill',diameterMm:4,cuttingLengthMm:30,gaugeLengthMm:40,shaftDiameterMm:4,holder:{diameterMm:8,lengthMm:10},axisDirection:{x:0,y:-1,z:0}}];raw.stock={objectId:'s',kind:'box',minCornerInW:[0,0,0],sizeMm:[20,20,20]};raw.initialPositionMm=[10,-10,10];raw.program={programId:'side',text};return validateJob(raw);}
it('侧头真实Y钻后沿原路退出，不将保守单元余量误当新碰撞',()=>{
  const p=new Playback();p.load(job('M3 S1000\nG1 Y10 F600\nG0 Y-10\nM30'));p.start();p.advance(100000);
  expect(p.snapshot().state).toBe('COMPLETED');expect(p.snapshot().stock!.removedVolumeMm3).toBeGreaterThan(70);
});
it('侧头快速插入按Y方向实际刀形检查，保留源行',()=>{
  const p=new Playback();p.load(job('G0 Y10\nM30'));p.start();p.advance(100000);
  expect(p.snapshot().state).toBe('PAUSED_COLLISION');expect(p.snapshot().incident?.collisionType).toBe('RAPID_STOCK');
  expect(p.snapshot().incident?.source.physicalLine).toBe(1);expect(p.snapshot().position.y).toBeLessThanOrEqual(.001);
});
it('钻孔子动作保持加工状态，不能冒充自动换刀',()=>{
  const raw=demoJob();raw.program={programId:'cycle-stage',text:'M3 S1000\nG81 X80 Y0 Z10 R20 F100\nG80\nM30'};
  const p=new Playback();p.load(validateJob(raw));p.start();p.advance(20);expect(p.snapshot().state).toBe('RUNNING');
  p.pause();p.resume();expect(p.snapshot().state).toBe('RUNNING');expect(p.snapshot().toolChangeStage).toBeUndefined();
});
