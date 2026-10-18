import { describe, expect, it } from 'vitest';
import { axisToTip, tipToAxis, axisToPhysicalTip, tableTranslation, componentTranslation, componentPhysicalTranslation, findLimitViolation, rapidWaypoints, validateMachineProfile, homeAxisPosition } from '../src/core/machine';
import type { MachineProfile } from '../src/core/machineTypes';
const profile: MachineProfile = {
  axes: {
    x:{direction:1,carrier:'table',zeroMm:10,minMm:-100,maxMm:100},
    y:{direction:-1,carrier:'table',zeroMm:0,minMm:-100,maxMm:100,parent:'x'},
    z:{direction:1,carrier:'tool',zeroMm:20,minMm:0,maxMm:200},
  }, rapidRateMmMin:6000,rapidMode:'linear',homeAxisPositionMm:{x:10,y:0,z:100},
  components:[{objectId:'saddle',drivenBy:['y']},{objectId:'spindle',drivenBy:['z']}],collisionPairs:[['spindle','saddle']],
};
describe('正交机床运动链',()=>{
  it('工作台轴取相对运动反向，安装刀长仅从量规点扣除一次',()=>{
    const axis={x:30,y:5,z:90};
    expect(axisToTip(axis,50,profile)).toEqual({x:-20,y:5,z:20});
    expect(tipToAxis({x:-20,y:5,z:20},50,profile)).toEqual(axis);
    expect(axisToPhysicalTip(axis,50,profile)).toEqual({x:0,y:0,z:20});
    expect(tableTranslation(axis,profile)).toEqual({x:20,y:-5,z:0});
  });
  it('部件父链继承一次并在内部参考框架减工作台平移',()=>{
    const axis={x:30,y:5,z:90};
    expect(componentPhysicalTranslation('saddle',axis,profile)).toEqual({x:20,y:-5,z:0});
    expect(componentTranslation('saddle',axis,profile)).toEqual({x:0,y:0,z:0});
    expect(componentTranslation('spindle',axis,profile)).toEqual({x:-20,y:5,z:70});
  });
  it('限位按实际轴坐标，边界合法且越界保留轴名和边界',()=>{
    expect(findLimitViolation({x:100,y:0,z:200},profile)).toBeNull();
    expect(findLimitViolation({x:101,y:0,z:100},profile)).toEqual({axis:'x',valueMm:101,minMm:-100,maxMm:100});
    expect(homeAxisPosition(profile)).toEqual({x:10,y:0,z:100});
  });
  it('逐轴快移返回实际路径拐点，线性模式只有终点',()=>{
    const from={x:0,y:0,z:0},to={x:5,y:7,z:9};
    expect(rapidWaypoints(from,to,{...profile,rapidMode:'axis_sequential',rapidAxisOrder:['z','x','y']})).toEqual([{x:0,y:0,z:9},{x:5,y:0,z:9},{x:5,y:7,z:9}]);
    expect(rapidWaypoints(from,to,profile)).toEqual([to]);
  });
  it.each([
    {...profile,rapidRateMmMin:0},
    {...profile,axes:{...profile.axes,x:{...profile.axes.x,direction:0}}},
    {...profile,axes:{...profile.axes,x:{...profile.axes.x,parent:'y'}}},
    {...profile,rapidAxisOrder:['x','x','z']},
    {...profile,components:[{objectId:'bad',drivenBy:['a']}]},
    {...profile,components:[{objectId:'same',drivenBy:['x']},{objectId:'same',drivenBy:['z']}]},
    {...profile,collisionPairs:[['spindle','spindle']]},
    {...profile,collisionPairs:[['spindle','*']]},
    {...profile,collisionExclusions:[{objects:['spindle','*']}]},
    {...profile,collisionExclusions:[{objects:['spindle','saddle'],roles:['machine']}]},
    {...profile,collisionExclusions:[{objects:['spindle','saddle'],stages:['*']}]},
  ])('拒绝非三轴/退化或歧义机床配置',p=>{
    expect(()=>validateMachineProfile(p)).toThrow();
  });
  it('接受明确的正交机床定义',()=>expect(()=>validateMachineProfile(profile)).not.toThrow());
  it('精确对象对可仅在指定换刀阶段排除装配接触',()=>{
    expect(()=>validateMachineProfile({...profile,collisionExclusions:[{objects:['spindle','tool-1:holder'],stages:['clamp_new']}]})).not.toThrow();
  });
});
