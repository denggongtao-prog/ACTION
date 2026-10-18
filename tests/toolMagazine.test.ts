import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {demoJob} from '../src/lib/demo';
import {toolMagazineLayout,exchangePose} from '../src/core/toolExchange';
import {createToolModel} from '../src/components/ToolModel';
import {ToolChangerView} from '../src/components/ToolChangerView';
import type {Tool} from '../src/core/types';
describe('毫米尺寸刀库与刀具显示',()=>{
  it.each([4,150])('刀柄长度%imm时，实际刀套网格位于夹持槽内，主轴实体不侵入刀柄',length=>{
    vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>({fillRect(){},fillText(){}})})});
    try{
      const tools=demoJob().tools.map(t=>({...t,holder:{...t.holder,lengthMm:length}}));
      const changer=new ToolChangerView(tools,createToolModel);
      changer.update({instructionId:1,source:{physicalLine:1,blockNumber:null,sourceText:'T2 M6'},fromTool:1,toTool:2,oldTip:{x:0,y:0,z:35},newTip:{x:0,y:0,z:40},progress:0,phase:'release',phaseProgress:0,illustrative:true});
      changer.group.updateMatrixWorld(true);
      const fork=new THREE.Box3().setFromObject(changer.group.getObjectByName('holder-fork-1')!);
      expect(fork.min.z).toBeGreaterThanOrEqual(85+length*.28-1e-5);expect(fork.max.z).toBeLessThanOrEqual(85+length*.4+1e-5);
      const spindle=new THREE.Box3().setFromObject(changer.group.getObjectByName('spindle-solid')!);
      expect(spindle.min.z).toBeGreaterThanOrEqual(85+length);
    }finally{vi.unstubAllGlobals();}
  });
  it('按完整刀具最大直径排布，任意相邻工位至少保留10mm净距',()=>{
    const tools=demoJob().tools,layout=toolMagazineLayout(tools);
    expect(layout.pocketCount).toBe(8);
    expect(2*layout.pitchRadiusMm*Math.sin(Math.PI/layout.pocketCount)-28-2*(4+.35)).toBeGreaterThanOrEqual(10-1e-8);
    const big=toolMagazineLayout([{...tools[0],diameterMm:80}]);
    expect(big.pitchRadiusMm).toBeGreaterThan(layout.pitchRadiusMm);
    expect(big.outerRadiusMm).toBeGreaterThan(layout.outerRadiusMm);
    const many=toolMagazineLayout(Array.from({length:13},(_,i)=>({...tools[0],toolNumber:i+100})));
    expect(many.pocketCount).toBeGreaterThanOrEqual(13);expect(new Set(many.slots.map(s=>s.angle))).toHaveProperty('size',13);
  });
  it('换刀阶段边界的刀尖连续，没有瞬移或独立动画时钟',()=>{
    const [old,next]=demoJob().tools,layout=toolMagazineLayout([old,next]);
    const frame={progress:0,fromTool:1,toTool:2,oldTip:{x:0,y:0,z:35},newTip:{x:0,y:0,z:40}};
    for(const p of [.12,.19,.35,.6,.76,.85]){
      const before=exchangePose({...frame,progress:p-1e-7},old,next,layout),after=exchangePose({...frame,progress:p+1e-7},old,next,layout);
      for(const key of ['oldTip','newTip'] as const)expect(Math.hypot(...(['x','y','z'] as const).map(a=>before[key][a]-after[key][a]))).toBeLessThan(.001);
    }
  });
  it('退刀后才转位，进刀后夹紧，两把刀的装夹基准保持实际尺寸',()=>{
    const [old,next]=demoJob().tools,layout=toolMagazineLayout([old,next]);
    const frame={progress:0,fromTool:1,toTool:2,oldTip:{x:0,y:0,z:35},newTip:{x:0,y:0,z:40}};
    expect(exchangePose(frame,old,next,layout).oldTip).toEqual(frame.oldTip);
    const parked=exchangePose({...frame,progress:.35},old,next,layout);
    const indexed=exchangePose({...frame,progress:.6},old,next,layout);
    expect(parked.rack).toEqual(indexed.rack);expect(parked.rotation).not.toBe(indexed.rotation);
    expect(parked.spindleLiftMm).toBeGreaterThan(old.holder.lengthMm);
    const done=exchangePose({...frame,progress:1},old,next,layout);
    expect(done.newTip).toEqual(frame.newTip);expect(done.spindleLiftMm).toBe(0);
  });
  it('侧头不冒充普通竖直刀套自动交换，完整刀具姿态仍沿实际轴线',()=>{
    const [old,t]=demoJob().tools,next={...t,axisDirection:{x:0,y:-1,z:0}};
    const frame={progress:.5,fromTool:1,toTool:2,oldTip:{x:0,y:0,z:40},newTip:{x:0,y:0,z:45}};
    expect(exchangePose(frame,old,next,toolMagazineLayout([old,next])).mode).toBe('side_head');
    expect(toolMagazineLayout([old,next]).slots.map(s=>s.toolNumber)).toEqual([1]);
  });
  it.each(['flat_endmill','ball_endmill','drill','profile_endmill'] as const)('%s刀具网格不超出声明包络，刀柄不为画面额外放大',type=>{
    const tool:Tool={...demoJob().tools[0],type,radialProfile:type==='profile_endmill'?[{zMm:0,radiusMm:0},{zMm:8,radiusMm:5},{zMm:20,radiusMm:5}]:undefined};
    const model=createToolModel(tool);model.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(model);
    expect(bounds.min.z).toBeGreaterThanOrEqual(-1e-5);expect(bounds.max.z).toBeCloseTo(80,4);
    expect(bounds.max.x-bounds.min.x).toBeCloseTo(28,4);
    model.traverse(o=>{if(o instanceof THREE.Mesh){const z=o.userData.part;
      const b=new THREE.Box3().setFromObject(o);if(z==='holder'){expect(b.min.z).toBeGreaterThanOrEqual(50-1e-5);expect(b.max.z).toBeLessThanOrEqual(80+1e-5);}
      if(z==='cutter')expect(Math.max(Math.abs(b.min.x),Math.abs(b.max.x))).toBeLessThanOrEqual(5+1e-5);
    }});
  });
});
