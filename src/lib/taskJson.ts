import type { Job } from '../core/types';
import { validateJob } from '../core/job';
function base64(buffer:ArrayBuffer){
  const bytes=new Uint8Array(buffer);let text='';
  for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return btoa(text);
}
export function taskToJson(task:Job){
  const clean=structuredClone(task);delete clean.preparedMeshes;
  if(clean.initialAxisPositionMm)delete (clean as Partial<Job>).initialPositionMm;
  return JSON.stringify(clean,(_,value)=>value instanceof ArrayBuffer?{$arrayBuffer:base64(value)}:value,2);
}
export function taskFromJson(text:string):Job{
  if(text.length>96*1024*1024)throw new Error('任务JSON超过96MB');
  return validateJob(JSON.parse(text,(_,value)=>{
    if(value&&typeof value==='object'&&Object.keys(value).length===1&&typeof value.$arrayBuffer==='string'){
      if(value.$arrayBuffer.length>44739244)throw new Error('任务二进制模型超过32MB');
      const raw=atob(value.$arrayBuffer),data=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)data[i]=raw.charCodeAt(i);return data.buffer;
    }
    return value;
  }));
}
