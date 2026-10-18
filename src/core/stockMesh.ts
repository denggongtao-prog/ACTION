import { DexelStock, subtractIntervals, TILE_SIZE } from './stock';
import { InputError } from './types';
import type { StockTile, StockUpdate } from './types';
type Point = [number, number, number];
export function meshTile(stock: DexelStock, tileId: number): StockTile {
  const positions: number[] = [], normals: number[] = [], colors: number[] = [];
  const tx = tileId % stock.tilesX, ty = Math.floor(tileId / stock.tilesX);
  const initialTop = stock.min[2] + stock.size[2];
  function quad(points: Point[], normal: Point, originalTop = false) {
    const color = originalTop ? [.43, .52, .41] : [.32, .43, .39];
    for (const i of [0, 1, 2, 0, 2, 3]) { positions.push(...points[i]); normals.push(...normal); colors.push(...color); }
    if (positions.length / 3 > 250000) throw new InputError('材料单块表面超过25万顶点', undefined, 'STOCK_MESH_BUDGET');
  }
  for (let y = ty * TILE_SIZE; y < Math.min(stock.ny, (ty + 1) * TILE_SIZE); y++) {
    for (let x = tx * TILE_SIZE; x < Math.min(stock.nx, (tx + 1) * TILE_SIZE); x++) {
      const current = stock.getColumn(x, y); if (!current.length) continue;
      // Float32 positions stay near the stock origin; world translation uses the object matrix.
      const x0 = x * stock.dx, x1 = x0 + stock.dx;
      const y0 = y * stock.dy, y1 = y0 + stock.dy;
      for (let k = 0; k < current.length; k += 2) {
        const z0 = current[k]-stock.min[2], z1 = current[k + 1]-stock.min[2];
        quad([[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],[0,0,1],Math.abs(current[k+1]-initialTop)<1e-7);
        quad([[x0,y1,z0],[x1,y1,z0],[x1,y0,z0],[x0,y0,z0]],[0,0,-1]);
      }
      for (const [xx, yy, axis, sign] of [[x-1,y,0,-1],[x+1,y,0,1],[x,y-1,1,-1],[x,y+1,1,1]]) {
        let exposed = [...current]; const neighbor = stock.getColumn(xx, yy);
        for (let k = 0; k < neighbor.length; k += 2) exposed = subtractIntervals(exposed, neighbor[k], neighbor[k+1]);
        for (let k = 0; k < exposed.length; k += 2) {
          const z0 = exposed[k]-stock.min[2], z1 = exposed[k+1]-stock.min[2];
          let points:Point[];
          const normal:Point = axis === 0 ? [sign,0,0] : [0,sign,0];
          if (axis === 0) {
            const at = sign > 0 ? x1 : x0;
            points = [[at,y0,z0],[at,y1,z0],[at,y1,z1],[at,y0,z1]];
          } else {
            const at = sign > 0 ? y1 : y0;
            points = [[x0,at,z0],[x0,at,z1],[x1,at,z1],[x1,at,z0]];
          }
          if (sign < 0) points.reverse();
          quad(points,normal);
        }
      }
    }
  }
  return { tileId, positions: new Float32Array(positions), normals: new Float32Array(normals), colors: new Float32Array(colors) };
}
export function createStockUpdate(stock:DexelStock, vertexCounts = new Map<number,number>()):StockUpdate|null {
  const dirty = stock.takeDirty(); if (!dirty.tileIds.length) return null;
  try{
  const nextCounts = dirty.full ? new Map<number,number>() : new Map(vertexCounts);
  const tiles:StockTile[] = []; let total = [...nextCounts.values()].reduce((sum,n)=>sum+n,0);
  for (const id of dirty.tileIds) {
    const tile = meshTile(stock,id), count = tile.positions.length/3;
    total += count - (nextCounts.get(id) ?? 0);
    if (total > 2400000) throw new InputError('材料表面超过240万顶点，请增大格距或简化加工',undefined,'STOCK_MESH_BUDGET');
    nextCounts.set(id,count);tiles.push(tile);
  }
  vertexCounts.clear();for(const [id,count] of nextCounts)vertexCounts.set(id,count);
  return { full:dirty.full, revision:dirty.revision, originMm:[stock.min[0],stock.min[1],stock.min[2]], tiles };
  }catch(error){stock.restoreDirty(dirty);throw error;}
}

