import type { Envelope, Identity } from '../core/protocol';

export const criticalEventTypes = new Set(['COLLISION','LIMIT','INDETERMINATE','ERROR','COMPLETED','TOOL_CHANGE']);
export type DeliveryChannel = { channelId:string; origin:string };
export type PersistedEvent = { envelope:Envelope; origin:string|null; createdAt:number; acknowledgedAt?:number };
export type PersistedRun = {
  identity:Identity; state:string; interrupted:boolean; previousState?:string;
  updatedAt:number; nextEventSeq:number; events:PersistedEvent[]; details?:Record<string,unknown>;
};
type Database = {version:1; runs:PersistedRun[]};
type StorageAdapter = Pick<Storage,'getItem'|'setItem'>;
export type ReliableEventOptions = {
  storage:StorageAdapter; key?:string; now?:()=>number; uuid?:()=>string; retryMs?:number;
  maxRuns?:number; maxEvents?:number; maxBytes?:number;
};
export class PersistenceError extends Error {
  readonly code='EVENT_PERSISTENCE_FAILED';
  constructor(message:string,options?:ErrorOptions){super(message,options);this.name='PersistenceError';}
}
const terminal = new Set(['COMPLETED','ERROR','INDETERMINATE','interrupted']);
const equalIdentity=(a:Identity,b:Identity)=>a.jobId===b.jobId&&a.revision===b.revision&&a.runId===b.runId;
function validIdentity(value:Identity) {
  return value&&typeof value.jobId==='string'&&!!value.jobId&&value.jobId.length<=128&&Number.isSafeInteger(value.revision)&&value.revision>0&&typeof value.runId==='string'&&!!value.runId&&value.runId.length<=128;
}
function serialize(value:unknown):string {
  try {return JSON.stringify(value,(_key,item:unknown)=>{
    if(typeof item==='number'&&!Number.isFinite(item))throw new Error('non-finite event value');
    if(typeof item==='bigint'||typeof item==='function'||typeof item==='symbol')throw new Error('non-JSON event value');
    return item;
  });}catch(error){throw new PersistenceError('Cannot persist a non-serializable event',{cause:error});}
}

