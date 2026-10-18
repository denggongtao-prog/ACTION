import type { Source, Vec3 } from './types';
export type Point3=[number,number,number];
export type Bounds={min:Point3;max:Point3};
export type DistanceWitness={lower:number;upper:number;obstacle:Point3;tool:Point3;normal:Point3;converged:boolean};
export type CollisionSample=DistanceWitness&{objects:string[];kind:string;method:'mesh_witness'|'stock_cell'|'configured_proxy';potential:boolean;error:number|'unknown'};
export type CollisionEvent={
  eventId:string;eventSeq:number;type:'COLLISION'|'LIMIT'|'INDETERMINATE';
  classification:'confirmed_collision'|'potential_collision'|'limit'|'indeterminate';
  collisionType:string;objects:string[];
  source:Source&{programId:string;programSha256:string;instructionId:number;segmentIndex:number};
  contact:null|{frame:'machine';workFrame:string;unit:'mm';point:Point3;pointInWork:Point3;toolPoint:Point3;normal:Point3;pointMethod:'mesh_witness'|'stock_cell'|'configured_proxy';positionErrorBoundMm:number|'unknown';pathParameterBracket:[number,number]};
  activeToolNumber:number;simulationTimeMs:number;contactToolTipInM:Point3;lastSafeToolTipInM:Point3;
  lastSafeVerified?:boolean;
  contactStage:string;verification:{method:'conservative_sweep_refinement';coverage:'configured_pairs';modelRevision:number};
  requiresAck:true;detail?:string;limit?:{axis:string;positionMm:number;rangeMm:[number,number]};
  response?:'pause'|'warn_continue';
};
export type PathHit={event:CollisionEvent;safeT:number;hitT:number};
export const tuple=(p:Vec3):Point3=>[p.x,p.y,p.z];
