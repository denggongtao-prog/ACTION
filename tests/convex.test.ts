import { describe,it,expect } from 'vitest';
import { convexDistance,boxSupport,toolSupport } from '../src/core/convex';
import type { Tool } from '../src/core/types';
const tool:Tool={toolId:'t',toolNumber:1,type:'flat_endmill',diameterMm:2,cuttingLengthMm:4,gaugeLengthMm:10,shaftDiameterMm:2,holder:{diameterMm:4,lengthMm:4}};
describe('凸体距离与见证点',()=>{
  it('圆柱与薄盒保持解析间距及障碍物见证点',()=>{
    const d=convexDistance(toolSupport(tool,'cutter',[0,0,0]),boxSupport({min:[3,-2,0],max:[3.01,2,4]}));
    expect(d.upper).toBeCloseTo(2,5);expect(d.lower).toBeCloseTo(2,5);
    expect(d.obstacle[0]).toBeCloseTo(3,5);expect(d.tool[0]).toBeCloseTo(1,5);
  });
  it('完全包含和相切不能判定分离',()=>{
    expect(convexDistance(toolSupport(tool,'cutter',[0,0,0]),boxSupport({min:[-5,-5,-5],max:[5,5,5]})).upper).toBeLessThan(1e-6);
    expect(convexDistance(toolSupport(tool,'cutter',[0,0,0]),boxSupport({min:[1,-2,0],max:[2,2,4]})).lower).toBeLessThan(1e-6);
  });
  it('球头及钻尖尖端不能当作整根圆柱',()=>{
    const corner=boxSupport({min:[.8,-.05,0],max:[.9,.05,.05]});
    const flat=convexDistance(toolSupport(tool,'cutter',[0,0,0]),corner);
    const ball=convexDistance(toolSupport({...tool,type:'ball_endmill'},'cutter',[0,0,0]),corner);
    const drill=convexDistance(toolSupport({...tool,type:'drill'},'cutter',[0,0,0]),corner);
    expect(flat.upper).toBeLessThan(1e-6);expect(ball.lower).toBeGreaterThan(.1);expect(drill.lower).toBeGreaterThan(.1);
  });
});
