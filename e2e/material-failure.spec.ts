import { test, expect } from '@playwright/test';

test('同步网格超预算使真实Worker停机，之后不能报告完成', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const worker = new Worker('/src/workers/simulation.worker.ts', { type: 'module' });
    let requestId = 0;
    const request = (type: string, payload?: unknown) => new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker response timeout')), 15000);
      worker.onmessage = event => {
        clearTimeout(timer);
        const { type, error, snapshot, stockUpdate } = event.data;
        resolve({ type, error, state: snapshot?.state, tiles: stockUpdate?.tiles.length });
      };
      worker.postMessage({ requestId: ++requestId, generation: 1, type, payload });
    });
    try {
      const load = await request('LOAD', {
        program: { programId: 'mesh-budget', text: 'M3 S1000\nG1 X100 F600\nM30' },
        stock: { objectId: 's', kind: 'box', sizeMm: [200, 200, 10], minCornerInW: [0, 0, 0] },
        initialPositionMm: [100, 100, 5],
        tools: [{ toolId: 't', toolNumber: 1, type: 'flat_endmill', diameterMm: 200, cuttingLengthMm: .1, gaugeLengthMm: 30, shaftDiameterMm: 200, holder: { diameterMm: 200, lengthMm: 20 } }],
        simulation: { stockCellMm: .5, arcChordToleranceMm: .02, mode: 'cut',checkCollisions:false },
      });
      const invalid = await request('RESUME');
      const spindle = await request('STEP');
      const failure = await request('STEP');
      const next = await request('STEP');
      return { load, invalid, spindle, failure, next };
    } finally { worker.terminate(); }
  });
  expect(result.load.state).toBe('READY');
  expect(result.invalid.type).toBe('REPLY');
  expect(result.invalid.error).toBeTruthy();
  expect(result.spindle.state).toBe('PAUSED');
  expect(result.failure.type).toBe('FATAL');
  expect(result.failure.error.message).toContain('240万顶点');
  expect(result.failure.error.physicalLine).toBe(2);
  expect(result.next.error).toBeTruthy();
  expect(result.next.state).toBeUndefined();
});
