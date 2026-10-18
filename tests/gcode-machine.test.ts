import { describe, expect, it } from 'vitest';
import { parseProgram } from '../src/core/gcode';
import type { ParseOptions, MachineProfile } from '../src/core/machineTypes';
const tools = [{ toolNumber: 1, gaugeLengthMm: 50 }, { toolNumber: 2, gaugeLengthMm: 70 }];
const start = { x: 0, y: 0, z: 10 };
const parse = (s: string, options: ParseOptions = {}) => parseProgram(s, tools, start, options);
const moves = (s: string, options: ParseOptions = {}) => parse(s, options).filter(i => i.kind === 'motion');
const offsets = { G54: { x: 100, y: 200, z: 300 }, G55: { x: 20, y: 30, z: 40 } };
const profile: MachineProfile = {
  axes: Object.fromEntries(['x','y','z'].map(a => [a, { direction: 1, carrier: 'tool', zeroMm: 0, minMm: -1000, maxMm: 1000 }])) as MachineProfile['axes'],
  rapidRateMmMin: 12000, rapidMode: 'linear',
};
describe('机床坐标与独立H补偿', () => {
  it('从工件坐标变换机床刀尖且G53仅当前块绕过偏置', () => {
    const m = moves('G54 G0 X1 Y2 Z3\nG53 G0 X10 Z20\nG55 G1 X2 Z4', { workOffsetsMm: offsets });
    expect(m.map(a => a.to)).toEqual([{x:101,y:202,z:303},{x:10,y:202,z:-30},{x:22,y:202,z:44}]);
    expect(m[2].workFrame).toBe('G55');
    expect(m[2].workOffsetMm).toEqual(offsets.G55);
  });
  it('补偿后的量规点减安装长度，H与刀号独立且M6不选H', () => {
    const m = moves('G43 H8\nG0 Z5\nT2 M6\nG0 Z5\nG49\nG0 Z5', { workOffsetsMm: offsets, toolLengthOffsetsMm: {'8': 60} });
    expect(m.map(a => a.to.z)).toEqual([315,295,305]);
    expect(m[0].axisTo!.z).toBe(365);
    expect(m[1].toolLengthOffset).toEqual({ h: 8, valueMm: 60 });
  });
  it('G53以机床量规轴坐标解释且不取消H模态', () => {
    const m = moves('G43 H8\nG53 G0 Z100\nG0 Z5', { toolLengthOffsetsMm: {'8':60} });
    expect(m.map(a => a.to.z)).toEqual([50,15]);
    expect(m[0].axisTo!.z).toBe(100);
  });
  it('英寸只缩放程序字而不缩放毫米偏置表与H表', () => {
    const m = moves('G20 G43 H8\nG0 Z1\nG91 Z1', {workOffsetsMm:offsets,toolLengthOffsetsMm:{'8':60}});
    expect(m[0].to.z).toBeCloseTo(335.4);
    expect(m[1].to.z).toBeCloseTo(360.8);
  });
  it('偏置切换和补偿切换本身不产生实体运动', () => {
    const m = moves('G55\nG43 H8\nG49\nG1 X2', {workOffsetsMm:offsets,toolLengthOffsetsMm:{'8':60}});
    expect(m).toHaveLength(1);
    expect(m[0].from).toEqual(start);
    expect(m[0].to).toEqual({x:22,y:0,z:10});
  });
  it.each(['G43', 'G43 H3', 'H3', 'G55 G0 X1', 'G55\nM30', 'G53 G91 G0 X1', 'G53 G2 X1 I1'])('明确拒绝缺表项或语义不支持的%s', code => {
    expect(() => parse(code, {workOffsetsMm:{G54:start},toolLengthOffsetsMm:{'8':60}})).toThrow();
  });
  it('初始轴坐标和初始刀尖输入互斥', () => {
    expect(() => parse('G0 X1',{ initialAxisPositionMm:{x:0,y:0,z:60} })).toThrow(/初始/);
    const m = parseProgram('G0 X1', tools, undefined, {initialAxisPositionMm:{x:0,y:0,z:60}}).find(i=>i.kind==='motion')!;
    expect(m.from).toEqual(start);
  });
  it('按配置快移速度和逐轴次序输出实际折线路径', () => {
    const m = moves('G0 X12 Y4 Z13',{machineProfile:{...profile,rapidMode:'axis_sequential',rapidAxisOrder:['z','x','y']}});
    expect(m.map(a=>a.to)).toEqual([{x:0,y:0,z:13},{x:12,y:0,z:13},{x:12,y:4,z:13}]);
    expect(m.reduce((s,a)=>s+a.durationMs,0)).toBeCloseTo(95);
  });
  it('M7/M8/M9保持独立冷却状态并按配置执行M1', () => {
    const p = parse('M7\nM8\nM9\nM1\nM0',{optionalStop:false});
    expect(p.filter(i=>i.kind==='coolant').map(i=>[i.mist,i.flood])).toEqual([[true,false],[true,true],[false,false]]);
    expect(p.filter(i=>i.kind==='stop')).toHaveLength(1);
    expect(parse('M1',{optionalStop:true}).filter(i=>i.kind==='stop')).toHaveLength(1);
  });
  it('配置换刀先用旧刀进站，新刀装夹后返回同一轴位，源行均为M6', () => {
    const p = parse('T2\nN90 M6\nG1 X4',{machineProfile:{...profile,toolChange:{mode:'configured',waypointsMm:[{x:0,y:0,z:100},{x:20,y:0,z:100}],returnToStart:true}}});
    const m = p.filter(i=>i.kind==='motion');
    expect(m.map(a=>a.toolNumber)).toEqual([1,1,2,2,2]);
    expect(m.slice(0,4).map(a=>a.source.physicalLine)).toEqual([2,2,2,2]);
    expect(m[2].from).toEqual({x:20,y:0,z:30});
    expect(m[3].axisTo).toEqual({x:0,y:0,z:60});
    expect(m[4].from).toEqual(m[3].to);
    const clamp = p.find(i=>i.kind==='tool_change')!;
    expect(clamp).toMatchObject({position:{x:20,y:0,z:30},contactStage:'clamp_new',capability:'configured_tool_change',workFrame:'G54',workOffsetMm:{x:0,y:0,z:0}});
  });
  it('显式配置换刀缺轨迹时拒绝，不回退成未知覆盖', () => {
    expect(()=>parse('T2 M6',{machineProfile:{...profile,toolChange:{mode:'configured'}}})).toThrow(/换刀/);
    expect(parse('T2 M6').find(i=>i.kind==='tool_change')).toMatchObject({capability:'logical_tool_change'});
  });
  it('逻辑换刀也固定量规轴位，刀长差只在装夹指令明确改变刀尖', () => {
    const p=parse('T2 M6\nG1 X2');
    expect(p.find(i=>i.kind==='tool_change')).toMatchObject({axisPosition:{x:0,y:0,z:60},position:{x:0,y:0,z:-10}});
    expect(p.find(i=>i.kind==='motion')!.from).toEqual({x:0,y:0,z:-10});
  });
  it('工作台反向轴的程序与G53得到可逆的参考刀尖和真实轴位', () => {
    const table: MachineProfile={...profile,axes:{
      x:{direction:1,carrier:'table',zeroMm:10,minMm:-1000,maxMm:1000},
      y:{direction:-1,carrier:'table',zeroMm:0,minMm:-1000,maxMm:1000},
      z:{direction:1,carrier:'tool',zeroMm:20,minMm:-1000,maxMm:1000},
    }};
    const m=moves('G55 G1 X2 Y4 Z5\nG53 G0 X30 Z90',{machineProfile:table,workOffsetsMm:offsets});
    expect(m[0].to).toEqual({x:22,y:34,z:45});
    expect(m[0].axisTo).toEqual({x:-12,y:34,z:115});
    expect(m[1].to).toEqual({x:-20,y:34,z:20});
    expect(m[1].axisTo).toEqual({x:30,y:34,z:90});
  });
  it('偏置后的圆弧圆心与端点同属参考机床坐标', () => {
    const m=moves('G0 X10 Y0\nG3 X0 Y10 I-10 J0',{workOffsetsMm:offsets});
    expect(m[1].arc).toMatchObject({centerX:100,centerY:200,radius:10});
    expect(m[1].to).toEqual({x:100,y:210,z:10});
  });
});

