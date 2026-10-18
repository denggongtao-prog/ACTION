import {openDevelopmentWorkbench} from './helpers';
import { test, expect } from '@playwright/test';
test('实验台通过真实Worker执行代码和单步换刀', async ({ page }) => {
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  await openDevelopmentWorkbench(page);
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByLabel('G代码程序').fill('T2 M6\nG1 X10 F600\nM30');
  await page.getByRole('button',{name:'应用程序',exact:true}).click();
  await expect(page.getByTestId('state')).toHaveText('就绪');
  await page.getByRole('button',{name:'单步',exact:true}).click();
  await expect(page.getByTestId('active-tool')).toHaveText('T2');
  await page.getByRole('button',{name:'单步',exact:true}).click();
  await expect(page.getByTestId('position-x')).toHaveText('10.000');
  await expect(page.getByTestId('verification')).toContainText('正在检查配置范围');
  expect(errors).toEqual([]);
});
test('错误G代码保留物理行且无法开始旧任务',async({page})=>{
  await openDevelopmentWorkbench(page);
  await page.getByLabel('G代码程序').fill('(header)\n\nG43 H1');
  await page.getByRole('button',{name:'应用程序',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('第3行');
  await expect(page.getByRole('button',{name:'开始',exact:true})).toBeDisabled();
});
test('外部STL二进制模型可以载入显示',async({page})=>{
  await openDevelopmentWorkbench(page);
  const stl='solid fixture\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 20 0 0\nvertex 0 20 0\nendloop\nendfacet\nendsolid fixture';
  await page.getByTestId('model-file').setInputFiles({name:'fixture.stl',mimeType:'application/octet-stream',buffer:Buffer.from(stl)});
  await expect(page.getByTestId('model-count')).toHaveText('1');
  await expect(page.getByText('fixture.stl',{exact:true})).toBeVisible();
});
test('运行暂停重置与窄屏布局',async({page})=>{
  await openDevelopmentWorkbench(page);
  await page.getByRole('button',{name:'开始',exact:true}).click();
  await expect(page.getByTestId('state')).toHaveText('运行中');
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  await expect(page.getByTestId('state')).toHaveText('已暂停');
  await page.getByRole('button',{name:'重置',exact:true}).click();
  await expect(page.getByTestId('state')).toHaveText('就绪');
  await page.setViewportSize({width:860,height:1000});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('GPU故障锁定错误并拒收Worker后续完成快照',async({page})=>{
  await openDevelopmentWorkbench(page);
  await page.getByLabel('G代码程序').fill('G1 X10 F600\nM30');
  await page.getByRole('button',{name:'应用程序',exact:true}).click();
  await expect(page.getByTestId('state')).toHaveText('就绪');
  await page.getByRole('button',{name:'开始',exact:true}).click();
  await page.locator('canvas').evaluate(canvas=>canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true})));
  await expect(page.getByRole('alert')).toContainText('图形上下文');
  const pausedX=await page.getByTestId('position-x').textContent();
  await page.waitForTimeout(1300);
  await expect(page.getByTestId('state')).toHaveText('运行故障');
  await expect(page.getByTestId('position-x')).toHaveText(pausedX!);
});
test('一帧多次换回同一刀具不漏执行记录',async({page})=>{
  await openDevelopmentWorkbench(page);
  await page.getByLabel('G代码程序').fill('T2 M6\nT1 M6\nT2 M6\nG1 X10 F600\nM30');
  await page.getByRole('button',{name:'应用程序',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('就绪');
  await page.getByLabel('回放倍率').selectOption('20');
  await page.getByRole('button',{name:'开始',exact:true}).click();
  await expect(page.locator('.activity-row').filter({hasText:'逻辑换刀'})).toHaveCount(3);
});

