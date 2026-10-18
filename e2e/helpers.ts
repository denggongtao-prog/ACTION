import {expect,type Page} from '@playwright/test';
/** Functional regressions explicitly choose their fixture through the collapsed developer UI. */
export async function loadDevelopmentScenario(page:Page,id='normal'){
  const panel=page.getByTestId('development-tests');
  if(await panel.getAttribute('open')===null)await panel.locator('summary').click();
  await page.getByLabel('实验场景').selectOption(id);await page.getByRole('button',{name:'载入场景',exact:true}).click();
  await expect(page.getByTestId('state')).toHaveText('就绪');
}
export async function openDevelopmentWorkbench(page:Page){
  await page.goto('/');await expect(page.getByTestId('state')).toHaveText('就绪');await loadDevelopmentScenario(page);
}
