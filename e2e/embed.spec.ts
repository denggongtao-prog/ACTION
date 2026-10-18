import { test, expect } from '@playwright/test';
test('上位网页真实iframe握手下发回放和报告',async({page})=>{
  await page.goto('/host.html');
  await expect(page.getByTestId('host-status')).toHaveText('已连接');
  await page.getByRole('button',{name:'下发示例',exact:true}).click();
  await expect(page.getByTestId('event-log')).toContainText('JOB_READY');
  await page.getByRole('button',{name:'开始仿真',exact:true}).click();
  await expect(page.getByTestId('event-log')).toContainText('PROGRESS');
  await page.getByRole('button',{name:'暂停仿真',exact:true}).click();
  await page.getByRole('button',{name:'获取报告',exact:true}).click();
  await expect(page.getByTestId('event-log')).toContainText('REPORT');
  await expect(page.getByTestId('event-log')).toContainText('in_progress');
});
test('失败的URL模型不能回传JOB_READY',async({page})=>{
  await page.goto('/host.html');
  await expect(page.getByTestId('host-status')).toHaveText('已连接');
  await page.getByLabel('夹具模型URL').fill('http://127.0.0.1:8786/missing-fixture.glb');
  await page.getByRole('button',{name:'下发示例',exact:true}).click();
  await expect(page.getByTestId('event-log')).toContainText('COMMAND_ERROR');
  await expect(page.getByTestId('event-log')).not.toContainText('JOB_READY');
});

