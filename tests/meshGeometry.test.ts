import { describe, expect, it } from 'vitest';
import { BoxGeometry } from 'three';
import type { PreparedMesh } from '../src/core/meshTypes';
import { closestPointOnMesh, pointInsideMesh, queryMeshTriangles, triangleAt, validateSolidMesh, validateSurfaceMesh } from '../src/core/meshGeometry';

function box(min: [number,number,number]=[0,0,0], max: [number,number,number]=[2,2,2]):PreparedMesh {
  const g=new BoxGeometry(max[0]-min[0],max[1]-min[1],max[2]-min[2]).toNonIndexed();
  const p=g.getAttribute('position'), t=new Float64Array(p.count*3);
  for(let i=0;i<p.count;i++)for(let a=0;a<3;a++)t[i*3+a]=p.array[i*3+a]+(min[a]+max[a])/2;
  g.dispose(); return {objectId:'box',role:'stock',closed:true,triangles:t,bounds:{min,max}};
}
function joined(a:PreparedMesh,b:PreparedMesh):PreparedMesh {
  return {...a,triangles:Float64Array.from([...a.triangles,...b.triangles]),bounds:{min:a.bounds.min.map((v,i)=>Math.min(v,b.bounds.min[i])) as [number,number,number],max:a.bounds.max.map((v,i)=>Math.max(v,b.bounds.max[i])) as [number,number,number]}};
}
describe('immutable machine-space mesh queries and validation',()=>{
  it('accepts a closed box and uses containment even far from every surface',()=>{
    const m=box(); expect(()=>validateSolidMesh(m)).not.toThrow();
    expect(pointInsideMesh(m,[1,1,1])).toBe(true); expect(pointInsideMesh(m,[0,1,1])).toBe(true);
    expect(pointInsideMesh(m,[3,1,1])).toBe(false);
  });
  it('keeps nested closed shell cavities empty independent of ray edge coincidences',()=>{
    const m=joined(box([0,0,0],[4,4,4]),box([1,1,1],[3,3,3]));
    expect(()=>validateSolidMesh(m)).not.toThrow();
    expect(pointInsideMesh(m,[2,2,2])).toBe(false); expect(pointInsideMesh(m,[.5,2,2])).toBe(true);
  });
  it('rejects open solids while supporting explicit conservative surface fixtures',()=>{
    const m:PreparedMesh={objectId:'plate',role:'fixture',closed:false,triangles:new Float64Array([0,0,0,2,0,0,0,2,0]),bounds:{min:[0,0,0],max:[2,2,0]}};
    expect(()=>validateSolidMesh(m)).toThrow(/闭合|closed/i); expect(()=>validateSurfaceMesh(m)).not.toThrow();
    expect(()=>pointInsideMesh(m,[.5,.5,0])).toThrow(/闭合|closed/i);
  });
  it('rejects degenerate, nonmanifold and inconsistently wound triangle soups',()=>{
    const m=box(),degenerate={...m,triangles:Float64Array.from([0,0,0,1,0,0,2,0,0])};
    expect(()=>validateSolidMesh(degenerate)).toThrow(/退化|degenerate/i);
    expect(()=>validateSolidMesh({...m,triangles:Float64Array.from([...m.triangles,...m.triangles.slice(0,9)])})).toThrow(/流形|manifold/i);
    const bad=m.triangles.slice(); for(let a=0;a<3;a++)[bad[3+a],bad[6+a]]=[bad[6+a],bad[3+a]];
    expect(()=>validateSolidMesh({...m,triangles:bad})).toThrow(/方向|winding/i);
  });
  it('rejects crossing closed shells and overlapping coplanar surfaces',()=>{
    expect(()=>validateSolidMesh(joined(box(),box([1,1,1],[3,3,3])))).toThrow(/自交|intersect/i);
    const plate:PreparedMesh={objectId:'bad',role:'fixture',closed:false,triangles:new Float64Array([0,0,0,3,0,0,0,3,0,1,0,0,4,0,0,1,3,0]),bounds:{min:[0,0,0],max:[4,3,0]}};
    expect(()=>validateSurfaceMesh(plate)).toThrow(/自交|intersect/i);
  });
  it('rejects false bounds that could conceal triangles and nonfinite vertices',()=>{
    const m=box(); expect(()=>validateSolidMesh({...m,bounds:{min:[0,0,0],max:[1,1,1]}})).toThrow(/包围|bounds/i);
    const t=m.triangles.slice(); t[0]=NaN; expect(()=>validateSolidMesh({...m,triangles:t})).toThrow(/有限|finite/i);
  });
  it('finds triangle crossings without requiring a vertex inside the query box',()=>{
    const m=box();const candidates=queryMeshTriangles(m,{min:[-.1,.9,.9],max:[.1,1.1,1.1]});
    expect(candidates.length).toBe(2); expect(candidates.every(i=>triangleAt(m,i).every(p=>p[0]===0))).toBe(true);
    expect(queryMeshTriangles(m,{min:[5,5,5],max:[6,6,6]})).toEqual([]);
  });
  it('returns the surface witness and true closest distance, including edge/vertex cases',()=>{
    const m=box(); const result=closestPointOnMesh(m,[3,1,1]);
    expect(result.distance).toBeCloseTo(1); expect(result.point).toEqual([2,1,1]);
    expect(closestPointOnMesh(m,[3,3,3]).distance).toBeCloseTo(Math.sqrt(3));
    expect(closestPointOnMesh(m,[1,1,1]).distance).toBeCloseTo(1);
  });
});

