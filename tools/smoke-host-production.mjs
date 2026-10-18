import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium,expect} from '@playwright/test';
const root=resolve('dist');
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.stl':'model/stl','.png':'image/png','.jpg':'image/jpeg'};
const server=createServer(async(req,res)=>{
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' blob:; worker-src 'self'; img-src 'self' data: blob:");
  try{
    const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/cnc/'))throw new Error('outside mount');
    const file=resolve(root,decodeURIComponent(url.pathname.slice(5))||'index.html');if(!file.startsWith(root+sep))throw new Error('outside root');
    res.setHeader('Content-Type',mime[extname(file)]??'application/octet-stream');res.end(await readFile(file));
  }catch{res.statusCode=404;res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,errors=[];let browser;
try{
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  const response=await page.goto(origin+'/cnc/examples/host-integration/index.html');assert.equal(response.status(),200,'生产包缺少接入示例');
  await page.getByRole('button',{name:'连接',exact:true}).click();await expect(page.locator('#connection')).toHaveText('已连接');
  await page.getByRole('button',{name:'下发任务',exact:true}).click();await expect(page.locator('#messages')).toContainText('JOB_READY');
  await page.getByRole('button',{name:'应用倍率',exact:true}).click();await page.getByRole('button',{name:'开始',exact:true}).click();await expect(page.frameLocator('iframe').getByTestId('state')).toHaveText('已完成');
  const getReport=()=>page.evaluate(async()=> (await window.exampleClient.getReport()).payload);
  await expect.poll(async()=> (await getReport()).reliableRun.events.every(e=>e.acknowledgedAt!==undefined)).toBe(true);
  const report=await getReport();assert.equal(report.verification,'fully_checked');assert.equal(report.state.progress,1);assert.ok(report.state.stock.removedVolumeMm3>0);assert.deepEqual(errors,[]);
  assert.equal(report.reliableRun.events.filter(e=>e.envelope.type==='TOOL_CHANGE').length,2);
  const evidence={mount:'/cnc/',engineVersion:report.engineVersion,state:report.state.state,verification:report.verification,removedVolumeMm3:report.state.stock.removedVolumeMm3,events:report.reliableRun.events.map(e=>({type:e.envelope.type,acknowledged:e.acknowledgedAt!==undefined})),pageErrors:errors};
  await writeFile('docs/host-production-evidence.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
