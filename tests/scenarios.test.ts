import { describe, expect, it } from 'vitest';
import { scenarioJob, scenarioOptions } from '../src/lib/scenarios';
import { validateJob } from '../src/core/job';
import { Playback } from '../src/core/playback';
import { disposeObject, loadAssetGroup, prepareAssetMeshes } from '../src/lib/assets';
import type { Job } from '../src/core/types';
async function prepared(id: string): Promise<Job> {
  const raw=scenarioJob(id);
  expect(raw.preparedMeshes).toBeUndefined();
  const job=validateJob(raw),group=await loadAssetGroup(job.assets,new AbortController().signal);
  try {
    job.preparedMeshes=prepareAssetMeshes(group,job.assets);
    for(const mesh of job.preparedMeshes) expect(mesh.closed).toBe(true);
    if(job.stock.kind==='mesh') {
      const mesh=job.preparedMeshes.find(m=>m.objectId===job.stock.assetId)!;
      const offset=job.workOffsetsMm!.G54!;
      job.stock.sizeMm=mesh.bounds.max.map((v,i)=>v-mesh.bounds.min[i]);
      job.stock.minCornerInW=mesh.bounds.min.map((v,i)=>v-[offset.x,offset.y,offset.z][i]);
    }
    return job;
  } finally {disposeObject(group);}
}
describe('可从宿主下发的完整仿真场景',()=>{
  it('提供十一种独立场景并拒绝未识别标识',()=>{
    expect(scenarioOptions.map(o=>o.id)).toEqual(['normal','rapid','spindle','fixture','holder','limit','toolchange','meshstock','machine','offsets','exchange']);
    expect(scenarioOptions.every(o=>o.label.trim().length>0)).toBe(true);
    expect(()=>scenarioJob('unknown')).toThrow();
  });
  it('返回可独立编辑的任务及独立二进制资源',()=>{
    const a=scenarioJob('fixture'),b=scenarioJob('fixture');
    a.tools[0].diameterMm=199;
    new Uint8Array(a.assets[0].buffer!)[0]=0xff;
    expect(b.tools[0].diameterMm).toBe(2);
    expect(new Uint8Array(b.assets[0].buffer!)[0]).not.toBe(0xff);
  });
  it.each([
    ['normal','COMPLETED',null],
    ['rapid','PAUSED_COLLISION','RAPID_STOCK'],
    ['spindle','PAUSED_COLLISION','SPINDLE_STOCK'],
    ['fixture','PAUSED_COLLISION','CUTTER_FIXTURE'],
    ['holder','PAUSED_COLLISION','HOLDER_FIXTURE'],
    ['limit','PAUSED_COLLISION','SOFT_LIMIT'],
    ['toolchange','PAUSED_COLLISION','CUTTER_FIXTURE'],
    ['meshstock','COMPLETED',null],
    ['machine','PAUSED_COLLISION','MACHINE_PAIR'],
    ['offsets','COMPLETED',null],
  ] as const)('%s通过校验和真实模型预处理后得到预期%s/%s',async(id,state,type)=>{
    const job=await prepared(id),playback=new Playback();
    expect(job.simulation!.checkCollisions).toBe(true);
    playback.load(job);playback.start();
    const result=playback.advance(1e9);
    expect(result.state).toBe(state);
    if(type) {
      expect(result.incident?.collisionType).toBe(type);
      expect(result.incident?.source.physicalLine).toBeGreaterThan(0);
      if(id==='limit')expect(result.incident?.contact).toBeNull();
      else expect(result.incident?.contact?.frame).toBe('machine');
      if(id==='toolchange') {
        expect(result.incident?.contactStage).toBe('move_to_change');
        expect(result.incident?.source.sourceText).toContain('M6');
      }
      if(id==='machine')expect(result.incident?.objects).toEqual(['machine-slider','machine-stop']);
    } else {
      expect(result.incident).toBeUndefined();
      expect(result.verification).toBe('fully_checked');
      expect(result.stock!.removedVolumeMm3).toBeGreaterThan(0);
      if(id==='normal')expect(result.activeTool).toBe(2);
    }
  },60000);
});
