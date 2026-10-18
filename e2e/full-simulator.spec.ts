import {loadDevelopmentScenario} from './helpers';
import { test,expect } from '@playwright/test';
test('碰撞停机显示源行和接触坐标，报告找回同一事件',async({page})=>{
  await page.goto('/');await expect(page.getByTestId('state')).toHaveText('就绪');
  await loadDevelopmentScenario(page,'rapid');
  await expect(page.getByTestId('state')).toHaveText('就绪');
  await page.getByLabel('回放倍率').selectOption('20');await page.getByRole('button',{name:'开始',exact:true}).click();
  await expect(page.getByTestId('state')).toHaveText('碰撞暂停');
  await expect(page.getByTestId('collision-detail')).toContainText('RAPID_STOCK');
  await expect(page.getByTestId('collision-detail')).toContainText('机床坐标');
  await expect(page.getByRole('button',{name:'开始',exact:true})).toBeDisabled();
  const shown=await page.getByTestId('collision-event-id').textContent();
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'导出报告',exact:true}).click();
  const download=await downloaded;const stream=await download.createReadStream();let text='';for await(const data of stream!)text+=data.toString();
  const report=JSON.parse(text);expect(report.collisions[0].eventId).toBe(shown);
  expect(report.collisions[0].source.programSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(report.verification).toBe('collision_detected');
  await page.getByRole('button',{name:'重置',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('就绪');
  await expect(page.getByTestId('collision-detail')).toHaveCount(0);
});
test('上位网页接收碰撞自动定位原行并确认关键事件',async({page})=>{
  await page.goto('/host.html');await expect(page.getByTestId('host-status')).toHaveText('已连接');
  await page.getByLabel('联调场景').selectOption('fixture');await page.getByRole('button',{name:'下发示例',exact:true}).click();
  await expect(page.getByTestId('event-log')).toContainText('JOB_READY');
  await page.getByRole('button',{name:'开始仿真',exact:true}).click();
  await expect(page.getByTestId('host-collision')).toContainText('CUTTER_FIXTURE');
  await expect(page.getByTestId('host-source-line')).not.toHaveText('—');
  await expect(page.getByTestId('event-log')).toContainText('COLLISION');
  await page.getByRole('button',{name:'获取报告',exact:true}).click();
  await expect(page.getByTestId('event-log')).toContainText('acknowledgedAt');
});
test('闭合模型毛坯和补偿示例可以在真实网页执行',async({page})=>{
  await page.goto('/');await expect(page.getByTestId('state')).toHaveText('就绪');
  for(const id of ['meshstock','offsets']){
    await loadDevelopmentScenario(page,id);
    await expect(page.getByTestId('state')).toHaveText('就绪');await page.getByLabel('回放倍率').selectOption('20');
    await page.getByRole('button',{name:'开始',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('已完成');
    await expect(page.getByTestId('verification')).toContainText('已完成配置范围检查');
  }
});
