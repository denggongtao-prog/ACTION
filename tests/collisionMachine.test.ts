import { describe, expect, it } from 'vitest';
import { BoxGeometry } from 'three';
import { machinePairDistance } from '../src/core/collisionMachine';
import { DexelStock } from '../src/core/stock';
import { InputError } from '../src/core/types';
import type { Job, Vec3 } from '../src/core/types';
import type { PreparedMesh } from '../src/core/meshTypes';
import type { Point3 } from '../src/core/collisionTypes';
import { demoJob } from '../src/lib/demo';
function mesh(id:string,min:Point3,max:Point3,role:PreparedMesh['role']='machine'):PreparedMesh {
  const g=new BoxGeometry(...max.map((v,i)=>v-min[i]) as [number,number,number]).toNonIndexed(),p=g.getAttribute('position'),triangles=new Float64Array(p.count*3);
  for(let i=0;i<p.count;i++)for(let a=0;a<3;a++)triangles[i*3+a]=p.array[i*3+a]+(min[a]+max[a])/2;
  g.dispose();return {objectId:id,role,closed:true,triangles,bounds:{min,max}};
}
function fixture():{job:Job;stock:DexelStock} {
  const job=demoJob();job.stock={objectId:'stock',kind:'box',minCornerInW:[0,0,0],sizeMm:[2,2,2]};
  job.machineProfile={axes:{x:{direction:1,carrier:'tool',zeroMm:0,minMm:-100,maxMm:100},y:{direction:1,carrier:'tool',zeroMm:0,minMm:-100,maxMm:100},z:{direction:1,carrier:'tool',zeroMm:0,minMm:-100,maxMm:100}},rapidRateMmMin:6000,rapidMode:'linear',components:[{objectId:'moving',drivenBy:['x']}],collisionPairs:[['moving','stock']]};
  job.preparedMeshes=[mesh('moving',[-4,.5,.5],[-2,1.5,1.5])];return {job,stock:new DexelStock(job.stock,.5)};
}
const origin:Vec3={x:0,y:0,z:0};
const onBoxSurface=(p:Point3,min:Point3,max:Point3)=>p.every((v,i)=>v>=min[i]-1e-7&&v<=max[i]+1e-7)&&p.some((v,i)=>Math.abs(v-min[i])<1e-7||Math.abs(v-max[i])<1e-7);
describe('显式机床部件检查对象对',()=>{
  it('实际平移后的机床网格撞入初始毛坯，障碍见证点来自毛坯表面',()=>{
    const {job,stock}=fixture();let calls=0;
    const apart=machinePairDistance(job,stock,origin,()=>calls++)!;
    expect(apart.lower).toBeCloseTo(2,6);expect(apart.upper).toBeCloseTo(2,6);
    const hit=machinePairDistance(job,stock,{x:3,y:0,z:0},()=>calls++)!;
    expect(hit.lower).toBe(0);expect(hit.upper).toBeCloseTo(0,7);expect(hit.kind).toBe('MACHINE_STOCK');
    expect(hit.objects).toEqual(['moving','stock']);expect(hit.potential).toBe(false);expect(hit.error).toBe(0);
    expect(onBoxSurface(hit.obstacle,[0,0,0],[2,2,2])).toBe(true);expect(calls).toBeGreaterThan(0);
  });
  it('工作台坐标的相对变换与tool轴运动得到相同接触',()=>{
    const {job,stock}=fixture();job.machineProfile!.axes.x.carrier='table';job.machineProfile!.components![0].drivenBy=[];
    expect(machinePairDistance(job,stock,{x:-3,y:0,z:0},()=>{})!.upper).toBeCloseTo(0,7);
  });
  it.each([
    [[.5,.5,.5],[1.5,1.5,1.5]],
    [[-1,-1,-1],[3,3,3]],
  ] as [Point3,Point3][])('双方完全包含也算实体重叠，stock见证点仍在表面', (min,max)=>{
    const {job,stock}=fixture();job.preparedMeshes=[mesh('moving',min,max)];
    const hit=machinePairDistance(job,stock,origin,()=>{})!;
    expect(hit.lower).toBe(0);expect(hit.upper).toBe(0);
    expect(onBoxSurface(hit.obstacle,[0,0,0],[2,2,2])).toBe(true);
  });
  it('对象对反序不改变stock作为障碍物见证点的语义',()=>{
    const {job,stock}=fixture();job.machineProfile!.collisionPairs=[['stock','moving']];
    const hit=machinePairDistance(job,stock,{x:3,y:0,z:0},()=>{})!;
    expect(hit.objects).toEqual(['stock','moving']);expect(onBoxSurface(hit.obstacle,[0,0,0],[2,2,2])).toBe(true);
  });
  it('实际去料后使用剩余列体，保守单元接触必须标记未知误差',()=>{
    const {job,stock}=fixture();
    stock.carveLine({x:1,y:1,z:1},{x:1,y:1,z:1},{...job.tools[0],diameterMm:1,cuttingLengthMm:1,gaugeLengthMm:2});
    expect(stock.stats().removedVolumeMm3).toBeGreaterThan(0);
    job.preparedMeshes=[mesh('moving',[.05,.05,.1],[.3,.3,.3])];
    const hit=machinePairDistance(job,stock,origin,()=>{})!;
    expect(hit.upper).toBe(0);expect(hit.potential).toBe(true);expect(hit.error).toBe('unknown');expect(hit.method).toBe('stock_cell');
    expect(hit.obstacle.every(Number.isFinite)).toBe(true);
    expect(hit.obstacle.some(v=>Math.abs(v/.5-Math.round(v/.5))<1e-7)).toBe(true);
  });
  it('网格对完全包含及分离都返回实体距离',()=>{
    const {job,stock}=fixture();job.machineProfile!.collisionPairs=[['moving','fixed']];
    job.preparedMeshes=[mesh('moving',[-1,-1,-1],[1,1,1]),mesh('fixed',[-2,-2,-2],[2,2,2],'fixture')];
    expect(machinePairDistance(job,stock,origin,()=>{})!.upper).toBe(0);
    const separated=machinePairDistance(job,stock,{x:5,y:0,z:0},()=>{})!;
    expect(separated.lower).toBeCloseTo(2,6);expect(separated.upper).toBeCloseTo(2,6);expect(separated.kind).toBe('MACHINE_PAIR');
    expect(onBoxSurface(separated.obstacle,[-2,-2,-2],[2,2,2])).toBe(true);
  });
  it('所有部件对共同产生最小距离，不能只返回第一对',()=>{
    const {job,stock}=fixture();job.machineProfile!.collisionPairs=[['moving','far'],['moving','near']];
    job.preparedMeshes=[mesh('moving',[0,0,0],[1,1,1]),mesh('far',[6,0,0],[7,1,1],'fixture'),mesh('near',[3,0,0],[4,1,1],'fixture')];
    const hit=machinePairDistance(job,stock,origin,()=>{})!;
    expect(hit.lower).toBeCloseTo(2,6);expect(hit.upper).toBeCloseTo(2,6);expect(hit.objects).toEqual(['moving','near']);
  });
  it('精确安装对象对只在声明阶段排除',()=>{
    const {job,stock}=fixture();job.machineProfile!.collisionExclusions=[{objects:['stock','moving'],stages:['clamp_new']}];
    expect(machinePairDistance(job,stock,{x:3,y:0,z:0},()=>{},'clamp_new')).toBeNull();
    expect(machinePairDistance(job,stock,{x:3,y:0,z:0},()=>{},'motion')!.upper).toBeCloseTo(0,7);
  });
  it('缺失或target对象不允许伪造已检查结论',()=>{
    const {job,stock}=fixture();job.preparedMeshes![0].role='target';
    try{machinePairDistance(job,stock,origin,()=>{});expect.fail('missing collision model must reject');}
    catch(e){expect(e).toMatchObject({code:'MISSING_COLLISION_MODEL'});}
  });
  it('几何查询逐次计入调用方预算且预算错误直接传播',()=>{
    const {job,stock}=fixture();let calls=0;
    expect(()=>machinePairDistance(job,stock,origin,()=>{if(++calls===3)throw new InputError('budget',undefined,'COLLISION_BUDGET');})).toThrow(/budget/);
    expect(calls).toBe(3);
  });
});
