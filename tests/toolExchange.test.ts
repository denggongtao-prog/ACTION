import {describe,it,expect} from 'vitest';
import {Playback} from '../src/core/playback';
import {validateJob} from '../src/core/job';
import {demoJob} from '../src/lib/demo';
import {exchangePhase,exchangePose,toolMagazineLayout} from '../src/core/toolExchange';
function job(text='T2 M6\nM3 S1000\nM30'){const j=demoJob();j.program={programId:'exchange',text};return validateJob(j);}
describe('受仿真时间控制的换刀动画',()=>{
  it('M6有可见时长，夹紧完成前不切换实际刀具或发送换刀完成',()=>{
    const p=new Playback();p.load(job());p.start();p.advance(1000);
    expect(p.snapshot().state).toBe('TOOL_CHANGING');expect(p.snapshot().activeTool).toBe(1);expect(p.snapshot().events).toHaveLength(0);
    expect(p.snapshot().toolExchange).toMatchObject({fromTool:1,toTool:2,phase:'remove_old',progress:.25,source:{physicalLine:1}});
    p.advance(3000);expect(p.snapshot().activeTool).toBe(2);expect(p.snapshot().events).toHaveLength(1);expect(p.snapshot().state).toBe('COMPLETED');
  });
  it('暂停冻结全部换刀阶段，恢复后延续进度，重置清空动画',()=>{
    const p=new Playback();p.load(job());p.start();p.advance(1800);p.pause();const frame=p.snapshot().toolExchange;
    p.advance(10000);expect(p.snapshot().toolExchange).toEqual(frame);p.resume();expect(p.snapshot().state).toBe('TOOL_CHANGING');
    p.advance(200);expect(p.snapshot().toolExchange!.progress).toBe(.5);p.reset();expect(p.snapshot().toolExchange).toBeUndefined();expect(p.snapshot().activeTool).toBe(1);
  });
  it('预选和重复同刀M6不产生虚假交换，源行单步完成一整个换刀周期',()=>{
    const p=new Playback();p.load(job('T2\nM6\nT2 M6\nM30'));p.step();expect(p.snapshot().toolExchange).toBeUndefined();expect(p.snapshot().activeTool).toBe(1);
    p.step();expect(p.snapshot().activeTool).toBe(2);expect(p.snapshot().elapsedMs).toBe(4000);expect(p.snapshot().events).toHaveLength(1);
    p.step();expect(p.snapshot().elapsedMs).toBe(4000);expect(p.snapshot().toolExchange).toBeUndefined();
  });
  it('倍率只加速动画时间，不改变换刀次数和去除材料',()=>{
    const p=new Playback();p.load(job('T2 M6\nT1 M6\nM30'));p.setSpeed(20);p.start();p.advance(400);
    expect(p.snapshot().state).toBe('COMPLETED');expect(p.snapshot().events.map(e=>e.toolNumber)).toEqual([2,1]);expect(p.snapshot().stock!.removedVolumeMm3).toBe(0);
  });
  it('动画中暂停后单步只完成当前源块，换刀事件不重复',()=>{
    const p=new Playback();p.load(job('T2 M6\nM30'));p.start();p.advance(1200);p.pause();p.step();
    expect(p.snapshot().activeTool).toBe(2);expect(p.snapshot().elapsedMs).toBe(4000);expect(p.snapshot().events).toHaveLength(1);expect(p.snapshot().toolExchange).toBeUndefined();
    p.step();expect(p.snapshot().state).toBe('COMPLETED');expect(p.snapshot().events).toHaveLength(0);
  });
  it('动画结束仍执行新刀装夹碰撞检查，碰撞锁定源行而非发送完成',()=>{
    const raw=job('N700 T2 M6\nM30');raw.tools[1].gaugeLengthMm=100;
    const p=new Playback();p.load(raw);p.start();p.advance(3900);expect(p.snapshot().activeTool).toBe(1);p.advance(100);
    expect(p.snapshot().state).toBe('PAUSED_COLLISION');expect(p.snapshot().incident?.contactStage).toBe('clamp_new');expect(p.snapshot().incident?.source.blockNumber).toBe(700);
    expect(p.snapshot().toolExchange).toBeUndefined();expect(p.snapshot().events).toHaveLength(0);expect(()=>p.resume()).toThrow();
  });
  it('阶段与机械示意姿态由固定进度唯一确定，暂停无需额外计时器',()=>{
    expect(exchangePhase(.1).phase).toBe('release');expect(exchangePhase(.5).phase).toBe('index_magazine');expect(exchangePhase(.95).phase).toBe('clamp');
    const frame={progress:0,fromTool:1,toTool:2,oldTip:{x:0,y:0,z:30},newTip:{x:0,y:0,z:40}};
    const [old,next]=demoJob().tools;next.gaugeLengthMm=40;const layout=toolMagazineLayout([old,next]);const a=exchangePose(frame,old,next,layout);expect(a.oldTip).toEqual(frame.oldTip);expect(a.newTip.x).toBeGreaterThan(60);
    const b=exchangePose({...frame,progress:1},old,next,layout);expect(b.newTip).toEqual(frame.newTip);expect(b.oldTip.x).toBeGreaterThan(60);expect(b.spindleLiftMm).toBe(0);
  });
});
