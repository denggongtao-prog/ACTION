import {loadNormalScenario} from './development-scenario.mjs';
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus, platform, release, arch, version as osVersion } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function optionsFrom(args) {
  const options={url:'http://127.0.0.1:8786/',sampleMs:2500,timeoutMs:90000,output:'docs/browser-benchmark.json',screenshots:'docs/screenshots',smoke:false};
  for(let i=0;i<args.length;i++) {
    const flag=args[i];
    if(flag==='--help') {
      console.log('Usage: node tools/benchmark-browser.mjs [--url URL] [--sample-ms 2500] [--timeout-ms 90000] [--output docs/browser-benchmark.json] [--screenshots-dir docs/screenshots] [--smoke]\nStart the local app separately. --smoke performs real measurement but writes no files.');
      return null;
    }
    if(flag==='--smoke'){options.smoke=true;continue;}
    if(!['--url','--sample-ms','--timeout-ms','--output','--screenshots-dir'].includes(flag)||!args[i+1])throw new Error(`Unknown or incomplete option: ${flag}`);
    const value=args[++i];
    if(flag==='--url')options.url=value;
    if(flag==='--output')options.output=value;
    if(flag==='--screenshots-dir')options.screenshots=value;
    if(flag==='--sample-ms')options.sampleMs=Number(value);
    if(flag==='--timeout-ms')options.timeoutMs=Number(value);
  }
  const target=new URL(options.url);
  if(!['127.0.0.1','localhost','[::1]'].includes(target.hostname))throw new Error('Benchmark URL must target localhost; this script does not test an external deployment.');
  if(!Number.isFinite(options.sampleMs)||options.sampleMs<2000||options.sampleMs>60000)throw new Error('--sample-ms must be between 2000 and 60000.');
  if(!Number.isFinite(options.timeoutMs)||options.timeoutMs<5000||options.timeoutMs>300000)throw new Error('--timeout-ms must be between 5000 and 300000.');
  return options;
}
function stats(values) {
  if(!values.length)return {intervalCount:0,minMs:null,medianMs:null,p95Ms:null,p99Ms:null,maxMs:null,meanMs:null,totalIntervalMs:0};
  const sorted=[...values].sort((a,b)=>a-b),total=values.reduce((sum,value)=>sum+value,0);
  const rounded=value=>Math.round(value*1000)/1000;
  const percentile=p=>sorted[Math.max(0,Math.ceil(p*sorted.length)-1)];
  return {intervalCount:values.length,minMs:rounded(sorted[0]),medianMs:rounded(percentile(.5)),p95Ms:rounded(percentile(.95)),p99Ms:rounded(percentile(.99)),maxMs:rounded(sorted.at(-1)),meanMs:rounded(total/values.length),totalIntervalMs:rounded(total)};
}
const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
function snapshotOf(report) {
  if(report?.state&&typeof report.state==='object')return report.state;
  if(report?.snapshot&&typeof report.snapshot==='object')return report.snapshot;
  return null;
}
async function downloadReport(page) {
  const [download]=await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button',{name:'导出报告',exact:true}).click(),
  ]);
  const failure=await download.failure();if(failure)throw new Error(`Report download failed: ${failure}`);
  const path=await download.path();if(!path)throw new Error('Browser did not provide a local report download.');
  return {fileName:download.suggestedFilename(),report:JSON.parse(await readFile(path,'utf8'))};
}
async function uiDetails(page) {
  return page.evaluate(()=>{
    const text=id=>document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim()??null;
    const value=label=>document.querySelector(`select[aria-label="${label}"]`)?.value??null;
    const motionRow=[...document.querySelectorAll('.program-status > div')].find(row=>row.textContent?.includes('刀路段数'));
    return {stateText:text('state'),requestedGridMm:value('材料格距'),mode:value('加工模式'),actualCellText:text('actual-cell'),removedVolumeText:text('removed-volume'),remainingPercentText:text('remaining-percent'),externalAssetCountText:text('model-count'),motionCountText:motionRow?.querySelector('b')?.textContent?.trim()??null,verificationText:text('verification'),horizontalOverflow:document.documentElement.scrollWidth>innerWidth};
  });
}

