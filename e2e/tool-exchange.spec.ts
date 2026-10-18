import {test,expect} from '@playwright/test';
test('真实Worker换刀动画可见，暂停冻结并在夹紧后回传新刀',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await expect(page.getByTestId('state')).toHaveText('就绪');
  await page.getByRole('button',{name:'换刀演示',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('就绪');
  await page.getByRole('button',{name:'开始',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('换刀中');
  const animation=page.getByTestId('tool-exchange-animation');await expect(animation).toBeVisible();await expect(animation).toContainText('T1 → T2');
  await expect(page.getByTestId('magazine-dimensions')).toContainText('8 工位');
  await expect(page.getByTestId('magazine-dimensions')).toContainText('Ø158.7 mm');
  await expect(animation).toContainText('刀柄 Ø28 × 30 mm');await expect(animation).toContainText('总长 80');
  await expect(page.getByTestId('active-tool')).toHaveText('T1');await page.getByRole('button',{name:'暂停',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('已暂停');
  const progress=await animation.getAttribute('data-progress');await page.waitForTimeout(250);await expect(animation).toHaveAttribute('data-progress',progress!);
  await page.getByLabel('回放倍率').selectOption('20');await page.getByRole('button',{name:'继续',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('已完成');
  await expect(animation).toHaveCount(0);await expect(page.getByTestId('active-tool')).toHaveText('T1');expect(errors).toEqual([]);
});
