import * as THREE from 'three';
import type { StockUpdate } from '../core/types';
export class StockSurface {
  readonly group=new THREE.Group();
  private meshes=new Map<number,THREE.Mesh>();
  private revision=-1;
  private material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.48,metalness:.28});
  apply(update:StockUpdate){
    if(!update.full&&update.revision<=this.revision)return;
    if(update.full)this.clear();
    this.group.position.fromArray(update.originMm);
    for(const tile of update.tiles){
      const previous=this.meshes.get(tile.tileId);
      if(previous){this.group.remove(previous);previous.geometry.dispose();this.meshes.delete(tile.tileId);}
      if(!tile.positions.length)continue;
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.BufferAttribute(tile.positions,3));
      geometry.setAttribute('normal',new THREE.BufferAttribute(tile.normals,3));
      geometry.setAttribute('color',new THREE.BufferAttribute(tile.colors,3));
      geometry.computeBoundingSphere();
      const mesh=new THREE.Mesh(geometry,this.material);mesh.castShadow=true;mesh.receiveShadow=true;
      this.meshes.set(tile.tileId,mesh);this.group.add(mesh);
    }
    this.revision=update.revision;
  }
  private clear(){for(const mesh of this.meshes.values())mesh.geometry.dispose();this.meshes.clear();this.group.clear();}
  dispose(){this.clear();this.material.dispose();this.group.removeFromParent();}
}

