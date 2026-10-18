import { describe,expect,it } from 'vitest';
import { DexelStock, subtractIntervals } from '../src/core/stock';
import { cuttingTipOffset, drillTipHeight } from '../src/core/toolProfile';
import type { Job,Tool } from '../src/core/types';
const stockSpec=(size=[20,20,10],min=[-10,-10,-10]):Job['stock']=>({objectId:'stock',kind:'box',sizeMm:size,minCornerInW:min});
export const cutter=(type:Tool['type']='flat_endmill',diameter=4,length=20):Tool=>({toolId:'tool',toolNumber:1,type,diameterMm:diameter,cuttingLengthMm:length,gaugeLengthMm:50,shaftDiameterMm:diameter,holder:{diameterMm:28,lengthMm:30}});
describe('Z区间差集',()=>{
  it('中间切除保留上下两段，重叠切除不重复计算',()=>{
    expect(subtractIntervals([-20,0],-12,-8)).toEqual([-20,-12,-8,0]);
    expect(subtractIntervals([-20,-12,-8,0],-14,-6)).toEqual([-20,-14,-6,0]);
    expect(subtractIntervals([-20,0],1,5)).toEqual([-20,0]);
    expect(subtractIntervals([-20,0],-30,10)).toEqual([]);
  });
});
describe('切削刀形',()=>{
  it('平底、球头和118度钻尖使用不同下包络',()=>{
    expect(cuttingTipOffset(cutter(),1)).toBe(0);
    expect(cuttingTipOffset(cutter('ball_endmill',10),3)).toBeCloseTo(1);
    expect(drillTipHeight(cutter('drill',10))).toBeCloseTo(5/Math.tan(59*Math.PI/180));
    expect(cuttingTipOffset(cutter('drill',10),3)).toBeCloseTo(3/Math.tan(59*Math.PI/180));
  });
});
describe('Dexel材料去除',()=>{
  it('直线连续扫掠接近独立计算的腰圆槽体积',()=>{
    const stock=new DexelStock(stockSpec(),.25);
    stock.carveLine({x:-5,y:0,z:-2},{x:5,y:0,z:-2},cutter());
    const analytic=(4*10+Math.PI*4)*2;
    expect(Math.abs(stock.stats().removedVolumeMm3-analytic)).toBeLessThan(1.8);
    expect(stock.stats().remainingVolumeMm3+stock.stats().removedVolumeMm3).toBeCloseTo(4000);
  });
  it('整段扫掠不会漏掉两个端点之间的材料',()=>{
    const stock=new DexelStock(stockSpec([1,1,10],[-.5,-.5,-10]),1);
    stock.carveLine({x:-100,y:0,z:-3},{x:100,y:0,z:-3},cutter());
    expect(stock.getColumn(0,0)).toEqual([-10,-3]);
  });
  it('有限刃长保留上层，不退化成顶面高度图',()=>{
    const stock=new DexelStock(stockSpec([1,1,20],[-.5,-.5,-20]),1);
    stock.carveLine({x:0,y:0,z:-12},{x:0,y:0,z:-12},cutter('flat_endmill',2,4));
    expect(stock.getColumn(0,0)).toEqual([-20,-12,-8,0]);
    expect(stock.stats().removedVolumeMm3).toBe(4);
    stock.carveLine({x:0,y:0,z:-12},{x:0,y:0,z:-12},cutter('flat_endmill',2,4));
    expect(stock.stats().removedVolumeMm3).toBe(4);
  });
  it('相同刀尖下球头保留的截面高度高于平底',()=>{
    const flat=new DexelStock(stockSpec([1,1,10],[2.5,-.5,-10]),1);
    const ball=new DexelStock(stockSpec([1,1,10],[2.5,-.5,-10]),1);
    flat.carveLine({x:0,y:0,z:-5},{x:0,y:0,z:-5},cutter('flat_endmill',10));
    ball.carveLine({x:0,y:0,z:-5},{x:0,y:0,z:-5},cutter('ball_endmill',10));
    expect(flat.getColumn(0,0)).toEqual([-10,-5]);expect(ball.getColumn(0,0)[1]).toBeCloseTo(-4);
  });
  it('垂直钻入的径向截面符合钻尖角度',()=>{
    const stock=new DexelStock(stockSpec([1,1,10],[2.5,-.5,-10]),1);
    stock.carveLine({x:0,y:0,z:5},{x:0,y:0,z:-5},cutter('drill',10));
    expect(stock.getColumn(0,0)[1]).toBeCloseTo(-5+3/Math.tan(59*Math.PI/180),5);
  });
  it('直线分段与整段去除相同，重置恢复体积',()=>{
    const a=new DexelStock(stockSpec(),.5),b=new DexelStock(stockSpec(),.5);
    a.carveLine({x:-5,y:0,z:-2},{x:5,y:0,z:-4},cutter());
    for(let i=0;i<10;i++)b.carveLine({x:-5+i,y:0,z:-2-.2*i},{x:-4+i,y:0,z:-2.2-.2*i},cutter());
    expect(b.stats().removedVolumeMm3).toBeCloseTo(a.stats().removedVolumeMm3,7);
    b.reset();expect(b.stats().removedVolumeMm3).toBe(0);expect(b.stats().remainingVolumeMm3).toBe(4000);
  });
  it('分块边界变化同时标记邻块',()=>{
    const stock=new DexelStock(stockSpec([32,16,5],[0,0,-5]),1);stock.takeDirty();
    stock.carveLine({x:15.5,y:7.5,z:-1},{x:15.5,y:7.5,z:-1},cutter('flat_endmill',.8));
    expect(stock.takeDirty().tileIds.sort()).toEqual([0,1]);
    expect(stock.takeDirty().tileIds).toEqual([]);
  });
  it('超单元预算在分配前拒绝',()=>{
    expect(()=>new DexelStock(stockSpec([1000,1000,10],[0,0,-10]),.1)).toThrow(/160000/);
  });
  it('超过每列区间上限时不提交该段',()=>{
    const stock=new DexelStock(stockSpec([1,1,100],[-.5,-.5,-100]),1);
    for(let i=0;i<31;i++)stock.carveLine({x:0,y:0,z:-99+i*2},{x:0,y:0,z:-99+i*2},cutter('flat_endmill',2,.2));
    const before=stock.stats().removedVolumeMm3;
    expect(()=>stock.carveLine({x:0,y:0,z:-37},{x:0,y:0,z:-37},cutter('flat_endmill',2,.2))).toThrow(/32/);
    expect(stock.stats().removedVolumeMm3).toBe(before);
  });
});

