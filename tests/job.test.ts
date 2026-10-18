import { describe, expect, it } from 'vitest';
import { validateJob } from '../src/core/job';
export function jobInput() {
  return {
    program: { programId: 'p1', text: 'G21 G90\nT1 M6\nM3 S3000\nG1 X10 F600\nM30' },
    stock: { objectId: 'stock-1', kind: 'box', sizeMm: [100, 80, 20], minCornerInW: [-50, -40, -20] },
    tools: [{ toolId: 't1', toolNumber: 1, type: 'flat_endmill', diameterMm: 10, cuttingLengthMm: 20, gaugeLengthMm: 50, shaftDiameterMm: 10, holder: { diameterMm: 28, lengthMm: 30 } }],
    initialPositionMm: [0, 0, 30], assets: [],
  };
}
describe('任务输入', () => {
  it('默认切削参数、预算及刀形尺寸在载入阶段校验',()=>{
    expect(validateJob(jobInput()).simulation).toEqual({stockCellMm:.5,arcChordToleranceMm:.02,mode:'cut',checkCollisions:true,stopOnCollision:true,contactLocalizationMm:.05,maxCollisionQueries:200000,maxMemoryMb:512});
    expect(()=>validateJob({...jobInput(),simulation:{stockCellMm:NaN}})).toThrow();
    expect(()=>validateJob({...jobInput(),simulation:{mode:'anything'}})).toThrow();
    expect(()=>validateJob({...jobInput(),stock:{...jobInput().stock,sizeMm:[1000,1000,10]},simulation:{stockCellMm:.1}})).toThrow(/160000/);
    expect(()=>validateJob({...jobInput(),tools:[{...jobInput().tools[0],type:'ball_endmill',diameterMm:20,cuttingLengthMm:3}]})).toThrow();
  });
  it('复制并规范化有效任务', () => {
    const input = jobInput(); const result = validateJob(input);
    input.stock.sizeMm[0] = 9;
    expect(result.stock.sizeMm).toEqual([100, 80, 20]);
  });
  it.each([NaN, Infinity, -1, 0])('拒绝非法毛坯尺寸 %s', value => {
    const input = jobInput(); input.stock.sizeMm[0] = value;
    expect(() => validateJob(input)).toThrow();
  });
  it('拒绝无刀和重复刀号', () => {
    const input = jobInput(); input.tools = [];
    expect(() => validateJob(input)).toThrow();
    const duplicate = jobInput(); duplicate.tools.push(duplicate.tools[0]);
    expect(() => validateJob(duplicate)).toThrow();
  });
  it('拒绝脚本URL与不支持的工件偏置编号', () => {
    expect(() => validateJob({ ...jobInput(), assets: [{ objectId: 'f1', role: 'fixture', format: 'glb', url: 'javascript:alert(1)', unit: 'mm' }] })).toThrow();
    expect(() => validateJob({ ...jobInput(), workOffsetsMm: { G60: [0, 0, 3] } })).toThrow();
  });
  it('保留资产角色、缩放和姿态', () => {
    const a = validateJob({ ...jobInput(), assets: [{ objectId: 'f1', role: 'fixture', format: 'stl', url: 'https://assets.example.edu/vise.stl', unit: 'm', poseInM: { translationMm: [1, 2, 3], quaternionXYZW: [0, 0, 0, 1] } }] });
    expect(a.assets[0].poseInM.translationMm).toEqual([1, 2, 3]);
  });
});

