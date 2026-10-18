import { InputError } from './types';
import type { Tool } from './types';
export function requireRadialProfile(tool: Tool): NonNullable<Tool['radialProfile']> {
  if (!tool.radialProfile?.length) throw new InputError('成形刀缺少径向剖面，不能替换为圆柱或球刀', undefined, 'PROFILE_REQUIRED');
  return tool.radialProfile;
}
export function drillTipHeight(tool: Tool): number {
  return tool.diameterMm / 2 / Math.tan(59 * Math.PI / 180);
}
export function cuttingTipOffset(tool: Tool, distance: number): number {
  if (tool.type === 'profile_endmill') {
    const profile = requireRadialProfile(tool);
    if (!Number.isFinite(distance) || distance < 0 || distance > profile[profile.length - 1].radiusMm) return Infinity;
    for (let i = 0; i < profile.length; i++) {
      const next = profile[i];
      if (distance > next.radiusMm) continue;
      if (i === 0) return next.zMm;
      const previous = profile[i - 1];
      // The first enclosing radius also handles plateaus at their lowest Z.
      return previous.zMm + (next.zMm - previous.zMm) * (distance - previous.radiusMm) / (next.radiusMm - previous.radiusMm);
    }
    return Infinity;
  }
  const r = tool.diameterMm / 2;
  if (distance > r + 1e-9 || distance < 0) return Infinity;
  const d = Math.min(r, distance);
  if (tool.type === 'ball_endmill') return r - Math.sqrt(Math.max(0, r * r - d * d));
  if (tool.type === 'drill') return drillTipHeight(tool) * d / r;
  return 0;
}

