import { describe,it,expect } from 'vitest';
import { Box3, Vector3,Sprite,SpriteMaterial,Texture } from 'three';
import { loadAssetGroup,disposeObject } from '../src/lib/assets';
import type { Asset } from '../src/core/types';
function triangleGlb():ArrayBuffer {
  const positions=new Float32Array([0,0,0, 1,0,0, 0,1,0]);
  const model={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0,translation:[1,2,3]}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}]};
  const json=new TextEncoder().encode(JSON.stringify(model)),length=Math.ceil(json.length/4)*4;
  const data=new ArrayBuffer(12+8+length+8+36),view=new DataView(data);
  view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,data.byteLength,true);
  view.setUint32(12,length,true);view.setUint32(16,0x4e4f534a,true);
  new Uint8Array(data,20,length).fill(32);new Uint8Array(data,20,json.length).set(json);
  view.setUint32(20+length,36,true);view.setUint32(24+length,0x004e4942,true);
  new Uint8Array(data,28+length,36).set(new Uint8Array(positions.buffer));
  return data;
}
const asset=():Asset=>({objectId:'fixture',role:'fixture',format:'glb',unit:'m',buffer:triangleGlb(),poseInM:{translationMm:[10,20,30],quaternionXYZW:[0,0,Math.SQRT1_2,Math.SQRT1_2]}});
it('销毁刀库工位文字时释放Sprite纹理和材质，防止连续M6累积GPU资源',()=>{
  const group=new Group(),texture=new Texture(),material=new SpriteMaterial({map:texture});let textures=0,materials=0;
  texture.addEventListener('dispose',()=>textures++);material.addEventListener('dispose',()=>materials++);group.add(new Sprite(material));
  disposeObject(group);expect(textures).toBe(1);expect(materials).toBe(1);
});
describe('真实GLB载入与模型坐标',()=>{
  it('资源单位先缩放再施加安装旋转和平移',async()=>{
    const group=await loadAssetGroup([asset()],new AbortController().signal);group.updateMatrixWorld(true);
    const box=new Box3().setFromObject(group);
    expect(box.min.x).toBeCloseTo(-2990);expect(box.max.x).toBeCloseTo(-1990);
    expect(box.min.y).toBeCloseTo(1020);expect(box.max.y).toBeCloseTo(2020);
    expect(box.min.z).toBeCloseTo(3030);
    expect(box.getSize(new Vector3()).z).toBeCloseTo(0);
    disposeObject(group);
  });
  it('损坏GLB和已取消载入被拒绝',async()=>{
    await expect(loadAssetGroup([{...asset(),buffer:new ArrayBuffer(30)}],new AbortController().signal)).rejects.toThrow('GLB');
    const controller=new AbortController();controller.abort();
    await expect(loadAssetGroup([asset()],controller.signal)).rejects.toThrow();
  });
});


import { createHash } from 'node:crypto';
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, SkinnedMesh } from 'three';
import { prepareAssetMeshes } from '../src/lib/assets';
describe('collision asset preparation and immutable source identity',()=>{
  it('extracts transformed millimetre triangles with stable IDs and the SHA256 of original bytes',async()=>{
    const input=asset(),expected=createHash('sha256').update(new Uint8Array(input.buffer!)).digest('hex');
    const group=await loadAssetGroup([input],new AbortController().signal);
    new Uint8Array(input.buffer!).fill(0);
    const meshes=prepareAssetMeshes(group,[input]);
    expect(meshes).toHaveLength(1);expect(meshes[0].objectId).toBe('fixture');expect(meshes[0].role).toBe('fixture');
    expect(meshes[0].sha256).toBe(expected);expect(meshes[0].closed).toBe(false);
    expect(meshes[0].triangles[0]).toBeCloseTo(-1990);expect(meshes[0].triangles[1]).toBeCloseTo(1020);expect(meshes[0].triangles[2]).toBeCloseTo(3030);
    expect(meshes[0].bounds.min[0]).toBeCloseTo(-2990);
    // The collision copy does not follow subsequent render-geometry edits.
    group.traverse(o=>{if(o instanceof Mesh)o.geometry.getAttribute('position').setXYZ(0,99,99,99);});
    expect(meshes[0].triangles[0]).toBeCloseTo(-1990);disposeObject(group);
  });
  it('does not flatten an asset installation pose into its existing model root transform',()=>{
    const group=new Group(),wrapper=new Group(),geometry=new BoxGeometry(1,1,1),child=new Mesh(geometry,new MeshBasicMaterial());
    wrapper.name='fixed';wrapper.userData.assetObjectId='fixed';wrapper.position.set(10,20,30);wrapper.scale.setScalar(1000);child.position.set(1,2,3);wrapper.add(child);group.add(wrapper);
    const a:Asset={...asset(),objectId:'fixed',role:'fixture'};
    const m=prepareAssetMeshes(group,[a])[0];expect(m.bounds.min).toEqual([510,1520,2530]);expect(m.closed).toBe(true);disposeObject(group);
  });
  it('rejects skinned, morphing or absent geometry for collision objects',()=>{
    const make=(child:Mesh)=>{const group=new Group(),wrapper=new Group();wrapper.name='fixture';wrapper.userData.assetObjectId='fixture';wrapper.add(child);group.add(wrapper);return group;};
    const g=new BufferGeometry().setAttribute('position',new Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
    expect(()=>prepareAssetMeshes(make(new SkinnedMesh(g,new MeshBasicMaterial())),[asset()])).toThrow(/蒙皮|skinned/i);
    g.morphAttributes.position=[new Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3)];
    expect(()=>prepareAssetMeshes(make(new Mesh(g,new MeshBasicMaterial())),[asset()])).toThrow(/形变|morph/i);
    expect(()=>prepareAssetMeshes(new Group(),[asset()])).toThrow(/缺失|missing/i);
  });
  it('rejects oversized direct buffers before parsing rather than bypassing the download cap',async()=>{
    await expect(loadAssetGroup([{...asset(),buffer:new ArrayBuffer(32*1024*1024+1)}],new AbortController().signal)).rejects.toThrow(/32MB/);
  });
});

