import {CncSimClient,type Job,type Envelope} from './cnc-sim-client.js';
/** Example for a TypeScript parent page. The caller supplies its own UI and event database. */
export async function connectTypedHost(frame:HTMLIFrameElement,simulatorUrl:string,job:Job,persistEvent:(message:Envelope)=>Promise<boolean>){
  const client=new CncSimClient(frame,simulatorUrl,{
    persistEvent,onConnectionChange:state=>{frame.dataset.connection=state;},
    onEvent:message=>{frame.dispatchEvent(new CustomEvent('cnc-event',{detail:message}));}
  });
  try{await client.connect();await client.loadJob(job);return client;}catch(error){client.dispose();throw error;}
}