async function run(options) {
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,acceptDownloads:true});
  const page=await context.newPage();
  page.setDefaultTimeout(options.timeoutMs);
  const pageErrors=[],consoleErrors=[],failedResources=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push({message:message.text(),location:message.location()});});
  page.on('response',response=>{if(response.status()>=400)failedResources.push({url:response.url(),status:response.status(),resourceType:response.request().resourceType()});});
  try {
    const response=await page.goto(options.url,{waitUntil:'domcontentloaded',timeout:options.timeoutMs});
    if(!response?.ok())throw new Error(`App navigation failed: HTTP ${response?.status()??'unknown'}`);
    await page.waitForFunction(()=>{
      const overlay=document.querySelector('vite-error-overlay');
      if(overlay)throw new Error(`Vite compilation error: ${overlay.shadowRoot?.textContent??overlay.textContent}`);
      const state=document.querySelector('[data-testid="state"]')?.textContent?.trim();
      if(['运行故障','无法判定','不确定'].includes(state??''))throw new Error(`App failed before READY: ${document.querySelector('[role="alert"]')?.textContent??state}`);
      return state==='就绪';
    },null,{timeout:options.timeoutMs});
    await loadNormalScenario(page);
    await page.locator('canvas').first().waitFor({state:'visible'});
    await page.evaluate(()=>document.fonts.ready);
    const environment=await page.evaluate(async()=>{
      let userAgentData=null;
      try {userAgentData=await navigator.userAgentData?.getHighEntropyValues(['architecture','bitness','model','platform','platformVersion','fullVersionList'])??null;}catch{}
      let gpu=null;
      try {
        const canvas=document.querySelector('canvas');
        const gl=canvas?.getContext('webgl2')??canvas?.getContext('webgl');
        if(gl) {
          const extension=gl.getExtension('WEBGL_debug_renderer_info');
          gpu={webglVersion:gl.getParameter(gl.VERSION),vendor:gl.getParameter(gl.VENDOR),renderer:gl.getParameter(gl.RENDERER),unmaskedVendor:extension?gl.getParameter(extension.UNMASKED_VENDOR_WEBGL):null,unmaskedRenderer:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):null,debugRendererInfoAvailable:!!extension};
        }
      }catch{}
      return {userAgent:navigator.userAgent,platform:navigator.platform,hardwareConcurrency:navigator.hardwareConcurrency??null,deviceMemoryGiB:navigator.deviceMemory??null,userAgentData,gpu,visibilityState:document.visibilityState,performanceMemoryAvailable:typeof performance.memory?.usedJSHeapSize==='number'};
    });
    const source=await page.getByLabel('G代码程序',{exact:true}).inputValue();
    const initialUi=await uiDetails(page),initialDownload=await downloadReport(page);
    await page.getByLabel('回放倍率',{exact:true}).selectOption('1');
    // Only consecutive RAF callbacks observing RUNNING at the same speed form an interval.
    await page.evaluate(()=>{
      const record={startedAt:performance.now(),stoppedAt:null,frames:{},heapSamples:[],transitions:[],lastFrame:null,lastRunning:false,lastSpeed:null,active:true,raf:0};
      window.__cncBrowserBenchmark=record;
      let lastState=null;
      const sample=timestamp=>{
        if(!record.active)return;
        const state=document.querySelector('[data-testid="state"]')?.textContent?.trim()??null;
        const speed=document.querySelector('select[aria-label="回放倍率"]')?.value??null;
        const running=state==='运行中';
        if(state!==lastState){record.transitions.push({atMs:timestamp,state,speed});lastState=state;}
        if(running) {
          if(record.lastRunning&&record.lastSpeed===speed&&record.lastFrame!==null) {
            const frames=record.frames[speed]??(record.frames[speed]=[]);
            if(frames.length<120000)frames.push(timestamp-record.lastFrame);
          }
          const bytes=performance.memory?.usedJSHeapSize;
          if(typeof bytes==='number'&&Number.isFinite(bytes)&&record.heapSamples.length<120000)record.heapSamples.push({atMs:timestamp,usedJSHeapSizeBytes:bytes,speed});
        }
        record.lastFrame=timestamp;record.lastRunning=running;record.lastSpeed=speed;
        record.raf=requestAnimationFrame(sample);
      };
      record.raf=requestAnimationFrame(sample);
    });
    const runStartedAt=performance.now();
    await page.getByRole('button',{name:'开始',exact:true}).click();
    await page.getByTestId('state').filter({hasText:'运行中'}).waitFor({state:'visible',timeout:options.timeoutMs});
    await page.waitForTimeout(options.sampleMs);
    if((await page.getByTestId('state').textContent())?.trim()==='运行中')await page.getByLabel('回放倍率',{exact:true}).selectOption('20');
    await page.waitForFunction(()=>{
      const state=document.querySelector('[data-testid="state"]')?.textContent?.trim();
      if(['运行故障','碰撞停机','碰撞暂停','无法判定','不确定','已暂停'].includes(state??''))throw new Error(`Benchmark did not complete normally: ${state}; ${document.querySelector('[role="alert"]')?.textContent??''}`);
      return state==='已完成';
    },null,{timeout:options.timeoutMs});
    const observedCompletionWallMs=performance.now()-runStartedAt;
    const samples=await page.evaluate(()=>{
      const record=window.__cncBrowserBenchmark;record.active=false;record.stoppedAt=performance.now();cancelAnimationFrame(record.raf);
      return {startedAt:record.startedAt,stoppedAt:record.stoppedAt,frames:record.frames,heapSamples:record.heapSamples,transitions:record.transitions};
    });
    const finalUi=await uiDetails(page),finalDownload=await downloadReport(page);
    if(pageErrors.length)throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
    const initialSnapshot=snapshotOf(initialDownload.report),finalSnapshot=snapshotOf(finalDownload.report);
    const manifest=finalDownload.report.inputManifest??finalDownload.report.inputs??null;
    const instructionCount=finite(finalDownload.report.instructionCount??manifest?.program?.instructionCount??finalSnapshot?.instructionCount);
    const externalAssets=Array.isArray(manifest?.assets)?manifest.assets:null;
    const assetTriangleCount=externalAssets?.every(asset=>finite(asset.triangleCount)!==null)?externalAssets.reduce((sum,asset)=>sum+asset.triangleCount,0):finalUi.externalAssetCountText==='0'?0:null;
    const heapValues=samples.heapSamples.map(sample=>sample.usedJSHeapSizeBytes);
    const result={
      schemaVersion:1,measuredAt:new Date().toISOString(),url:options.url,
      measurement:'Real headless Edge UI + Worker run. RAF intervals are main-window callback intervals, not GPU frame timings. Sampled JS heap is not total process, Worker, GPU, or full-run peak memory.',
      environment:{browserChannel:'msedge',headless:true,browserVersion:browser.version(),viewport:{width:1440,height:1000},deviceScaleFactor:1,nodeVersion:process.version,host:{platform:platform(),release:release(),version:osVersion(),arch:arch(),cpuModel:cpus()[0]?.model??null,logicalCpuCount:cpus().length||null},browser:environment},
      scenario:{name:'Explicit normal development fixture; default fixture parameters',requestedSpeed1SampleMs:options.sampleMs,program:{physicalLineCount:source.split(/\r\n|\r|\n/).length,characters:source.length,sha256:createHash('sha256').update(source,'utf8').digest('hex'),instructionCount,motionCountFromUi:finalUi.motionCountText===null?null:finite(Number(finalUi.motionCountText))},externalAssets:{configuredCountFromUi:finalUi.externalAssetCountText===null?null:finite(Number(finalUi.externalAssetCountText)),triangleCount:assetTriangleCount,triangleCountSource:externalAssets?.every(asset=>finite(asset.triangleCount)!==null)?'exported report asset manifest':finalUi.externalAssetCountText==='0'?'UI declares zero external assets':'unavailable'},initialUi,finalUi,initialStock:initialSnapshot?.stock??null,finalStock:finalSnapshot?.stock??null},
      timing:{observedCompletionWallMs:Math.round(observedCompletionWallMs*1000)/1000,completionWallTimeDefinition:'Monotonic wall time from before Start click to observed COMPLETED; includes automation and UI observation overhead.',bySpeed:Object.fromEntries(Object.entries(samples.frames).map(([speed,frames])=>[speed,{...stats(frames),rawIntervalMs:frames}])),stateTransitions:samples.transitions,samplingWindowMs:samples.stoppedAt-samples.startedAt},
      memory:{metric:'main_window.performance.memory.usedJSHeapSize',unit:'bytes',availability:heapValues.length?'available':'unavailable',maxSampledJsHeapBytes:heapValues.length?Math.max(...heapValues):null,sampleCount:heapValues.length,definition:'Maximum of visible main-window JS heap samples taken during RUNNING RAF callbacks. Not total application memory; Worker/GPU memory and unobserved peaks are excluded.',samples:samples.heapSamples},
      coverage:{verification:finalDownload.report.verification??finalSnapshot?.verification??null,details:finalDownload.report.coverage??finalSnapshot?.coverage??null,source:'exported final report; null means no exposed field, never assumed fully checked'},
      reports:{initial:initialDownload,final:finalDownload},diagnostics:{pageErrors,consoleErrors,failedResources},screenshots:null,
    };
    if(!options.smoke) {
      const screenshotDirectory=resolve(projectRoot,options.screenshots);await mkdir(screenshotDirectory,{recursive:true});
      await page.evaluate(()=>window.scrollTo(0,0));await page.mouse.move(0,0);
      await page.screenshot({path:resolve(screenshotDirectory,'full-desktop.png'),fullPage:true});
      await page.setViewportSize({width:860,height:1000});
      await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:resolve(screenshotDirectory,'full-narrow.png'),fullPage:true});
      result.screenshots={desktop:`${options.screenshots}/full-desktop.png`,desktopViewport:{width:1440,height:1000},narrow:`${options.screenshots}/full-narrow.png`,narrowViewport:{width:860,height:1000},narrowHorizontalOverflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)};
      const output=resolve(projectRoot,options.output);await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
    }
    console.log(JSON.stringify({smoke:options.smoke,output:options.smoke?null:options.output,browserVersion:result.environment.browserVersion,completed:finalUi.stateText,verification:result.coverage.verification,observedCompletionWallMs:result.timing.observedCompletionWallMs,frameIntervalsBySpeed:Object.fromEntries(Object.entries(result.timing.bySpeed).map(([speed,data])=>[speed,{intervalCount:data.intervalCount,p95Ms:data.p95Ms,maxMs:data.maxMs}])),maxSampledJsHeapBytes:result.memory.maxSampledJsHeapBytes,metricEvidence:{host:result.environment.host,browser:environment,program:result.scenario.program,externalAssets:result.scenario.externalAssets,requestedGridMm:initialUi.requestedGridMm,initialStock:result.scenario.initialStock,finalStock:result.scenario.finalStock,coverage:result.coverage,memorySampleCount:result.memory.sampleCount,finalInstructionIndex:finalSnapshot?.instructionIndex??null},screenshots:result.screenshots,consoleErrors,failedResources},null,2));
  } finally {await context.close();await browser.close();}
}

try {const options=optionsFrom(process.argv.slice(2));if(options)await run(options);}
catch(error){console.error(JSON.stringify({status:'failed',message:error instanceof Error?error.message:String(error)},null,2));process.exitCode=1;}
