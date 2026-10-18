import { Playback } from '../core/playback';
import { validateJob } from '../core/job';
import { InputError } from '../core/types';
import type { StockUpdate } from '../core/types';
const engine = new Playback();
let generation = 0, last = performance.now();
let failed=false;
function fatal(error:unknown){
  failed=true;
  self.postMessage({type:'FATAL',generation,finalSnapshot:engine.snapshot(),error:{message:(error as Error).message,physicalLine:(error as InputError).physicalLine}});
}
function send(type:string,requestId?:number){
  const snapshot=engine.snapshot(),stockUpdate=engine.takeStockUpdate();
  const transfer:Transferable[]=stockUpdate?stockUpdate.tiles.flatMap(tile=>[tile.positions.buffer as ArrayBuffer,tile.normals.buffer as ArrayBuffer,tile.colors.buffer as ArrayBuffer]):[];
  self.postMessage({type,requestId,generation,snapshot,stockUpdate},{transfer});
}
setInterval(() => {
  const now = performance.now(), elapsed = Math.min(now - last, 100); last = now;
  if (failed||!['RUNNING','TOOL_CHANGING'].includes(engine.snapshot().state)) return;
  try{engine.advance(elapsed);send('SNAPSHOT');}
  catch(e){fatal(e);}
}, 40);
self.onmessage = (event: MessageEvent) => {
  const { requestId, type, payload } = event.data;
  try {
    if(failed)throw new InputError('材料计算已停止，请重新载入页面');
    if (type === 'LOAD') { const job = validateJob(payload,true);job.preparedMeshes=payload.preparedMeshes; engine.load(job); generation = event.data.generation; }
    else if ((type==='RESET'||type==='SEEK_LINE')&&event.data.generation===generation+1){generation=event.data.generation;if(type==='RESET')engine.reset();else engine.seekLine(payload);}
    else if (event.data.generation !== generation) throw new InputError('Worker任务已失效');
    else if (type === 'START') engine.start();
    else if (type === 'PAUSE') engine.pause();
    else if (type === 'RESUME') engine.resume();
    else if (type === 'RESET') engine.reset();
    else if (type === 'STEP') engine.step();
    else if (type === 'SEEK_LINE') engine.seekLine(payload);
    else if (type === 'SET_SPEED') engine.setSpeed(payload);
    else if (type !== 'STATE') throw new InputError('Worker命令不支持');
    last = performance.now();
    send('REPLY',requestId);
  } catch (e) {
    if(!failed&&engine.snapshot().state==='ERROR'){fatal(e);return;}
    self.postMessage({type:'REPLY',requestId,generation,error:{message:(e as Error).message,physicalLine:(e as InputError).physicalLine}});
  }
};

