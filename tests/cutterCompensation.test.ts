import {describe,it,expect} from 'vitest';
import type {Motion} from '../src/core/types';
import {applyCutterCompensation} from '../src/core/cutterCompensation';
const make=(from:number[],to:number[],line:number,side:'left'|'right'|'cancel'='left'):Motion=>({id:line,kind:'motion',source:{physicalLine:line,blockNumber:line*10,sourceText:'original '+line},mode:'linear',from:{x:from[0],y:from[1],z:0},to:{x:to[0],y:to[1],z:0},lengthMm:Math.hypot(to[0]-from[0],to[1]-from[1]),durationMs:1000,feedMmMin:60,toolNumber:1,spindleOn:true,spindleRpm:1000,spindleDirection:'CW',cutterCompensation:{side,register:1,radiusMm:1}});
describe('真实刀心半径补偿',()=>{
  it('左补直线凹角求交而非穿过程序轮廓，进出段连续',()=>{
    const result=applyCutterCompensation([make([-10,0],[0,0],1),make([0,0],[10,0],2),make([10,0],[10,10],3),make([10,10],[20,10],4,'cancel')]) as Motion[];
    expect(result[0].from).toEqual({x:-10,y:0,z:0});expect(result[0].to).toEqual({x:0,y:1,z:0});
    expect(result[1].to.x).toBeCloseTo(9);expect(result[1].to.y).toBeCloseTo(1);
    for(let i=1;i<result.length;i++)expect(result[i].from).toEqual(result[i-1].to);
    expect(result.at(-1)!.to).toEqual({x:20,y:10,z:0});expect(result[1].source.physicalLine).toBe(2);
  });
  it('右补凸角增加真实半径过渡圆弧并归属源行',()=>{
    const result=applyCutterCompensation([make([-10,0],[0,0],1,'right'),make([0,0],[10,0],2,'right'),make([10,0],[10,10],3,'right'),make([10,10],[20,10],4,'cancel')]) as Motion[];
    const corner=result.find(m=>m.contactStage==='cutter_comp_corner')!;
    expect(corner.arc?.radius).toBe(1);expect(corner.arc?.sweep).toBeCloseTo(Math.PI/2);expect(corner.source.physicalLine).toBe(3);
    expect(corner.from).toEqual({x:10,y:-1,z:0});expect(corner.to).toEqual({x:11,y:0,z:0});
    for(let i=1;i<result.length;i++)expect(result[i].from).toEqual(result[i-1].to);
  });
  it('圆弧补偿真正改变半径，并重新计算弧长且无端点跳变',()=>{
    const arc={...make([10,0],[0,10],2),mode:'arc_ccw' as const,arc:{centerX:0,centerY:0,radius:10,startAngle:0,sweep:Math.PI/2}};
    const result=applyCutterCompensation([make([10,-10],[10,0],1),arc,make([0,10],[-10,10],3),make([-10,10],[-20,20],4,'cancel')]) as Motion[];
    const actual=result.find(m=>m.source.physicalLine===2)!;
    expect(actual.arc?.radius).toBe(9);expect(actual.lengthMm).toBeCloseTo(9*Math.PI/2);expect(actual.to).toEqual({x:0,y:9,z:0});
    expect(actual.from).toEqual({x:9,y:0,z:0});
  });
  it('刀补半径大于凹圆弧时拒绝并保留原行',()=>{
    const arc={...make([1,0],[0,1],2),mode:'arc_ccw' as const,arc:{centerX:0,centerY:0,radius:1,startAngle:0,sweep:Math.PI/2}};
    expect(()=>applyCutterCompensation([make([1,-10],[1,0],1),arc])).toThrow(/半径/);
  });
  it('补偿期间的整圆仍是真正XY路径，起点终点与整弧半径连续一致',()=>{
    const circle={...make([10,0],[10,0],2),mode:'arc_ccw' as const,arc:{centerX:0,centerY:0,radius:10,startAngle:0,sweep:2*Math.PI}};
    const result=applyCutterCompensation([make([10,-10],[10,0],1),circle,make([10,0],[20,0],3,'cancel')]) as Motion[];
    const arc=result.find(i=>i.source.physicalLine===2)!;
    expect(arc.arc!.radius).toBe(9);expect(arc.from).toEqual({x:9,y:0,z:0});expect(arc.to).toEqual(arc.from);
    expect(arc.lengthMm).toBeCloseTo(18*Math.PI);expect(arc.arc!.startAngle).toBe(0);expect(result.at(-1)!.from).toEqual(arc.to);
  });
});
