import {readFileSync} from 'node:fs';
const {version:engineVersion}=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
import {test,expect,type Page} from '@playwright/test';

async function connect(page:Page){
  await page.goto('/examples/host-integration/index.html');
  await page.getByRole('button',{name:'连接',exact:true}).click();
  await expect(page.locator('#connection')).toHaveText('已连接');
}
const report=(page:Page)=>page.evaluate(async()=> (await (window as any).exampleClient.getReport()).payload);

test('手册双刀任务完整执行、保存并确认事件，重置和回看采纳新runId',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await connect(page);
  expect(await page.evaluate(()=>(window as any).exampleClient.ready.engineVersion)).toBe(engineVersion);
  await page.getByRole('button',{name:'下发任务',exact:true}).click();
  await expect(page.locator('#messages')).toContainText('JOB_READY');
  await page.getByRole('button',{name:'应用倍率',exact:true}).click();
  await page.getByRole('button',{name:'开始',exact:true}).click();
  const sim=page.frameLocator('iframe');await expect(sim.getByTestId('state')).toHaveText('已完成',{timeout:20000});
  await expect.poll(async()=>{const r=await report(page);return r.reliableRun.events.every((e:any)=>e.acknowledgedAt!==undefined);}).toBe(true);
  const r=await report(page);expect(r.state.progress).toBe(1);expect(r.verification).toBe('fully_checked');
  expect(r.state.stock.removedVolumeMm3).toBeGreaterThan(0);
  expect(r.reliableRun.events.filter((e:any)=>e.envelope.type==='TOOL_CHANGE').map((e:any)=>e.envelope.payload.toolNumber)).toEqual([1,2]);
  const persisted=await page.evaluate(()=>JSON.parse(localStorage.getItem('cnc-host-manual-events:'+location.origin)!));
  expect(persisted.map((e:any)=>e.type)).toEqual(['TOOL_CHANGE','TOOL_CHANGE','COMPLETED']);
  const previous=await page.evaluate(()=>(window as any).exampleClient.identity);
  await page.getByRole('button',{name:'重置',exact:true}).click();await expect(sim.getByTestId('state')).toHaveText('就绪');
  const reset=await page.evaluate(()=>(window as any).exampleClient.identity);expect(reset.runId).not.toBe(previous.runId);expect(reset.revision).toBe(previous.revision);
  await page.evaluate(async()=>{await (window as any).exampleClient.seekLine(6);await (window as any).exampleClient.setSpeed(3);});
  const seek=await page.evaluate(()=>(window as any).exampleClient.identity);expect(seek.runId).not.toBe(reset.runId);
  expect((await report(page)).state.speed).toBe(3);await expect(page.getByRole('alert')).toBeEmpty();expect(errors).toEqual([]);
});

test('手册示例下发STL原始ArrayBuffer，提示模式回传全部源行和接触误差',async({page})=>{
  await connect(page);
  const input=page.getByLabel('示例任务JSON'),job=JSON.parse(await input.inputValue());
  job.initialPositionMm=[0,0,-2];job.program={programId:'manual-warning',text:'N10 M3 S1000\nN20 G0 X1\nN30 G0 X2\nN40 G0 X3\nM30'};
  await input.fill(JSON.stringify(job));
  const stl='solid target\nfacet normal 0 0 1\nouter loop\nvertex 0 0 10\nvertex 10 0 10\nvertex 0 10 10\nendloop\nendfacet\nendsolid target';
  await page.locator('#model').setInputFiles({name:'reference.stl',mimeType:'model/stl',buffer:Buffer.from(stl)});
  await page.getByRole('button',{name:'下发任务',exact:true}).click();await expect(page.locator('#messages')).toContainText('JOB_READY');
  await page.getByRole('button',{name:'应用倍率',exact:true}).click();await page.getByRole('button',{name:'开始',exact:true}).click();
  await expect(page.frameLocator('iframe').getByTestId('state')).toHaveText('已完成');
  await expect.poll(async()=> (await report(page)).reliableRun.events.filter((e:any)=>e.envelope.type==='COLLISION'&&e.acknowledgedAt!==undefined).length).toBe(4);
  const r=await report(page);expect(r.verification).toBe('collision_detected');
  expect(r.collisions.map((e:any)=>e.source.physicalLine)).toEqual([1,2,3,4]);expect(r.collisions.map((e:any)=>e.source.blockNumber)).toEqual([10,20,30,40]);
  expect(r.collisions.every((e:any)=>e.response==='warn_continue'&&e.contact.point.length===3&&e.contact.positionErrorBoundMm!==undefined)).toBe(true);
  expect(r.inputManifest.assets).toEqual([expect.objectContaining({objectId:'uploaded-model',role:'target',triangleCount:1,closed:false})]);
  await expect(page.getByRole('alert')).toBeEmpty();
});

