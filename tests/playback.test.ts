import { describe, it, expect } from 'vitest';
import { Playback } from '../src/core/playback';
import { validateJob } from '../src/core/job';
const job = (text = 'G1 X10 F600\nM30') => validateJob({ program: { programId: 'p', text }, stock: { objectId: 's', kind: 'box', sizeMm: [20,20,10], minCornerInW: [0,0,-10] }, initialPositionMm: [0,0,10], tools: [1,2].map(n => ({ toolId: 't'+n, toolNumber:n, type:'flat_endmill', diameterMm:n*4, cuttingLengthMm:20, gaugeLengthMm:50, shaftDiameterMm:8, holder:{ diameterMm:28, lengthMm:30 } })) });
describe('回放状态机', () => {
  it('在真实指令时长内插值并可暂停恢复', () => {
    const p = new Playback(); p.load(job()); p.start(); p.advance(500);
    expect(p.snapshot().position.x).toBeCloseTo(5);
    p.pause(); p.advance(500); expect(p.snapshot().position.x).toBeCloseTo(5);
    p.resume(); p.advance(500); expect(p.snapshot().state).toBe('COMPLETED');
    expect(p.snapshot().position.x).toBe(10);
    expect(p.snapshot().verification).toBe('fully_checked');
  });
  it('倍率不改变路径终点，重置恢复初始状态', () => {
    const p = new Playback(); p.load(job()); p.setSpeed(2); p.start(); p.advance(500);
    expect(p.snapshot().state).toBe('COMPLETED'); p.reset();
    expect(p.snapshot().state).toBe('READY'); expect(p.snapshot().position.x).toBe(0);
    expect(p.snapshot().elapsedMs).toBe(0);
  });
  it('单步以源行而非内部指令为单位', () => {
    const p = new Playback(); p.load(job('T2 M6\nG1 X10 F600\nM30')); p.step();
    expect(p.snapshot().activeTool).toBe(2);
    expect(p.snapshot().events).toMatchObject([{ type:'TOOL_CHANGE', toolNumber:2, physicalLine:1, instructionId:2 }]);
    expect(p.snapshot().position.x).toBe(0); p.step(); expect(p.snapshot().position.x).toBe(10);
  });
  it('M0暂停后恢复不重复停在同块', () => {
    const p = new Playback(); p.load(job('G1 X10 F600\nM0\nG1 X20\nM30')); p.start(); p.advance(5000);
    expect(p.snapshot().state).toBe('PAUSED'); expect(p.snapshot().position.x).toBe(10);
    p.resume(); p.advance(1000); expect(p.snapshot().state).toBe('COMPLETED');
    expect(p.snapshot().position.x).toBe(20);
  });
  it('T预选与主轴状态跟随执行而非解析终态', () => {
    const p = new Playback(); p.load(job('T2\nG1 X10 F600\nM6\nM3 S2500\nG1 X20\nM30'));
    p.step(); expect(p.snapshot().selectedTool).toBe(2); expect(p.snapshot().activeTool).toBe(1);
    p.step(); expect(p.snapshot().activeTool).toBe(1);
    p.step(); expect(p.snapshot().activeTool).toBe(2);
    p.step(); expect(p.snapshot().spindleRpm).toBe(2500);
  });
  it('错误状态转换和非法倍率被拒绝', () => {
    const p = new Playback();
    expect(() => p.start()).toThrow(); p.load(job()); p.start();
    expect(() => p.start()).toThrow(); expect(() => p.step()).toThrow();
    expect(() => p.setSpeed(NaN)).toThrow(); expect(() => p.setSpeed(100)).toThrow();
  });
  it('每次推进的事件只返回一次', () => {
    const p = new Playback(); p.load(job('T2 M6\nG1 X10 F600\nM30')); p.start(); p.advance(4000);
    expect(p.snapshot().events).toHaveLength(1); p.advance(10); expect(p.snapshot().events).toHaveLength(0);
  });
  it('同一tick中的每次换刀带有独立源指令编号',()=>{
    const p=new Playback();p.load(job('T2 M6\nT1 M6\nT2 M6\nG1 X10 F600\nM30'));p.start();p.advance(12000);
    expect(p.snapshot().events.map(e=>e.physicalLine)).toEqual([1,2,3]);
    expect(new Set(p.snapshot().events.map(e=>e.instructionId)).size).toBe(3);
  });
});

