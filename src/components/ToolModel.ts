import * as THREE from 'three';
import type {Tool} from '../core/types';
import {drillTipHeight} from '../core/toolProfile';

/** Geometry is in mm. Every visible part stays inside the configured collision envelope. */
export function createToolModel(tool:Tool):THREE.Group {
  const group=new THREE.Group();group.name='tool-T'+tool.toolNumber;
  const material=(color:number,roughness=.32)=>new THREE.MeshStandardMaterial({color,metalness:.78,roughness});
  const carbide=material(0xb6a06c),steel=material(0xaeb9c0),black=material(0x303b45);
  const add=(geometry:THREE.BufferGeometry,mat:THREE.Material,part:string,z=0)=>{
    const mesh=new THREE.Mesh(geometry,mat);mesh.rotation.x=Math.PI/2;mesh.position.z=z;
    mesh.userData.part=part;mesh.castShadow=true;group.add(mesh);return mesh;
  };
  const lathe=(profile:number[][],mat:THREE.Material,part:string,z=0)=>add(new THREE.LatheGeometry(profile.map(([r,h])=>new THREE.Vector2(r,h)),64),mat,part,z);
  const cylinder=(r:number,h:number,z:number,mat:THREE.Material,part:string)=>add(new THREE.CylinderGeometry(r,r,h,64),mat,part,z);
  const r=tool.diameterMm/2,l=tool.cuttingLengthMm;
  const flutes=(height:number,low:number,count:number)=>{
    if(height<=0)return;
    const geometry=new THREE.CylinderGeometry(r,r,height,64,40),points=geometry.getAttribute('position');
    for(let i=0;i<points.count;i++){
      const x=points.getX(i),y=points.getY(i),z=points.getZ(i),radius=Math.hypot(x,z);
      if(radius<r*.5)continue;
      const angle=Math.atan2(z,x)+(y+height/2)/Math.max(r,1)*.5;
      const relief=.76+.24*Math.cos(count*angle);
      points.setXYZ(i,x*relief,y,z*relief);
    }
    geometry.computeVertexNormals();add(geometry,carbide,'cutter',low+height/2);
  };
  if(tool.type==='ball_endmill'){
    // Bottom hemisphere, then the fluted cylinder; tip remains exactly at local z=0.
    add(new THREE.SphereGeometry(r,48,24,0,Math.PI*2,Math.PI/2,Math.PI/2),carbide,'cutter',r);
    flutes(l-r,r,4);
  }else if(tool.type==='drill'){
    const height=drillTipHeight(tool);
    lathe([[0,0],[r,height],[0,height]],carbide,'cutter');flutes(l-height,height,2);
  }else if(tool.type==='profile_endmill'){
    lathe([[0,0],...tool.radialProfile!.map(p=>[p.radiusMm,p.zMm]),[0,l]],carbide,'cutter');
  }else flutes(l,0,4);
  if(tool.gaugeLengthMm>l)cylinder(tool.shaftDiameterMm/2,tool.gaugeLengthMm-l,(tool.gaugeLengthMm+l)/2,steel,'shaft');
  const d=tool.holder.diameterMm,h=tool.holder.lengthMm,g=tool.gaugeLengthMm;
  // Generic collar, grip groove, flange and taper. Not a fabricated BT/HSK standard.
  lathe([[0,0],[d*.4,0],[d*.48,h*.06],[d*.48,h*.23],[d*.34,h*.28],
    [d*.34,h*.4],[d*.5,h*.43],[d*.5,h*.53],[d*.3,h*.57],[d*.16,h*.94],[d*.14,h],[0,h]],steel,'holder',g);
  lathe([[d*.4,0],[d*.48,h*.06],[d*.48,h*.22],[d*.34,h*.26]],black,'holder',g);
  lathe([[d*.341,h*.285],[d*.341,h*.395]],black,'holder',g);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(tool.axisDirection?.x??0,tool.axisDirection?.y??0,tool.axisDirection?.z??1));
  return group;
}
