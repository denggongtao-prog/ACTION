import {it,expect} from 'vitest';
import {Playback} from '../src/core/playback';
import {validateJob} from '../src/core/job';
import {demoJob} from '../src/lib/demo';
import {parseProgram} from '../src/core/gcode';
it('G0刀补凸角仍为快速运动，不能变成合法切削并吞掉碰撞材料',()=>{
  const raw=demoJob();raw.initialPositionMm=[-10,0,0];raw.stock={objectId:'s',kind:'box',minCornerInW:[11.35,-1.45,0],sizeMm:[.1,.1,1]};
  raw.tools=[{...raw.tools[0],diameterMm:2,cuttingLengthMm:2,gaugeLengthMm:3,shaftDiameterMm:.1,holder:{diameterMm:.1,lengthMm:1}}];raw.cutterRadiusOffsetsMm={'1':1};raw.simulation!.stockCellMm=.1;
  raw.program={programId:'rapid-comp',text:'M3 S1000\nG42 G0 X10 D1\nY10\nG40 X20\nM30'};
  const p=new Playback();p.load(validateJob(raw));p.start();p.advance(100000);
  expect(p.snapshot().state).toBe('PAUSED_COLLISION');expect(p.snapshot().incident?.collisionType).toBe('RAPID_STOCK');expect(p.snapshot().stock!.removedVolumeMm3).toBe(0);expect(p.snapshot().incident?.source.physicalLine).toBe(3);
});
it('增量循环黏性Z保留相对R的钻深，单独更新R不会静默变浅',()=>{
  const moves=parseProgram('G91 G99 G81 X5 Z-7 R-2\nX5 R-4\nG80',[{toolNumber:1,gaugeLengthMm:50}],{x:0,y:0,z:10}).filter(i=>i.kind==='motion');
  expect(moves.filter(i=>i.contactStage==='cycle_drill').map(i=>[i.from.z,i.to.z])).toEqual([[8,1],[6,-1]]);
});
it.each(['H','frame'])('循环中的%s改变按原始绝对R/Z重新计算物理面，而不是沿用旧轴位置',kind=>{
  const code=kind==='H'?'G43 H1\nG81 X0 Z-5 R2\nG43 H2\nX10':'G54\nG81 X0 Z-5 R2\nG55\nX10';
  const instructions=parseProgram(code,[{toolNumber:1,gaugeLengthMm:50}],{x:0,y:0,z:30},{toolLengthOffsetsMm:{'1':50,'2':60},workOffsetsMm:{G54:{x:0,y:0,z:0},G55:{x:0,y:0,z:10}}});
  const drills=instructions.filter(i=>i.kind==='motion').filter(i=>i.contactStage==='cycle_drill');expect(drills.map(i=>[i.from.z,i.to.z])).toEqual([[2,-5],[12,5]]);
});
