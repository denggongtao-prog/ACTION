import {createServer} from 'vite';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom'});
try{
  const {DexelStock}=await server.ssrLoadModule('/src/core/stock.ts');
  const {Playback}=await server.ssrLoadModule('/src/core/playback.ts');
  const {validateJob}=await server.ssrLoadModule('/src/core/job.ts');
  const {scenarioJob}=await server.ssrLoadModule('/src/lib/scenarios.ts');
  const {loadAssetGroup,prepareAssetMeshes,disposeObject}=await server.ssrLoadModule('/src/lib/assets.ts');
  const tool=scenarioJob('normal').tools[0];
  const radius=2,length=10,depth=2,analyticVolume=(2*radius*length+Math.PI*radius**2)*depth;
  const convergence=[.5,.25,.1].map(cell=>{
    const stock=new DexelStock({objectId:'analytic',kind:'box',minCornerInW:[-10,-10,-10],sizeMm:[20,20,10]},cell);
    stock.carveLine({x:-5,y:0,z:-depth},{x:5,y:0,z:-depth},{...tool,diameterMm:radius*2,cuttingLengthMm:20});
    const volume=stock.stats().removedVolumeMm3,error=Math.abs(volume-analyticVolume);
    // Independent area bound: a boundary strip of width half the cell diagonal.
    const delta=Math.SQRT2*cell/2,perimeter=2*length+2*Math.PI*radius;
    const bound=(perimeter*delta+Math.PI*delta**2)*depth;
    assert.ok(error<=bound);return {cellMm:cell,analyticVolumeMm3:analyticVolume,volumeMm3:volume,absoluteErrorMm3:error,relativeError:error/analyticVolume,independentBoundaryBoundMm3:bound};
  });
  assert.ok(convergence.at(-1).absoluteErrorMm3<convergence[0].absoluteErrorMm3,'fine-grid slot error must improve over coarse sample');
  assert.ok(convergence.at(-1).relativeError<.01,'0.1 mm sample slot volume must be within 1%');
  const thinFixture=[];
  for(const speed of [.25,1,20,'source_step']){
    const job=validateJob(scenarioJob('fixture'));
    const group=await loadAssetGroup(job.assets,new AbortController().signal);
    try{
      job.preparedMeshes=prepareAssetMeshes(group,job.assets);
      const engine=new Playback();engine.load(job);
      if(speed==='source_step')for(let i=0;i<20&&!engine.snapshot().incident;i++)engine.step();
      else{
        engine.setSpeed(speed);engine.start();
        for(let i=0;i<10000&&['RUNNING','TOOL_CHANGING'].includes(engine.snapshot().state);i++)engine.advance(40);
      }
      const snapshot=engine.snapshot(),incident=snapshot.incident;
      assert.equal(snapshot.state,'PAUSED_COLLISION');assert.equal(incident?.collisionType,'CUTTER_FIXTURE');
      assert.equal(incident.source.physicalLine,4);assert.equal(incident.source.blockNumber,350);
      assert.ok(incident.contact.positionErrorBoundMm<=.05);
      thinFixture.push({speed,state:snapshot.state,source:incident.source,contact:incident.contact,lastSafeVerified:incident.lastSafeVerified});
    }finally{disposeObject(group);}
  }
  const result={measuredAt:new Date().toISOString(),runtime:process.version,scope:'Independent analytic slot volume and real thin-fixture asset, at three playback speeds and source-line step. Not a CAMotics comparison.',convergence,thinFixture};
  await writeFile('docs/acceptance-evidence.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({convergence,thinFixture:thinFixture.map(({speed,state,contact})=>({speed,state,contact:contact.point,errorMm:contact.positionErrorBoundMm}))},null,2));
}finally{await server.close();}
