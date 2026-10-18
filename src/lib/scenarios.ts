import { InputError } from '../core/types';
import type { Asset, Job } from '../core/types';
import type { MachineProfile } from '../core/machineTypes';
import { demoJob } from './demo';

export const scenarioOptions: {id:string;label:string}[] = [
  {id:'normal',label:'正常 · 双刀轮廓与球头精加工'},
  {id:'rapid',label:'故障 · 快移穿入毛坯'},
  {id:'spindle',label:'故障 · 主轴停转时进给'},
  {id:'fixture',label:'故障 · 刀刃穿越薄夹具'},
  {id:'holder',label:'故障 · 刀柄碰撞高夹具'},
  {id:'limit',label:'故障 · X轴超出软限位'},
  {id:'toolchange',label:'故障 · 换刀内部轨迹受阻'},
  {id:'meshstock',label:'正常 · 闭合STL毛坯切削'},
  {id:'machine',label:'故障 · 工作台运动部件碰撞'},
  {id:'offsets',label:'正常 · 工件偏置与独立H补偿'},
  {id:'exchange',label:'动画 · 双刀自动交换'},
];

type Triple=[number,number,number];
/** Twelve consistently outward-facing triangles. Binary STL keeps the examples self-contained. */
function cuboidAsset(objectId:string,role:Asset['role'],min:Triple,size:Triple):Asset {
  const [x,y,z]=size;
  const vertices:Triple[]=[[0,0,0],[x,0,0],[x,y,0],[0,y,0],[0,0,z],[x,0,z],[x,y,z],[0,y,z]];
  const faces=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,4,7],[0,7,3],[1,2,6],[1,6,5],[0,1,5],[0,5,4],[3,7,6],[3,6,2]];
  const buffer=new ArrayBuffer(84+faces.length*50),view=new DataView(buffer);
  view.setUint32(80,faces.length,true);
  faces.forEach((indices,n)=>{
    const a=vertices[indices[0]],b=vertices[indices[1]],c=vertices[indices[2]];
    const u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]);
    const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal);
    const values=[...normal.map(n=>n/length),...a,...b,...c];
    values.forEach((value,i)=>view.setFloat32(84+n*50+i*4,value,true));
  });
  return {objectId,role,format:'stl',unit:'mm',buffer,poseInM:{translationMm:[...min],quaternionXYZW:[0,0,0,1]}};
}
function machineProfile():MachineProfile {
  return {axes:{
    x:{direction:1,carrier:'tool',zeroMm:0,minMm:-100,maxMm:100},
    y:{direction:1,carrier:'tool',zeroMm:0,minMm:-100,maxMm:100},
    z:{direction:1,carrier:'tool',zeroMm:0,minMm:-100,maxMm:100},
  },rapidRateMmMin:6000,rapidMode:'linear'};
}
function basic(id:string,lines:string[]):Job {
  return {
    dialectId:'milling-basic-v1',program:{programId:'SCENARIO-'+id.toUpperCase(),text:['(教学场景：'+scenarioOptions.find(o=>o.id===id)!.label+')','G21 G90 G17 G94',...lines,'M30'].join('\n')},
    stock:{objectId:'stock-001',kind:'box',minCornerInW:[-5,-5,-6],sizeMm:[10,10,6]},
    tools:[{toolId:'tool-001',toolNumber:1,type:'flat_endmill',diameterMm:2,cuttingLengthMm:4,gaugeLengthMm:10,shaftDiameterMm:2,holder:{diameterMm:6,lengthMm:4},requiredSpindleDirection:'CW'}],
    initialPositionMm:[-10,0,5],assets:[],
    simulation:{stockCellMm:.5,arcChordToleranceMm:.02,mode:'cut',checkCollisions:true,contactLocalizationMm:.05,maxCollisionQueries:200000,maxMemoryMb:512},
  };
}
/** Returns fresh raw inputs: no runtime collision meshes, network dependency or shared mutable buffers. */
export function scenarioJob(id:string):Job {
  if(!scenarioOptions.some(o=>o.id===id))throw new InputError('未知教学场景：'+id);
  if(id==='normal') {
    const job=demoJob();job.simulation={...job.simulation!,checkCollisions:true};return job;
  }
  if(id==='exchange'){
    const job=demoJob();job.program={programId:'TOOL-EXCHANGE-DEMO',text:'(教学换刀动画：刀库机构为示意，刀具按毫米尺寸)\nT2\nN100 M6\nG4 P0.4\nT1\nN200 M6\nM30'};
    job.initialPositionMm=[-20,-10,35];return job;
  }
  if(id==='rapid'||id==='spindle') {
    const job=basic(id,[id==='rapid'?'G0 X10':'G1 X10 F300']);job.initialPositionMm=[-10,0,-2];return job;
  }
  if(id==='fixture'||id==='holder') {
    const job=basic(id,['M3 S3000','N350 G1 X10 F300']);
    job.assets=[cuboidAsset(id==='fixture'?'fixture-thin':'fixture-high','fixture',[-.1,-3,id==='fixture'?4:16],[.2,6,id==='fixture'?4:2])];return job;
  }
  if(id==='limit') {
    const job=basic(id,['M3 S3000','N410 G1 X15 F300']);job.initialPositionMm=[0,0,5];
    job.machineProfile=machineProfile();job.machineProfile.axes.x.minMm=-10;job.machineProfile.axes.x.maxMm=10;return job;
  }
  if(id==='toolchange') {
    const job=basic(id,['T2','N600 M6']);
    job.tools.push({...job.tools[0],toolId:'tool-002',toolNumber:2,gaugeLengthMm:12,holder:{diameterMm:6,lengthMm:4}});
    job.machineProfile={...machineProfile(),toolChange:{mode:'configured',waypointsMm:[{x:-10,y:0,z:25},{x:10,y:0,z:25}],returnToStart:true}};
    job.assets=[cuboidAsset('fixture-change-path','fixture',[-.1,-3,16],[.2,6,2])];return job;
  }
  if(id==='meshstock') {
    const job=basic(id,['M3 S3000','G0 X0 Y0 Z5','G1 Z-1 F120','G1 X3 F300','G0 Z5','M5']);
    job.stock={...job.stock,kind:'mesh',assetId:'stock-mesh'};
    job.assets=[cuboidAsset('stock-mesh','stock',[-5,-5,-6],[10,10,6])];return job;
  }
  if(id==='machine') {
    const job=basic(id,['M3 S3000','N510 G1 X12 F300']);job.initialPositionMm=[0,0,5];
    const p=machineProfile();p.axes.x.carrier='table';p.axes.z.parent='y';
    p.components=[{objectId:'machine-slider',drivenBy:['x']},{objectId:'machine-stop',drivenBy:[]}];
    p.collisionPairs=[['machine-slider','machine-stop']];job.machineProfile=p;
    job.assets=[cuboidAsset('machine-slider','machine',[-5,20,0],[2,4,4]),cuboidAsset('machine-stop','machine',[-15,20,0],[2,4,4])];return job;
  }
  const job=basic(id,[
    'G54 G43 H1','M3 S3000','M8','G0 X0 Y0 Z5','G1 Z-1 F120','G1 X2 F300','G0 Z8',
    'G55','G0 X0 Y0 Z8','G43 H7','G0 Z5','G53 G0 Z30','G54 G49','G0 X0 Y0 Z8','M9','M5',
  ]);
  job.initialPositionMm=[20,0,8];job.workOffsetsMm={G54:{x:20,y:0,z:0},G55:{x:40,y:0,z:0}};job.toolLengthOffsetsMm={'1':10,'7':12};return job;
}
