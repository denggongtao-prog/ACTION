import { describe,it,expect } from 'vitest';
import { DexelStock } from '../src/core/stock';
import { createStockUpdate } from '../src/core/stockMesh';
import type { StockUpdate,Tool } from '../src/core/types';
import { StockSurface } from '../src/components/StockSurface';
function volume(patch:StockUpdate){
  let sum=0;
  for(const tile of patch.tiles){
    const p=tile.positions;
    for(let i=0;i<p.length;i+=9)sum+=(p[i]*(p[i+4]*p[i+8]-p[i+5]*p[i+7])+p[i+1]*(p[i+5]*p[i+6]-p[i+3]*p[i+8])+p[i+2]*(p[i+3]*p[i+7]-p[i+4]*p[i+6]))/6;
  }
  return sum;
}
const tool:Tool={toolId:'t',toolNumber:1,type:'flat_endmill',diameterMm:2,cuttingLengthMm:4,gaugeLengthMm:30,shaftDiameterMm:2,holder:{diameterMm:20,lengthMm:20}};
describe('材料分块表面',()=>{
  it('初始块料三角面有向体积等于解析体积',()=>{
    const stock=new DexelStock({objectId:'s',kind:'box',sizeMm:[4,4,10],minCornerInW:[-2,-2,-10]},1);
    const update=createStockUpdate(stock)!;
    expect(update.full).toBe(true);expect(volume(update)).toBeCloseTo(160,5);
    expect(createStockUpdate(stock)).toBeNull();
  });
  it('多层实体与通孔网格体积等于剩余区间体积',()=>{
    const stock=new DexelStock({objectId:'s',kind:'box',sizeMm:[2,2,20],minCornerInW:[-1,-1,-20]},1);
    stock.carveLine({x:0,y:0,z:-12},{x:0,y:0,z:-12},tool);
    let update=createStockUpdate(stock)!;
    expect(volume(update)).toBeCloseTo(stock.stats().remainingVolumeMm3,5);
    stock.carveLine({x:-.5,y:-.5,z:-30},{x:-.5,y:-.5,z:10},{...tool,diameterMm:.5});
    update=createStockUpdate(stock)!;
    expect(volume(update)).toBeCloseTo(stock.stats().remainingVolumeMm3,5);
  });
  it('所有材料被去除后发送空块以删除旧网格',()=>{
    const stock=new DexelStock({objectId:'s',kind:'box',sizeMm:[1,1,10],minCornerInW:[-.5,-.5,-10]},1);
    createStockUpdate(stock);
    stock.carveLine({x:0,y:0,z:-20},{x:0,y:0,z:10},tool);
    const update=createStockUpdate(stock)!;
    expect(update.full).toBe(false);expect(update.tiles[0].positions.length).toBe(0);
    expect(stock.stats().remainingVolumeMm3).toBe(0);
  });
  it('大世界坐标的小毛坯保持局部尺寸，显示对象定位到世界原点',()=>{
    const stock=new DexelStock({objectId:'s',kind:'box',sizeMm:[.1,.1,.1],minCornerInW:[1000000,-1000000,1000000]},.1);
    const update=createStockUpdate(stock)!;
    expect(volume(update)).toBeCloseTo(.001,9);
    const surface=new StockSurface();
    try{
      surface.apply(update);
      expect(surface.group.position.toArray()).toEqual(stock.min);
      const positions=update.tiles[0].positions;
      for(let axis=0;axis<3;axis++){
        const values=Array.from(positions).filter((_,i)=>i%3===axis);
        expect(Math.min(...values)).toBeCloseTo(0,8);
        expect(Math.max(...values)).toBeCloseTo(.1,8);
      }
    }finally{surface.dispose();}
  });
});

