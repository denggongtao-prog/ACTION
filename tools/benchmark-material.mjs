import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';
const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom'});
try{
  const { Playback }=await server.ssrLoadModule('/src/core/playback.ts');
  const { validateJob }=await server.ssrLoadModule('/src/core/job.ts');
  const { demoJob }=await server.ssrLoadModule('/src/lib/demo.ts');
  const rows=[];
  for(const cell of [.5,.25]){
    const input=demoJob();input.simulation.stockCellMm=cell;
    const engine=new Playback(),start=performance.now();engine.load(validateJob(input));const initialized=performance.now();
    const initial=engine.takeStockUpdate();const meshed=performance.now();
    let transmittedBytes=0,ticks=0,maxTickMs=0;
    const count=update=>{if(update)for(const tile of update.tiles)transmittedBytes+=tile.positions.byteLength+tile.normals.byteLength+tile.colors.byteLength;};
    count(initial);engine.setSpeed(20);engine.start();const runStart=performance.now();
    while(engine.snapshot().state!=='COMPLETED'){
      const tick=performance.now();engine.advance(40);count(engine.takeStockUpdate());maxTickMs=Math.max(maxTickMs,performance.now()-tick);
      if(++ticks>2000)throw new Error('benchmark did not complete');
    }
    rows.push({requestedCellMm:cell,grid:engine.snapshot().stock.grid,initializeMs:+(initialized-start).toFixed(1),initialMeshMs:+(meshed-initialized).toFixed(1),computeAndMeshMs:+(performance.now()-runStart).toFixed(1),maxTickMs:+maxTickMs.toFixed(1),ticks,transmittedMB:+(transmittedBytes/1048576).toFixed(2),removedVolumeMm3:+engine.snapshot().stock.removedVolumeMm3.toFixed(3)});
  }
  const result={runtime:process.version,platform:process.platform,measurement:'Node.js deterministic CPU/mesh benchmark; not browser FPS or peak memory',rows};
  await writeFile('docs/material-benchmark.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}finally{await server.close();}

