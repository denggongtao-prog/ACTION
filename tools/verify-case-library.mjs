import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const server=await createServer({configFile:resolve('vite.config.ts'),server:{middlewareMode:true},appType:'custom'});
try{
  const {caseOptions,caseJob,caseDefinition}=await server.ssrLoadModule('/src/lib/caseLibrary.ts');
  const {validateJob}=await server.ssrLoadModule('/src/core/job.ts');
  const {Playback}=await server.ssrLoadModule('/src/core/playback.ts');
  const {loadAssetGroup,prepareAssetMeshes,disposeObject}=await server.ssrLoadModule('/src/lib/assets.ts');
  const rows=[];
  for(const {id} of caseOptions){
    const definition=caseDefinition(id),raw=caseJob(id),start=performance.now();let group;
    raw.simulation.stopOnCollision=true; // Preserve the historical pause-mode evidence matrix.
    try{
      if(definition.targetPath){const bytes=await readFile(resolve('src/lib',definition.targetPath));raw.assets[0].buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);delete raw.assets[0].url;}
      const job=validateJob(raw);group=await loadAssetGroup(job.assets,new AbortController().signal);job.preparedMeshes=prepareAssetMeshes(group,job.assets);
      const engine=new Playback();engine.load(job);engine.start();engine.advance(1e9);const snapshot=engine.snapshot();
      const row={id,state:snapshot.state,verification:snapshot.verification,physicalLine:snapshot.physicalLine,programSha256:job.program.sha256,instructionCount:engine.instructions.length,motionCount:engine.instructions.filter(i=>i.kind==='motion').length,grid:snapshot.stock.grid,removedVolumeMm3:snapshot.stock.removedVolumeMm3,incident:snapshot.incident??null,assumptions:definition.assumptions,elapsedWallMs:Math.round(performance.now()-start)};
      rows.push(row);console.log(JSON.stringify(row));
    }catch(error){const row={id,error:error.message,code:error.code,physicalLine:error.physicalLine,elapsedWallMs:Math.round(performance.now()-start)};rows.push(row);console.log(JSON.stringify(row));process.exitCode=1;}
    finally{if(group)disposeObject(group);}
  }
  await writeFile('docs/case-library-evidence.json',JSON.stringify({measuredAt:new Date().toISOString(),runtime:process.version,scope:'All nine original programs and original STL references. Teaching assumptions are explicit; collision is an execution result, not a failed compatibility test.',rows},null,2)+'\n');
}finally{await server.close();}
