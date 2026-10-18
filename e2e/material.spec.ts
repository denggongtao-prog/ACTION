import {openDevelopmentWorkbench} from './helpers';
import { test,expect } from '@playwright/test';
const code='M3 S3000\nG0 X-10 Y0 Z2\nG1 Z-4 F600\nG1 X10 F600\nM30';
async function prepare(page:import('@playwright/test').Page){
  await openDevelopmentWorkbench(page);
  await page.getByLabel('G代码程序').fill(code);
  await page.getByRole('button',{name:'应用程序',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('就绪');
}
test('真实切削增加体积统计，重置恢复原始毛坯',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await prepare(page);await expect(page.getByTestId('removed-volume')).toHaveText('0.0');
  await page.getByLabel('回放倍率').selectOption('20');
  await page.getByRole('button',{name:'开始',exact:true}).click();
  await expect(page.getByTestId('state')).toHaveText('已完成');
  expect(Number(await page.getByTestId('removed-volume').textContent())).toBeGreaterThan(500);
  await expect(page.getByTestId('verification')).toContainText('已完成配置范围检查');
  await page.getByRole('button',{name:'重置',exact:true}).click();
  await expect(page.getByTestId('removed-volume')).toHaveText('0.0');
  await expect(page.getByTestId('remaining-percent')).toHaveText('100.0');
  expect(errors).toEqual([]);
});
test('空运行不会删除材料，精度可应用',async({page})=>{
  await prepare(page);
  await page.getByLabel('加工模式').selectOption('dry_run');await page.getByLabel('材料格距').selectOption('1');
  await page.getByRole('button',{name:'应用设置',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('就绪');
  await expect(page.getByTestId('actual-cell')).toContainText('1.00');
  await page.getByLabel('回放倍率').selectOption('20');await page.getByRole('button',{name:'开始',exact:true}).click();
  await expect(page.getByTestId('state')).toHaveText('已完成');await expect(page.getByTestId('removed-volume')).toHaveText('0.0');
});
test('暂停期间材料统计保持不变',async({page})=>{
  await prepare(page);await page.getByRole('button',{name:'开始',exact:true}).click();
  await expect.poll(async()=>Number(await page.getByTestId('removed-volume').textContent())).toBeGreaterThan(0);
  await page.getByRole('button',{name:'暂停',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('已暂停');
  const removed=await page.getByTestId('removed-volume').textContent();
  await page.waitForTimeout(350);await expect(page.getByTestId('removed-volume')).toHaveText(removed!);
});
test('上位网页报告返回材料统计和实际能力',async({page})=>{
  await page.goto('/host.html');await expect(page.getByTestId('host-status')).toHaveText('已连接');
  await page.getByRole('button',{name:'下发示例',exact:true}).click();await expect(page.getByTestId('event-log')).toContainText('JOB_READY');
  const sim=page.frameLocator('iframe');await sim.getByLabel('回放倍率').selectOption('20');
  await page.getByRole('button',{name:'开始仿真',exact:true}).click();
  await expect(sim.getByTestId('state')).toHaveText('已完成',{timeout:15000});
  await page.getByRole('button',{name:'获取报告',exact:true}).click();
  await expect(page.getByTestId('event-log')).toContainText('REPORT');
  await expect(page.getByTestId('event-log')).toContainText('removedVolumeMm3');
  await expect(page.getByTestId('event-log')).toContainText('"materialRemoval": true');
});

