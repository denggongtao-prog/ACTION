import type { Job } from '../core/types';
export function demoJob(): Job {
  return {
    program: { programId:'O1001', text: [
      '(三轴铣削演示 / 轮廓开槽与球头精加工)',
      'G21 G90 G17 G94',
      'T1 M6',
      'M3 S3000',
      'G0 X-30 Y-20 Z10',
      'G1 Z-3 F200',
      'G1 X30 F600',
      'G3 X30 Y20 I0 J20',
      'G1 X-30',
      'G3 X-30 Y-20 I0 J-20',
      'G0 Z30',
      'M5',
      'T2 M6',
      'M3 S4500',
      'G0 X0 Y-12 Z10',
      'G1 Z-6 F200',
      'G1 Y12 F400',
      'G0 Z30',
      'M5',
      'M30',
    ].join('\n') },
    stock:{objectId:'stock-001',kind:'box',sizeMm:[100,80,20],minCornerInW:[-50,-40,-20]},
    tools:[
      {toolId:'tool-001',toolNumber:1,type:'flat_endmill',diameterMm:10,cuttingLengthMm:20,gaugeLengthMm:50,shaftDiameterMm:10,holder:{diameterMm:28,lengthMm:30}},
      {toolId:'tool-002',toolNumber:2,type:'ball_endmill',diameterMm:6,cuttingLengthMm:16,gaugeLengthMm:45,shaftDiameterMm:6,holder:{diameterMm:24,lengthMm:30}},
    ],
    initialPositionMm:[0,0,40], assets:[],simulation:{stockCellMm:.5,arcChordToleranceMm:.02,mode:'cut'},
  };
}

