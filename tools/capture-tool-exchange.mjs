import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8786/');await expect(page.getByTestId('state')).toHaveText('就绪');
  await page.getByRole('button',{name:'换刀演示',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('就绪');
  await page.getByRole('button',{name:'开始',exact:true}).click();const overlay=page.getByTestId('tool-exchange-animation');await expect(overlay).toHaveAttribute('data-phase','index_magazine');
  await page.getByRole('button',{name:'暂停',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('已暂停');
  const progress=await overlay.getAttribute('data-progress');await page.waitForTimeout(250);await expect(overlay).toHaveAttribute('data-progress',progress);
  await mkdir('docs/screenshots',{recursive:true});await page.screenshot({path:'docs/screenshots/tool-exchange.png',fullPage:true});
  await page.setViewportSize({width:860,height:1000});await page.screenshot({path:'docs/screenshots/tool-exchange-narrow.png',fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  await page.getByLabel('回放倍率').selectOption('20');await page.getByRole('button',{name:'继续',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('已完成');
  const result={measuredAt:new Date().toISOString(),browser:browser.version(),phase:'index_magazine',pausedProgress:Number(progress),narrowHorizontalOverflow:overflow,finalState:await page.getByTestId('state').textContent(),errors};
  if(errors.length||overflow)throw new Error(JSON.stringify(result));await writeFile('docs/tool-exchange-evidence.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();}
