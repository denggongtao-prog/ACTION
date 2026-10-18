import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseProgram } from '../src/core/gcode';
import type { MachineProfile, ParseOptions } from '../src/core/machineTypes';

const tools = [1, 2, 3, 7].map(toolNumber => ({toolNumber, gaugeLengthMm: 50, axisDirection: toolNumber === 7 ? {x:0,y:-1,z:0} : {x:0,y:0,z:1}}));
const profile: MachineProfile = {
  axes: Object.fromEntries(['x','y','z'].map(a => [a,{direction:1,carrier:'tool',zeroMm:0,minMm:-1000,maxMm:2000}])) as MachineProfile['axes'],
  rapidMode:'linear',rapidRateMmMin:6000,
  homeAxisPositionMm:{x:0,y:0,z:500},secondaryHomeAxisPositionMm:{x:200,y:100,z:400},
};
const parse = (code: string, options: ParseOptions = {}) => parseProgram(code,tools,{x:0,y:0,z:10},options);
const moves = (code: string, options: ParseOptions = {}) => parse(code,options).filter(i=>i.kind==='motion');

describe('案例库解释器扩展', () => {
  it('G92改变当前坐标读数，不移动；G53绕过G92且不清除它', () => {
    const m=moves('G92 X50 Y42 Z50\nG0 X42 Y32\nG1 Z-2\nG53 G0 X0 Z60\nG0 X50');
    expect(m.map(i=>i.to)).toEqual([{x:-8,y:-10,z:10},{x:-8,y:-10,z:-42},{x:0,y:-10,z:10},{x:0,y:-10,z:10}]);
    expect(m[0].source.physicalLine).toBe(2);
  });
  it('G92可反复设定且G91不会把读数设定当作增量运动', () => {
    expect(moves('G92 X50\nG91 G92 X10\nG90 G1 X12')[0].to).toEqual({x:2,y:0,z:10});
  });
  it('G16在原G0模态按半径/角度移动，省略半径沿用名义极坐标，G15恢复直角坐标', () => {
    const m=moves('G0 X65 Y0\nG16 X60 Y330\nG1 X30 Y60\nY120\nG15 G0 X65 Y0');
    expect(m[1].mode).toBe('rapid');
    expect(m[1].to.x).toBeCloseTo(51.961524227);
    expect(m[1].to.y).toBeCloseTo(-30);
    expect(m[2].to.x).toBeCloseTo(15);
    expect(m[2].to.y).toBeCloseTo(25.980762114);
    expect(m[3].to.x).toBeCloseTo(-15);
    expect(m[3].to.y).toBeCloseTo(25.980762114);
    expect(m[4].to).toEqual({x:65,y:0,z:10});
  });
  it('极坐标以工件/G92原点为中心，英寸只缩放半径不缩放角度', () => {
    const m=moves('G92 X0 Y0\nG20 G16 G0 X1 Y90\nY180',{workOffsetsMm:{G54:{x:100,y:200,z:0}}});
    expect(m[0].to.x).toBeCloseTo(0);
    expect(m[0].to.y).toBeCloseTo(25.4);
    expect(m[1].to.x).toBeCloseTo(-25.4);
    expect(m[1].to.y).toBeCloseTo(0);
  });
  it('G81展开定位、R面、钻进、回退，G98初始面与G99 R面可切换且无坐标块不重钻', () => {
    const m=moves('N10 G98 G81 X30 Y30 Z-35 R2 F20\nS200\nG91 X40\nG90 G99 X110\nG80\nG0 Z30');
    expect(m.filter(i=>i.contactStage==='cycle_drill').map(i=>i.to)).toEqual([{x:30,y:30,z:-35},{x:70,y:30,z:-35},{x:110,y:30,z:-35}]);
    expect(m.filter(i=>i.contactStage==='cycle_retract').map(i=>i.to.z)).toEqual([10,10,2]);
    const first=m.filter(i=>i.source.physicalLine===1);
    expect(first.map(i=>i.contactStage)).toEqual(['cycle_position','cycle_approach','cycle_drill','cycle_retract']);
    expect(first.every(i=>i.source.sourceText==='N10 G98 G81 X30 Y30 Z-35 R2 F20' && i.source.blockNumber===10)).toBe(true);
    expect(m.at(-1)!.to.z).toBe(30);
  });
  it('G91循环的R相对初始面、钻深相对R，重复定位不累积R或钻深', () => {
    const m=moves('G91 G99 G81 X5 Z-7 R-2\nX5\nG80\nG0 Z10');
    expect(m.filter(i=>i.contactStage==='cycle_drill').map(i=>i.to)).toEqual([{x:5,y:0,z:1},{x:10,y:0,z:1}]);
    expect(m.filter(i=>i.contactStage==='cycle_retract').map(i=>i.to.z)).toEqual([8,8]);
  });
  it('循环先退到安全R面再作横向定位，不让初始低点横穿材料', () => {
    const m=moves('G99 G81 X20 Z-10 R20');
    expect(m[0]).toMatchObject({mode:'rapid',to:{x:0,y:0,z:20},contactStage:'cycle_approach'});
    expect(m[1]).toMatchObject({to:{x:20,y:0,z:20},contactStage:'cycle_position'});
  });
  it.each(['G0','G1','G28','G30'])('%s退出钻孔模态，后续轴字不能继续钻孔', command => {
    const m=moves(`G81 Z-5 R2\n${command} X0\nG0 X40`,{machineProfile:profile});
    expect(m.filter(i=>i.contactStage==='cycle_drill')).toHaveLength(1);
    expect(m.at(-1)!.to.x).toBe(40);
  });
  it('侧钻按T7固定Y刀轴展开正Y钻孔，继承Z15且每孔仍保留源行', () => {
    const m=moves('T7 M6\nG0 X108 Y-2\nG43 Z15 H7\nN340 G81 G99 Y33 R-2 F10000\nN350 X236\nG80\nM2',{toolLengthOffsetsMm:{'7':50}});
    const drills=m.filter(i=>i.contactStage==='cycle_drill');
    expect(drills.map(i=>i.from)).toEqual([{x:108,y:-2,z:15},{x:236,y:-2,z:15}]);
    expect(drills.map(i=>i.to)).toEqual([{x:108,y:33,z:15},{x:236,y:33,z:15}]);
    expect(drills.map(i=>i.source.blockNumber)).toEqual([340,350]);
  });
  it('G28/G30依次经过编程中间点和显式参考轴位，只返回指定轴', () => {
    const m=moves('N20 G28 G90 X20 Z25\nN30 G30 G91 Y5',{machineProfile:profile});
    expect(m.map(i=>i.to)).toEqual([{x:20,y:0,z:25},{x:0,y:0,z:450},{x:0,y:5,z:450},{x:0,y:100,z:450}]);
    expect(m.map(i=>i.source.blockNumber)).toEqual([20,20,30,30]);
    expect(m.map(i=>i.axisTo!.z)).toEqual([75,500,500,500]);
  });
  it.each(['G28','G30'])('未配置%s参考点时明确拒绝，不能隐式回机床零点', command=>{
    expect(()=>parse(`${command} Z0`)).toThrow(/参考/);
    expect(()=>parse(`${command} Z0`,{machineProfile:{...profile,homeAxisPositionMm:undefined,secondaryHomeAxisPositionMm:undefined}})).toThrow(/参考/);
  });
  it('G4 X秒为停留，保留后续G1模态且不移动X', () => {
    const p=parse('G1 X2\nN40 G4 X5\nX3');
    expect(p.filter(i=>i.kind==='dwell')).toEqual([expect.objectContaining({durationMs:5000,source:{physicalLine:2,blockNumber:40,sourceText:'N40 G4 X5'}})]);
    expect(p.filter(i=>i.kind==='motion').map(i=>i.to.x)).toEqual([2,3]);
  });
  it('H差值加安装参考量规基准，负H仍得到正确绝对刀尖坐标', () => {
    const m=moves('G43 H3 Z20',{toolLengthOffsetsMm:{'3':-25},toolLengthReferenceMm:100});
    expect(m[0].to.z).toBe(45);
    expect(m[0].toolLengthOffset).toEqual({h:3,valueMm:75});
  });
  it('G41/G42携带独立D半径，G40在首个XY引出段取消且不能被Z段消费', () => {
    const m=moves('G41 G1 X10 D8\nY10\nG40\nZ20\nG0 X20\nX30',{cutterRadiusOffsetsMm:{'8':2}});
    expect(m.map(i=>i.cutterCompensation)).toEqual([
      {side:'left',register:8,radiusMm:2},{side:'left',register:8,radiusMm:2},
      {side:'left',register:8,radiusMm:2},{side:'cancel',register:8,radiusMm:2},undefined,
    ]);
  });
  it('刀补引入可先声明再走Z，首个XY线性段才启用补偿',()=>{
    const m=moves('G41 D8\nG0 Z20\nG1 X10\nG40\nG0 X20',{cutterRadiusOffsetsMm:{'8':2}});
    expect(m[0].cutterCompensation).toBeUndefined();
    expect(m[1].cutterCompensation).toEqual({side:'left',register:8,radiusMm:2});
  });
  it.each(['G41 D1\nG2 I5','G41 G1 X10 D1\nG40\nG2 I5'])('整圆有XY运动，不能用作刀补引入/引出：%s',code=>{
    expect(()=>parse(code,{cutterRadiusOffsetsMm:{'1':1}})).toThrow(/XY/);
  });
  it('逐轴快移的Z动作不消耗G40引出标记，首个XY动作才取消',()=>{
    const m=moves('G41 G1 X10 D1\nG40 G0 X20 Y30 Z40',{machineProfile:{...profile,rapidMode:'axis_sequential',rapidAxisOrder:['z','x','y']},cutterRadiusOffsetsMm:{'1':2}});
    expect(m.map(i=>i.cutterCompensation?.side)).toEqual(['left','left','cancel',undefined]);
  });
  it('G28不带轴字时全部轴回参考点，参考点不受工件偏置或H影响',()=>{
    const m=moves('G43 H1\nG28',{machineProfile:profile,workOffsetsMm:{G54:{x:100,y:200,z:300}},toolLengthOffsetsMm:{'1':70}});
    expect(m).toHaveLength(1);
    expect(m[0].axisTo).toEqual({x:0,y:0,z:500});
    expect(m[0].to).toEqual({x:0,y:0,z:450});
  });
  it('G30第二参考点必须落在机床轴限位内',()=>{
    expect(()=>parse('G30',{machineProfile:{...profile,secondaryHomeAxisPositionMm:{x:0,y:0,z:3000}}})).toThrow(/第二参考/);
  });
  it.each(['G41 G1 X10','G42 G0 X10 D9','G41 G2 X1 I1 D1','G81 Z-1','G81 Z5 R2','G80 X2','G4 X1 P1','G92','G28 G30 X0'])('拒绝缺表项、无效循环或冲突语义：%s', code=>{
    expect(()=>parse(code,{cutterRadiusOffsetsMm:{'1':1},machineProfile:profile})).toThrow();
  });
  it('D0显式零半径也必须是已配置表项',()=>{
    expect(()=>parse('G41 G1 X10 D0')).toThrow(/D/);
    expect(moves('G41 G1 X10 D0',{cutterRadiusOffsetsMm:{'0':0}})[0].cutterCompensation).toEqual({side:'left',register:0,radiusMm:0});
  });
  it('九个原始txt可直接解析，全部展开指令回指未经改写的物理行', () => {
    const list=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?list(join(dir,e.name)):e.name.endsWith('.txt')?[join(dir,e.name)]:[]);
    const paths=list(join(process.cwd(),'案例库'));
    expect(paths).toHaveLength(9);
    for(const path of paths) {
      const text=readFileSync(path,'utf8'), lines=text.split(/\r\n|\n|\r/);
      const result=parse(text,{machineProfile:profile,toolLengthOffsetsMm:{'1':50,'2':50,'3':50,'7':50},cutterRadiusOffsetsMm:{'1':1,'2':1,'3':1}});
      expect(result.some(i=>i.kind==='motion'),path).toBe(true);
      for(const instruction of result) expect(instruction.source.sourceText,path).toBe(lines[instruction.source.physicalLine-1]);
    }
  });
});
