import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import type { Asset } from '../core/types';
import { InputError } from '../core/types';
import type { MeshPoint, PreparedMesh } from '../core/meshTypes';
import { isClosedMesh, validateSolidMesh } from '../core/meshGeometry';
const MAX = 32 * 1024 * 1024;
export function disposeObject(group:THREE.Object3D) {
  group.traverse(o=>{ if(o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Sprite) {
    // Sprite uses Three's shared quad; release its owned material/map only.
    if(!(o instanceof THREE.Sprite))o.geometry.dispose();
    for(const m of Array.isArray(o.material)?o.material:[o.material]) {
      for(const value of Object.values(m)) if(value instanceof THREE.Texture)value.dispose();
      m.dispose();
    }
  }});
}
async function bytes(asset:Asset, signal:AbortSignal) {
  if(asset.buffer) {
    if(asset.buffer.byteLength>MAX)throw new Error('模型超过32MB');
    if(!asset.buffer.byteLength)throw new Error('模型数据为空');
    return asset.buffer.slice(0);
  }
  const response=await fetch(asset.url!,{signal,credentials:'omit'});
  if(!response.ok)throw new Error('模型下载失败：HTTP '+response.status);
  if(Number(response.headers.get('content-length'))>MAX)throw new Error('模型超过32MB');
  const reader=response.body?.getReader();
  if(!reader)throw new Error('模型响应为空');
  const chunks:Uint8Array[]=[]; let size=0;
  try{
    while(true){ if(signal.aborted)throw new DOMException('任务已取消','AbortError');const {value,done}=await reader.read(); if(done)break; size+=value.byteLength;if(size>MAX)throw new Error('模型超过32MB');chunks.push(value); }
  }catch(e){await reader.cancel();throw e;}
  const result=new Uint8Array(size); let offset=0;
  for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}
  if(!size)throw new Error('模型数据为空');
  return result.buffer;
}
function checkGlb(buffer:ArrayBuffer) {
  if(buffer.byteLength<20)throw new Error('GLB文件不完整');
  const view=new DataView(buffer);
  if(view.getUint32(0,true)!==0x46546c67 || view.getUint32(4,true)!==2 || view.getUint32(8,true)!==buffer.byteLength)throw new Error('不是有效的GLB 2.0文件');
  const jsonSize=view.getUint32(12,true);
  if(view.getUint32(16,true)!==0x4e4f534a || jsonSize>buffer.byteLength-20)throw new Error('GLB描述段无效');
  const json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,jsonSize)));
  if([...(json.buffers??[]),...(json.images??[])].some((x:{uri?:string})=>x.uri && !x.uri.startsWith('data:')))throw new Error('请提供内嵌资源的GLB，暂不加载外部纹理或缓冲');
}
export async function loadAssetGroup(assets:Asset[], signal:AbortSignal):Promise<THREE.Group> {
  const group=new THREE.Group(); let totalBytes=0, triangles=0;
  const ids=new Set<string>();
  try{
    for(const asset of assets){
      if(signal.aborted)throw new DOMException('任务已取消','AbortError');
      if(ids.has(asset.objectId))throw new Error('模型objectId重复：'+asset.objectId);ids.add(asset.objectId);
      const data=await bytes(asset,signal);totalBytes+=data.byteLength;
      if(totalBytes>64*1024*1024)throw new Error('模型总量超过64MB');
      const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),v=>v.toString(16).padStart(2,'0')).join('');
      if(signal.aborted)throw new DOMException('任务已取消','AbortError');
      if(asset.sha256!==undefined&&asset.sha256.toLowerCase()!==sha256)throw new InputError('模型SHA-256与指定摘要不匹配：'+asset.objectId,undefined,'HASH_MISMATCH');
      let object:THREE.Object3D;
      if(asset.format==='glb'){checkGlb(data);object=(await new GLTFLoader().parseAsync(data,'')).scene;}
      else {
        const geometry=new STLLoader().parse(data);
        if(!geometry.getAttribute('position')?.count)throw new Error('STL没有三角面');
        object=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0x8a9694,roughness:0.7,metalness:0.15,side:THREE.DoubleSide}));
      }
      // Installation pose must wrap the entire native node hierarchy. In particular,
      // native root translations must be scaled and rotated with the model.
      const installation=new THREE.Group();installation.name=asset.objectId;
      installation.userData={assetObjectId:asset.objectId,role:asset.role,sha256,sourceByteLength:data.byteLength};
      installation.add(object);group.add(installation);
      object.traverse(o=>{
        if(o instanceof THREE.Mesh){
          const positions=o.geometry.getAttribute('position');
          if(!positions?.count)throw new Error('模型含空几何');
          for(let i=0;i<positions.array.length;i++)if(!Number.isFinite(positions.array[i]))throw new Error('模型含非有限顶点');
          triangles+=(o.geometry.index?.count??positions.count)/3;
          if(triangles>1000000)throw new Error('模型总三角面超过100万');
          o.castShadow=true;o.receiveShadow=true;
        }
      });
      if(asset.unit==='m')installation.scale.setScalar(1000);
      installation.position.set(...asset.poseInM.translationMm as [number,number,number]);
      const q=new THREE.Quaternion(...asset.poseInM.quaternionXYZW as [number,number,number,number]);
      installation.quaternion.copy(q);
    }
    if(signal.aborted)throw new DOMException('任务已取消','AbortError');
    return group;
  }catch(e){disposeObject(group);throw e;}
}

