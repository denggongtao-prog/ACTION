import { afterEach,it,expect,vi } from 'vitest';
import { SimulationClient } from '../src/lib/client';
import { Playback } from '../src/core/playback';
import type { Snapshot } from '../src/core/types';
class WorkerTransport{
  static current:WorkerTransport;onmessage:(event:{data:any})=>void=()=>{};onerror=()=>{};onmessageerror=()=>{};
  sent:any[]=[];constructor(){WorkerTransport.current=this;}postMessage(data:unknown){this.sent.push(data);}terminate(){}
  reply(snapshot:Snapshot){const request=this.sent.at(-1);this.onmessage({data:{type:'REPLY',generation:request.generation,requestId:request.requestId,snapshot}});}
}
afterEach(()=>vi.unstubAllGlobals());
it.each(['RESET','SEEK_LINE'])('%s隔离已在传输中的旧运行完成快照',async command=>{
  vi.stubGlobal('Worker',WorkerTransport);const accepted:Snapshot[]=[];
  const client=new SimulationClient(s=>accepted.push(s),()=>{}),transport=WorkerTransport.current;
  const base=new Playback().snapshot();const initial=client.request('STATE');transport.reply({...base,state:'READY',snapshotSeq:1});await initial;
  const oldGeneration=transport.sent.at(-1).generation;
  const reset=client.request(command,1);
  transport.onmessage({data:{type:'SNAPSHOT',generation:oldGeneration,snapshot:{...base,state:'COMPLETED',snapshotSeq:2}}});
  transport.reply({...base,state:'READY',snapshotSeq:3});await reset;
  expect(accepted.map(s=>s.state)).toEqual(['READY','READY']);client.dispose();
});