/** Persist first, then transmit the original envelope. No simulation state is restored. */
export class ReliableEventStore {
  private database:Database={version:1,runs:[]};
  private readonly key:string;
  private readonly now:()=>number;
  private readonly uuid:()=>string;
  private readonly lastSent=new Map<string,number>();
  constructor(private options:ReliableEventOptions) {
    this.key=options.key??'cnc-sim-reliable-v1';this.now=options.now??Date.now;this.uuid=options.uuid??(()=>crypto.randomUUID());
    try {
      const raw=options.storage.getItem(this.key);
      if(raw!==null) {
        if(new TextEncoder().encode(raw).byteLength>(options.maxBytes??4*1024*1024))throw new Error('stored data exceeds capacity');
        const parsed=JSON.parse(raw) as Database;
        if(parsed?.version!==1||!Array.isArray(parsed.runs))throw new Error('unsupported event history');
        const runKeys=new Set<string>(),eventIds=new Set<string>(),messageIds=new Set<string>();
        for(const run of parsed.runs) {
          if(!validIdentity(run.identity)||typeof run.state!=='string'||typeof run.interrupted!=='boolean'||!Number.isFinite(run.updatedAt)||!Number.isSafeInteger(run.nextEventSeq)||run.nextEventSeq<1||!Array.isArray(run.events))throw new Error('invalid run history');
          const runKey=JSON.stringify([run.identity.jobId,run.identity.revision,run.identity.runId]);if(runKeys.has(runKey))throw new Error('duplicate run history');runKeys.add(runKey);
          let lastSequence=0;
          for(const event of run.events) {
            const m=event.envelope;
            if(!m||m.protocol!=='cnc-sim'||m.version!=='1.0'||!criticalEventTypes.has(m.type)||typeof m.messageId!=='string'||!m.messageId||typeof m.channelId!=='string'||!m.payload||typeof m.payload.eventId!=='string'||!m.payload.eventId||!Number.isSafeInteger(m.payload.eventSeq)||(m.payload.eventSeq as number)<=lastSequence||!equalIdentity(m as Identity,run.identity)||!Number.isFinite(event.createdAt)||(event.acknowledgedAt!==undefined&&!Number.isFinite(event.acknowledgedAt))||(event.origin!==null&&typeof event.origin!=='string'))throw new Error('invalid event history');
            if(eventIds.has(m.payload.eventId)||messageIds.has(m.messageId))throw new Error('duplicate event history');
            eventIds.add(m.payload.eventId);messageIds.add(m.messageId);
            lastSequence=m.payload.eventSeq as number;
          }
          if(run.nextEventSeq<=lastSequence)throw new Error('invalid event sequence');
        }
        this.database=parsed;
        const next=structuredClone(parsed);let changed=false;
        for(const run of next.runs)if(!terminal.has(run.state)) {
          run.previousState=run.state;run.state='interrupted';run.interrupted=true;run.updatedAt=this.now();changed=true;
        }
        if(changed)this.commit(next);
      }
    } catch(error) {
      if(error instanceof PersistenceError)throw error;
      throw new PersistenceError('Cannot read persisted event history',{cause:error});
    }
  }
  private commit(next:Database,protectedIdentity?:Identity) {
    const withinCount=()=>next.runs.length<=(this.options.maxRuns??32)&&next.runs.reduce((sum,r)=>sum+r.events.length,0)<=(this.options.maxEvents??2048);
    let json=serialize(next);
    const withinBytes=()=>new TextEncoder().encode(json).byteLength<=(this.options.maxBytes??4*1024*1024);
    while(!withinCount()||!withinBytes()) {
      // Only whole finished histories with all events acknowledged may be evicted.
      const index=next.runs.findIndex(r=>terminal.has(r.state)&&(!protectedIdentity||!equalIdentity(r.identity,protectedIdentity))&&r.events.every(e=>e.acknowledgedAt!==undefined));
      if(index<0)throw new PersistenceError('Event persistence capacity reached; unacknowledged events retained');
      next.runs.splice(index,1);json=serialize(next);
    }
    try {this.options.storage.setItem(this.key,json);}
    catch(error){throw new PersistenceError('Cannot persist critical event history',{cause:error});}
    // Canonical JSON ensures the first send and sends after reload have identical payloads.
    this.database=JSON.parse(json) as Database;
  }
  private run(next:Database,identity:Identity) {
    if(!validIdentity(identity))throw new PersistenceError('Cannot persist event without a valid run identity');
    let run=next.runs.find(r=>equalIdentity(r.identity,identity));
    if(!run) {
      run={identity:structuredClone(identity),state:'READY',interrupted:false,updatedAt:this.now(),nextEventSeq:1,events:[]};
      next.runs.push(run);
    }
    if(run.interrupted)throw new PersistenceError('An interrupted run cannot resume or complete; create a new runId');
    return run;
  }
  markState(identity:Identity,state:string,details?:Record<string,unknown>) {
    const existing=this.database.runs.find(r=>equalIdentity(r.identity,identity));
    if(existing&&existing.state===state&&details===undefined)return;
    const next=structuredClone(this.database),run=this.run(next,identity);
    run.state=state;run.updatedAt=this.now();
    if(details!==undefined)run.details=structuredClone(details);
    this.commit(next,identity);
  }
  enqueue(type:string,payload:Record<string,unknown>,identity:Identity,channel?:DeliveryChannel):Envelope {
    if(!criticalEventTypes.has(type))throw new PersistenceError('Only critical event types belong in the persistent outbox');
    const next=structuredClone(this.database),run=this.run(next,identity);
    const eventId=typeof payload.eventId==='string'&&payload.eventId?payload.eventId:this.uuid();
    const event:Envelope={protocol:'cnc-sim',version:'1.0',type,messageId:this.uuid(),channelId:channel?.channelId??'',...structuredClone(identity),payload:{...structuredClone(payload),eventId,eventSeq:run.nextEventSeq++}};
    run.events.push({envelope:event,origin:channel?.origin??null,createdAt:this.now()});run.updatedAt=this.now();
    if(type==='COMPLETED'||type==='ERROR')run.state=type;
    else if(type==='COLLISION'&&payload.response!=='warn_continue')run.state='PAUSED_COLLISION';
    else if(type==='LIMIT')run.state='ERROR';
    else if(type==='INDETERMINATE')run.state='INDETERMINATE';
    this.commit(next,identity);
    return structuredClone(this.database.runs.find(r=>equalIdentity(r.identity,identity))!.events.at(-1)!.envelope);
  }
  acknowledge(identity:Identity,eventId:string,channel:DeliveryChannel):boolean {
    const run=this.database.runs.find(r=>equalIdentity(r.identity,identity));
    const event=run?.events.find(e=>e.envelope.payload.eventId===eventId&&e.envelope.channelId===channel.channelId&&e.origin===channel.origin);
    if(!event)return false;
    if(event.acknowledgedAt!==undefined)return true;
    const next=structuredClone(this.database);
    const nextRun=next.runs.find(r=>equalIdentity(r.identity,identity))!;
    nextRun.events.find(e=>e.envelope.payload.eventId===eventId)!.acknowledgedAt=this.now();
    this.commit(next,identity);this.lastSent.delete(event.envelope.messageId);return true;
  }
  flush(channel:DeliveryChannel,send:(message:Envelope)=>void) {
    for(const run of this.database.runs) {
      if(run.interrupted)continue;
      for(const event of run.events) {
        const envelope=event.envelope;
        if(event.acknowledgedAt!==undefined||envelope.channelId!==channel.channelId||event.origin!==channel.origin)continue;
        const last=this.lastSent.get(envelope.messageId),now=this.now();
        if(last!==undefined&&now-last<(this.options.retryMs??1000))continue;
        send(structuredClone(envelope));this.lastSent.set(envelope.messageId,now);
      }
    }
  }
  history():PersistedRun[]{return structuredClone(this.database.runs);}
  report(identity:Identity):PersistedRun|undefined {
    const run=this.database.runs.find(r=>equalIdentity(r.identity,identity));return run?structuredClone(run):undefined;
  }
}
