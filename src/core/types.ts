export type Vec3 = { x: number; y: number; z: number };
export type Source = { physicalLine: number; blockNumber: number | null; sourceText: string };
export type Tool = {
  toolId: string; toolNumber: number; type: 'flat_endmill' | 'ball_endmill' | 'drill' | 'profile_endmill';
  diameterMm: number; cuttingLengthMm: number; gaugeLengthMm: number; shaftDiameterMm: number;
  holder: { diameterMm: number; lengthMm: number };
  requiredSpindleDirection?: 'CW' | 'CCW';
  /** Fixed tool axis from cutting tip toward holder. Defaults to +Z; side head supports -Y. */
  axisDirection?:Vec3;
  radialProfile?:{zMm:number;radiusMm:number}[];
};
export type Asset = {
  objectId: string; role: 'stock' | 'fixture' | 'machine' | 'target'; format: 'glb' | 'stl'; unit: 'mm' | 'm';
  url?: string; buffer?: ArrayBuffer;sha256?:string;
  poseInM: { translationMm: number[]; quaternionXYZW: number[] };
  nodes?:{nodeName:string;objectId:string;role:'stock'|'fixture'|'machine'|'target'}[];
};
export type Job = {
  dialectId?:'milling-preview-v1'|'milling-basic-v1';
  program: { programId: string; text: string; sha256?:string; lineEnding?:string }; stock: { objectId: string; kind: 'box'|'mesh'; assetId?:string; sizeMm: number[]; minCornerInW: number[] };
  tools: Tool[]; initialPositionMm: number[]; assets: Asset[];
  initialAxisPositionMm?:Vec3;workOffsetsMm?:Partial<Record<WorkFrame,Vec3>>;toolLengthOffsetsMm?:Record<string,number>;toolLengthReferenceMm?:number;cutterRadiusOffsetsMm?:Record<string,number>;
  machineProfile?:MachineProfile;machineProfileId?:string;optionalStop?:boolean;preparedMeshes?:PreparedMesh[];
  simulation?: { stockCellMm: number; arcChordToleranceMm: number; mode: 'cut' | 'dry_run';checkCollisions?:boolean;stopOnCollision?:boolean;contactLocalizationMm?:number;maxCollisionQueries?:number;maxMemoryMb?:number };
};
export type StockStats = {
  representation: 'z_dexel'; revision: number; cellSizeMm: [number, number]; grid: [number, number];
  initialVolumeMm3: number; removedVolumeMm3: number; remainingVolumeMm3: number; remainingFraction: number;
};
export type StockTile = { tileId: number; positions: Float32Array; normals: Float32Array; colors: Float32Array };
export type StockUpdate = { full: boolean; revision: number; originMm: [number,number,number]; tiles: StockTile[] };
type BaseInstruction = { id: number; source: Source };
export type Motion = BaseInstruction & {
  kind: 'motion'; mode: 'rapid' | 'linear' | 'arc_cw' | 'arc_ccw';
  from: Vec3; to: Vec3; lengthMm: number; durationMs: number; feedMmMin: number; toolNumber: number;
  spindleRpm: number; spindleOn: boolean; spindleDirection: 'CW' | 'CCW';
  axisFrom?:Vec3;axisTo?:Vec3;workFrame?:WorkFrame;workOffsetMm?:Vec3;toolLengthOffset?:{h:number;valueMm:number};contactStage?:string;
  cutterCompensation?:{side:'left'|'right'|'cancel';register:number;radiusMm:number};
  arc?: { centerX: number; centerY: number; radius: number; startAngle: number; sweep: number };
};
export type Instruction = Motion | (BaseInstruction & (
  { kind: 'tool_select' | 'tool_change'; toolNumber: number;fromToolNumber?:number;durationMs?:number;position?:Vec3;axisPosition?:Vec3;contactStage?:string;capability?:string;workFrame?:WorkFrame;workOffsetMm?:Vec3;toolLengthOffset?:{h:number;valueMm:number} } |
  { kind: 'spindle'; rpm: number; on: boolean; direction: 'CW' | 'CCW' } |
  { kind: 'dwell'; durationMs: number } |
  { kind: 'coolant'; mist:boolean;flood:boolean } |
  { kind: 'stop'; optional: boolean } | { kind: 'end' }
));
export type State = 'IDLE' | 'LOADING' | 'READY' | 'RUNNING' | 'TOOL_CHANGING' | 'PAUSED' | 'PAUSED_COLLISION' | 'INDETERMINATE' | 'COMPLETED' | 'ERROR';
export type CuttingState = 'idle' | 'cutting' | 'air_cut' | 'rapid' | 'spindle_off' | 'direction_mismatch' | 'dry_run';
export type Snapshot = {
  state: State; position: Vec3; activeTool: number; selectedTool: number;
  spindleRpm: number; spindleOn: boolean; physicalLine: number | null; instructionIndex: number;
  progress: number; elapsedMs: number; totalMs: number; speed: number;
  verification: 'not_checked'|'in_progress'|'fully_checked'|'collision_detected'|'indeterminate'; materialRemoval: boolean; stock?: StockStats; cuttingState?: CuttingState;
  snapshotSeq?:number;axisPosition?:Vec3;coolant?:{mist:boolean;flood:boolean};incident?:CollisionEvent;incidents?:CollisionEvent[];
  toolChangeStage?:string;
  toolExchange?:{instructionId:number;source:Source;fromTool:number;toTool:number;oldTip:Vec3;newTip:Vec3;progress:number;phase:'release'|'remove_old'|'index_magazine'|'insert_new'|'clamp';phaseProgress:number;illustrative:true};
  instructionCount?:number;
  coverage?:{method:string;pairs:string[];machineComponents:string[];stock:'box'|'mesh';geometryQueries:number;collisionResponse?:'pause'|'warn_continue';warningScope?:'first_contact_per_instruction'};
  events: { type: 'TOOL_CHANGE'; toolNumber: number; physicalLine: number; instructionId: number;capability?:string;contactStage?:string }[];
};
export class InputError extends Error {
  constructor(message: string, public physicalLine?: number, public code = 'INVALID_INPUT') { super(message); this.name = 'InputError'; }
}

import type { MachineProfile,WorkFrame } from './machineTypes';
import type { PreparedMesh } from './meshTypes';
import type { CollisionEvent } from './collisionTypes';