describe('strict manifold and resource guards',()=>{
  it('rejects closed shells touching at a vertex as a nonmanifold solid',()=>{
    const a=box(),b=box([2,2,2],[4,4,4]);
    expect(()=>validateSolidMesh(joined(a,b))).toThrow(/流形|manifold/i);
  });
  it('keeps a deterministic broadphase result for large empty queries',()=>{
    const m=box();expect(queryMeshTriangles(m,{min:[-1,-1,-1],max:[3,3,3]}).sort((a,b)=>a-b)).toEqual([0,1,2,3,4,5,6,7,8,9,10,11]);
  });
  it('rejects triangle counts beyond the collision validation budget before allocating an index',()=>{
    const m={...box(),triangles:new Float64Array(200001*9)};
    expect(()=>validateSolidMesh(m)).toThrow(/预算/);
  });
  it('gets interior/outside decisions for rays originating on a box diagonal plane',()=>{
    const m=box();for(const p of [[.1,.1,.1],[1,1,1],[1.9,1.9,1.9]] as [number,number,number][])expect(pointInsideMesh(m,p)).toBe(true);
    expect(pointInsideMesh(m,[-.01,1,1])).toBe(false);
  });
});

describe('containment near parallel to sliver triangles',()=>{
  it('retries an ill-conditioned ray instead of declaring an interior point clear',()=>{
    const d=[1,.3713906763541037,.529177210903],dl=Math.hypot(...d),unit=d.map(v=>v/dl);
    const nl=Math.hypot(d[0],d[1]),n0=[-d[1]/nl,d[0]/nl,0],delta=1e-5;
    const n=n0.map((v,i)=>(v+delta*unit[i])/Math.sqrt(1+delta*delta));
    const z=unit.map((v,i)=>(v-n[i]*delta/Math.sqrt(1+delta*delta))/Math.sqrt(1-delta*delta/(1+delta*delta)));
    const y=[z[1]*n[2]-z[2]*n[1],z[2]*n[0]-z[0]*n[2],z[0]*n[1]-z[1]*n[0]];
    const transform=(p:number[])=>n.map((v,i)=>v*p[0]+y[i]*p[1]+z[i]*p[2]) as [number,number,number];
    const g=new BoxGeometry(2,2,2,1,2,1).toNonIndexed(),p=g.getAttribute('position'),values:number[]=[],min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<p.count;i++){const v=transform([p.getX(i),p.getY(i)===0?-.99999:p.getY(i),p.getZ(i)]);values.push(...v);for(let a=0;a<3;a++){min[a]=Math.min(min[a],v[a]);max[a]=Math.max(max[a],v[a]);}}
    g.dispose();const m:PreparedMesh={objectId:'sliver',role:'stock',closed:true,triangles:new Float64Array(values),bounds:{min,max}};
    expect(pointInsideMesh(m,transform([1-1e-6,-.999995,-.5]))).toBe(true);
  });
});
