import { ProtocolSession } from '../core/protocol';
import type { CommandReply, Envelope, Identity } from '../core/protocol';
import { criticalEventTypes, PersistenceError, ReliableEventStore } from './reliableEvents';
import type { DeliveryChannel, ReliableEventOptions } from './reliableEvents';

export type EmbedOptions=Partial<ReliableEventOptions>;
export function attachEmbed(execute:(message:Envelope)=>Promise<CommandReply>,identity:()=>Identity|null,options:EmbedOptions={}) {
  const configured=(import.meta.env.VITE_PARENT_ORIGINS as string|undefined)?.split(',').map(s=>s.trim()).filter(Boolean)??[];
  let store:ReliableEventStore|undefined,persistenceError:string|null=null;
  try {store=new ReliableEventStore({...options,storage:options.storage??window.localStorage,key:options.key??`cnc-sim-reliable-v1:${window.location.pathname}`});}
  catch(error){persistenceError=(error as Error).message;}
  const history=()=>store?.history()??[];
  const channel=():DeliveryChannel|undefined=>session.channelId&&session.targetOrigin?{channelId:session.channelId,origin:session.targetOrigin}:undefined;
  const send=(message:Envelope)=>{if(session.targetOrigin)window.parent.postMessage(message,session.targetOrigin);};
  function failure(error:unknown) {
    persistenceError=error instanceof Error?error.message:String(error);
    const delivery={durable:false,errorCode:'EVENT_PERSISTENCE_FAILED',message:persistenceError};
    const notification=session.event('ERROR',{code:'EVENT_PERSISTENCE_FAILED',message:persistenceError,delivery});
    if(notification)send(notification);
    return delivery;
  }
  function markState(state:string,details?:Record<string,unknown>) {
    const current=identity();if(!current)return;
    try {
      if(!store)throw new PersistenceError(persistenceError??'Persistent event storage is unavailable');
      store.markState(current,state,details);
    } catch(error){failure(error);}
  }
  const session=new ProtocolSession([window.location.origin,...configured],async message=>{
    const requested={jobId:message.jobId!,revision:message.revision!,runId:message.runId!};
    const archived=store?.report(requested);
    if(!identity()&&message.type==='GET_REPORT'&&archived)return {type:'REPORT',payload:{...requested,reliableRun:archived,history:history(),persistenceError}};
    if(!identity()&&message.type==='GET_STATE')return {type:'STATE',payload:{state:null,history:history(),persistenceError}};
    const result=await execute(message);
    if(result.type==='JOB_READY')markState('READY');
    if(message.type==='GET_REPORT'||message.type==='GET_STATE')return {...result,payload:{...result.payload,reliableRun:store?.report(identity()??requested),history:history(),persistenceError}};
    return result;
  },identity,message=>{
    const activeChannel=channel();
    try {return !!activeChannel&&!!store&&store.acknowledge({jobId:message.jobId!,revision:message.revision!,runId:message.runId!},message.payload.eventId as string,activeChannel);}
    catch(error){failure(error);throw error;}
  });
  function retry(){
    const activeChannel=channel();if(!activeChannel||!store)return;
    try {store.flush(activeChannel,send);}catch{/* Keep the durable outbox pending until the transport is available. */}
  }
  const listener=async(event:MessageEvent)=>{
    const result=await session.receive(event.data,event.origin,event.source===window.parent);
    if(result?.type==='SIM_READY')result.payload={...result.payload,history:history().map(run=>({identity:run.identity,state:run.state,interrupted:run.interrupted,updatedAt:run.updatedAt})),persistenceError};
    if(result)send(result);
    retry();
  };
  window.addEventListener('message',listener);
  const timer=setInterval(retry,options.retryMs??1000);
  return {
    emit(type:string,payload:Record<string,unknown>):Record<string,unknown>{
      if(criticalEventTypes.has(type)) {
        try {
          const current=identity();
          if(!store||!current)throw new PersistenceError(persistenceError??'Cannot persist critical event without a run identity');
          const event=store.enqueue(type,{...payload,delivery:{durable:true}},current,channel());
          retry();return event.payload;
        } catch(error) {
          const marked={...payload,delivery:failure(error)};
          const event=session.event(type,marked);if(event)send(event);
          return marked;
        }
      }
      const message=session.event(type,payload);if(message)send(message);
      return payload;
    },
    markState,history,retry,
    report(requested?:Identity){const current=requested??identity();return current?store?.report(current):undefined;},
    get persistenceError(){return persistenceError;},
    dispose(){clearInterval(timer);window.removeEventListener('message',listener);},
  };
}

