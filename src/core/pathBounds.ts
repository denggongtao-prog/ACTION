import type { Motion } from './types';
import type { Bounds,Point3 } from './collisionTypes';
import { pointAt } from './gcode';
/** Exact coordinate extrema for a line or fixed-Z-axis XY helix over a parameter interval. */
export function pathBounds(move:Motion,a:number,b:number):Bounds{
  const points=[pointAt(move,a),pointAt(move,b)];
  if(move.arc){const start=move.arc.startAngle+move.arc.sweep*a,end=move.arc.startAngle+move.arc.sweep*b;
    for(let k=Math.ceil(Math.min(start,end)/(Math.PI/2));k<=Math.floor(Math.max(start,end)/(Math.PI/2));k++){
      const t=(k*Math.PI/2-move.arc.startAngle)/move.arc.sweep;if(t>=a&&t<=b)points.push(pointAt(move,t));
    }
  }
  const axes=['x','y','z'] as const;
  return {min:axes.map(axis=>Math.min(...points.map(p=>p[axis]))) as Point3,max:axes.map(axis=>Math.max(...points.map(p=>p[axis]))) as Point3};
}
