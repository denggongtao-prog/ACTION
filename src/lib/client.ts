import type { Job, Snapshot, StockUpdate } from '../core/types';
export class SimulationClient {
  private worker: Worker;
  private generation = 0; private next = 0;
  private failed = false;
  private lastSnapshotSeq=-1;
  private pending = new Map<number,{resolve:(s:Snapshot)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>;generation:number}>();
  constructor(private onSnapshot: (s:Snapshot,stockUpdate?:StockUpdate|null)=>void, private onFatal:(message:string)=>void) {
    this.worker = new Worker(new URL('../workers/simulation.worker.ts',import.meta.url),{type:'module'});
    this.worker.onmessage = e => {
      const data = e.data;
      if(data.type==='FATAL'&&data.generation===this.generation){
        if(data.finalSnapshot&&(data.finalSnapshot.snapshotSeq??0)>this.lastSnapshotSeq){this.lastSnapshotSeq=data.finalSnapshot.snapshotSeq??0;this.onSnapshot(data.finalSnapshot);}
        this.fail((data.error.physicalLine?'程序第'+data.error.physicalLine+'行：':'')+data.error.message);return;
      }
      if (data.requestId !== undefined) {
        const pending = this.pending.get(data.requestId);
        if (!pending) return;
        this.pending.delete(data.requestId); clearTimeout(pending.timer);
        if(pending.generation!==this.generation){pending.reject(Object.assign(new Error('旧运行响应已失效'),{code:'STALE_RUN'}));return;}
        if(data.error) {pending.reject(Object.assign(new Error(data.error.message),{physicalLine:data.error.physicalLine}));return;}
        if(data.generation !== this.generation) {pending.reject(new Error('旧任务响应已失效'));return;}
        if((data.snapshot.snapshotSeq??0)>this.lastSnapshotSeq){this.lastSnapshotSeq=data.snapshot.snapshotSeq??0;this.onSnapshot(data.snapshot,data.stockUpdate);}pending.resolve(data.snapshot);
      } else if(data.generation === this.generation && data.type==='SNAPSHOT'&&(data.snapshot.snapshotSeq??0)>this.lastSnapshotSeq){this.lastSnapshotSeq=data.snapshot.snapshotSeq??0;this.onSnapshot(data.snapshot,data.stockUpdate);}
    };
    this.worker.onerror = e => this.fail(e.message || '仿真Worker无法启动');
    this.worker.onmessageerror = () => this.fail('仿真Worker数据无法解码');
  }
  private fail(message:string) {
    if(this.failed)return;
    this.failed=true;this.worker.terminate();
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(message));}
    this.pending.clear(); this.onFatal(message);
  }
  request(type:string,payload?:unknown):Promise<Snapshot> {
    if(this.failed)return Promise.reject(new Error('仿真Worker不可用，请重载页面'));
    if(type==='RESET'||type==='SEEK_LINE'){this.generation++;this.lastSnapshotSeq=-1;}
    const requestId=++this.next;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.fail('仿真Worker响应超时，请重载页面');},15000);
      this.pending.set(requestId,{resolve,reject,timer,generation:this.generation});
      this.worker.postMessage({requestId,type,payload,generation:this.generation});
    });
  }
  load(job:Job){this.generation++;this.lastSnapshotSeq=-1;return this.request('LOAD',job);}
  dispose(){this.worker.terminate();this.fail('仿真页面已关闭');}
}