describe('bounded streamed model sources',()=>{
  it('hashes the fetched payload rather than its URL and preserves source identity after parsing',async()=>{
    const previous=globalThis.fetch,data=triangleGlb(),expected=createHash('sha256').update(new Uint8Array(data)).digest('hex');
    globalThis.fetch=async()=>new Response(data,{status:200});
    try{const a={...asset(),buffer:undefined,url:'https://example.test/triangle.glb'},group=await loadAssetGroup([a],new AbortController().signal);
      expect(prepareAssetMeshes(group,[a])[0].sha256).toBe(expected);disposeObject(group);
    }finally{globalThis.fetch=previous;}
  });
  it('cancels an over-budget stream even without a Content-Length header',async()=>{
    const previous=globalThis.fetch;let cancelled=false;
    globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(32*1024*1024+1));},cancel(){cancelled=true;}}));
    try{await expect(loadAssetGroup([{...asset(),buffer:undefined,url:'https://example.test/large.glb'}],new AbortController().signal)).rejects.toThrow(/32MB/);expect(cancelled).toBe(true);
    }finally{globalThis.fetch=previous;}
  });
  it('cancels a source aborted during streaming and rejects the entire load',async()=>{
    const previous=globalThis.fetch,abort=new AbortController();let cancelled=false;
    globalThis.fetch=async()=>new Response(new ReadableStream({pull(controller){abort.abort();controller.enqueue(new Uint8Array([1,2,3]));},cancel(){cancelled=true;}}));
    try{await expect(loadAssetGroup([{...asset(),buffer:undefined,url:'https://example.test/slow.glb'}],abort.signal)).rejects.toThrow(/取消/);expect(cancelled).toBe(true);
    }finally{globalThis.fetch=previous;}
  });
});

