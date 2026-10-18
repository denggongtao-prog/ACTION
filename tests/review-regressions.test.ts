import { describe,it,expect } from 'vitest';
import { Playback } from '../src/core/playback';
import { validateJob } from '../src/core/job';
import { scenarioJob } from '../src/lib/scenarios';
describe('独立审阅回归',()=>{
  it('圆弧半径不一致不能形成未覆盖端点跳变',()=>{
    const raw=scenarioJob('rapid');raw.initialPositionMm=[100,0,10];
    raw.stock={objectId:'s',kind:'box',minCornerInW:[100.06,-.05,10],sizeMm:[.1,.1,.1]};
    raw.tools=[{...raw.tools[0],diameterMm:.1,cuttingLengthMm:.1,gaugeLengthMm:.1,shaftDiameterMm:.1,holder:{diameterMm:.1,lengthMm:.1}}];
    raw.simulation!.stockCellMm=.1;raw.program={programId:'arc-jump',text:'G3 X100.019 Y0.001 I-100 J0 F100\nM30'};
    const p=new Playback();expect(()=>p.load(validateJob(raw))).toThrow(/半径/);expect(p.snapshot().verification).not.toBe('fully_checked');
  });
  it('弦线逼近不能从保守毛坯删除真实弧线未覆盖的内弯残料',()=>{
    const raw=scenarioJob('rapid');
    raw.initialPositionMm=[7.415636913464779*1.1,6.708824723277438*1.1,0];
    raw.stock={objectId:'s',kind:'box',minCornerInW:[6.3551947478626785,6.3551947478626785,0],sizeMm:[.1,.1,1]};
    raw.tools=[{...raw.tools[0],diameterMm:2,cuttingLengthMm:2,gaugeLengthMm:3,shaftDiameterMm:.1,holder:{diameterMm:.1,lengthMm:.1}}];
    raw.simulation!.stockCellMm=.1;raw.simulation!.arcChordToleranceMm=.02;
    raw.program={programId:'arc-stock',text:'M3 S1000\nG1 X7.415636913464779 Y6.708824723277438 F100\nG3 X6.708824723277438 Y7.415636913464777 I-7.415636913464779 J-6.708824723277438 F100\nM5\nG0 X6.356194747862678 Y6.356194747862678\nM30'};
    const p=new Playback();p.load(validateJob(raw));p.start();p.advance(10000);
    expect(p.snapshot().state).toBe('PAUSED_COLLISION');expect(p.snapshot().incident?.collisionType).toBe('RAPID_STOCK');expect(p.snapshot().incident?.source.physicalLine).toBe(5);
  });
  it.each(['advance','step'])('无运动程序%s仍检查初始停转刀具与毛坯',method=>{
    const raw=scenarioJob('normal');raw.initialPositionMm=[0,0,-10];raw.program={programId:'initial',text:';comment\n\nN42 G4 P1\nM30'};
    const p=new Playback();p.load(validateJob(raw));if(method==='step')p.step();else{p.start();p.advance(2000);}
    expect(p.snapshot().state).toBe('PAUSED_COLLISION');expect(p.snapshot().incident?.collisionType).toBe('SPINDLE_STOCK');expect(p.snapshot().incident?.source.physicalLine).toBe(3);
  });
  it('无运动程序仍检查初始轴超限，LIMIT无伪接触点',()=>{
    const raw=scenarioJob('limit');raw.initialPositionMm=[20,0,5];raw.program={programId:'initial-limit',text:'G4 P1\nM30'};
    const p=new Playback();p.load(validateJob(raw));p.start();p.advance(2000);
    expect(p.snapshot().state).toBe('PAUSED_COLLISION');expect(p.snapshot().incident?.type).toBe('LIMIT');expect(p.snapshot().incident?.contact).toBeNull();
  });
  it('配置换刀保留覆盖类型和装夹阶段用于上位机回传',()=>{
    const raw=scenarioJob('toolchange');raw.assets=[];
    const p=new Playback();p.load(validateJob(raw));p.start();p.advance(10000);
    expect(p.snapshot().state).toBe('COMPLETED');expect(p.snapshot().events[0]).toMatchObject({capability:'configured_tool_change',contactStage:'clamp_new'});
  });
});
