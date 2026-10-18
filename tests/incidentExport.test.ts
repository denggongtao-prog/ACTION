import {it,expect} from 'vitest';
import {incidentCsv} from '../src/lib/incidentExport';
import type {CollisionEvent} from '../src/core/collisionTypes';
const event={eventId:'event-1',type:'COLLISION',classification:'potential_collision',collisionType:'RAPID_STOCK',objects:['=cmd','stock'],source:{physicalLine:95,blockNumber:910,sourceText:'N910 (a,"b")',programId:'O0008',programSha256:'abc'},contact:{frame:'machine',workFrame:'G54',point:[1.5,-2,3],pointInWork:[4,5,6],positionErrorBoundMm:'unknown'},simulationTimeMs:12,activeToolNumber:3,contactStage:'motion',response:'warn_continue',lastSafeVerified:false} as CollisionEvent;
it('第08轮：CSV保留任务、原始行、坐标、unknown和引号，防止公式文本执行',()=>{
  const csv=incidentCsv([event],{jobId:'job-1',revision:2,runId:'run-1'});
  expect(csv.startsWith('\ufeffjobId,revision,runId,eventId')).toBe(true);expect(csv).toContain('job-1,2,run-1,event-1');
  expect(csv).toContain('95,910,"N910 (a,""b"")"');expect(csv).toContain("'=cmd | stock");expect(csv).toContain('1.5,-2,3,4,5,6,unknown');expect(csv).toContain('warn_continue,false');
});
it('无接触点的LIMIT导出空坐标，不伪造0或unknown，空事件仍有表头',()=>{
  const csv=incidentCsv([{...event,type:'LIMIT',contact:null}]);expect(csv).not.toContain('1.5,-2');expect(csv).not.toContain('unknown');expect(incidentCsv([]).split('\r\n')).toHaveLength(2);
});
