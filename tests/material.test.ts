import { describe,it,expect } from 'vitest';
import { Playback } from '../src/core/playback';
import { validateJob } from '../src/core/job';
function job(text:string,mode='cut'){
  return validateJob({program:{programId:'p',text},stock:{objectId:'s',kind:'box',sizeMm:[20,20,10],minCornerInW:[-10,-10,-10]},initialPositionMm:[-5,0,5],tools:[{toolId:'t',toolNumber:1,type:'flat_endmill',diameterMm:4,cuttingLengthMm:20,gaugeLengthMm:40,shaftDiameterMm:4,holder:{diameterMm:20,lengthMm:20}}],simulation:{stockCellMm:.5,arcChordToleranceMm:.02,mode,checkCollisions:false}});
}
describe('加工与回放集成',()=>{
  const program='M3 S3000\nG0 X-5 Y0 Z-2\nG1 X5 F600\nM30';
  it('进给切削统计增长，暂停不变，重置恢复完整毛坯',()=>{
    const p=new Playback();p.load(job(program));expect(p.snapshot().stock?.removedVolumeMm3).toBe(0);
    p.start();p.advance(600);const removed=p.snapshot().stock!.removedVolumeMm3;
    expect(removed).toBeGreaterThan(20);p.pause();p.advance(10000);
    expect(p.snapshot().stock!.removedVolumeMm3).toBe(removed);
    p.reset();expect(p.snapshot().stock!.removedVolumeMm3).toBe(0);
    expect(p.takeStockUpdate()?.full).toBe(true);
  });
  it.each(['dry_run','spindle_off','wrong_direction','zero_rpm','rapid'])('%s不删除材料',scenario=>{
    const text=scenario==='spindle_off'?'G1 Z-3 F600\nG1 X5\nM30':scenario==='wrong_direction'?program.replace('M3','M4'):scenario==='zero_rpm'?program.replace('S3000','S0'):scenario==='rapid'?program.replace('G1 X5','G0 X5'):program;
    const p=new Playback();p.load(job(text,scenario==='dry_run'?'dry_run':'cut'));p.start();p.advance(10000);
    expect(p.snapshot().stock!.removedVolumeMm3).toBe(0);
    expect(p.snapshot().verification).toBe('not_checked');
  });
  it('倍率与源行单步不改变材料结果',()=>{
    const a=new Playback(),b=new Playback(),c=new Playback();
    for(const p of [a,b,c])p.load(job(program));
    a.start();for(let i=0;i<200;i++)a.advance(10);
    b.setSpeed(20);b.start();b.advance(100);
    while(c.snapshot().state!=='COMPLETED')c.step();
    expect(a.snapshot().stock!.removedVolumeMm3).toBeCloseTo(b.snapshot().stock!.removedVolumeMm3,7);
    expect(c.snapshot().stock!.removedVolumeMm3).toBeCloseTo(b.snapshot().stock!.removedVolumeMm3,7);
  });
  it('圆弧在分帧和整段执行时应用同一条折线',()=>{
    const text='M3 S3000\nG0 X-5 Y0 Z-2\nG3 X5 Y0 I5 J0 F600\nM30';
    const a=new Playback(),b=new Playback();a.load(job(text));b.load(job(text));
    a.start();b.start();a.advance(10000);for(let i=0;i<1000;i++)b.advance(10);
    expect(a.snapshot().stock!.removedVolumeMm3).toBeGreaterThan(100);
    expect(b.snapshot().stock!.removedVolumeMm3).toBeCloseTo(a.snapshot().stock!.removedVolumeMm3,6);
  });
  it('材料更新按需产生，状态查询不重复发送整块',()=>{
    const p=new Playback();p.load(job(program));
    expect(p.takeStockUpdate()?.tiles.length).toBeGreaterThan(0);expect(p.takeStockUpdate()).toBeNull();
    p.start();p.advance(600);expect(p.takeStockUpdate()?.tiles.length).toBeGreaterThan(0);expect(p.takeStockUpdate()).toBeNull();
  });
  it.each(['step','advance'])('%s遇到材料区间预算错误锁定ERROR并保留源行',method=>{
    const text=['M3 S1000',...Array.from({length:33},(_,i)=>`G0 Z${.2+i*.2}\nG1 X0 F600`),'M30'].join('\n');
    const task=job(text);
    task.stock={objectId:'s',kind:'box',sizeMm:[1,1,10],minCornerInW:[-.5,-.5,0]};
    task.initialPositionMm=[0,0,9];task.tools[0].cuttingLengthMm=.1;
    const p=new Playback();p.load(task);
    let failure:unknown;
    try{
      if(method==='advance'){p.start();p.advance(100000);}
      else while(p.snapshot().state!=='COMPLETED')p.step();
    }catch(e){failure=e;}
    expect(failure).toMatchObject({code:'STOCK_BUDGET',physicalLine:65});
    expect(p.snapshot().state).toBe('ERROR');
    expect(p.snapshot().physicalLine).toBe(65);
    expect(()=>p.step()).toThrow();expect(()=>p.start()).toThrow();
    expect(p.advance(100000).state).toBe('ERROR');
  });
});

