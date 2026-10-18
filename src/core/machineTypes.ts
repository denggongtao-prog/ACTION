import type { Vec3 } from './types';
export type AxisName = 'x' | 'y' | 'z';
export type WorkFrame = 'G54' | 'G55' | 'G56' | 'G57' | 'G58' | 'G59';
/** Axis translation = direction * (axisPosition - zeroMm). Parents inherit translations. */
export type AxisConfig = {
  direction: 1 | -1; carrier: 'tool' | 'table'; zeroMm: number; minMm: number; maxMm: number; parent?: AxisName;
};
export type MachineProfile = {
  axes: Record<AxisName, AxisConfig>;
  rapidRateMmMin: number;
  rapidMode: 'linear' | 'axis_sequential';
  rapidAxisOrder?: AxisName[];
  homeAxisPositionMm?: Vec3;
  /** Explicit second reference position used by G30, in actual axis coordinates. */
  secondaryHomeAxisPositionMm?: Vec3;
  /** Waypoints are actual axis positions in mm; reverse approach then return to saved axes. */
  toolChange?: { mode: 'configured' | 'logical'; waypointsMm?: Vec3[]; returnToStart?: boolean };
  components?: { objectId: string; drivenBy: AxisName[] }[];
  collisionPairs?: [string, string][];
  /** Only exact object IDs and exact stages; no wildcard/category exclusions. */
  collisionExclusions?: { objects: [string, string]; stages?: string[] }[];
};
export type ParseOptions = {
  workOffsetsMm?: Partial<Record<WorkFrame, Vec3>>;
  toolLengthOffsetsMm?: Record<string, number>;
  /** Absolute gauge reference added to relative H table entries (defaults to zero). */
  toolLengthReferenceMm?: number;
  cutterRadiusOffsetsMm?: Record<string, number>;
  machineProfile?: MachineProfile;
  initialAxisPositionMm?: Vec3;
  optionalStop?: boolean;
};
export type LimitViolation = { axis: AxisName; valueMm: number; minMm: number; maxMm: number };
