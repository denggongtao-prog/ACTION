import {test,expect} from '@playwright/test';
test('第10轮审阅回归：旧查询迟到不影响新任务就绪',async({page})=>{
  await page.addInitScript(()=>{
    window.addEventListener('message',event=>{
      if((window as any).delayState&&event.data?.type==='STATE'){
        event.stopImmediatePropagation();(window as any).heldState={data:event.data,origin:event.origin,source:event.source};(window as any).delayState=false;
      }
      if(event.data?.type==='JOB_READY'&&(window as any).heldState){
        const held=(window as any).heldState;(window as any).heldState=null;window.dispatchEvent(new MessageEvent('message',held));
      }
    },true);
  });
  await page.goto('/host.html');await expect(page.getByTestId('host-status')).toHaveText('已连接');await page.getByRole('button',{name:'下发示例',exact:true}).click();await expect(page.getByRole('button',{name:'开始仿真',exact:true})).toBeEnabled();
  await page.evaluate(()=>(window as any).delayState=true);await page.getByRole('button',{name:'查询状态',exact:true}).click();await expect.poll(()=>page.evaluate(()=>!!(window as any).heldState)).toBe(true);
  await page.getByRole('button',{name:'下发示例',exact:true}).click();await expect(page.frameLocator('iframe').getByTestId('state')).toHaveText('就绪');await expect(page.getByRole('button',{name:'开始仿真',exact:true})).toBeEnabled();
});
test('第10轮：0.5.0握手报告页脚一致，连续SDK操作使用最新身份',async({page})=>{
  await page.goto('/examples/host-integration/index.html');await page.getByRole('button',{name:'连接',exact:true}).click();await expect(page.locator('#connection')).toHaveText('已连接');
  expect(await page.evaluate(()=>(window as any).exampleClient.ready.engineVersion)).toBe('0.5.0');
  await page.getByRole('button',{name:'下发任务',exact:true}).click();await expect(page.locator('#messages')).toContainText('JOB_READY');
  const result=await page.evaluate(async()=>{const c=(window as any).exampleClient;await Promise.all([c.reset(),c.setSpeed(2),c.seekLine(1)]);return {identity:c.identity,report:(await c.getReport()).payload};});
  expect(result.report.engineVersion).toBe('0.5.0');expect(result.report.runId).toBe(result.identity.runId);expect(result.report.state.speed).toBe(2);
  await expect(page.frameLocator('iframe').locator('.app-footer')).toContainText('0.5.0');await expect(page.getByRole('alert')).toBeEmpty();
});
test('第08轮：O0008完整动画后导出全部4条碰撞CSV',async({page})=>{
  await page.goto('/');await expect(page.getByTestId('state')).toHaveText('就绪');await page.getByLabel('原始案例').selectOption('O0008');await page.getByRole('button',{name:'载入案例',exact:true}).click();
  await expect(page.getByTestId('state')).toHaveText('就绪');await page.getByLabel('回放倍率').selectOption('20');await page.getByRole('button',{name:'开始',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('已完成',{timeout:20000});
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出碰撞CSV',exact:true}).click();const file=await download;expect(file.suggestedFilename()).toBe('cnc-collision-records.csv');
  let csv='';for await(const chunk of (await file.createReadStream())!)csv+=chunk;
  expect(csv).toContain(',95,910,');expect(csv.split('\r\n')).toHaveLength(6);expect(csv).toContain('warn_continue');expect(csv).toContain('positionErrorBoundMm');
});
test('第07轮：上位网页完成单步、继续、暂停、调速及回看身份切换',async({page})=>{
  await page.goto('/host.html');await expect(page.getByTestId('host-status')).toHaveText('已连接');
  const input=page.getByLabel('上位网页任务JSON'),job=JSON.parse(await input.inputValue());job.program={programId:'host-controls',text:'M3 S1000\nG4 P3\nG0 X10\nM30'};
  await page.getByText('自定义完整任务',{exact:true}).click();await input.fill(JSON.stringify(job));await page.getByRole('button',{name:'下发自定义任务',exact:true}).click();
  await expect(page.getByTestId('event-log')).toContainText('JOB_READY');const sim=page.frameLocator('iframe');
  await page.getByRole('button',{name:'单步仿真',exact:true}).click();await expect(sim.getByTestId('state')).toHaveText('已暂停');
  await page.getByRole('button',{name:'继续仿真',exact:true}).click();await expect(sim.getByTestId('state')).toHaveText('运行中');
  await page.getByRole('button',{name:'暂停仿真',exact:true}).click();await expect(sim.getByTestId('state')).toHaveText('已暂停');
  await page.getByLabel('上位机倍率').selectOption('5');await page.getByRole('button',{name:'应用倍率',exact:true}).click();
  await page.getByLabel('上位机回看行号').fill('2');await page.getByRole('button',{name:'回看源行',exact:true}).click();await expect(page.getByTestId('event-log')).toContainText('STATE');
  await page.getByRole('button',{name:'查询状态',exact:true}).click();await expect(page.getByTestId('event-log')).not.toContainText('STALE_RUN');
  await page.getByRole('button',{name:'获取报告',exact:true}).click();await expect(page.getByTestId('event-log')).toContainText('REPORT');
});
test('第06轮：工作台追加成品参考保留已有案例资源',async({page})=>{
  await page.goto('/');await expect(page.getByTestId('state')).toHaveText('就绪');
  const stl='solid extra\nfacet normal 0 0 1\nouter loop\nvertex 0 0 40\nvertex 10 0 40\nvertex 0 10 40\nendloop\nendfacet\nendsolid extra';
  await page.getByTestId('model-file').setInputFiles({name:'extra.stl',mimeType:'model/stl',buffer:Buffer.from(stl)});
  await expect(page.getByTestId('state')).toHaveText('就绪');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出报告',exact:true}).click();let raw='';for await(const chunk of (await (await download).createReadStream())!)raw+=chunk;
  expect(JSON.parse(raw).inputManifest.assets).toHaveLength(2);
});
test('第06轮：追加URL夹具保留案例目标模型',async({page})=>{
  const stl='solid extra\nfacet normal 0 0 1\nouter loop\nvertex 1000 0 0\nvertex 1010 0 0\nvertex 1000 10 0\nendloop\nendfacet\nendsolid extra';
  await page.route('**/extra-fixture.stl',route=>route.fulfill({contentType:'model/stl',body:stl}));
  await page.goto('/host.html');await expect(page.getByTestId('host-status')).toHaveText('已连接');
  await page.getByLabel('夹具模型URL').fill('http://127.0.0.1:8786/extra-fixture.stl');await page.getByRole('button',{name:'下发案例',exact:true}).click();
  await expect(page.getByTestId('event-log')).toContainText('JOB_READY');
  const job=JSON.parse(await page.getByLabel('上位网页任务JSON').inputValue());expect(job.assets.map((a:any)=>a.role)).toEqual(['target','fixture']);
});
test('第06轮：iframe刷新清除任务就绪并重连，拒绝错误协议版本',async({page})=>{
  await page.addInitScript(()=>window.addEventListener('message',event=>{if(event.data?.type==='SIM_READY')(window as any).testChannel=event.data.channelId;}));
  await page.goto('/host.html');await expect(page.getByTestId('host-status')).toHaveText('已连接');await page.getByRole('button',{name:'下发示例',exact:true}).click();
  await expect(page.getByRole('button',{name:'开始仿真',exact:true})).toBeEnabled();const channel=await page.evaluate(()=>(window as any).testChannel);
  await page.frames()[1].evaluate(channel=>parent.postMessage({protocol:'cnc-sim',version:'2.0',type:'UNTRUSTED_VERSION',messageId:'invalid-version',channelId:channel,payload:{}},location.origin),channel);
  await expect(page.getByTestId('event-log')).not.toContainText('UNTRUSTED_VERSION');
  await page.frames()[1].evaluate(()=>location.reload());await expect(page.getByRole('button',{name:'开始仿真',exact:true})).toBeDisabled();
  await expect(page.getByTestId('host-status')).toHaveText('已连接');await page.getByRole('button',{name:'下发示例',exact:true}).click();await expect(page.getByRole('button',{name:'开始仿真',exact:true})).toBeEnabled();
});
