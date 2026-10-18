import {test,expect} from '@playwright/test';
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
