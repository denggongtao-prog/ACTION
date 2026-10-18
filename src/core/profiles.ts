import type { MachineProfile } from './machineTypes';
/** Teaching profile only. Real axis travels and change paths must be supplied by the host. */
export function builtInProfile(id:string):MachineProfile|undefined{
  if(id!=='vmc-xyz-demo-v1')return undefined;
  return {axes:{x:{direction:-1,carrier:'table',zeroMm:0,minMm:-500,maxMm:500},y:{direction:-1,carrier:'table',zeroMm:0,minMm:-400,maxMm:400,parent:'x'},z:{direction:1,carrier:'tool',zeroMm:0,minMm:-500,maxMm:500}},rapidRateMmMin:6000,rapidMode:'linear',toolChange:{mode:'logical'},components:[],collisionPairs:[]};
}
