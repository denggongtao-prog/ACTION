import { InputError } from './types';
import type { Tool, Vec3 } from './types';

/** Fixed direction from the cutting tip toward the holder. */
export function toolAxis(tool: Tool): Vec3 {
  const axis = tool.axisDirection ?? { x: 0, y: 0, z: 1 };
  if (Math.abs(axis.x) < 1e-10 && Math.abs(axis.y) < 1e-10 && Math.abs(axis.z - 1) < 1e-10) return { x: 0, y: 0, z: 1 };
  if (Math.abs(axis.x) < 1e-10 && Math.abs(axis.y + 1) < 1e-10 && Math.abs(axis.z) < 1e-10) return { x: 0, y: -1, z: 0 };
  throw new InputError('固定刀轴仅支持+Z主轴或-Y侧钻轴', undefined, 'TOOL_AXIS');
}

/** Rotate a vector from cutter coordinates (+Z toward holder), without translation. */
export function toolLocalToWorld(tool: Tool, local: Vec3): Vec3 {
  return toolAxis(tool).y === -1 ? { x: local.x, y: -local.z, z: local.y } : { ...local };
}

/** Inverse rotation; suitable for both positions relative to the tip and directions. */
export function toolWorldToLocal(tool: Tool, world: Vec3): Vec3 {
  return toolAxis(tool).y === -1 ? { x: world.x, y: world.z, z: -world.y } : { ...world };
}
