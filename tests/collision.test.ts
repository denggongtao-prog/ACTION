import { describe,it,expect } from 'vitest';
import { CollisionKernel } from '../src/core/collision';
import { DexelStock } from '../src/core/stock';
import { parseProgram } from '../src/core/gcode';
import { demoJob } from '../src/lib/demo';
import type { Job,Motion } from '../src/core/types';
import type { PreparedMesh } from '../src/core/meshTypes';
function sheet():PreparedMesh{return {objectId:'thin',role:'fixture',closed:false,bounds:{min:[0,-10,-10],max:[0,10,8]},triangles:new Float64Array([0,-10,-10,0,10,-10,0,10,8,0,-10,-10,0,10,8,0,-10,8])};}
function task():Job{const j=demoJob();j.stock={objectId:'s',kind:'box',minCornerInW:[-5,-5,-10],sizeMm:[10,10,10]};j.tools=[{...j.tools[0],diameterMm:2,cuttingLengthMm:4,gaugeLengthMm:10,shaftDiameterMm:2,holder:{diameterMm:4,lengthMm:4}}];j.initialPositionMm=[-10,0,5];j.preparedMeshes=[sheet()];return j;}
function move(j:Job,code='G1 X10 F600'):Motion{return parseProgram(code,j.tools,{x:j.initialPositionMm[0],y:j.initialPositionMm[1],z:j.initialPositionMm[2]}).find(i=>i.kind==='motion') as Motion;}
describe('连续路径检查',()=>{
  it('两个端点安全仍捕获薄夹具并定位障碍物见证点及原始行',()=>{
    const j=task(),stock=new DexelStock(j.stock,.5),kernel=new CollisionKernel(j,stock);
    const hit=kernel.find(move(j,';comment\n\nN350 G1 X10 F600'),0,1)!;
    expect(hit.event.collisionType).toBe('CUTTER_FIXTURE');expect(hit.event.source.physicalLine).toBe(3);expect(hit.event.source.blockNumber).toBe(350);
    expect(hit.event.contact!.point[0]).toBeCloseTo(0,7);
    expect(hit.safeT).toBeGreaterThan(.44);expect(hit.hitT).toBeLessThan(.46);
    expect((hit.event.contact!.pathParameterBracket[1]-hit.event.contact!.pathParameterBracket[0])*20).toBeLessThanOrEqual(.05);
  });
  it('G0穿入毛坯与主轴停转进给分类不同',()=>{
    const j=task();j.preparedMeshes=[];j.initialPositionMm=[-10,0,-2];
    const kernel=new CollisionKernel(j,new DexelStock(j.stock,.5));
    expect(kernel.find(move(j,'G0 X10'),0,1)?.event.collisionType).toBe('RAPID_STOCK');
    expect(kernel.find(move(j,'G1 X10 F600'),0,1)?.event.collisionType).toBe('SPINDLE_STOCK');
  });
  it('有效切削允许刀刃但不能屏蔽刀杆及刀柄',()=>{
    const j=task();j.preparedMeshes=[];j.initialPositionMm=[-10,0,-2];
    const kernel=new CollisionKernel(j,new DexelStock(j.stock,.5));
    expect(kernel.find(move(j,'M3 S3000\nG1 X10 F600'),0,1)).toBeNull();
    j.initialPositionMm=[-10,0,-6];
    expect(kernel.find(move(j,'M3 S3000\nG1 X10 F600'),0,1)?.event.collisionType).toBe('SHAFT_STOCK');
  });
  it('圆弧中段撞薄障碍，不借助端点推断安全',()=>{
    const j=task();j.initialPositionMm=[-10,0,5];
    const kernel=new CollisionKernel(j,new DexelStock(j.stock,.5));
    expect(kernel.find(move(j,'G3 X10 Y0 I10 J0 F600'),0,1)).not.toBeNull();
  });
  it('精确障碍前保留0.001mm间隙的路径可以证明分离',()=>{
    const j=task();const kernel=new CollisionKernel(j,new DexelStock(j.stock,.5));
    expect(kernel.find(move(j,'G1 X-1.001 F600'),0,1)).toBeNull();
  });
});
