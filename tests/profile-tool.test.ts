import { describe, expect, it } from 'vitest';
import { boxSupport, convexDistance, toolSupport } from '../src/core/convex';
import { cuttingTipOffset } from '../src/core/toolProfile';
import { DexelStock } from '../src/core/stock';
import type { Job, Tool } from '../src/core/types';

const profile: Tool = {
  toolId: 'forming', toolNumber: 3, type: 'profile_endmill', diameterMm: 10,
  cuttingLengthMm: 8, gaugeLengthMm: 12, shaftDiameterMm: 6,
  holder: { diameterMm: 20, lengthMm: 10 },
  radialProfile: [
    { zMm: 0, radiusMm: 1 }, { zMm: 2, radiusMm: 1 },
    { zMm: 4, radiusMm: 2 }, { zMm: 5, radiusMm: 4 }, { zMm: 8, radiusMm: 5 },
  ],
};
const spec = (distance: number): Job['stock'] => ({
  objectId: 'stock', kind: 'box', minCornerInW: [distance - .05, -.05, -10], sizeMm: [.1, .1, 25],
});
const p = (z: number) => ({ x: 0, y: 0, z });

describe('measured radial forming profile', () => {
  it.each([[.5, 0], [1, 0], [1.5, 3], [3, 4.5], [4.5, 6.5], [5, 8]])(
    'inverts radial distance %s to the lowest profile height %s', (radius, height) => {
      expect(cuttingTipOffset(profile, radius)).toBeCloseTo(height, 10);
    },
  );

  it('keeps distances beyond the maximum radius outside the tool', () => {
    expect(cuttingTipOffset(profile, 5.01)).toBe(Infinity);
    expect(cuttingTipOffset(profile, 5 + 1e-10)).toBe(Infinity);
    expect(cuttingTipOffset(profile, -.01)).toBe(Infinity);
  });

  it('requires a measured profile instead of silently substituting a cylinder', () => {
    const missing = { ...profile, radialProfile: undefined };
    expect(() => cuttingTipOffset(missing, 2)).toThrow(/剖面|profile/i);
    expect(() => toolSupport(missing, 'cutter', [0, 0, 0])([1, 0, 0])).toThrow(/剖面|profile/i);
  });

  it.each([[1.5, -2], [3, -.5], [4.5, 1.5]])('cuts radius %s to its actual groove-bottom height %s', (radius, bottom) => {
    const stock = new DexelStock(spec(radius), .1);
    stock.carveLine(p(-5), p(-5), profile);
    expect(stock.getColumn(0, 0)).toEqual([-10, expect.closeTo(bottom, 9), 3, 15]);
  });

  it('sweeps a constant-height slot using the profile at the nearest radial distance', () => {
    const stock = new DexelStock({ ...spec(0), minCornerInW: [-.05, 2.95, -10] }, .1);
    stock.carveLine({ x: -3, y: 0, z: -5 }, { x: 3, y: 0, z: -5 }, profile);
    expect(stock.getColumn(0, 0)).toEqual([-10, expect.closeTo(-.5, 9), 3, 15]);
  });

  it('allows pure-Z feed with finite cutting length and the same radial profile', () => {
    const stock = new DexelStock(spec(1.5), .1);
    stock.carveLine(p(2), p(-5), profile);
    expect(stock.getColumn(0, 0)).toEqual([-10, expect.closeTo(-2, 9), 10, 15]);
  });

  it('rejects mixed XY/Z feed before removing any material', () => {
    const stock = new DexelStock(spec(0), .1);
    expect(() => stock.carveLine(p(0), { x: 1, y: 0, z: -1 }, profile)).toThrow(/剖面|profile/i);
    expect(stock.stats().removedVolumeMm3).toBe(0);
  });

  it('selects the support point from all measured profile circles', () => {
    const support = toolSupport(profile, 'cutter', [0, 0, 0]);
    expect(support([1, 0, -1])).toEqual([1, 0, 0]);
    expect(support([1, 0, -.5])).toEqual([4, 0, 5]);
    expect(support([1, 0, -.1])).toEqual([5, 0, 8]);
    const distance = convexDistance(support, boxSupport({ min: [3, -.05, 0], max: [3.1, .05, .1] }));
    expect(distance.lower).toBeGreaterThan(1);
  });

  it('retains exact shaft and holder cylinders independently of the forming profile', () => {
    expect(toolSupport(profile, 'shaft', [0, 0, 0])([1, 0, -1])).toEqual([3, 0, 8]);
    expect(toolSupport(profile, 'holder', [0, 0, 0])([1, 0, -1])).toEqual([10, 0, 12]);
  });
});
