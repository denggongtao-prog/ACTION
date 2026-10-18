import {it,expect} from 'vitest';
import {caseOptions,caseDefinition,caseJob} from '../src/lib/caseLibrary';
import {validateJob} from '../src/core/job';
import {parseProgram,pointAt} from '../src/core/gcode';
import {Playback} from '../src/core/playback';
it('九个原案例提供真实原程序、图纸、配置与来源，不替换为示例',()=>{
  expect(caseOptions.map(c=>c.id)).toEqual(['O0001','O0008','O0020','O0021','O0022','O0023','O0025','O0314','O0315']);
  for(const item of caseOptions){const job=validateJob(caseJob(item.id,'http://localhost/')),definition=caseDefinition(item.id);
    expect(job.program.text).toMatch(new RegExp('^'+item.id));expect(definition.documents.length).toBeGreaterThan(0);expect(definition.assumptions.length).toBeGreaterThan(0);
    const instructions=parseProgram(job.program.text,job.tools,{x:job.initialPositionMm[0],y:job.initialPositionMm[1],z:job.initialPositionMm[2]},job);
    expect(instructions.length).toBeGreaterThan(5);
    for(const i of instructions){expect(i.source.sourceText).toBe(job.program.text.split(/\r\n|\n|\r/)[i.source.physicalLine-1]);if(i.kind==='motion'&&i.arc){const near=pointAt(i,1-1e-9);expect(Math.hypot(near.x-i.to.x,near.y-i.to.y)).toBeLessThan(1e-5);}}
    expect(job.simulation!.checkCollisions).toBe(true);
  }
});
it('侧孔、成形刀、补偿冲突及非居中原点有明确任务参数',()=>{
  expect(caseJob('O0001','http://localhost/').tools.find(t=>t.toolNumber===7)?.axisDirection).toEqual({x:0,y:-1,z:0});
  expect(caseJob('O0008','http://localhost/').tools.find(t=>t.toolNumber===3)?.type).toBe('profile_endmill');
  expect(caseJob('O0314','http://localhost/').stock.minCornerInW).toEqual([55,10,-25]);
  expect(caseDefinition('O0315').assumptions.join(' ')).toContain('D1');
});
it.each([
  ['O0001','COMPLETED',null],['O0008','PAUSED_COLLISION',95],['O0020','PAUSED_COLLISION',20],
  ['O0021','PAUSED_COLLISION',6],['O0022','COMPLETED',null],['O0023','COMPLETED',null],
  ['O0025','COMPLETED',null],['O0314','COMPLETED',null],['O0315','PAUSED_COLLISION',15],
] as const)('实际原程序%s执行到预期%s，风险不靠关闭检查消除',(id,state,line)=>{
  const raw=caseJob(id,'http://localhost/');raw.simulation!.stopOnCollision=true;
  const p=new Playback();p.load(validateJob(raw));p.start();p.advance(1e9);
  expect(p.snapshot().state).toBe(state);if(line)expect(p.snapshot().incident?.source.physicalLine).toBe(line);else expect(p.snapshot().verification).toBe('fully_checked');
  if(id==='O0001'){const drills=p.instructions.filter(i=>i.kind==='motion').filter(i=>i.contactStage==='cycle_drill');expect(drills.map(i=>i.to)).toEqual([108,236,364,492].map(x=>({x,y:33,z:15})));}
  if(id==='O0022')expect(p.instructions.filter(i=>i.kind==='motion').filter(i=>i.contactStage==='cycle_drill')).toHaveLength(8);
});
it.each(caseOptions.map(c=>c.id))('案例%s默认完整动画，原碰撞作为提示保留',id=>{
  const raw=caseJob(id,'http://localhost/');expect(raw.simulation?.stopOnCollision).toBe(false);
  const p=new Playback();p.load(validateJob(raw));p.start();p.advance(1e9);
  expect(p.snapshot().state).toBe('COMPLETED');expect(p.snapshot().progress).toBe(1);
  if(['O0008','O0020','O0021','O0315'].includes(id))expect(p.snapshot().verification).toBe('collision_detected');
});
