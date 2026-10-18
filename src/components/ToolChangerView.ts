import * as THREE from 'three';
import type {Snapshot,Tool,Vec3} from '../core/types';
import {exchangePose,toolMagazineLayout} from '../core/toolExchange';
import {disposeObject} from '../lib/assets';

/** Umbrella carousel + shuttle; decorative only, driven entirely by Worker time. */
export class ToolChangerView {
  readonly group=new THREE.Group();
  readonly layout;
  private key='';private oldModel=new THREE.Group();private newModel=new THREE.Group();
  private rotor=new THREE.Group();private frame=new THREE.Group();private carriage=new THREE.Group();private spindle=new THREE.Group();
  constructor(private tools:Tool[],private buildTool:(tool:Tool)=>THREE.Group,private floorZ=-32){
    this.layout=toolMagazineLayout(tools);this.group.visible=false;this.group.name='illustrative-tool-changer';
  }
  private material(color:number){return new THREE.MeshStandardMaterial({color,roughness:.32,metalness:.65});}
  private box(parent:THREE.Group,w:number,d:number,h:number,color:number,x:number,y:number,z:number){
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,d,h),this.material(color));mesh.position.set(x,y,z);mesh.castShadow=true;parent.add(mesh);return mesh;
  }
  private cylinder(parent:THREE.Group,r:number,h:number,color:number,x:number,y:number,z:number,segments=48){
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,segments),this.material(color));mesh.rotation.x=Math.PI/2;mesh.position.set(x,y,z);mesh.castShadow=true;parent.add(mesh);return mesh;
  }
  private plate(parent:THREE.Group,shape:THREE.Shape,height:number,color:number,z:number,bevel=.35){
    const mesh=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:height,steps:1,bevelEnabled:true,bevelSegments:1,bevelSize:bevel,bevelThickness:bevel,curveSegments:48}),this.material(color));
    mesh.position.z=z;mesh.castShadow=true;parent.add(mesh);return mesh;
  }
  private label(parent:THREE.Group,text:string,x:number,y:number,z:number){
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='#e8edea';ctx.fillRect(0,0,128,64);ctx.fillStyle='#253b45';ctx.font='bold 34px Consolas';ctx.textAlign='center';ctx.fillText(text,64,44);
    const texture=new THREE.CanvasTexture(canvas),sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture}));sprite.position.set(x,y,z);sprite.scale.set(13,6.5,1);parent.add(sprite);
  }
  private build(old:Tool,next:Tool,gauge:Vec3,side:boolean){
    disposeObject(this.group);this.group.clear();
    this.rotor=new THREE.Group();this.frame=new THREE.Group();this.carriage=new THREE.Group();this.spindle=new THREE.Group();
    this.oldModel=this.buildTool(old);this.newModel=this.buildTool(next);
    this.group.add(this.rotor,this.frame,this.carriage,this.spindle,this.oldModel,this.newModel);
    if(side){this.label(this.group,'HEAD',gauge.x+this.layout.outerRadiusMm+40,gauge.y,gauge.z+35);return;}
    const {pitchRadiusMm:r,maxDiameterMm:d,shuttleTravelMm:travel,pocketCount:n}=this.layout,bodyR=r-d/2-6;
    const steel=0xb5c0c6,dark=0x344954,black=0x242e35;
    const disk=new THREE.Shape();disk.absarc(0,0,bodyR,0,Math.PI*2,false);
    for(let i=0;i<Math.min(n,12);i++){
      const a=i*Math.PI*2/Math.min(n,12),hole=new THREE.Path();hole.absarc(bodyR*.65*Math.cos(a),bodyR*.65*Math.sin(a),Math.min(5,bodyR*.13),0,Math.PI*2,true);disk.holes.push(hole);
    }
    this.plate(this.rotor,disk,5,steel,-3);this.cylinder(this.rotor,14,9,dark,0,0,3);
    this.cylinder(this.carriage,9,48,steel,0,0,32);this.cylinder(this.carriage,17,8,black,0,0,57);
    this.box(this.carriage,36,34,20,dark,0,0,71);this.cylinder(this.carriage,12,30,black,0,0,96);
    for(let i=0;i<4;i++){const a=Math.PI/4+i*Math.PI/2;this.cylinder(this.rotor,1.7,2,black,10*Math.cos(a),10*Math.sin(a),8,6);}
    for(let i=0;i<n;i++){
      const a=Math.PI+i*2*Math.PI/n,t=this.tools.find(t=>this.layout.slots.find(s=>s.toolNumber===t.toolNumber)?.angle===a);
      const slot=new THREE.Group();slot.position.set(r*Math.cos(a),r*Math.sin(a),0);slot.rotation.z=a;this.rotor.add(slot);
      const diameter=t?.holder.diameterMm??d,h=t?.holder.lengthMm??30,inner=diameter*.34+.7,outer=diameter/2+4;
      const root=r-bodyR+8,seat=outer+3;
      this.box(slot,Math.max(6,root-seat),12,5,steel,-(root+seat)/2,0,0);
      // Spring finger opens radially outward; grip groove is inside the holder flange.
      const fork=new THREE.Shape();fork.absarc(0,0,outer,Math.PI/3,Math.PI*5/3,false);
      fork.lineTo(inner*Math.cos(Math.PI*5/3),inner*Math.sin(Math.PI*5/3));fork.absarc(0,0,inner,Math.PI*5/3,Math.PI/3,true);fork.closePath();
      this.plate(slot,fork,h*.07,dark,h*.31,Math.min(.35,h*.01)).name='holder-fork-'+(t?.toolNumber??'empty-'+i);
      this.box(slot,6,10,h*.31,steel,-outer-3,0,h*.155);
      for(const y of [-5,5])this.cylinder(slot,1.4,2,black,-outer-3,y,4,6);
      this.label(slot,t?'T'+t.toolNumber:String(i+1),-diameter/2-12,0,5);
      if(t&&t.toolNumber!==old.toolNumber&&t.toolNumber!==next.toolNumber){const model=this.buildTool(t);model.position.set(r*Math.cos(a),r*Math.sin(a),-t.gaugeLengthMm);this.rotor.add(model);}
    }
    const columnX=r+travel+bodyR+24,low=this.floorZ-gauge.z;
    this.box(this.frame,42,62,8,dark,columnX,0,low+4);
    this.box(this.frame,24,28,104-low,dark,columnX,0,(104+low)/2);
    for(const y of [-18,18]){
      const length=columnX-r+26;
      this.box(this.frame,length,8,11,dark,(columnX+r)/2,y,108);
      this.box(this.frame,length,3,3,steel,(columnX+r)/2,y,115);
      this.box(this.carriage,34,12,8,black,0,y,108);
    }
    this.box(this.frame,8,50,28,dark,columnX,0,104);this.label(this.frame,'ATC',columnX,-16,70);
    // Hollow spindle nose receives the actual holder taper, with no extra tool scale.
    const diameter=Math.max(old.holder.diameterMm,next.holder.diameterMm),h=Math.max(old.holder.lengthMm,next.holder.lengthMm),lowZ=h*.58,inside=diameter*.31;
    const housingBase=Math.max(lowZ+41,h+4),noseTop=housingBase+1;
    const nose=new THREE.LatheGeometry([[inside,lowZ],[diameter*.68,lowZ],[diameter*.72,lowZ+5],[diameter*.72,noseTop],[inside,noseTop],[inside,lowZ]].map(([x,y])=>new THREE.Vector2(x,y)),64);
    const sleeve=new THREE.Mesh(nose,this.material(steel));sleeve.rotation.x=Math.PI/2;this.spindle.add(sleeve);
    this.box(this.spindle,diameter*1.6,diameter*1.5,34,dark,0,0,housingBase+17).name='spindle-solid';
  }
  update(frame:Snapshot['toolExchange']){
    if(!frame){this.group.visible=false;return;}
    const old=this.tools.find(t=>t.toolNumber===frame.fromTool),next=this.tools.find(t=>t.toolNumber===frame.toTool);if(!old||!next)return;
    const pose=exchangePose(frame,old,next,this.layout),key=frame.instructionId+':'+frame.fromTool+':'+frame.toTool;
    if(key!==this.key){this.build(old,next,pose.gauge,pose.mode==='side_head');this.key=key;}
    const set=(o:THREE.Object3D,p:Vec3)=>o.position.set(p.x,p.y,p.z);
    set(this.oldModel,pose.oldTip);set(this.newModel,pose.newTip);set(this.rotor,pose.rack);this.rotor.rotation.z=pose.rotation;
    set(this.carriage,pose.rack);set(this.frame,pose.gauge);set(this.spindle,{...pose.gauge,z:pose.gauge.z+pose.spindleLiftMm});
    this.group.visible=true;
  }
}
