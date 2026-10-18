import { describe, expect, it } from 'vitest';
import { BoxGeometry } from 'three';
import type { PreparedMesh } from '../src/core/meshTypes';
import { initializeMeshStock } from '../src/core/meshStock';
function box(min: [number,number,number],max: [number,number,number]):PreparedMesh {
  const g=new BoxGeometry(max[0]-min[0],max[1]-min[1],max[2]-min[2]).toNonIndexed(), p=g.getAttribute('position');
  const t=Float64Array.from(p.array,(v,i)=>v+(min[i%3]+max[i%3])/2);g.dispose();
  return {objectId:'raw',role:'stock',closed:true,triangles:t,bounds:{min,max}};
}
describe('closed mesh Z dexel initialization',()=>{
  it('initializes transformed world coordinates with deterministic diagonal ray hits',()=>{
    const m=box([10,20,30],[12,22,34]); const result=initializeMeshStock(m,2,2,1,1,[10,20,30],[2,2,4]);
    expect(result.columns).toEqual([[30,34],[30,34],[30,34],[30,34]]);
  });
  it('pairs multiple shells into intervals rather than filling their cavity',()=>{
    const outer=box([0,0,0],[4,4,4]), inner=box([1,1,1],[3,3,3]);
    const m={...outer,triangles:Float64Array.from([...outer.triangles,...inner.triangles])};
    const r=initializeMeshStock(m,4,4,1,1,[0,0,0],[4,4,4]);
    expect(r.columns[5]).toEqual([0,1,3,4]); expect(r.columns[0]).toEqual([0,4]);
  });
  it('keeps off-center thin material conservatively covered across a cell footprint',()=>{
    const m=box([.0625,.0625,0],[.125,.125,2]); const r=initializeMeshStock(m,1,1,1,1,[0,0,0],[1,1,2]);
    expect(r.columns[0]).toEqual([]); expect(r.conservativeColumns[0]).toEqual([0,2]);
    expect(r.boundaryCells[0]).toBe(true);
  });
  it('finds analytical sloped tetrahedron top and bounds its entire footprint',()=>{
    const m:PreparedMesh={objectId:'tetra',role:'stock',closed:true,triangles:new Float64Array([0,0,0,0,2,0,2,0,0,0,0,0,2,0,0,0,0,2,0,0,0,0,0,2,0,2,0,2,0,0,0,2,0,0,0,2]),bounds:{min:[0,0,0],max:[2,2,2]}};
    const r=initializeMeshStock(m,2,2,1,1,[0,0,0],[2,2,2]);
    expect(r.columns[0]).toEqual([0,1]); expect(r.columns[3]).toEqual([]);
    expect(r.conservativeColumns[0][1]).toBeCloseTo(2);
  });
  it('refuses open or crossing solids and grids that would silently crop the mesh',()=>{
    const a=box([0,0,0],[2,2,2]), b=box([1,1,1],[3,3,3]);
    expect(()=>initializeMeshStock({...a,closed:false},2,2,1,1,[0,0,0],[2,2,2])).toThrow();
    expect(()=>initializeMeshStock({...a,triangles:Float64Array.from([...a.triangles,...b.triangles]),bounds:{min:[0,0,0],max:[3,3,3]}},3,3,1,1,[0,0,0],[3,3,3])).toThrow(/自交|intersect/i);
    expect(()=>initializeMeshStock(a,1,1,1,1,[0,0,0],[1,1,2])).toThrow(/范围|覆盖|bounds/i);
  });
});


describe('conservative footprint error bound',()=>{
  it('clips sloped triangle z bounds to the actual XY cell instead of its whole bounding box',()=>{
    const m:PreparedMesh={objectId:'tetra',role:'stock',closed:true,triangles:new Float64Array([0,0,0,0,2,0,2,0,0,0,0,0,2,0,0,0,0,2,0,0,0,0,0,2,0,2,0,2,0,0,0,2,0,0,0,2]),bounds:{min:[0,0,0],max:[2,2,2]}};
    const r=initializeMeshStock(m,4,4,.5,.5,[0,0,0],[2,2,2]);
    expect(r.conservativeColumns[2][0]).toBe(0);expect(r.conservativeColumns[2][1]).toBeCloseTo(1,8);
    expect(r.conservativeColumns[15]).toEqual([]);
  });
});