test('宿主保存失败不确认事件，存储恢复后通过真实重传完成确认',async({page})=>{
  await connect(page);
  await page.evaluate(()=>{
    const c=(window as any).exampleClient,save=c.persistEvent;
    (window as any).allowEventSave=false;
    c.persistEvent=async(message:any)=>{
      if(!(window as any).allowEventSave)throw new Error('模拟宿主存储失败');
      return save(message);
    };
  });
  const input=page.getByLabel('示例任务JSON'),job=JSON.parse(await input.inputValue());job.program={programId:'persistence-retry',text:'M30'};
  await input.fill(JSON.stringify(job));await page.getByRole('button',{name:'下发任务',exact:true}).click();
  await expect(page.locator('#messages')).toContainText('JOB_READY');await page.getByRole('button',{name:'开始',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('模拟宿主存储失败');
  const pending=await report(page);expect(pending.reliableRun.events).toHaveLength(1);expect(pending.reliableRun.events[0].acknowledgedAt).toBeUndefined();
  await page.evaluate(()=>(window as any).allowEventSave=true);
  await expect.poll(async()=> (await report(page)).reliableRun.events[0].acknowledgedAt,{timeout:5000}).toBeDefined();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('cnc-host-manual-events:'+location.origin)!));
  expect(saved).toHaveLength(1);expect(saved[0].payload.eventId).toBe(pending.reliableRun.events[0].envelope.payload.eventId);
});

test('RESET应答未关联请求时，状态和报告查询恢复当前身份，显式历史查询仍报失效',async({page})=>{
  await connect(page);await page.getByRole('button',{name:'下发任务',exact:true}).click();await expect(page.locator('#messages')).toContainText('JOB_READY');
  const old=await page.evaluate(()=>(window as any).exampleClient.identity);
  // Deliberately bypass the pending-request map: simulate RESET executed but caller never adopted its reply.
  async function untrackedReset(){return page.evaluate(async()=>{
    const c=(window as any).exampleClient,m=c._envelope('RESET');
    return await new Promise<any>(resolve=>{
      const listener=(event:MessageEvent)=>{if(event.source===c.frame.contentWindow&&event.data?.replyTo===m.messageId){window.removeEventListener('message',listener);resolve(event.data);}};
      window.addEventListener('message',listener);c._post(m);
    });
  });}
  const first=await untrackedReset();expect(first.runId).not.toBe(old.runId);
  const state=await page.evaluate(async()=> (await (window as any).exampleClient.getState()));expect(state.runId).toBe(first.runId);
  const second=await untrackedReset();const current=await report(page);expect(current.runId).toBe(second.runId);
  const explicit=await page.evaluate(async(identity)=>{try{await (window as any).exampleClient.getReport(identity);return null;}catch(error){return {code:(error as any).code,identity:(error as any).identity};}},old);
  expect(explicit).toEqual({code:'STALE_RUN',identity:{jobId:second.jobId,revision:second.revision,runId:second.runId}});
});
