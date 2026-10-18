import {test,expect} from '@playwright/test';
async function loadCase(page:import('@playwright/test').Page){
  await page.goto('/');await expect(page.getByTestId('state')).toHaveText('就绪');
  await page.getByLabel('原始案例').selectOption('O0008');await page.getByRole('button',{name:'载入案例',exact:true}).click();
  await expect(page.locator('.project-bar')).toContainText('O0008');await expect(page.getByTestId('state')).toHaveText('就绪');
}
test('O0008默认碰撞提示并完成动画，全部提示与第95行保留在报告中',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await loadCase(page);
  await expect(page.getByLabel('碰撞处理')).toHaveValue('false');
  await page.getByLabel('回放倍率').selectOption('20');await page.getByRole('button',{name:'开始',exact:true}).click();
  await expect(page.getByTestId('state')).toHaveText('已完成',{timeout:20000});
  await expect(page.getByTestId('verification')).toContainText('存在碰撞提示');
  const first=page.getByRole('button',{name:'定位第95行',exact:true});await expect(first).toBeVisible();await first.click();
  const editor=page.getByLabel('G代码程序',{exact:true});expect(await editor.evaluate((e:HTMLTextAreaElement)=>e.value.slice(0,e.selectionStart).split(/\r\n|\n|\r/).length)).toBe(95);
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'导出报告',exact:true}).click();const stream=await (await pending).createReadStream();let text='';for await(const chunk of stream!)text+=chunk;
  const report=JSON.parse(text);expect(report.state.progress).toBe(1);expect(report.verification).toBe('collision_detected');expect(report.collisions.length).toBeGreaterThan(1);
  expect(report.collisions.some((i:any)=>i.source.physicalLine===95&&i.source.blockNumber===910)).toBe(true);
  expect(report.inputManifest.simulation.stopOnCollision).toBe(false);expect(errors).toEqual([]);
  await page.getByRole('button',{name:'重置',exact:true}).click();await expect(page.getByTestId('collision-warning-count')).toHaveCount(0);
});
test('可切回碰撞暂停，O0008仍在原第95行暂停',async({page})=>{
  await loadCase(page);await page.getByLabel('碰撞处理').selectOption('true');await page.getByRole('button',{name:'应用设置',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('就绪');
  await page.getByLabel('回放倍率').selectOption('20');await page.getByRole('button',{name:'开始',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('碰撞暂停',{timeout:15000});
  await expect(page.getByTestId('collision-detail')).toContainText('L95');await expect(page.getByRole('button',{name:'开始',exact:true})).toBeDisabled();
});
test('iframe完整回传同次更新的多条碰撞，宿主ACK与报告保留全部原行',async({page})=>{
  await page.goto('/host.html');await expect(page.getByTestId('host-status')).toHaveText('已连接');
  const input=page.getByLabel('上位网页任务JSON');const raw=JSON.parse(await input.inputValue());
  raw.initialPositionMm=[0,0,-2];raw.program={programId:'multi-warning',text:'N10 M3 S1000\nN20 G0 X1\nN30 G0 X2\nN40 G0 X3\nM30'};raw.simulation.stopOnCollision=false;
  await page.getByText('自定义完整任务',{exact:true}).click();await input.fill(JSON.stringify(raw));await page.getByRole('button',{name:'下发自定义任务',exact:true}).click();
  await expect(page.getByTestId('event-log')).toContainText('JOB_READY');const sim=page.frameLocator('iframe');await sim.getByLabel('回放倍率').selectOption('20');
  await page.getByRole('button',{name:'开始仿真',exact:true}).click();await expect(sim.getByTestId('state')).toHaveText('已完成');
  await expect(page.getByTestId('event-log').locator('article>strong').filter({hasText:/^COLLISION$/})).toHaveCount(4);
  await page.getByRole('button',{name:'获取报告',exact:true}).click();const reportBlock=page.getByTestId('event-log').locator('article').filter({has:page.locator('strong').filter({hasText:/^REPORT$/})}).locator('pre');await expect(reportBlock).toBeVisible();
  const report=JSON.parse((await reportBlock.textContent())!);expect(report.collisions.map((i:any)=>i.source.physicalLine)).toEqual([1,2,3,4]);expect(report.state.state).toBe('COMPLETED');expect(report.verification).toBe('collision_detected');
  const persisted=report.reliableRun.events.filter((e:any)=>e.envelope.type==='COLLISION');expect(persisted).toHaveLength(4);expect(persisted.every((e:any)=>e.acknowledgedAt!==undefined&&e.envelope.payload.response==='warn_continue')).toBe(true);
});
test('碰撞后材料计算失败仍向宿主回传已检测的两条碰撞',async({page})=>{
  await page.goto('/host.html');await expect(page.getByTestId('host-status')).toHaveText('已连接');
  const input=page.getByLabel('上位网页任务JSON'),raw=JSON.parse(await input.inputValue());
  raw.initialPositionMm=[0,0,-2];raw.program={programId:'warning-then-error',text:'M3 S1000\nG1 X2 Z-1 F600\nM30'};raw.simulation.stopOnCollision=false;
  raw.tools[0]={...raw.tools[0],type:'profile_endmill',cuttingLengthMm:1,radialProfile:[{radiusMm:0,zMm:0},{radiusMm:5,zMm:1}]};
  await page.getByText('自定义完整任务',{exact:true}).click();await input.fill(JSON.stringify(raw));await page.getByRole('button',{name:'下发自定义任务',exact:true}).click();await expect(page.getByTestId('event-log')).toContainText('JOB_READY');
  await page.getByRole('button',{name:'开始仿真',exact:true}).click();const sim=page.frameLocator('iframe');await expect(sim.getByTestId('state')).toHaveText('运行故障');
  await expect(page.getByTestId('event-log').locator('article>strong').filter({hasText:/^COLLISION$/})).toHaveCount(2);
  await page.getByRole('button',{name:'获取报告',exact:true}).click();const reportBlock=page.getByTestId('event-log').locator('article').filter({has:page.locator('strong').filter({hasText:/^REPORT$/})}).locator('pre');await expect(reportBlock).toBeVisible();
  const report=JSON.parse((await reportBlock.textContent())!);expect(report.collisions.map((i:any)=>i.source.physicalLine)).toEqual([1,2]);expect(report.verification).toBe('indeterminate');expect(report.state.state).toBe('ERROR');
});
