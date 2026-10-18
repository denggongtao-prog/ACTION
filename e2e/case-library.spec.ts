import {test,expect} from '@playwright/test';
test('默认真实案例为主入口，换刀独立进入，开发测试默认折叠且仍可使用',async({page})=>{
  await page.goto('/');await expect(page.getByTestId('state')).toHaveText('就绪');
  await expect(page.locator('.project-bar')).toContainText('O0001');
  await expect(page.getByLabel('原始案例').locator('option')).toHaveCount(9);
  const development=page.getByTestId('development-tests');await expect(development).not.toHaveAttribute('open');
  await expect(page.getByLabel('实验场景')).not.toBeVisible();
  await page.getByRole('button',{name:'换刀演示',exact:true}).click();
  await expect(page.locator('.project-bar')).toContainText('TOOL-EXCHANGE-DEMO');await expect(page.getByTestId('state')).toHaveText('就绪');
  await page.getByLabel('原始案例').selectOption('O0025');await page.getByRole('button',{name:'载入案例',exact:true}).click();
  await expect(page.getByLabel('G代码程序',{exact:true})).toHaveValue(/^O0025/);
  await development.locator('summary').click();await expect(page.getByLabel('实验场景').locator('option')).toHaveCount(10);
  await page.getByLabel('实验场景').selectOption('rapid');await page.getByRole('button',{name:'载入场景',exact:true}).click();
  await expect(page.getByTestId('state')).toHaveText('就绪');await page.getByRole('button',{name:'开始',exact:true}).click();
  await expect(page.getByTestId('state')).toHaveText('碰撞暂停');await expect(page.getByTestId('collision-detail')).toContainText('RAPID_STOCK');
});
test('九个原案例入口和资料可用，钻孔循环执行原程序并回传报告',async({page})=>{
  await page.goto('/');await expect(page.getByTestId('state')).toHaveText('就绪');
  await expect(page.getByLabel('原始案例').locator('option')).toHaveCount(9);
  await page.getByLabel('原始案例').selectOption('O0022');await page.getByRole('button',{name:'载入案例',exact:true}).click();
  await expect(page.getByTestId('case-information')).toContainText('φ20');await expect(page.getByTestId('state')).toHaveText('就绪');
  await expect(page.getByLabel('G代码程序',{exact:true})).toHaveValue(/^O0022/);
  await page.getByLabel('回放倍率').selectOption('20');await page.getByRole('button',{name:'开始',exact:true}).click();
  // F20 is deliberately retained. Source-line STEP finishes one original cycle block.
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  await expect(page.getByTestId('state')).toHaveText('已暂停');
  for(let i=0;i<18&&(await page.getByTestId('state').textContent())==='已暂停';i++){
    const before=await page.getByTestId('state').getAttribute('data-instruction-index');
    await page.getByRole('button',{name:'单步',exact:true}).click();
    await expect(page.getByTestId('state')).not.toHaveAttribute('data-instruction-index',before!);
  }
  await expect(page.getByTestId('state')).toHaveText('已完成');await expect(page.getByTestId('removed-volume')).not.toHaveText('0.0');
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'导出报告',exact:true}).click();const download=await pending;const stream=await download.createReadStream();let text='';for await(const chunk of stream!)text+=chunk;
  const report=JSON.parse(text);expect(report.programId).toBe('O0022');expect(report.caseSource.id).toBe('O0022');expect(report.inputManifest.cutterRadiusOffsetsMm).toEqual({});
});
test('上位网页可以下发真实案例和模型，保留碰撞的原行',async({page})=>{
  await page.goto('/host.html');await expect(page.getByTestId('host-status')).toHaveText('已连接');
  await page.getByLabel('联调案例').selectOption('O0021');await page.getByRole('button',{name:'下发案例',exact:true}).click();
  await expect(page.getByTestId('event-log')).toContainText('JOB_READY');await page.getByRole('button',{name:'开始仿真',exact:true}).click();
  await expect(page.getByTestId('host-collision')).toContainText('RAPID_STOCK');await expect(page.getByTestId('host-source-line')).toHaveText('6');
});
