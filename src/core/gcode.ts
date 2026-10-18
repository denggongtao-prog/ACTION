import { InputError } from './types';
import type { Instruction, Motion, Source, Vec3 } from './types';
import { AXES, axisToTip, rapidWaypoints, tipToAxis, validateMachineProfile } from './machine';
import type { ParseOptions, WorkFrame } from './machineTypes';
import {applyCutterCompensation} from './cutterCompensation';
import {TOOL_EXCHANGE_DURATION_MS} from './toolExchange';
export type { ParseOptions } from './machineTypes';

const TAU = Math.PI * 2;
const allowedG = new Set([0, 1, 2, 3, 4, 15, 16, 17, 20, 21, 28, 30, 90, 91, 92, 94, 98, 99, 40, 41, 42, 43, 49, 80, 81, 53, 54, 55, 56, 57, 58, 59]);
const allowedM = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 30]);
function angularSweep(a: number, b: number, cw: boolean) {
  const positive = ((b - a) % TAU + TAU) % TAU;
  return cw ? (positive < 1e-10 ? -TAU : positive - TAU) : (positive < 1e-10 ? TAU : positive);
}
function arcGeometry(from: Vec3, to: Vec3, words: Map<string, number[]>, scale: number, cw: boolean) {
  const value = (key: string) => words.get(key)?.[0];
  const i = value('I'), j = value('J'), r = value('R');
  let centerX: number, centerY: number;
  if ((i !== undefined || j !== undefined) && r !== undefined) throw new Error('圆心I/J与R不能同时指定');
  if (i !== undefined || j !== undefined) {
    centerX = from.x + (i ?? 0) * scale; centerY = from.y + (j ?? 0) * scale;
  } else if (r !== undefined) {
    const radius = Math.abs(r * scale);
    const dx = to.x - from.x, dy = to.y - from.y, chord = Math.hypot(dx, dy);
    if (!radius || chord < 1e-9 || chord > 2 * radius + 1e-8) throw new Error('R圆弧半径或端点无效');
    const h = Math.sqrt(Math.max(0, radius * radius - chord * chord / 4));
    const centers = [1, -1].map(sign => ({ x: (from.x + to.x) / 2 - sign * dy * h / chord, y: (from.y + to.y) / 2 + sign * dx * h / chord }));
    const selected = centers.find(c => {
      const s = Math.abs(angularSweep(Math.atan2(from.y - c.y, from.x - c.x), Math.atan2(to.y - c.y, to.x - c.x), cw));
      return r >= 0 ? s <= Math.PI + 1e-8 : s >= Math.PI - 1e-8;
    })!;
    centerX = selected.x; centerY = selected.y;
  } else throw new Error('圆弧必须提供I/J或R');
  const radius = Math.hypot(from.x - centerX, from.y - centerY);
  if (radius < 1e-8 || Math.abs(Math.hypot(to.x - centerX, to.y - centerY) - radius) > Math.max(1e-9,radius*1e-10)) throw new Error('圆弧起终点半径不一致，不能形成连续圆弧');
  const startAngle = Math.atan2(from.y - centerY, from.x - centerX);
  return { centerX, centerY, radius, startAngle, sweep: angularSweep(startAngle, Math.atan2(to.y - centerY, to.x - centerX), cw) };
}
/**
 * Positions are machine_reference mm: the machine frame with table at zero.
 * For table machines physical M = reference + tableTranslation(current axes).
 * G43: gaugeZ = programmedZ + workOffsetZ + H; tipZ = gaugeZ - installed length.
 * G49 / no G43: programmed Z + work offset directly addresses the tip (legacy).
 * G53 addresses actual axis/gauge coordinates, bypassing work offsets and H for one block.
 * Changing compensation/frame never moves geometry by itself. M6 never selects an H.
 */
