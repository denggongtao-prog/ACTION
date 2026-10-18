import { InputError } from './types';
import type { Vec3 } from './types';
import type { AxisName, LimitViolation, MachineProfile } from './machineTypes';
export type { MachineProfile, ParseOptions } from './machineTypes';
export const AXES: readonly AxisName[] = ['x', 'y', 'z'];
const zero = (): Vec3 => ({x:0,y:0,z:0});
function validPoint(v: unknown): v is Vec3 {
  return !!v && typeof v === 'object' && AXES.every(a => Number.isFinite((v as Vec3)[a]) && Math.abs((v as Vec3)[a]) <= 1e6);
}
/** Validate the supported orthogonal translation model; no arbitrary rotations or extra axes. */
export function validateMachineProfile(input: unknown): asserts input is MachineProfile {
  const p = input as MachineProfile;
  const fail = (m: string): never => { throw new InputError('机床配置：' + m); };
  if (!p || typeof p !== 'object' || !p.axes || typeof p.axes !== 'object' || Object.keys(p.axes).length !== 3) fail('需要且仅支持XYZ三平移轴');
  for (const a of AXES) {
    const c = p.axes[a];
    if (!c || ![1,-1].includes(c.direction) || !['tool','table'].includes(c.carrier)) fail('轴方向或运动链无效：'+a);
    if (![c.zeroMm,c.minMm,c.maxMm].every(n=>Number.isFinite(n)&&Math.abs(n)<=1e6) || c.minMm >= c.maxMm || c.zeroMm<c.minMm || c.zeroMm>c.maxMm) fail('轴零位/限位无效：'+a);
    const seen = new Set<AxisName>([a]);
    let current = c;
    while (current.parent !== undefined) {
      if (!AXES.includes(current.parent) || seen.has(current.parent)) fail('轴父链循环或未知轴');
      seen.add(current.parent);
      const parent = p.axes[current.parent];
      if (!parent || parent.carrier !== c.carrier) fail('父子轴必须属于同一tool/table链');
      current = parent;
    }
  }
  if (!Number.isFinite(p.rapidRateMmMin)||p.rapidRateMmMin<=0||p.rapidRateMmMin>100000) fail('快移速度需为0至100000 mm/min');
  if (!['linear','axis_sequential'].includes(p.rapidMode)) fail('快移规则无效');
  if (p.rapidAxisOrder && (p.rapidAxisOrder.length!==3 || new Set(p.rapidAxisOrder).size!==3 || p.rapidAxisOrder.some(a=>!AXES.includes(a)))) fail('快移次序需要XYZ各一次');
  if (p.homeAxisPositionMm && (!validPoint(p.homeAxisPositionMm)||findLimitViolation(p.homeAxisPositionMm,p))) fail('回零位置无效或超限');
  if (p.secondaryHomeAxisPositionMm && (!validPoint(p.secondaryHomeAxisPositionMm)||findLimitViolation(p.secondaryHomeAxisPositionMm,p))) fail('第二参考位置无效或超限');
  if (p.toolChange) {
    if (!['logical','configured'].includes(p.toolChange.mode)) fail('换刀模式无效');
    if (p.toolChange.returnToStart !== undefined && typeof p.toolChange.returnToStart!=='boolean') fail('换刀返回开关无效');
    if (p.toolChange.waypointsMm && (!Array.isArray(p.toolChange.waypointsMm)||p.toolChange.waypointsMm.length>1000||p.toolChange.waypointsMm.some(v=>!validPoint(v)))) fail('换刀轨迹无效');
  }
  const ids = new Set<string>();
  for (const c of p.components ?? []) {
    if (!c || typeof c.objectId!=='string'||!c.objectId.trim()||ids.has(c.objectId)||!Array.isArray(c.drivenBy)||new Set(c.drivenBy).size!==c.drivenBy.length||c.drivenBy.some(a=>!AXES.includes(a))) fail('部件标识重复或运动链无效');
    ids.add(c.objectId);
  }
  const exactId = (id: unknown): id is string => typeof id==='string' && id.trim().length>0 && id===id.trim() && !/[*?]/.test(id);
  const pairs = new Set<string>();
  for (const pair of p.collisionPairs ?? []) {
    if (!Array.isArray(pair)||pair.length!==2||pair.some(id=>!exactId(id))||pair[0]===pair[1]) fail('检查对象对无效');
    const key = [...pair].sort().join('\0');
    if (pairs.has(key)) fail('检查对象对重复');
    pairs.add(key);
  }
  if (p.collisionExclusions!==undefined && !Array.isArray(p.collisionExclusions)) fail('排除项需要数组');
  for (const e of p.collisionExclusions ?? []) {
    if (!e || typeof e!=='object' || Object.keys(e).some(k=>!['objects','stages'].includes(k)) || !Array.isArray(e.objects) || e.objects.length!==2 || e.objects.some(id=>!exactId(id)) || e.objects[0]===e.objects[1]) fail('排除项仅接受精确对象ID对');
    if (e.stages!==undefined && (!Array.isArray(e.stages)||!e.stages.length||e.stages.some(s=>!exactId(s))||new Set(e.stages).size!==e.stages.length)) fail('排除阶段需要不重复的精确名称');
  }
}
function carrierTranslation(axis: Vec3, p: MachineProfile | undefined, carrier: 'tool'|'table'): Vec3 {
  if (!p) return carrier==='tool' ? {...axis} : zero();
  const result = zero();
  for (const a of AXES) if (p.axes[a].carrier===carrier) result[a]=p.axes[a].direction*(axis[a]-p.axes[a].zeroMm);
  return result;
}
export function tableTranslation(axis: Vec3, p?: MachineProfile): Vec3 { return carrierTranslation(axis,p,'table'); }
export function axisToPhysicalTip(axis: Vec3, gaugeLengthMm: number, p?: MachineProfile): Vec3 {
  const v = carrierTranslation(axis,p,'tool'); v.z-=gaugeLengthMm; return v;
}
/** Internal machine_reference: M with table at its zero. External physical M adds tableTranslation. */
export function axisToTip(axis: Vec3, gaugeLengthMm: number, p?: MachineProfile): Vec3 {
  const tip = axisToPhysicalTip(axis,gaugeLengthMm,p), table=tableTranslation(axis,p);
  return {x:tip.x-table.x,y:tip.y-table.y,z:tip.z-table.z};
}
export function tipToAxis(tip: Vec3, gaugeLengthMm: number, p?: MachineProfile): Vec3 {
  const gauge={...tip,z:tip.z+gaugeLengthMm};
  if (!p) return gauge;
  const result=zero();
  for (const a of AXES) result[a]=p.axes[a].zeroMm+gauge[a]*p.axes[a].direction*(p.axes[a].carrier==='table'?-1:1);
  return result;
}
export function componentPhysicalTranslation(objectId: string, axis: Vec3, p: MachineProfile): Vec3 {
  const component=p.components?.find(c=>c.objectId===objectId);
  if (!component) throw new InputError('机床部件未配置：'+objectId);
  const inherited=new Set<AxisName>();
  for (const a of component.drivenBy) {
    let current: AxisName|undefined=a;
    while(current && !inherited.has(current)) { inherited.add(current); current=p.axes[current].parent; }
  }
  const v=zero();
  for (const a of inherited) v[a]=p.axes[a].direction*(axis[a]-p.axes[a].zeroMm);
  return v;
}
export function componentTranslation(objectId: string, axis: Vec3, p: MachineProfile): Vec3 {
  const v=componentPhysicalTranslation(objectId,axis,p),t=tableTranslation(axis,p);
  return {x:v.x-t.x,y:v.y-t.y,z:v.z-t.z};
}
export function findLimitViolation(axis: Vec3, p: MachineProfile): LimitViolation|null {
  for(const a of AXES) { const c=p.axes[a]; if(axis[a]<c.minMm||axis[a]>c.maxMm) return {axis:a,valueMm:axis[a],minMm:c.minMm,maxMm:c.maxMm}; }
  return null;
}
export function homeAxisPosition(p: MachineProfile): Vec3 {
  return p.homeAxisPositionMm ? {...p.homeAxisPositionMm} : {x:p.axes.x.zeroMm,y:p.axes.y.zeroMm,z:p.axes.z.zeroMm};
}
export function rapidWaypoints(from: Vec3,to: Vec3,p?: MachineProfile): Vec3[] {
  if(p?.rapidMode!=='axis_sequential') return [{...to}];
  const points: Vec3[]=[],current={...from};
  for(const a of p.rapidAxisOrder??['z','x','y']) if(current[a]!==to[a]) { current[a]=to[a];points.push({...current}); }
  return points.length ? points : [{...to}];
}
