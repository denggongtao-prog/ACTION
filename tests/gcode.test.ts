import { describe, expect, it } from 'vitest';
import { parseProgram, pointAt } from '../src/core/gcode';
const tools = [{ toolNumber: 1 }, { toolNumber: 2 }];
const parse = (s: string) => parseProgram(s, tools, { x: 0, y: 0, z: 10 });
describe('G代码解释器', () => {
  it('保留空行注释后的原始物理行和N段号', () => {
    const moves = parse('(header)\r\n\r\nN350 G1 X10 F600').filter(i => i.kind === 'motion');
    expect(moves[0].source).toEqual({ physicalLine: 3, blockNumber: 350, sourceText: 'N350 G1 X10 F600' });
    expect(moves[0].to).toEqual({ x: 10, y: 0, z: 10 });
  });
  it('T只预选而M6才启用新刀', () => {
    const a = parse('T2\nG1 X10\nM6\nG1 X20');
    expect(a.filter(i => i.kind === 'motion').map(i => i.toolNumber)).toEqual([1, 2]);
    expect(a.filter(i => i.kind === 'tool_change').map(i => i.source.physicalLine)).toEqual([3]);
  });
  it('英寸与增量坐标分别换算', () => {
    const a = parse('G20 G91\nG1 X1 F10\nX0.5');
    const m = a.filter(i => i.kind === 'motion');
    expect(m[0].to.x).toBeCloseTo(25.4);
    expect(m[1].to.x).toBeCloseTo(38.1);
    expect(m[0].feedMmMin).toBeCloseTo(254);
  });
  it('逆时针四分之一圆有独立解析中点', () => {
    const m = parse('G0 X10 Y0\nG3 X0 Y10 I-10 J0 F600').filter(i => i.kind === 'motion')[1];
    const p = pointAt(m, 0.5);
    expect(p.x).toBeCloseTo(7.07106781);
    expect(p.y).toBeCloseTo(7.07106781);
    expect(m.lengthMm).toBeCloseTo(5 * Math.PI);
  });
  it('全圆I/J与螺旋Z保留完整路径', () => {
    const m = parse('G2 I5 J0 Z0 F600').find(i => i.kind === 'motion')!;
    expect(m.lengthMm).toBeCloseTo(Math.hypot(10 * Math.PI, 10));
    expect(pointAt(m, 0.5)).toEqual({ x: 10, y: expect.closeTo(0, 8), z: 5 });
  });
  it('R负数选择大圆弧', () => {
    const m = parse('G0 X10 Y0\nG3 X0 Y10 R-10').filter(i => i.kind === 'motion')[1];
    expect(m.lengthMm).toBeCloseTo(15 * Math.PI);
  });
  it.each(['G90.1', 'G43 H1', 'G41 X10', 'G81 X10', 'G1 X10 rubbish', 'G1 X1e9', 'G1 XNaN', 'G1 X1 X2', 'G90 G91', 'G1 X10 F0', 'T7 M6', 'G2 X20 I1', 'G3 X2 R0'])('不静默接受不支持或非法输入 %s', (code) => {
    expect(() => parse(code)).toThrow();
  });
  it('错误返回精确物理行', () => {
    try { parse('\n(comment)\nG43 H1'); expect.fail('must reject'); }
    catch (e) { expect((e as { physicalLine: number }).physicalLine).toBe(3); }
  });
  it('M30后面的程序块不执行也不解析为运动', () => {
    expect(parse('G1 X10\nM30\nG1 X999').filter(i => i.kind === 'motion')).toHaveLength(1);
  });
});

