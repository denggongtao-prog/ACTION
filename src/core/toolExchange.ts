import type {Snapshot,Vec3,Tool} from './types';
export const TOOL_EXCHANGE_DURATION_MS=4000;
export const exchangePhaseLabels={release:'主轴松刀',remove_old:'取出旧刀',index_magazine:'刀库转位',insert_new:'送入新刀',clamp:'主轴夹紧'};
export const sideExchangePhaseLabels={release:'松开原装夹',remove_old:'移出原组件',index_magazine:'准备新组件',insert_new:'装入新组件',clamp:'确认装夹'};
export function exchangePhase(progress:number):Pick<NonNullable<Snapshot['toolExchange']>,'phase'|'phaseProgress'>{
  const p=Math.max(0,Math.min(1,progress));
  const phases=[['release',0,.12],['remove_old',.12,.35],['index_magazine',.35,.6],['insert_new',.6,.85],['clamp',.85,1]] as const;
  const [phase,low,high]=phases.find(([, ,high])=>p<high)??phases[4];return {phase,phaseProgress:(p-low)/(high-low)};
}
const smooth=(v:number)=>{const t=Math.max(0,Math.min(1,v));return t*t*(3-2*t);};
const lerp=(a:Vec3,b:Vec3,t:number):Vec3=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
export const isVerticalTool=(tool:Tool)=>(tool.axisDirection?.z??1)>.999;
export function toolMagazineLayout(tools:Tool[]){
  const vertical=tools.filter(isVerticalTool).sort((a,b)=>a.toolNumber-b.toolNumber);
  const pocketCount=Math.max(8,Math.ceil(vertical.length/4)*4);
  const maxDiameterMm=Math.max(12,...vertical.map(t=>Math.max(t.diameterMm,t.shaftDiameterMm,t.holder.diameterMm)));
  const pitchMm=maxDiameterMm+2*(4+.35)+10,pitchRadiusMm=pitchMm/(2*Math.sin(Math.PI/pocketCount));
  return {pocketCount,maxDiameterMm,pitchRadiusMm,outerRadiusMm:pitchRadiusMm+maxDiameterMm/2+4+.35,
    clearanceMm:10,shuttleTravelMm:maxDiameterMm+24,
    slots:vertical.map((t,i)=>({toolNumber:t.toolNumber,angle:Math.PI+i*2*Math.PI/pocketCount}))};
}
export type MagazineLayout=ReturnType<typeof toolMagazineLayout>;
type Frame=Pick<NonNullable<Snapshot['toolExchange']>,'progress'|'oldTip'|'newTip'|'fromTool'|'toTool'>;
/** Pure teaching poses. The Worker owns XYZ/clamp checks; this mechanism is illustrative. */
export function exchangePose(frame:Frame,oldTool:Tool,newTool:Tool,layout:MagazineLayout){
  const {progress:p,oldTip:old,newTip:next}=frame;
  const gauge={x:old.x,y:old.y,z:old.z+oldTool.gaugeLengthMm};
  const mode=isVerticalTool(oldTool)&&isVerticalTool(newTool)?'umbrella':'side_head';
  const oldAngle=layout.slots.find(s=>s.toolNumber===frame.fromTool)?.angle??Math.PI;
  const newAngle=layout.slots.find(s=>s.toolNumber===frame.toTool)?.angle??Math.PI;
  const delta=Math.atan2(Math.sin(oldAngle-newAngle),Math.cos(oldAngle-newAngle));
  const rotation=Math.PI-oldAngle+delta*smooth((p-.35)/.25);
  // Dock under the spindle, lift clear, retract, index, return, then lower the spindle.
  const extension=p<.12?1-smooth(p/.12):p<.35?smooth((p-.19)/.16):p<.6?1:p<.85?1-smooth((p-.6)/.16):smooth((p-.85)/.15);
  const rack={x:gauge.x+layout.pitchRadiusMm+layout.shuttleTravelMm*extension,y:gauge.y,z:gauge.z};
  const lift=Math.max(oldTool.holder.lengthMm,newTool.holder.lengthMm)+14;
  const spindleLiftMm=p<.12?0:p<.35?lift*smooth((p-.12)/.07):p<.76?lift:p<.85?lift*(1-smooth((p-.76)/.09)):0;
  const pocket=(angle:number,tool:Tool):Vec3=>({x:rack.x+layout.pitchRadiusMm*Math.cos(angle+rotation),y:rack.y+layout.pitchRadiusMm*Math.sin(angle+rotation),z:rack.z-tool.gaugeLengthMm});
  let oldTip=p<.12?{...old}:pocket(oldAngle,oldTool),newTip=p<.85?pocket(newAngle,newTool):{...next};
  if(mode==='side_head'){
    const reach=Math.max(oldTool.gaugeLengthMm+oldTool.holder.lengthMm,newTool.gaugeLengthMm+newTool.holder.lengthMm)+layout.outerRadiusMm+20;
    const oldPark={x:gauge.x+reach,y:gauge.y-35,z:gauge.z},newPark={x:gauge.x+reach,y:gauge.y+35,z:gauge.z};
    oldTip=lerp(old,oldPark,smooth((p-.12)/.23));newTip=lerp(newPark,next,smooth((p-.6)/.25));
  }
  return {oldTip,newTip,gauge,rack,rotation,spindleLiftMm,mode,extension};
}
