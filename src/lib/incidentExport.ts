import type {CollisionEvent} from '../core/collisionTypes';
import type {Identity} from '../core/protocol';
function cell(value:unknown):string{
  let text=value===undefined||value===null?'':String(value);
  if(typeof value==='string'&&/^\s*[=+\-@\t\r]/.test(text))text="'"+text;
  return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;
}
/** Excel-compatible UTF-8 CSV. Coordinates stay empty when the event has no contact. */
export function incidentCsv(events:readonly CollisionEvent[],identity?:Identity|null):string{
  const header=['jobId','revision','runId','eventId','type','classification','collisionType','programId','programSha256','physicalLine','blockNumber','sourceText','objects','simulationTimeMs','frame','workFrame','machineXmm','machineYmm','machineZmm','workXmm','workYmm','workZmm','positionErrorBoundMm','activeToolNumber','contactStage','response','lastSafeVerified'];
  const rows=events.map(event=>[
    identity?.jobId,identity?.revision,identity?.runId,event.eventId,event.type,event.classification,event.collisionType,event.source.programId,event.source.programSha256,event.source.physicalLine,event.source.blockNumber,event.source.sourceText,event.objects.join(' | '),event.simulationTimeMs,event.contact?.frame,event.contact?.workFrame,
    ...(event.contact?.point??[null,null,null]),...(event.contact?.pointInWork??[null,null,null]),event.contact?.positionErrorBoundMm,event.activeToolNumber,event.contactStage,event.response,event.lastSafeVerified
  ].map(cell).join(','));
  return '\ufeff'+[header.join(','),...rows].join('\r\n')+'\r\n';
}
