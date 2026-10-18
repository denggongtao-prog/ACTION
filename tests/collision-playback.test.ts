import { describe,it,expect } from 'vitest';
import { Playback } from '../src/core/playback';
import { validateJob } from '../src/core/job';
import { demoJob } from '../src/lib/demo';
function task(text:string){const j=demoJob();return validateJob({...j,program:{programId:'p',text},initialPositionMm:[-60,0,-2]});}
describe('碰撞停机与快照',()=>{
  it.each([.25,1,20])('倍率%s下快移穿过材料停在首触之前，报告原始行且不能继续',speed=>{
    const p=new Playback();p.load(task('; comment\n\nN350 G0 X60\nM30'));p.setSpeed(speed);p.start();
    for(let i=0;i<1000&&p.snapshot().state==='RUNNING';i++)p.advance(40);
    const snapshot=p.snapshot();expect(snapshot.state).toBe('PAUSED_COLLISION');expect(snapshot.physicalLine).toBe(3);
    expect(snapshot.position.x).toBeLessThanOrEqual(-55);expect(snapshot.position.x).toBeGreaterThan(-55.06);
    expect(snapshot.incident?.collisionType).toBe('RAPID_STOCK');expect(snapshot.incident?.source.blockNumber).toBe(350);
    expect(snapshot.stock?.removedVolumeMm3).toBe(0);expect(()=>p.resume()).toThrow();expect(()=>p.step()).toThrow();
  });
  it('有效双刀程序完成所有检查，重置清除碰撞记录和材料',()=>{
    const p=new Playback();p.load(validateJob(demoJob()));p.start();p.advance(100000);
    expect(p.snapshot().state).toBe('COMPLETED');expect(p.snapshot().verification).toBe('fully_checked');
    p.load(task('G0 X60\nM30'));p.step();expect(p.snapshot().incident).toBeTruthy();p.reset();
    expect(p.snapshot().incident).toBeUndefined();expect(p.snapshot().incidents).toEqual([]);
  });
});
