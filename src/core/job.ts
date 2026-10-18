import { InputError } from './types';
import type { Asset, Job, Tool } from './types';
import { MAX_CELLS } from './stock';
import { drillTipHeight } from './toolProfile';
import { sha256 } from './hash';
import { validateMachineProfile,axisToTip } from './machine';
import type { WorkFrame } from './machineTypes';
import { builtInProfile } from './profiles';
function object(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError(label + '必须是对象');
  return value as Record<string, any>;
}
function text(value: unknown, label: string, limit = 128): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new InputError(label + '为空或长度超限');
  return value;
}
function number(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new InputError(label + '超出范围');
  return value;
}
function vector(value: unknown, label: string, length = 3, min = -1e6, max = 1e6): number[] {
  if (!Array.isArray(value) || value.length !== length) throw new InputError(label + '维度无效');
  return value.map(x => number(x, label, min, max));
}
export function validateJob(value: unknown,internal=false): Job {
  const input = object(value, '任务'), program = object(input.program, '程序'), stock = object(input.stock, '毛坯');
  if(program.encoding!==undefined&&program.encoding!=='utf-8')throw new InputError('程序文件仅支持utf-8');
  if(input.dialectId&&!['milling-preview-v1','milling-basic-v1'].includes(input.dialectId))throw new InputError('不支持的G代码方言');
  if(!['box','mesh'].includes(stock.kind))throw new InputError('毛坯应为box或闭合mesh');
  const asVector=(value:unknown,label:string)=>{const v=value&&typeof value==='object'&&!Array.isArray(value)?[(value as any).x,(value as any).y,(value as any).z]:value;const [x,y,z]=vector(v,label);return {x,y,z};};
  const workOffsetsMm:Job['workOffsetsMm']={G54:{x:0,y:0,z:0}};
  if(input.workOffsetsMm)for(const [key,value] of Object.entries(object(input.workOffsetsMm,'工件偏置'))){if(!/^G5[4-9]$/.test(key))throw new InputError('仅支持G54至G59偏置');workOffsetsMm[key as WorkFrame]=asVector(value,'工件偏置');}
  const toolLengthOffsetsMm:Record<string,number>={};
  if(input.toolLengthOffsetsMm)for(const [key,value] of Object.entries(object(input.toolLengthOffsetsMm,'H表'))){if(!/^[1-9]\d{0,3}$/.test(key))throw new InputError('H号应为1至9999整数');toolLengthOffsetsMm[key]=number(value,'H补偿',-1000,1000);}
  const toolLengthReferenceMm=number(input.toolLengthReferenceMm??0,'刀长基准',0,600);
  const cutterRadiusOffsetsMm:Record<string,number>={};
  if(input.cutterRadiusOffsetsMm)for(const [key,value] of Object.entries(object(input.cutterRadiusOffsetsMm,'D半径表'))){if(!/^(0|[1-9]\d{0,3})$/.test(key))throw new InputError('D号应为0至9999整数');cutterRadiusOffsetsMm[key]=number(value,'D半径',0,150);}
  const programText = text(program.text, 'G代码', 512000);
  if (programText.split(/\r\n|\r|\n/).length > 20000) throw new InputError('程序超过20000物理行');
  if (!Array.isArray(input.tools) || !input.tools.length || input.tools.length > 32) throw new InputError('刀具表应包含1至32把刀');
  const toolNumbers = new Set<number>(), ids = new Set<string>();
  const unique = (id: string) => { if (ids.has(id)) throw new InputError('objectId重复：' + id); ids.add(id); return id; };
  const tools: Tool[] = input.tools.map((raw: unknown) => {
    const t = object(raw, '刀具'), holder = object(t.holder, '刀柄');
    const n = number(t.toolNumber, '刀号', 1, 9999);
    if (!Number.isInteger(n) || toolNumbers.has(n)) throw new InputError('刀号必须为不重复的正整数');
    toolNumbers.add(n);
    if (!['flat_endmill', 'ball_endmill', 'drill','profile_endmill'].includes(t.type)) throw new InputError('不支持的刀形');
    const cuttingLengthMm = number(t.cuttingLengthMm, '刃长', 0.1, 300);
    const gaugeLengthMm = number(t.gaugeLengthMm, '量规长度', cuttingLengthMm, 600);
    const diameterMm=number(t.diameterMm,'刀径',.1,200);
    const minimumLength=t.type==='ball_endmill'?diameterMm/2:t.type==='drill'?drillTipHeight({diameterMm} as Tool):0;
    if(cuttingLengthMm<minimumLength)throw new InputError('切削刃长不足以容纳球头或钻尖');
    if(t.requiredSpindleDirection!==undefined&&!['CW','CCW'].includes(t.requiredSpindleDirection))throw new InputError('刀具主轴方向应为CW或CCW');
    const axisDirection=t.axisDirection===undefined?undefined:asVector(t.axisDirection,'刀具方向');
    if(axisDirection&&!((axisDirection.x===0&&axisDirection.y===0&&axisDirection.z===1)||(axisDirection.x===0&&axisDirection.y===-1&&axisDirection.z===0)))throw new InputError('刀具方向仅支持+Z或固定-Y侧头');
    let radialProfile:Tool['radialProfile'];
    if(t.type==='profile_endmill'){
      if(!Array.isArray(t.radialProfile)||t.radialProfile.length<2||t.radialProfile.length>128)throw new InputError('成形刀需要2至128点的径向剖面');
      radialProfile=t.radialProfile.map((point:unknown)=>{const p=object(point,'刀具剖面');return {zMm:number(p.zMm,'剖面高度',0,cuttingLengthMm),radiusMm:number(p.radiusMm,'剖面半径',0,diameterMm/2)};});
      if(radialProfile![0].zMm!==0||radialProfile!.at(-1)!.zMm!==cuttingLengthMm||radialProfile!.at(-1)!.radiusMm!==diameterMm/2||radialProfile!.some((p,i)=>i>0&&(p.zMm<=radialProfile![i-1].zMm||p.radiusMm<radialProfile![i-1].radiusMm)))throw new InputError('成形刀剖面须从0至刃长，高度递增、半径不减且最大半径匹配刀径');
      if(axisDirection?.y===-1)throw new InputError('成形刀剖面仅支持+Z方向');
    }else if(t.radialProfile!==undefined)throw new InputError('径向剖面仅供成形刀使用');
    return { toolId: unique(text(t.toolId, '刀具ID')), toolNumber: n, type: t.type, diameterMm, cuttingLengthMm, gaugeLengthMm, shaftDiameterMm: number(t.shaftDiameterMm, '刀杆直径', 0.1, 200), holder: { diameterMm: number(holder.diameterMm, '刀柄直径', 0.1, 300), lengthMm: number(holder.lengthMm, '刀柄长度', 0.1, 300) },requiredSpindleDirection:t.requiredSpindleDirection??'CW',axisDirection,radialProfile };
  });
  if (input.assets !== undefined && !Array.isArray(input.assets)) throw new InputError('assets必须是数组');
  if ((input.assets?.length ?? 0) > 20) throw new InputError('模型数量超过20');
  const assets: Asset[] = (input.assets ?? []).map((raw: unknown) => {
    const a = object(raw, '模型');
    if (!['stock','fixture', 'machine', 'target'].includes(a.role) || !['glb', 'stl'].includes(a.format) || !['mm', 'm'].includes(a.unit)) throw new InputError('模型角色、格式或单位不支持');
    if (!!a.url === !!a.buffer) throw new InputError('模型应提供URL或ArrayBuffer之一');
    if (a.url) {
      const url = new URL(text(a.url, '模型URL', 4096), 'https://invalid.example');
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hostname === 'invalid.example') throw new InputError('模型必须使用绝对HTTP或HTTPS地址');
    }
    if (a.buffer && (!(a.buffer instanceof ArrayBuffer) || a.buffer.byteLength > 32 * 1024 * 1024 || !a.buffer.byteLength)) throw new InputError('模型二进制为空或超过32MB');
    if(a.sha256!==undefined&&(typeof a.sha256!=='string'||!/^[a-f0-9]{64}$/.test(a.sha256)))throw new InputError('模型SHA-256应为64位小写十六进制');
    const pose = a.poseInM ? object(a.poseInM, '模型姿态') : {};
    const quaternionXYZW = vector(pose.quaternionXYZW ?? [0, 0, 0, 1], '四元数', 4, -1, 1);
    if (Math.abs(Math.hypot(...quaternionXYZW) - 1) > 1e-4) throw new InputError('四元数必须归一化');
    if(a.nodes!==undefined&&(!Array.isArray(a.nodes)||a.nodes.length>200))throw new InputError('模型nodes映射无效');
    const nodes=a.nodes?.map((raw:unknown)=>{const node=object(raw,'节点映射');if(!['stock','fixture','machine','target'].includes(node.role))throw new InputError('节点角色无效');return {nodeName:text(node.nodeName,'节点名称'),objectId:unique(text(node.objectId,'节点对象ID')),role:node.role};});
    return { objectId: unique(text(a.objectId, '模型ID')), role: a.role, format: a.format, unit: a.unit, url: a.url, buffer: a.buffer,sha256:a.sha256,nodes, poseInM: { translationMm: vector(pose.translationMm ?? [0, 0, 0], '安装坐标'), quaternionXYZW } };
  });
  const simulation=input.simulation===undefined?{}:object(input.simulation,'仿真参数');
  const stockCellMm=number(simulation.stockCellMm??.5,'材料格距',.1,5);
  const arcChordToleranceMm=number(simulation.arcChordToleranceMm??.02,'弦高公差',.001,.1);
  const mode=simulation.mode??'cut';if(!['cut','dry_run'].includes(mode))throw new InputError('加工模式应为cut或dry_run');
  if(simulation.stopOnCollision!==undefined&&typeof simulation.stopOnCollision!=='boolean')throw new InputError('stopOnCollision应为布尔值');
  if(simulation.checkCollisions!==undefined&&typeof simulation.checkCollisions!=='boolean')throw new InputError('checkCollisions应为布尔值');
  const contactLocalizationMm=number(simulation.contactLocalizationMm??.05,'接触定位区间',.001,.05);
  const maxCollisionQueries=number(simulation.maxCollisionQueries??200000,'碰撞查询预算',100,1000000);
  const maxMemoryMb=number(simulation.maxMemoryMb??512,'内存预算MB',64,1024);
  const sizeMm=vector(stock.sizeMm??(stock.kind==='mesh'?[1,1,1]:undefined),'毛坯尺寸',3,.1,1000);
  if(Math.ceil(sizeMm[0]/stockCellMm)*Math.ceil(sizeMm[1]/stockCellMm)>MAX_CELLS)throw new InputError('材料网格超过160000单元，请增大格距');
  if(stock.kind==='mesh'&&!assets.some(a=>(a.objectId===stock.assetId&&a.role==='stock')||a.nodes?.some(n=>n.objectId===stock.assetId&&n.role==='stock')))throw new InputError('网格毛坯必须引用role=stock的assetId');
  const digest=sha256(programText);
  if(program.sha256!==undefined&&program.sha256!==digest)throw new InputError('程序SHA-256不匹配',undefined,'HASH_MISMATCH');
  const profileId=input.machineProfileId===undefined?undefined:text(input.machineProfileId,'机床配置ID');
  const profile=input.machineProfile??(profileId?builtInProfile(profileId):undefined);
  if(profileId&&!profile)throw new InputError('机床配置ID未注册，请下发完整machineProfile',undefined,'MISSING_PROFILE');
  if(profile)validateMachineProfile(profile);
  const initialAxisPositionMm=input.initialAxisPositionMm===undefined?undefined:asVector(input.initialAxisPositionMm,'初始轴位置');
  const fromAxes=initialAxisPositionMm?axisToTip(initialAxisPositionMm,tools[0].gaugeLengthMm,profile):undefined;
  const initialPositionMm=fromAxes?[fromAxes.x,fromAxes.y,fromAxes.z]:vector(input.initialPositionMm??[0,0,30],'初始刀尖位置');
  if(!internal&&initialAxisPositionMm&&input.initialPositionMm!==undefined&&vector(input.initialPositionMm,'初始刀尖位置').some((v,i)=>Math.abs(v-initialPositionMm[i])>1e-7))throw new InputError('初始刀尖与初始轴位置不一致');
  if(input.optionalStop!==undefined&&typeof input.optionalStop!=='boolean')throw new InputError('optionalStop应为布尔值');
  return {
    dialectId:input.dialectId??'milling-basic-v1',
    program: { programId: text(program.programId, '程序ID'), text: programText,sha256:digest,lineEnding:programText.includes('\r\n')?'CRLF':programText.includes('\r')?'CR':'LF' },
    stock: { objectId: unique(text(stock.objectId, '毛坯ID')), kind: stock.kind,assetId:stock.assetId, sizeMm, minCornerInW: vector(stock.minCornerInW??(stock.kind==='mesh'?[0,0,0]:undefined), '毛坯原点') },
    tools, initialPositionMm, assets,initialAxisPositionMm,
    workOffsetsMm,toolLengthOffsetsMm,toolLengthReferenceMm,cutterRadiusOffsetsMm,machineProfile:profile?structuredClone(profile):undefined,machineProfileId:profileId,optionalStop:input.optionalStop??false,
    simulation:{stockCellMm,arcChordToleranceMm,mode,checkCollisions:simulation.checkCollisions??true,stopOnCollision:simulation.stopOnCollision??true,contactLocalizationMm,maxCollisionQueries,maxMemoryMb},
  };
}

