import { describe, expect, it } from 'vitest';
import { boxSupport, convexDistance, toolSupport } from '../src/core/convex';
import { DexelStock } from '../src/core/stock';
import type { Job, Tool } from '../src/core/types';

const sideTool = (type: Tool['type'] = 'drill', length = 4): Tool => ({
  toolId: 'side', toolNumber: 1, type, diameterMm: 4, cuttingLengthMm: length,
  gaugeLengthMm: 8, shaftDiameterMm: 2, holder: { diameterMm: 6, lengthMm: 3 },
  axisDirection: { x: 0, y: -1, z: 0 },
});
const spec = (min: number[], size: number[]): Job['stock'] => ({
  objectId: 'stock', kind: 'box', minCornerInW: min, sizeMm: size,
});
const p = (y: number) => ({ x: 0, y, z: 0 });

describe('fixed -Y side spindle geometry', () => {
  it('rotates the actual drill cone and finite cutter instead of a vertical cylinder', () => {
    const support = toolSupport(sideTool(), 'cutter', [0, 0, 0]);
    expect(support([0, -1, 0])).toEqual([0, -4, 0]);
    expect(support([0, 1, 0])).toEqual([0, 0, 0]);
    expect(convexDistance(support, boxSupport({ min: [1.5, -.06, -.02], max: [1.6, -.01, .02] })).lower).toBeGreaterThan(.5);
    expect(convexDistance(support, boxSupport({ min: [1.9, -3, -.02], max: [2.1, -2.9, .02] })).upper).toBeLessThan(1e-6);
  });

  it('rotates shaft and holder with the same axis and retains their axial gap', () => {
    const tip: [number, number, number] = [10, 20, 30];
    const shaft = toolSupport(sideTool(), 'shaft', tip);
    const holder = toolSupport(sideTool(), 'holder', tip);
    expect(shaft([0, -1, 0])).toEqual([10, 12, 30]);
    expect(holder([0, -1, 0])).toEqual([10, 9, 30]);
    expect(convexDistance(holder, boxSupport({ min: [9.5, 13, 29.5], max: [10.5, 14, 30.5] })).lower).toBeCloseTo(1, 5);
    expect(convexDistance(shaft, boxSupport({ min: [10.9, 14, 29.9], max: [11.1, 15, 30.1] })).upper).toBeLessThan(1e-6);
  });
});

describe('horizontal drilling Z-column difference', () => {
  it('cuts a stationary finite flat cutter circle only between its axial ends', () => {
    const stock = new DexelStock(spec([-.5, -5, -4], [1, 6, 8]), 1);
    stock.carveLine(p(0), p(0), sideTool('flat_endmill'));
    expect(stock.getColumn(0, 0)).toEqual([-4, 4]);
    expect(stock.getColumn(0, 1)).toEqual([-4, -2, 2, 4]);
    expect(stock.getColumn(0, 5)).toEqual([-4, 4]);
  });

  it('matches a hand-derived 118 degree cone cross-section and preserves both Z layers', () => {
    const stock = new DexelStock(spec([.5, -.6, -4], [1, .2, 8]), .2);
    stock.carveLine(p(0), p(0), sideTool());
    // Column x=.6, y=-.5: cone radius = .5*tan(59 degrees).
    const half = Math.sqrt((.5 * Math.tan(59 * Math.PI / 180)) ** 2 - .6 ** 2);
    expect(stock.getColumn(0, 0)).toEqual([-4, expect.closeTo(-half, 8), expect.closeTo(half, 8), 4]);
  });

  it('sweeps positive Y drilling and reverse withdrawal as the same union', () => {
    const forward = new DexelStock(spec([-.5, -5, -4], [1, 10, 8]), 1);
    const reverse = new DexelStock(spec([-.5, -5, -4], [1, 10, 8]), 1);
    forward.carveLine(p(-1), p(3), sideTool());
    reverse.carveLine(p(3), p(-1), sideTool());
    expect(forward.getColumn(0, 4)).toEqual([-4, -2, 2, 4]);
    expect(forward.getColumn(0, 9)).toEqual([-4, 4]);
    expect(reverse.save().columns).toEqual(forward.save().columns);
  });

  it('keeps conservative removal inside every point of each XY cell', () => {
    const stock = new DexelStock(spec([.5, -.6, -4], [.2, .2, 8]), .2, true);
    stock.carveLine(p(0), p(0), sideTool());
    // Least cone radius occurs at y=-.4; furthest radial x is .7.
    expect(stock.getColumn(0, 0)).toEqual([-4, 4]);
    const flat = new DexelStock(spec([.5, -2, -4], [.2, .2, 8]), .2, true);
    flat.carveLine(p(0), p(0), sideTool('flat_endmill'));
    const half = Math.sqrt(4 - .7 ** 2);
    expect(flat.getColumn(0, 0)).toEqual([-4, expect.closeTo(-half, 8), expect.closeTo(half, 8), 4]);
  });

  it('produces identical conservative columns for whole, segmented and checkpointed paths', () => {
    const shape = spec([-.3, -1.4, -2], [.6, 2.8, 4]);
    const whole = new DexelStock(shape, .2, true);
    const chunks = new DexelStock(shape, .2, true);
    const drill = sideTool('drill', 1.3);
    whole.carveLine(p(-.4), p(.8), drill);
    for (let i = 0; i < 12; i++) {
      chunks.carveLine(p(-.4 + i * .1), p(-.3 + i * .1), drill);
      if (i === 5) { const saved = chunks.save(); chunks.reset(); chunks.restore(saved); }
    }
    expect(chunks.save().columns).toEqual(whole.save().columns);
  });

  it('rejects a non-axial side-tool carve explicitly before changing stock', () => {
    const stock = new DexelStock(spec([-5, -5, -5], [10, 10, 10]), 1);
    expect(() => stock.carveLine(p(0), { x: 1, y: 0, z: 0 }, sideTool())).toThrow(/侧|axis|axial/i);
    expect(stock.stats().removedVolumeMm3).toBe(0);
  });
});
