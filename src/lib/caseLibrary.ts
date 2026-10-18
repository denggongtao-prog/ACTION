import type {Job,Tool} from '../core/types';
import {InputError} from '../core/types';
const programs=import.meta.glob<string>('../../案例库/**/*.txt',{eager:true,query:'?raw',import:'default'});
const resources=import.meta.glob<string>(['../../案例库/**/*.stl','../../案例库/**/*.pdf','../../案例库/**/*.png','../../案例库/**/*.jpg'],{eager:true,query:'?url',import:'default'});
type CaseDefinition={id:string;label:string;directory:string;programPath:string;programText:string;targetPath?:string;documents:{label:string;url:string}[];assumptions:string[];features:string[]};
const folders=[
  ['O0001','开槽与四个侧孔','O0001-开槽侧孔'],['O0008','实木轮廓、R10边型与六孔','O0008-实木零件'],
  ['O0020','右刀补与长度补偿','O0020-G43G49G42G40刀具半径长度补偿'],['O0021','极坐标六边形','O0021-G15G16极坐标'],
  ['O0022','八孔固定循环','O0022-G81G80钻孔循环'],['O0023','预选刀与自动换刀','O0023-M06自动换刀'],
  ['O0025','270°与180°圆弧','O0025-G02G03圆弧编程'],['O0314','增量刀长与停留','O0314-例3.14-G43G49刀具长度补偿'],
  ['O0315','左刀补轮廓','O0315-例3.15-G43G49G41G40刀具半径长度补偿'],
] as const;
const assumptions:Record<string,string[]>={
  O0001:['成品600×370×30，初始矩形坯按此外框；未提供额外毛坯余量和夹具。','T2 φ16/T1 φ10由CAM名称，T7 φ12沿+Y侧钻；刃长40、量规60及刀柄为教学假设，H均60。','M6使用教学换刀站[-30,-100,200]轴坐标，换刀后留在站点。真实站点未知；若直接在工件上方原位逻辑换侧头，Z32不足以保证横刀安全。','底面Z0；STL按轴置换和平移与程序对齐。大件实际格距1.5mm。'],
  O0008:['以用户选择的CAM原程序和图纸为主：T1 φ6，T2 φ5；毛坯320×350×22，XY左下原点为教学假设。','H采用截图0/35/-25，参考量规100，安装长100/135/75；有效刃长35/30/15为假设。','T3为R10成形刀；缺少完整剖面，采用可编辑的R10、导向半径10、最大半径20教学剖面（32段），D3=10为注册偏置。不能据此认证原刀具/成品吻合。','初始位置及第一参考点为教学配置，未复原截图机床/平口钳。STL平移XY各151.345169。'],
  O0020:['φ16直刀、D1=8；有效刃长30、量规60及H1=60为教学假设。','毛坯按成品300×170×20包围盒；txt的G92使物理Y偏移-85，毛坯与参考STL同步放置。','刀路图对刀点Y320与txt Y220不一致，本例保留原txt。初始刀尖[300,135,60]是假设。'],
  O0021:['φ16直刀、D1=8；刃长40/量规60及初始刀尖为假设。','原G42 G16块继承G0，本例保持快移并启用检查，可能在入料时停机；适配不等于原程序无碰撞。'],
  O0022:['按CAM教学要求用φ10钻，PDF却标φ20；原文件保留并提示冲突。','矩形坯200×100×30、顶面Z0。有效刃长45、量规70、初始位置为教学假设。','复位默认G98回初始面；G0取消循环。原程序8孔、R2、Z-35、F20、S200均保留。'],
  O0023:['T1 φ20钻；T2刀径缺失，教学设φ10、D2=5、H2=60；刃长30/量规60为假设。','初始粗坯用[-5,-5,-5]至[85,50,0]矩形外框；原要求沿形状留5，矩形会保留未切外围材料，不能当作原粗坯精确复原。','第一/第二参考轴点均设[-50,-50,200]，未提供真实机床位置。成品原点与刀路图外扩5原点冲突，按原txt/图纸成品坐标。'],
  O0025:['程序原文和刀路图R12优先；PDF标R12.5，资料冲突保留。','外框60×45；厚10、φ4平底刀、有效刃长15/量规50为教学假设。','初始刀尖[50,42,50]以G92声明点建立，G92本身不移动。'],
  O0314:['毛坯[55,10,-25]至[115,55,0]，原点在毛坯外，不能居中。','φ6钻；初始刀尖[0,0,25]、有效刃长40/量规60、H1=60为教学假设。','保留G91增量和G04 X5秒：两孔钻尖分别到Z-15与Z-30。'],
  O0315:['φ8立铣刀；采用物理一致D1=4。原要求同时写φ8及D01=8，后者按半径口径与刀径冲突，可在完整JSON改为8比较。','矩形粗坯130×70×20、刃长30/量规60/H1=60、初始位置为教学假设；原资料只给成品120×60×20。','所有G0进入余料仍检查，不将原程序强制判为安全。'],
};
const featureMap:Record<string,string[]>={O0001:['T/M6','G43','Y+侧钻G81/G99'],O0008:['G41/D','R圆弧','R10成形刀','G81','G28'],O0020:['G92','G42/D','G43/G49'],O0021:['G15/G16','G42/D'],O0022:['G81','G90/G91','G98/G99'],O0023:['G30','T预选/M6','G41','G28'],O0025:['G92','I/J大弧'],O0314:['G91','G43/G49','G4 X'],O0315:['G41/D','G43/G49']};
const definitions:CaseDefinition[]=folders.map(([id,label,directory])=>{
  const prefix='../../案例库/'+directory+'/',programPath=Object.keys(programs).find(path=>path.startsWith(prefix))!;
  if(!programPath)throw new Error('案例缺少原始程序：'+id);
  const paths=Object.keys(resources).filter(path=>path.startsWith(prefix));
  return {id,label,directory,programPath,programText:programs[programPath],targetPath:paths.find(path=>path.endsWith('.stl')),documents:paths.filter(path=>!path.endsWith('.stl')).map(path=>({label:path.slice(prefix.length),url:resources[path]})),assumptions:assumptions[id],features:featureMap[id]};
});
export const caseOptions=definitions.map(({id,label})=>({id,label:id+' · '+label}));
export function caseDefinition(id:string):CaseDefinition{const value=definitions.find(item=>item.id===id);if(!value)throw new InputError('未知原始案例：'+id);return value;}
function tool(n:number,type:Tool['type'],diameter:number,length=30,gauge=60):Tool{return {toolId:'case-tool-'+n,toolNumber:n,type,diameterMm:diameter,cuttingLengthMm:length,gaugeLengthMm:gauge,shaftDiameterMm:Math.min(diameter,16),holder:{diameterMm:30,lengthMm:25}};}
export function caseJob(id:string,baseUrl=typeof location==='undefined'?'http://127.0.0.1:8786/':location.href):Job{
  const definition=caseDefinition(id);
  let tools=[tool(1,'flat_endmill',8)],size=[100,100,20],min=[0,0,-20],initial=[-30,-30,60],cell=.5,h:Record<string,number>={'1':60},d:Record<string,number>={},translation=[0,0,0],quaternion=[0,0,0,1],reference=0;
  if(id==='O0001'){tools=[tool(2,'flat_endmill',16,40),tool(1,'flat_endmill',10,40),{...tool(7,'drill',12,40),axisDirection:{x:0,y:-1,z:0}}];size=[600,370,30];min=[0,0,0];initial=[-30,-30,80];cell=1.5;h={'1':60,'2':60,'7':60};translation=[300,200,650];quaternion=[-.5,-.5,-.5,.5];}
  if(id==='O0008'){
    const radialProfile=Array.from({length:33},(_,i)=>{const zMm=10*i/32;return {zMm,radiusMm:20-Math.sqrt(Math.max(0,100-zMm*zMm))};});radialProfile.push({zMm:15,radiusMm:20});
    tools=[tool(1,'flat_endmill',6,35,100),tool(2,'drill',5,30,135),{...tool(3,'profile_endmill',40,15,75),radialProfile}];size=[320,350,22];min=[0,0,0];cell=1;initial=[-30,-30,80];h={'1':0,'2':35,'3':-25};d={'1':3,'2':0,'3':10};reference=100;translation=[151.345169,151.345169,0];
  }
  if(id==='O0020'){tools=[tool(1,'flat_endmill',16)];size=[300,170,20];min=[-150,-85,-20];initial=[300,135,60];d={'1':8};translation=[0,-85,-20];cell=.75;}
  if(id==='O0021'){tools=[tool(1,'flat_endmill',16,40)];size=[100,80,30];min=[-50,-40,-30];initial=[70,-60,50];d={'1':8};}
  if(id==='O0022'){tools=[tool(1,'drill',10,45,70)];size=[200,100,30];min=[0,0,-30];initial=[-20,-20,50];h={'1':70};cell=.75;}
  if(id==='O0023'){tools=[tool(1,'drill',20),tool(2,'flat_endmill',10)];size=[90,55,5];min=[-5,-5,-5];initial=[-50,-50,140];h={'2':60};d={'2':5};}
  if(id==='O0025'){tools=[tool(1,'flat_endmill',4,15,50)];size=[60,45,10];min=[0,0,-10];initial=[50,42,50];}
  if(id==='O0314'){tools=[tool(1,'drill',6,40)];size=[60,45,25];min=[55,10,-25];initial=[0,0,25];}
  if(id==='O0315'){tools=[tool(1,'flat_endmill',8)];size=[130,70,20];min=[-65,-35,-20];initial=[0,0,60];d={'1':4};}
  const job:Job={dialectId:'milling-basic-v1',program:{programId:id,text:definition.programText},stock:{objectId:id+'-stock',kind:'box',sizeMm:size,minCornerInW:min},tools,initialPositionMm:initial,assets:definition.targetPath?[{objectId:id+'-target',role:'target',format:'stl',unit:'mm',url:new URL(resources[definition.targetPath],baseUrl).href,poseInM:{translationMm:translation,quaternionXYZW:quaternion}}]:[],workOffsetsMm:{G54:{x:0,y:0,z:0}},toolLengthOffsetsMm:h,toolLengthReferenceMm:reference,cutterRadiusOffsetsMm:d,simulation:{stockCellMm:cell,arcChordToleranceMm:.02,mode:'cut',checkCollisions:true,stopOnCollision:false}};
  if(id==='O0008'||id==='O0023')job.machineProfile={axes:{x:{direction:1,carrier:'tool',zeroMm:0,minMm:-1000,maxMm:1000},y:{direction:1,carrier:'tool',zeroMm:0,minMm:-1000,maxMm:1000},z:{direction:1,carrier:'tool',zeroMm:0,minMm:-500,maxMm:1000}},rapidRateMmMin:6000,rapidMode:'linear',homeAxisPositionMm:{x:-50,y:-50,z:200},secondaryHomeAxisPositionMm:{x:-50,y:-50,z:200},toolChange:{mode:'logical'}};
  if(id==='O0001')job.machineProfile={axes:{x:{direction:1,carrier:'tool',zeroMm:0,minMm:-1000,maxMm:1000},y:{direction:1,carrier:'tool',zeroMm:0,minMm:-1000,maxMm:1000},z:{direction:1,carrier:'tool',zeroMm:0,minMm:-500,maxMm:1000}},rapidRateMmMin:6000,rapidMode:'linear',toolChange:{mode:'configured',waypointsMm:[{x:-30,y:-100,z:200}],returnToStart:false}};
  return job;
}
