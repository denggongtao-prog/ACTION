import { it,expect } from 'vitest';
import { Playback } from '../src/core/playback';
import { scenarioJob } from '../src/lib/scenarios';
import { validateJob } from '../src/core/job';
it('配置换刀中能够暂停并恢复同一子阶段，不重复装夹',()=>{
  const raw=scenarioJob('toolchange');raw.assets=[];
  const p=new Playback();p.load(validateJob(raw));p.start();p.advance(20);
  expect(p.snapshot().state).toBe('TOOL_CHANGING');expect(p.snapshot().toolChangeStage).toBe('move_to_change');
  p.pause();const position=p.snapshot().position;p.advance(1000);expect(p.snapshot().position).toEqual(position);
  p.resume();expect(p.snapshot().state).toBe('TOOL_CHANGING');p.advance(10000);
  expect(p.snapshot().state).toBe('COMPLETED');expect(p.snapshot().events).toHaveLength(1);expect(p.snapshot().activeTool).toBe(2);
});
it('软限位上的终点合法，真正越界才停止',()=>{
  const raw=scenarioJob('limit');raw.program.text=raw.program.text.replace('X15','X10');
  const p=new Playback();p.load(validateJob(raw));p.start();p.advance(10000);
  expect(p.snapshot().state).toBe('COMPLETED');expect(p.snapshot().verification).toBe('fully_checked');
});
it('斜线同时到达两轴限位不会误报未确定',()=>{
  const raw=scenarioJob('limit');raw.program.text='G1 X10 Y10 F300\nM30';raw.machineProfile!.axes.y.maxMm=10;
  const p=new Playback();p.load(validateJob(raw));p.start();p.advance(10000);expect(p.snapshot().state).toBe('COMPLETED');
});
it('检查点回看以向前重放恢复材料，与全新运行到同一源行一致',()=>{
  const raw=scenarioJob('normal');raw.program={programId:'checkpoints',text:['M3 S3000','G1 Z-2 F600',...Array.from({length:65},(_,i)=>'G1 X'+(i%2?4:-4)),'M30'].join('\n')};raw.initialPositionMm=[-4,0,5];
  const a=new Playback(),b=new Playback();a.load(validateJob(raw));b.load(validateJob(raw));a.start();a.advance(100000);a.seekLine(56);
  for(let i=0;i<56;i++)b.step();
  expect(a.snapshot().position).toEqual(b.snapshot().position);expect(a.snapshot().stock?.removedVolumeMm3).toBeCloseTo(b.snapshot().stock!.removedVolumeMm3,7);
  expect(a.snapshot().snapshotSeq).toBeGreaterThan(0);expect(a.snapshot().state).toBe('PAUSED');
});
