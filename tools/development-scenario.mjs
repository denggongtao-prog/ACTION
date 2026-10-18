import {expect} from '@playwright/test';
/** Keep benchmarks and legacy smoke checks on the same explicit normal fixture. */
export async function loadNormalScenario(page){
  const panel=page.getByTestId('development-tests');
  if(await panel.getAttribute('open')===null)await panel.locator('summary').click();
  await page.getByLabel('实验场景').selectOption('normal');
  await page.getByRole('button',{name:'载入场景',exact:true}).click();
  await expect(page.getByTestId('state')).toHaveText('就绪');
}