type NodeMapping={nodeName:string;objectId:string;role:'stock'|'fixture'|'machine'|'target'};
function mappedScene(){
  const group=new Group(),wrapper=new Group();wrapper.name='assembly';wrapper.userData.assetObjectId='assembly';wrapper.userData.sha256='source-sha';group.add(wrapper);
  const stockNode=new Group();stockNode.name='raw-node';stockNode.add(new Mesh(new BoxGeometry(2,2,2),new MeshBasicMaterial()));wrapper.add(stockNode);
  const fixture=new Group();fixture.name='fixture-node';fixture.position.x=5;fixture.add(new Mesh(new BoxGeometry(1,1,1),new MeshBasicMaterial()));wrapper.add(fixture);
  const target=new Group();target.name='target-node';target.add(new Mesh(new BoxGeometry(.5,.5,.5),new MeshBasicMaterial()));fixture.add(target);
  const a:Asset&{nodes:NodeMapping[]}={...asset(),objectId:'assembly',role:'target',nodes:[{nodeName:'raw-node',objectId:'raw',role:'stock'},{nodeName:'fixture-node',objectId:'clamp',role:'fixture'},{nodeName:'target-node',objectId:'finished',role:'target'}]};
  return {group,wrapper,a,stockNode,fixture,target};
}
describe('explicit mixed-role GLB node mappings',()=>{
  it('splits mapped geometry and inherits the nearest mapping without dropping unmapped descendants',()=>{
    const {group,a,stockNode,fixture}=mappedScene();const meshes=prepareAssetMeshes(group,[a]);
    expect(meshes.map(m=>[m.objectId,m.role])).toEqual([['raw','stock'],['clamp','fixture'],['finished','target']]);
    expect(meshes[0].triangles.length).toBe(108);expect(meshes[1].triangles.length).toBe(108);expect(meshes[1].bounds.min[0]).toBe(4.5);
    expect(meshes.every(m=>m.sha256==='source-sha')).toBe(true);expect(stockNode.userData.collisionObjectId).toBe('raw');expect(fixture.userData.collisionObjectId).toBe('clamp');disposeObject(group);
  });
  it('keeps resource-role fallback geometry alongside explicitly mapped children',()=>{
    const {group,wrapper,a}=mappedScene();wrapper.add(new Mesh(new BoxGeometry(1,1,1),new MeshBasicMaterial()));
    expect(prepareAssetMeshes(group,[a]).map(m=>m.objectId)).toEqual(['assembly','raw','clamp','finished']);disposeObject(group);
  });
  it('rejects missing and ambiguous original node names rather than silently omitting them',()=>{
    const missing=mappedScene();missing.a.nodes[0].nodeName='missing';expect(()=>prepareAssetMeshes(missing.group,[missing.a])).toThrow(/节点|node/i);disposeObject(missing.group);
    const ambiguous=mappedScene(),duplicate=new Group();duplicate.name='raw-node';ambiguous.wrapper.add(duplicate);
    expect(()=>prepareAssetMeshes(ambiguous.group,[ambiguous.a])).toThrow(/歧义|ambiguous/i);disposeObject(ambiguous.group);
  });
  it('uses preserved source names when the renderer sanitizes or renames nodes',()=>{
    const {group,a,stockNode}=mappedScene();stockNode.userData.name='原始.毛坯';stockNode.name='renamed_by_renderer';a.nodes[0].nodeName='原始.毛坯';
    expect(prepareAssetMeshes(group,[a])[0].objectId).toBe('raw');disposeObject(group);
  });
  it('rejects duplicate object IDs and mapped nodes with no owned triangle geometry',()=>{
    const duplicate=mappedScene();duplicate.a.nodes[1].objectId='raw';expect(()=>prepareAssetMeshes(duplicate.group,[duplicate.a])).toThrow(/objectId/);disposeObject(duplicate.group);
    const empty=mappedScene();const node=new Group();node.name='empty-node';empty.wrapper.add(node);empty.a.nodes.push({nodeName:'empty-node',objectId:'empty',role:'machine'});
    expect(()=>prepareAssetMeshes(empty.group,[empty.a])).toThrow(/三角面|geometry/i);disposeObject(empty.group);
  });
});

describe('caller-pinned asset hashes',()=>{
  it('rejects mismatching buffered payloads with HASH_MISMATCH and the stable object ID before parsing',async()=>{
    const input={...asset(),objectId:'pinned-fixture',sha256:'0'.repeat(64)};
    await expect(loadAssetGroup([input],new AbortController().signal)).rejects.toMatchObject({name:'InputError',code:'HASH_MISMATCH',message:expect.stringContaining('pinned-fixture')});
    await expect(loadAssetGroup([{...input,buffer:new ArrayBuffer(30)}],new AbortController().signal)).rejects.toMatchObject({code:'HASH_MISMATCH'});
  });
  it('accepts the correct digest and retains the computed immutable source manifest',async()=>{
    const input=asset(),expected=createHash('sha256').update(new Uint8Array(input.buffer!)).digest('hex');input.sha256=expected;
    const promise=loadAssetGroup([input],new AbortController().signal);new Uint8Array(input.buffer!).fill(0);
    const group=await promise;expect(group.children[0].userData.sha256).toBe(expected);expect(prepareAssetMeshes(group,[input])[0].sha256).toBe(expected);disposeObject(group);
  });
  it('pins fetched bytes and rejects changed contents at the same URL',async()=>{
    const previous=globalThis.fetch,data=triangleGlb(),sha256=createHash('sha256').update(new Uint8Array(data)).digest('hex');
    const input={...asset(),buffer:undefined,url:'https://example.test/pinned.glb',sha256};
    let payload=data;
    globalThis.fetch=async()=>new Response(payload,{status:200});
    try{
      const group=await loadAssetGroup([input],new AbortController().signal);expect(prepareAssetMeshes(group,[input])[0].sha256).toBe(sha256);disposeObject(group);
      payload=data.slice(0);new Uint8Array(payload)[payload.byteLength-1]^=1;
      await expect(loadAssetGroup([input],new AbortController().signal)).rejects.toMatchObject({code:'HASH_MISMATCH'});
    }finally{globalThis.fetch=previous;}
  });
});