/** A detached collision copy. Hidden render nodes are deliberately still included. */
export function prepareAssetMeshes(group:THREE.Group,assets:Asset[]):PreparedMesh[] {
  group.updateWorldMatrix(true,true);
  type Mapping={nodeName:string;objectId:string;role:PreparedMesh['role']};
  type Bucket={objectId:string;role:PreparedMesh['role'];values:number[];min:MeshPoint;max:MeshPoint;explicit:boolean};
  const prepared:PreparedMesh[]=[],seen=new Set<string>();let totalCoordinates=0;
  for(const asset of assets){if(seen.has(asset.objectId))throw new Error('模型objectId重复：'+asset.objectId);seen.add(asset.objectId);}
  for(const asset of assets)for(const mapping of (asset as Asset&{nodes?:Mapping[]}).nodes??[]){
    if(!mapping.objectId||seen.has(mapping.objectId))throw new Error('模型objectId重复或为空：'+mapping.objectId);seen.add(mapping.objectId);
  }
  for(const asset of assets){
    const installation=group.children.find(o=>o.userData.assetObjectId===asset.objectId||o.name===asset.objectId);
    if(!installation)throw new Error('碰撞模型 missing 缺失：'+asset.objectId);
    const mappings=(asset as Asset&{nodes?:Mapping[]}).nodes??[];
    if(mappings.length&&asset.format!=='glb')throw new Error('节点 node 映射只适用于GLB');
    const buckets:Bucket[]=[],mapped=new Map<THREE.Object3D,Bucket>();
    const makeBucket=(objectId:string,role:PreparedMesh['role'],explicit:boolean):Bucket=>{
      const bucket:Bucket={objectId,role,explicit,values:[],min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};buckets.push(bucket);return bucket;
    };
    const fallback=makeBucket(asset.objectId,asset.role,false);
    const usedNames=new Set<string>();
    for(const mapping of mappings){
      if(!mapping.nodeName||usedNames.has(mapping.nodeName))throw new Error('节点 nodeName 重复或为空');usedNames.add(mapping.nodeName);
      if(!['stock','fixture','machine','target'].includes(mapping.role))throw new Error('节点 node 角色无效');
      const matches:THREE.Object3D[]=[];
      installation.traverse(o=>{
        if(o===installation)return;
        // GLTFLoader preserves the original GLB name here before generating a
        // renderer-safe unique name. Matching the generated name loses identity.
        const original=typeof o.userData.name==='string'?o.userData.name:o.name;
        if(original===mapping.nodeName)matches.push(o);
      });
      if(matches.length!==1)throw new Error(matches.length?'节点名存在歧义 ambiguous：'+mapping.nodeName:'节点 node 缺失：'+mapping.nodeName);
      mapped.set(matches[0],makeBucket(mapping.objectId,mapping.role,true));
    }
    const point=new THREE.Vector3();
    const visit=(o:THREE.Object3D,inherited:Bucket)=>{
      const bucket=mapped.get(o)??inherited;
      o.userData.collisionObjectId=bucket.objectId;o.userData.role=bucket.role;
      if(!(o instanceof THREE.Mesh)) {
        if(bucket.role!=='target'&&(o instanceof THREE.Line||o instanceof THREE.Points))throw new Error('碰撞角色含未支持的线或点几何，请提供三角面');
      }else{
      if(bucket.role!=='target'){
        if(o instanceof THREE.SkinnedMesh)throw new Error('碰撞角色暂不支持蒙皮 skinned 网格');
        if(o instanceof THREE.InstancedMesh)throw new Error('碰撞角色暂不支持实例化 instanced 网格');
        if(Object.values(o.geometry.morphAttributes).some(v=>Array.isArray(v)&&v.length))throw new Error('碰撞角色暂不支持形变 morph 网格');
      }
      const positions=o.geometry.getAttribute('position'),index=o.geometry.index,count=index?.count??positions?.count??0;
      if(!positions||!count||count%3)throw new Error('模型包含不完整的三角面');
      totalCoordinates+=count*3;if(totalCoordinates>9000000)throw new Error('模型总三角面超过100万');
      for(let i=0;i<count;i++){
        const vertex=index?index.getX(i):i;
        if(!Number.isInteger(vertex)||vertex<0||vertex>=positions.count)throw new Error('模型三角面顶点索引无效');
        point.fromBufferAttribute(positions,vertex).applyMatrix4(o.matrixWorld);
        if(![point.x,point.y,point.z].every(Number.isFinite))throw new Error('模型含非有限顶点或变换');
        bucket.values.push(point.x,point.y,point.z);
        for(let a=0;a<3;a++){const v=point.getComponent(a);bucket.min[a]=Math.min(bucket.min[a],v);bucket.max[a]=Math.max(bucket.max[a],v);}
      }
      }
      for(const child of o.children)visit(child,bucket);
    };
    visit(installation,fallback);
    if(!buckets.some(b=>b.values.length))throw new Error('碰撞模型 missing 缺失三角面：'+asset.objectId);
    for(const bucket of buckets){
      if(!bucket.values.length){if(bucket.explicit)throw new Error('映射节点缺失三角面 geometry：'+bucket.objectId);continue;}
      const mesh:PreparedMesh={objectId:bucket.objectId,role:bucket.role,triangles:new Float64Array(bucket.values),closed:false,bounds:{min:bucket.min,max:bucket.max},sha256:installation.userData.sha256};
      if(bucket.role!=='target'){
        mesh.closed=isClosedMesh(mesh);
        if(bucket.role==='stock')validateSolidMesh(mesh);
      }
      prepared.push(Object.freeze(mesh));
    }
  }
  return prepared;
}

