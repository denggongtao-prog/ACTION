<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { disposeObject, loadAssetGroup,prepareAssetMeshes } from '../lib/assets';
import { tableTranslation,componentTranslation,axisToTip } from '../core/machine';
import { pointAt } from '../core/gcode';
import type { Job, Motion, Snapshot, StockUpdate, Tool } from '../core/types';
import type {CollisionEvent} from '../core/collisionTypes';
import { StockSurface } from './StockSurface';
import {createToolModel} from './ToolModel';
import {ToolChangerView} from './ToolChangerView';
const props=defineProps<{snapshot:Snapshot|null;highlightIncident?:CollisionEvent}>();
const emit=defineEmits<{fatal:[message:string]}>();
const element=ref<HTMLDivElement>();
let renderer:THREE.WebGLRenderer, scene:THREE.Scene, camera:THREE.PerspectiveCamera, controls:OrbitControls;
let content=new THREE.Group(), toolGroup=new THREE.Group(), pathGroup=new THREE.Group();
let job:Job|null=null, activeTool=-1, animation=0, abort:AbortController|null=null, observer:ResizeObserver;
let disposed=false;
let stockSurface:StockSurface|null=null;
let movingMeshes:{objectId:string;mesh:THREE.Mesh;origin:THREE.Vector3}[]=[];
let marker=new THREE.Group(),markedIncident='';
let changer:ToolChangerView|null=null;
let exchangeViewKey='',savedView:{position:THREE.Vector3;target:THREE.Vector3}|null=null;
function metal(color:number){return new THREE.MeshStandardMaterial({color,roughness:.52,metalness:.3});}
function box(w:number,d:number,h:number,color:number,x=0,y=0,z=0){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,d,h),metal(color));mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;return mesh;
}
function makeTool(tool:Tool) {
  disposeObject(toolGroup);toolGroup.clear();toolGroup.quaternion.identity();toolGroup.add(createToolModel(tool));
}
function update(snapshot:Snapshot|null) {
  if(!snapshot||!job)return;
  if(activeTool!==snapshot.activeTool){
    const tool=job.tools.find(t=>t.toolNumber===snapshot.activeTool);
    if(tool){makeTool(tool);activeTool=snapshot.activeTool;}
  }
  toolGroup.position.set(snapshot.position.x,snapshot.position.y,snapshot.position.z);
  changer?.update(snapshot.toolExchange);toolGroup.visible=!snapshot.toolExchange;
  if(snapshot.axisPosition){
    const table=tableTranslation(snapshot.axisPosition,job.machineProfile);content.position.set(table.x,table.y,table.z);
    for(const entry of movingMeshes){const shift=componentTranslation(entry.objectId,snapshot.axisPosition,job.machineProfile!);entry.mesh.position.copy(entry.origin).add(new THREE.Vector3(shift.x,shift.y,shift.z));}
  }
  if(snapshot.toolExchange&&changer){
    const key=String(snapshot.toolExchange.instructionId);
    if(exchangeViewKey!==key){
      if(!savedView)savedView={position:camera.position.clone(),target:controls.target.clone()};
      exchangeViewKey=key;
      content.updateMatrixWorld(true);
      const bounds=new THREE.Box3().setFromObject(changer.group);
      const offset=job.workOffsetsMm?.G54??{x:0,y:0,z:0};
      bounds.expandByPoint(new THREE.Vector3(...job.stock.minCornerInW).add(new THREE.Vector3(offset.x,offset.y,offset.z)).add(content.position));
      bounds.expandByPoint(new THREE.Vector3(...job.stock.minCornerInW).add(new THREE.Vector3(...job.stock.sizeMm)).add(new THREE.Vector3(offset.x,offset.y,offset.z)).add(content.position));
      bounds.max.z+=Math.max(...job.tools.map(t=>t.holder.lengthMm))+14;bounds.expandByScalar(12);
      const center=bounds.getCenter(new THREE.Vector3()),direction=new THREE.Vector3(-1.15,-1.9,1.35).normalize();
      const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,0,1),direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right);
      const tangent=Math.tan(THREE.MathUtils.degToRad(camera.fov)/2);let distance=0;
      for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
        const corner=new THREE.Vector3(x,y,z).sub(center);
        distance=Math.max(distance,corner.dot(direction)+Math.max(Math.abs(corner.dot(right))/(tangent*camera.aspect*.88),Math.abs(corner.dot(up))/(tangent*.88)));
      }
      controls.target.copy(center);camera.position.copy(center).addScaledVector(direction,distance);controls.update();
    }
  }else if(savedView){
    camera.position.copy(savedView.position);controls.target.copy(savedView.target);controls.update();savedView=null;exchangeViewKey='';
  }
  const highlighted=props.highlightIncident??snapshot.incident;
  if((highlighted?.eventId??'')!==markedIncident){
    disposeObject(marker);marker.clear();markedIncident=highlighted?.eventId??'';
    const contact=highlighted?.contact;
    if(contact){const radius=Math.max(.5,Math.min(...job.stock.sizeMm)*.025);const dot=new THREE.Mesh(new THREE.SphereGeometry(radius,20,12),new THREE.MeshBasicMaterial({color:0xc34532,depthTest:false}));dot.position.fromArray(contact.point);dot.renderOrder=10;marker.add(dot);marker.add(new THREE.ArrowHelper(new THREE.Vector3(...contact.normal),new THREE.Vector3(...contact.point),radius*5,0xc34532));}
    const hitIds=highlighted?.objects??[];
    content.traverse(object=>{if(object instanceof THREE.Mesh){const id=object.userData.collisionObjectId;for(const material of Array.isArray(object.material)?object.material:[object.material])if(material instanceof THREE.MeshStandardMaterial)material.emissive.setHex(hitIds.includes(id)?0x582015:0);}});
  }
}
function resize(){
  if(!renderer||!element.value)return;
  const {width,height}=element.value.getBoundingClientRect();
  camera.aspect=width/Math.max(1,height);camera.updateProjectionMatrix();renderer.setSize(width,Math.max(1,height));
  if(changer?.group.visible&&props.snapshot?.toolExchange){exchangeViewKey='';update(props.snapshot);}
}
function resetView(top=false) {
  if(!camera||!job)return;
  if(changer?.group.visible&&props.snapshot?.toolExchange){
    exchangeViewKey='';update(props.snapshot);
    if(top){const distance=camera.position.distanceTo(controls.target);camera.position.copy(controls.target).add(new THREE.Vector3(.01,0,distance));controls.update();}
    return;
  }
  const [w,d,h]=job.stock.sizeMm,offset=job.workOffsetsMm?.G54??{x:0,y:0,z:0},[x,y,z]=job.stock.minCornerInW.map((v,i)=>v+[offset.x,offset.y,offset.z][i]);
  const highest=nextToolTop(job);
  const size=Math.max(w,d,h,(highest-z+12)*.65,90),center=new THREE.Vector3(x+w/2,y+d/2,((z-12)+highest)/2);
  controls.target.copy(center);
  camera.position.copy(center).add(top?new THREE.Vector3(.01,0,size*2.6):new THREE.Vector3(size*1.55,-size*1.85,size*1.55));
  camera.up.set(0,0,1);controls.update();
}
function nextToolTop(current:Job){const z=current.initialAxisPositionMm?axisToTip(current.initialAxisPositionMm,current.tools[0].gaugeLengthMm,current.machineProfile).z:current.initialPositionMm[2];return z+Math.max(...current.tools.map(t=>t.gaugeLengthMm+t.holder.lengthMm+8));}
async function load(nextJob:Job,instructions:Motion[]) {
  if(!renderer)throw new Error('三维视窗未就绪');
  abort?.abort();const own=new AbortController();abort=own;
  const assets=await loadAssetGroup(nextJob.assets,own.signal);
  if(disposed||own.signal.aborted){disposeObject(assets);throw new Error('模型加载已取消');}
  const meshes=prepareAssetMeshes(assets,nextJob.assets);
  if(nextJob.stock.kind==='mesh'){
    const source=meshes.find(m=>m.objectId===nextJob.stock.assetId&&m.role==='stock');if(!source){disposeObject(assets);throw new Error('网格毛坯节点缺失');}
    const offset=nextJob.workOffsetsMm?.G54??{x:0,y:0,z:0};nextJob.stock.sizeMm=source.bounds.max.map((v,i)=>v-source.bounds.min[i]);nextJob.stock.minCornerInW=source.bounds.min.map((v,i)=>v-[offset.x,offset.y,offset.z][i]);
  }
  stockSurface?.dispose();stockSurface=null;disposeObject(marker);marker.clear();markedIncident='';movingMeshes=[];
  disposeObject(content);scene.remove(content);content=new THREE.Group();scene.add(content);
  job=nextJob;activeTool=-1;
  savedView=null;exchangeViewKey='';
  const [w,d,h]=job.stock.sizeMm,offset=job.workOffsetsMm?.G54??{x:0,y:0,z:0},[x,y,z]=job.stock.minCornerInW.map((v,i)=>v+[offset.x,offset.y,offset.z][i]);
  const base=box(w+38,d+38,10,0xadb5b1,x+w/2,y+d/2,z-7);
  content.add(base);
  for(let n=-2;n<=2;n++)content.add(box(w+32,1.6,.5,0x7e8983,x+w/2,y+d/2+n*(d+25)/6,z-1.8));
  stockSurface=new StockSurface();stockSurface.group.name=job.stock.objectId;content.add(stockSurface.group);
  content.add(assets);
  assets.traverse(object=>{if(object instanceof THREE.Mesh&&object.userData.role==='target'){
    const originals=Array.isArray(object.material)?object.material:[object.material];
    const materials=originals.map(material=>{const copy=material.clone();copy.transparent=true;copy.opacity=.22;copy.depthWrite=false;if(copy instanceof THREE.MeshStandardMaterial)copy.wireframe=true;return copy;});
    object.material=Array.isArray(object.material)?materials:materials[0];
  }});
  assets.traverse(object=>{if(object instanceof THREE.Mesh&&['stock','machine'].includes(object.userData.role))object.visible=false;});
  for(const prepared of meshes.filter(m=>m.role==='machine')){
    if(!job.machineProfile?.components?.some(c=>c.objectId===prepared.objectId))throw new Error('机床模型缺少运动部件配置：'+prepared.objectId);
    const origin=new THREE.Vector3(...prepared.bounds.min),geometry=new THREE.BufferGeometry(),positions=new Float32Array(prepared.triangles.length);
    for(let i=0;i<positions.length;i++)positions[i]=prepared.triangles[i]-prepared.bounds.min[i%3];
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,metal(0x78908b));mesh.position.copy(origin);mesh.userData.collisionObjectId=prepared.objectId;content.add(mesh);movingMeshes.push({objectId:prepared.objectId,mesh,origin});
  }
  pathGroup=new THREE.Group();content.add(pathGroup);let vertices=0;
  for(const move of instructions){
    const segments=move.arc?Math.min(256,Math.max(8,Math.ceil(move.lengthMm))):1;
    vertices+=segments+1;if(vertices>200000)throw new Error('显示刀路超过20万个采样点，请拆分程序');
    const points=[];for(let i=0;i<=segments;i++){const p=pointAt(move,i/segments);points.push(new THREE.Vector3(p.x,p.y,p.z));}
    const geometry=new THREE.BufferGeometry().setFromPoints(points);
    const line=move.mode==='rapid'
      ?new THREE.Line(geometry,new THREE.LineDashedMaterial({color:0xb99b67,dashSize:2,gapSize:1.5,transparent:true,opacity:.65}))
      :new THREE.Line(geometry,new THREE.LineBasicMaterial({color:0x316b57}));
    line.computeLineDistances();pathGroup.add(line);
  }
  toolGroup=new THREE.Group();content.add(toolGroup);
  changer=new ToolChangerView(job.tools,createToolModel,z-12);content.add(changer.group);
  const axes=new THREE.AxesHelper(Math.min(w,d)*.28);axes.position.set(offset.x,offset.y,offset.z+.2);content.add(axes);
  resetView();update(props.snapshot);
  return meshes;
}
onMounted(()=>{
  try{
    scene=new THREE.Scene();scene.background=new THREE.Color(0xf0f2ef);
    camera=new THREE.PerspectiveCamera(38,1,.1,20000);camera.up.set(0,0,1);
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
    element.value!.appendChild(renderer.domElement);
    controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;
    controls.minDistance=20;controls.maxDistance=5000;
    scene.add(new THREE.HemisphereLight(0xffffff,0xb5b8b0,2.8));
    const light=new THREE.DirectionalLight(0xffffff,3.5);light.position.set(70,-100,220);light.castShadow=true;
    light.shadow.mapSize.set(2048,2048);light.shadow.camera.left=-200;light.shadow.camera.right=200;light.shadow.camera.top=200;light.shadow.camera.bottom=-200;light.shadow.normalBias=.2;scene.add(light);
    const fill=new THREE.DirectionalLight(0xe9f0ef,1.5);fill.position.set(-120,70,100);scene.add(fill);
    const grid=new THREE.GridHelper(600,30,0xc5ccc5,0xe1e5df);grid.rotation.x=Math.PI/2;grid.position.z=-34;scene.add(grid);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(3000,3000),new THREE.MeshStandardMaterial({color:0xe9ece7,roughness:1}));floor.position.z=-34.2;floor.receiveShadow=true;scene.add(floor);
    scene.add(content);scene.add(marker);camera.position.set(170,-200,160);controls.target.set(0,0,15);
    observer=new ResizeObserver(resize);observer.observe(element.value!);resize();
    renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();emit('fatal','图形上下文已丢失，请重载页面');});
    function render(){if(disposed)return;animation=requestAnimationFrame(render);controls.update();renderer.render(scene,camera);}render();
  }catch(e){emit('fatal','无法初始化三维视窗：'+(e as Error).message);}
});
watch(()=>[props.snapshot,props.highlightIncident],()=>update(props.snapshot));
onBeforeUnmount(()=>{disposed=true;abort?.abort();cancelAnimationFrame(animation);observer?.disconnect();controls?.dispose();stockSurface?.dispose();if(scene)disposeObject(scene);renderer?.dispose();});
defineExpose({load,resetView,setTop:()=>resetView(true),togglePath:()=>{pathGroup.visible=!pathGroup.visible;},applyStock:(update:StockUpdate)=>{if(!stockSurface)throw new Error('材料视窗未准备好');stockSurface.apply(update);}});
</script>
<template><div ref="element" class="viewport" aria-label="三维刀路视窗"></div></template>