export function parseProgram(text: string, tools: readonly { toolNumber: number; gaugeLengthMm?: number; axisDirection?: Vec3 }[], initialPosition?: Vec3, options: ParseOptions = {}): Instruction[] {
  if (!tools.length) throw new InputError('刀具表不能为空');
  if (initialPosition && options.initialAxisPositionMm) throw new InputError('初始轴坐标与初始刀尖坐标不能同时指定');
  if (options.machineProfile) validateMachineProfile(options.machineProfile);
  const validPoint = (v: Vec3) => AXES.every(a => Number.isFinite(v[a]) && Math.abs(v[a]) <= 1e6);
  for (const t of tools) if (!Number.isInteger(t.toolNumber) || t.toolNumber < 0 || (t.gaugeLengthMm !== undefined && (!Number.isFinite(t.gaugeLengthMm) || t.gaugeLengthMm <= 0 || t.gaugeLengthMm > 1e6))) throw new InputError('刀具号或安装长度无效');
  if (new Set(tools.map(t => t.toolNumber)).size !== tools.length) throw new InputError('刀具号重复');
  for (const [frame, offset] of Object.entries(options.workOffsetsMm ?? {})) if (!/^G5[4-9]$/.test(frame) || !offset || !validPoint(offset)) throw new InputError('工件偏置表无效');
  for (const [h, value] of Object.entries(options.toolLengthOffsetsMm ?? {})) if (!/^\d+$/.test(h) || !Number.isInteger(Number(h)) || !Number.isFinite(value) || Math.abs(value) > 1e6) throw new InputError('刀长H表无效');
  if (options.toolLengthReferenceMm !== undefined && (!Number.isFinite(options.toolLengthReferenceMm) || options.toolLengthReferenceMm < 0 || options.toolLengthReferenceMm > 1e6)) throw new InputError('刀长参考量规无效');
  for (const [d, value] of Object.entries(options.cutterRadiusOffsetsMm ?? {})) if (!/^\d+$/.test(d) || !Number.isInteger(Number(d)) || !Number.isFinite(value) || value < 0 || value > 1e6) throw new InputError('刀具半径D表无效');
  if (options.optionalStop !== undefined && typeof options.optionalStop !== 'boolean') throw new InputError('可选停配置无效');
  const profile = options.machineProfile;
  const installedLength = (n: number) => tools.find(t => t.toolNumber === n)?.gaugeLengthMm ?? 0;
  // This position is the nominal programmed tip, independent of later cutter-radius geometry.
  let position = options.initialAxisPositionMm ? axisToTip(options.initialAxisPositionMm, installedLength(tools[0].toolNumber), profile) : { ...(initialPosition ?? { x: 0, y: 0, z: 30 }) };
  if (!validPoint(position) || (options.initialAxisPositionMm && !validPoint(options.initialAxisPositionMm))) throw new InputError('初始位置无效');
  let scale = 1, absolute = true, feed = 300, motion = 0;
  let activeTool = tools[0].toolNumber, selectedTool = activeTool, spindleRpm = 0, spindleOn = false;
  let direction: 'CW' | 'CCW' = 'CW';
  let workFrame: WorkFrame = 'G54';
  let toolLengthOffset: {h:number;valueMm:number}|undefined;
  let coordinateShift: Vec3 = {x:0,y:0,z:0};
  let polar = false;
  let retractInitial = true;
  let cycle: {axis: 'x'|'y'|'z'; direction: number; initial: number; r: number; depth: number;rValue:number;rAbsolute:boolean;depthValue:number;depthAbsolute:boolean}|undefined;
  let cutterCompensation: {side:'left'|'right';register:number;radiusMm:number}|undefined;
  let compensationEntryPending = false, compensationCancelPending = false;
  let mist = false, flood = false;
  const workOffset = (required: boolean): Vec3 => {
    const offset = options.workOffsetsMm?.[workFrame];
    if (offset) return {...offset};
    if (required && (options.workOffsetsMm || workFrame !== 'G54')) throw new Error('工件偏置表缺少 ' + workFrame);
    return {x:0,y:0,z:0};
  };
  const out: Instruction[] = [];
  const frameOffset=():Vec3=>{const base=workOffset(false);return {x:base.x+coordinateShift.x,y:base.y+coordinateShift.y,z:base.z+coordinateShift.z};};
  const hasTool = (n: number) => Number.isInteger(n) && tools.some(t => t.toolNumber === n);
  const lines = text.split(/\r\n|\n|\r/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const source: Source = { physicalLine: lineIndex + 1, blockNumber: null, sourceText: lines[lineIndex] };
    try {
      const raw = lines[lineIndex].split(';')[0];
      let stripped = raw.replace(/\([^()]*\)/g, ' ').trim();
      if (!stripped || stripped === '%') continue;
      if (/[()]/.test(stripped)) throw new Error('注释括号未闭合或存在嵌套');
      const words = new Map<string, number[]>();
      const re = /([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/iy;
      stripped = stripped.toUpperCase();
      let cursor = 0;
      while (cursor < stripped.length) {
        if (/\s/.test(stripped[cursor])) { cursor++; continue; }
        re.lastIndex = cursor; const match = re.exec(stripped);
        if (!match) throw new Error('无法识别的字符：' + stripped.slice(cursor, cursor + 14));
        const letter = match[1], n = Number(match[2]);
        if (!Number.isFinite(n) || Math.abs(n) > 1e7) throw new Error('数值超出范围');
        if (!'GMNTOSFXYZIJRPHD'.includes(letter)) throw new Error('不支持的字段：' + letter);
        if (letter !== 'G' && letter !== 'M' && words.has(letter)) throw new Error('字段重复：' + letter);
        words.set(letter, [...(words.get(letter) ?? []), n]); cursor = re.lastIndex;
      }
      const g = words.get('G') ?? [], m = words.get('M') ?? [];
      const v = (key: string) => words.get(key)?.[0];
      if (v('N') !== undefined) {
        if (!Number.isInteger(v('N')) || v('N')! < 0) throw new Error('N段号必须为非负整数');
        source.blockNumber = v('N')!;
      }
      if (g.some(n => !allowedG.has(n))) throw new Error('预览版本不支持 G' + g.find(n => !allowedG.has(n)));
      if (m.some(n => !allowedM.has(n))) throw new Error('预览版本不支持 M' + m.find(n => !allowedM.has(n)));
      for (const group of [[0, 1, 2, 3, 4, 81], [20, 21], [90, 91], [15,16], [28,30,92,4,53], [98,99], [40,41,42], [17], [54,55,56,57,58,59], [43,49]]) {
        if (g.filter(n => group.includes(n)).length > 1) throw new Error('同程序块含冲突模态指令');
      }
      if (m.filter(n => [3, 4, 5].includes(n)).length > 1 || m.filter(n => [0, 1, 2, 30].includes(n)).length > 1) throw new Error('M指令冲突');
      if (g.includes(20)) scale = 25.4;
      if (g.includes(21)) scale = 1;
      if (g.includes(90)) absolute = true;
      if (g.includes(91)) absolute = false;
      if (g.includes(15)) polar = false;
      if (g.includes(16)) polar = true;
      if (g.includes(98)) retractInitial = true;
      if (g.includes(99)) retractInitial = false;
      const frame = g.find(n => n >= 54 && n <= 59);
      if (frame !== undefined) { workFrame = ('G' + frame) as WorkFrame; workOffset(true); }
      if (g.includes(43)) {
        const h = v('H');
        if (h === undefined || !Number.isInteger(h) || h < 0 || options.toolLengthOffsetsMm?.[String(h)] === undefined) throw new Error('G43需要已配置的H编号');
        if (tools.find(t=>t.toolNumber===activeTool)?.gaugeLengthMm === undefined) throw new Error('G43需要刀具安装长度');
        toolLengthOffset = {h,valueMm:options.toolLengthOffsetsMm[String(h)]+(options.toolLengthReferenceMm??0)};
      } else if (v('H') !== undefined) throw new Error('H只能与G43一起指定');
      if (g.includes(49)) toolLengthOffset = undefined;
      if (g.includes(41)||g.includes(42)) {
        if (compensationCancelPending) throw new Error('刀具半径补偿尚未完成XY引出');
        const d = v('D');
        if (d===undefined || !Number.isInteger(d) || d<0 || options.cutterRadiusOffsetsMm?.[String(d)]===undefined) throw new Error('G41/G42需要已配置的D编号');
        if (cutterCompensation) throw new Error('更改刀具半径补偿前需要G40引出');
        cutterCompensation={side:g.includes(41)?'left':'right',register:d,radiusMm:options.cutterRadiusOffsetsMm[String(d)]};
        compensationEntryPending=true;
      } else if (v('D')!==undefined) throw new Error('D只能与G41/G42一起指定');
      if (g.includes(40) && cutterCompensation) compensationCancelPending=true;
      if (v('F') !== undefined) {
        feed = v('F')! * scale; if (feed <= 0 || feed > 100000) throw new Error('进给F必须在0至100000 mm/min之间');
      }
      if (v('S') !== undefined) {
        spindleRpm = v('S')!; if (spindleRpm < 0 || spindleRpm > 100000) throw new Error('转速S超出范围');
      }
      const push = (instruction: Omit<Instruction, 'source' | 'id'>) => out.push({ ...instruction, id: out.length, source } as Instruction);
      const appendMotion = (to: Vec3, mode: Motion['mode'], arc?: Motion['arc'], contactStage?: string) => {
        if (!validPoint(to)) throw new Error('目标位置超出预览范围');
        const from={...position}, axisFrom=tipToAxis(from,installedLength(activeTool),profile), axisTo=tipToAxis(to,installedLength(activeTool),profile);
        const xyMotion=!!arc||Math.hypot(to.x-from.x,to.y-from.y)>1e-9;
        if (xyMotion && (compensationEntryPending||compensationCancelPending) && !['rapid','linear'].includes(mode)) throw new Error('刀具半径补偿引入/引出需要XY直线或快移');
        const compensation=cutterCompensation&&(!compensationEntryPending||xyMotion)?{...cutterCompensation,side:compensationCancelPending&&xyMotion?'cancel' as const:cutterCompensation.side}:undefined;
        if (xyMotion) {
          compensationEntryPending=false;
          if (compensationCancelPending) {cutterCompensation=undefined;compensationCancelPending=false;}
        }
        const lengthMm = arc ? Math.hypot(arc.radius * arc.sweep,to.z-from.z) : Math.hypot(to.x-from.x,to.y-from.y,to.z-from.z);
        out.push({id:out.length,kind:'motion',source,mode,from,to:{...to},axisFrom,axisTo,arc,lengthMm,
          durationMs:lengthMm/(mode==='rapid'?(profile?.rapidRateMmMin??6000):feed)*60000,
          feedMmMin:feed,toolNumber:activeTool,spindleRpm,spindleOn,spindleDirection:direction,
          workFrame,workOffsetMm:frameOffset(),toolLengthOffset:toolLengthOffset ? {...toolLengthOffset}:undefined,cutterCompensation:compensation,contactStage});
        position={...to};
      };
      const appendRapidAxes = (target: Vec3, stage?: string) => {
        const from=tipToAxis(position,installedLength(activeTool),profile);
        for (const p of rapidWaypoints(from,target,profile)) appendMotion(axisToTip(p,installedLength(activeTool),profile),'rapid',undefined,stage);
      };
      if (v('T') !== undefined) {
        if (!hasTool(v('T')!)) throw new Error('刀具表不存在 T' + v('T'));
        selectedTool = v('T')!; push({ kind: 'tool_select', toolNumber: selectedTool } as Instruction);
      }
      if (m.includes(6)) {
        if (['X', 'Y', 'Z'].some(k => words.has(k)) || g.some(n => [0, 1, 2, 3, 28, 30, 81, 92].includes(n))) throw new Error('M6换刀与运动应分行');
        if(cutterCompensation) throw new Error('换刀前需要完成刀具半径补偿G40引出');
        spindleOn = false;
        push({kind:'spindle',rpm:spindleRpm,on:false,direction} as Instruction);
        const change=profile?.toolChange;
        const exchange={fromToolNumber:activeTool,durationMs:activeTool===selectedTool?0:TOOL_EXCHANGE_DURATION_MS};
        if (change?.mode==='configured') {
          if (!change.waypointsMm?.length) throw new Error('配置换刀模式缺少换刀轨迹');
          const savedAxes=tipToAxis(position,installedLength(activeTool),profile);
          for (const waypoint of change.waypointsMm) appendRapidAxes(waypoint,'move_to_change');
          const clampAxes=tipToAxis(position,installedLength(activeTool),profile);
          activeTool=selectedTool;
          position=axisToTip(clampAxes,installedLength(activeTool),profile);
          push({kind:'tool_change',...exchange,toolNumber:activeTool,position:{...position},axisPosition:clampAxes,contactStage:'clamp_new',capability:'configured_tool_change',workFrame,workOffsetMm:frameOffset(),toolLengthOffset:toolLengthOffset ? {...toolLengthOffset}:undefined} as Instruction);
          if (change.returnToStart!==false) {
            for (const waypoint of change.waypointsMm.slice(0,-1).reverse()) appendRapidAxes(waypoint,'return_from_change');
            appendRapidAxes(savedAxes,'return_from_change');
          }
        } else {
          // Even logical exchange holds the gauge/axes. The new tip is explicit at clamp.
          const clampAxes=tipToAxis(position,installedLength(activeTool),profile);
          activeTool=selectedTool;
          position=axisToTip(clampAxes,installedLength(activeTool),profile);
          push({kind:'tool_change',...exchange,toolNumber:activeTool,position:{...position},axisPosition:clampAxes,contactStage:'clamp_new',capability:'logical_tool_change',workFrame,workOffsetMm:frameOffset(),toolLengthOffset:toolLengthOffset ? {...toolLengthOffset}:undefined} as Instruction);
        }
      }
      if (m.some(n => [3, 4, 5].includes(n)) || v('S') !== undefined) {
        if (m.includes(3)) { spindleOn = true; direction = 'CW'; }
        if (m.includes(4)) { spindleOn = true; direction = 'CCW'; }
        if (m.includes(5)) spindleOn = false;
        push({ kind: 'spindle', rpm: spindleRpm, on: spindleOn, direction } as Instruction);
      }
      if (m.includes(9) && (m.includes(7)||m.includes(8))) throw new Error('M9与M7/M8冲突');
      if (m.some(n=>[7,8,9].includes(n))) {
        if (m.includes(7)) mist=true;
        if (m.includes(8)) flood=true;
        if (m.includes(9)) {mist=false;flood=false;}
        push({kind:'coolant',mist,flood} as Instruction);
      }
      const nextMotion = g.find(n => n >= 0 && n <= 3);
      if (g.includes(80) || nextMotion!==undefined || g.includes(28) || g.includes(30)) cycle=undefined;
      if (g.includes(80)) motion=-1;
      if (g.includes(28)||g.includes(30)) motion=0;
      if (nextMotion !== undefined) motion = nextMotion;
      const axes = ['X', 'Y', 'Z'].some(k => words.has(k));
      const centerWords = ['I', 'J', 'R'].some(k => words.has(k));
      const effectiveOffset=():Vec3=>{
        const offset=workOffset(true);
        return {x:offset.x+coordinateShift.x,y:offset.y+coordinateShift.y,z:offset.z+coordinateShift.z+(toolLengthOffset?toolLengthOffset.valueMm-installedLength(activeTool):0)};
      };
      const resolveTarget=():Vec3=>{
        const offset=effectiveOffset();
        const resolve=(a:'x'|'y'|'z')=>v(a.toUpperCase())===undefined?position[a]:absolute?v(a.toUpperCase())!*scale+offset[a]:position[a]+v(a.toUpperCase())!*scale;
        const target={x:resolve('x'),y:resolve('y'),z:resolve('z')};
        if(polar && (words.has('X')||words.has('Y'))) {
          if(!absolute) throw new Error('极坐标预览仅支持G90绝对半径和角度');
          const radius=v('X')!==undefined?v('X')!*scale:Math.hypot(position.x-offset.x,position.y-offset.y);
          const angle=(v('Y')??Math.atan2(position.y-offset.y,position.x-offset.x)*180/Math.PI)*Math.PI/180;
          if(radius<0) throw new Error('极坐标半径不能为负');
          target.x=offset.x+radius*Math.cos(angle);target.y=offset.y+radius*Math.sin(angle);
        }
        return target;
      };
      if (g.includes(53) && (!absolute || ![0,1].includes(motion) || !axes || centerWords || cycle || g.includes(81) || cutterCompensation)) throw new Error('G53仅支持绝对G0/G1轴坐标运动且刀具半径补偿已取消');
      if (g.includes(4)) {
        const seconds=v('P')??v('X');
        if (words.has('Y')||words.has('Z')||centerWords||(v('P')!==undefined&&v('X')!==undefined)||seconds===undefined||seconds<0||seconds>3600) throw new Error('G4需要0至3600秒的P或X值，且不能混用');
        push({ kind: 'dwell', durationMs: seconds * 1000 } as Instruction);
      } else {
        if (v('P') !== undefined) throw new Error('P仅用于G4');
        if (g.includes(92)) {
          if(!axes||centerWords||nextMotion!==undefined||g.includes(81)||polar||cutterCompensation) throw new Error('G92需要XYZ读数，且不能混用运动、极坐标或刀具半径补偿');
          const offset=workOffset(true);
          for(const a of AXES) if(v(a.toUpperCase())!==undefined) coordinateShift[a]=position[a]-v(a.toUpperCase())!*scale-offset[a]-(a==='z'&&toolLengthOffset?toolLengthOffset.valueMm-installedLength(activeTool):0);
        } else if(g.includes(28)||g.includes(30)) {
          if(centerWords||nextMotion!==undefined||g.includes(81)||cutterCompensation||polar) throw new Error('G28/G30不能混用圆弧、极坐标、固定循环或刀具半径补偿');
          const reference=g.includes(28)?profile?.homeAxisPositionMm:profile?.secondaryHomeAxisPositionMm;
          if(!reference) throw new Error((g.includes(28)?'G28':'G30')+'需要显式配置参考点');
          if(axes) appendRapidAxes(tipToAxis(resolveTarget(),installedLength(activeTool),profile),'reference_intermediate');
          const target=tipToAxis(position,installedLength(activeTool),profile);
          for(const a of AXES) if(!axes||words.has(a.toUpperCase())) target[a]=reference[a];
          appendRapidAxes(target,'reference_return');
        } else if (g.includes(81)||cycle) {
          if(polar||cutterCompensation||words.has('I')||words.has('J')||g.includes(80)) throw new Error('G81不能混用极坐标、圆弧或刀具半径补偿');
          const tool=tools.find(t=>t.toolNumber===activeTool)!;
          const direction=tool.axisDirection??{x:0,y:0,z:1};
          const drillAxis=AXES.find(a=>Math.abs(Math.abs(direction[a])-1)<1e-9&&AXES.every(b=>a===b||Math.abs(direction[b])<1e-9));
          if(!drillAxis) throw new Error('G81仅支持固定XYZ正交刀轴');
          if(!cycle) {
            if(v(drillAxis.toUpperCase())===undefined||v('R')===undefined) throw new Error('G81首次调用需要钻深轴和R值');
            cycle={axis:drillAxis,direction:-direction[drillAxis],initial:position[drillAxis],r:position[drillAxis],depth:position[drillAxis],rValue:v('R')!*scale,rAbsolute:absolute,depthValue:v(drillAxis.toUpperCase())!*scale,depthAbsolute:absolute};
          } else if(cycle.axis!==drillAxis) throw new Error('改变刀轴前需要取消G81');
          const offset=effectiveOffset(), axis=cycle.axis;
          if(v('R')!==undefined){cycle.rValue=v('R')!*scale;cycle.rAbsolute=absolute;}
          if(v(axis.toUpperCase())!==undefined){cycle.depthValue=v(axis.toUpperCase())!*scale;cycle.depthAbsolute=absolute;}
          cycle.r=cycle.rAbsolute?cycle.rValue+offset[axis]:cycle.initial+cycle.rValue;
          cycle.depth=cycle.depthAbsolute?cycle.depthValue+offset[axis]:cycle.r+cycle.depthValue;
          if((cycle.depth-cycle.r)*cycle.direction<=1e-9) throw new Error('G81钻深必须沿刀尖切入方向位于R面之后');
          if(axes) {
            if((position[axis]-cycle.r)*cycle.direction>1e-9) appendRapidAxes(tipToAxis({...position,[axis]:cycle.r},installedLength(activeTool),profile),'cycle_approach');
            const target=resolveTarget();target[axis]=position[axis];
            appendRapidAxes(tipToAxis(target,installedLength(activeTool),profile),'cycle_position');
            appendRapidAxes(tipToAxis({...position,[axis]:cycle.r},installedLength(activeTool),profile),'cycle_approach');
            appendMotion({...position,[axis]:cycle.depth},'linear',undefined,'cycle_drill');
            const retract=retractInitial&&(cycle.initial-cycle.r)*cycle.direction<0?cycle.initial:cycle.r;
            appendRapidAxes(tipToAxis({...position,[axis]:retract},installedLength(activeTool),profile),'cycle_retract');
          }
        } else if (axes || centerWords) {
          if(motion<0) throw new Error('G80后需要显式G0/G1/G2/G3才能移动');
          if(centerWords&&![2,3].includes(motion)) throw new Error('I/J/R只能用于圆弧或G81');
          let to: Vec3;
          if (g.includes(53)) {
            const target=tipToAxis(position,installedLength(activeTool),profile);
            for (const a of AXES) if (v(a.toUpperCase())!==undefined) target[a]=v(a.toUpperCase())!*scale;
            to=axisToTip(target,installedLength(activeTool),profile);
          } else to=resolveTarget();
          if (Object.values(to).some(n => !Number.isFinite(n) || Math.abs(n) > 1e6)) throw new Error('目标位置超出预览范围');
          const arc = [2, 3].includes(motion) ? arcGeometry(position, to, words, scale, motion === 2) : undefined;
          const mode = (['rapid', 'linear', 'arc_cw', 'arc_ccw'] as const)[motion];
          if(mode==='rapid') appendRapidAxes(tipToAxis(to,installedLength(activeTool),profile));
          else appendMotion(to,mode,arc);
        }
      }
      if (m.includes(0) || (m.includes(1) && options.optionalStop!==false)) push({ kind: 'stop', optional: m.includes(1) } as Instruction);
      if (m.includes(2) || m.includes(30)) { push({ kind: 'end' }); break; }
    } catch (e) { throw new InputError((e as Error).message, source.physicalLine, 'GCODE_ERROR'); }
  }
  if (!out.length) throw new InputError('程序没有可执行指令');
  return applyCutterCompensation(out,tools,profile);
}
export function pointAt(move: Motion, ratio: number): Vec3 {
  const t = Math.max(0, Math.min(1, ratio));
  if (t === 1) return { ...move.to };
  if (!move.arc) return { x: move.from.x + (move.to.x - move.from.x) * t, y: move.from.y + (move.to.y - move.from.y) * t, z: move.from.z + (move.to.z - move.from.z) * t };
  const a = move.arc.startAngle + move.arc.sweep * t;
  return { x: move.arc.centerX + move.arc.radius * Math.cos(a), y: move.arc.centerY + move.arc.radius * Math.sin(a), z: move.from.z + (move.to.z - move.from.z) * t };
}

