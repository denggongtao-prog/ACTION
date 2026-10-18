import {loadNormalScenario} from './development-scenario.mjs';
import {chromium,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)errors.push(`HTTP ${response.status()} ${response.url()}`);});
  await page.goto('http://127.0.0.1:8787/');await expect(page.getByTestId('state')).toHaveText('就绪');
  await loadNormalScenario(page);
  await page.getByLabel('回放倍率').selectOption('20');await page.getByRole('button',{name:'开始',exact:true}).click();
  await expect(page.getByTestId('state')).toHaveText('已完成');
  await expect(page.getByTestId('verification')).toContainText('已完成配置范围检查');
  await page.goto('http://127.0.0.1:8787/host.html');await expect(page.getByTestId('host-status')).toHaveText('已连接');
  await page.getByLabel('联调场景').selectOption('fixture');await page.getByRole('button',{name:'下发示例',exact:true}).click();
  await expect(page.getByTestId('event-log')).toContainText('JOB_READY');
  await page.getByRole('button',{name:'开始仿真',exact:true}).click();
  await expect(page.getByTestId('host-collision')).toContainText('CUTTER_FIXTURE');
  await expect(page.getByTestId('host-source-line')).not.toHaveText('—');
  await page.getByRole('button',{name:'获取报告',exact:true}).click();await expect(page.getByTestId('event-log')).toContainText('acknowledgedAt');
  await page.screenshot({path:'docs/screenshots/full-host-collision.png',fullPage:true});
  const result={measuredAt:new Date().toISOString(),browserVersion:browser.version(),url:'http://127.0.0.1:8787/',artifact:'dist production build via Vite preview',checks:['normal two-tool machining completed with coverage','bundled module Worker loaded','iframe handshake and model transfer','fixture collision source line and position returned','report retained acknowledged event'],errors};
  if(errors.length)throw new Error(JSON.stringify(result));
  await writeFile('docs/production-smoke.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
