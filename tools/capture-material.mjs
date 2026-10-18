import {loadNormalScenario} from './development-scenario.mjs';
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
await mkdir('docs/screenshots',{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8786/');
  await page.getByTestId('state').getByText('就绪',{exact:true}).waitFor();
  await loadNormalScenario(page);
  await page.getByLabel('回放倍率').selectOption('20');
  await page.getByRole('button',{name:'开始',exact:true}).click();
  await page.getByTestId('state').getByText('已完成',{exact:true}).waitFor({timeout:20000});
  await page.screenshot({path:'docs/screenshots/material-desktop.png',fullPage:true});
  await page.setViewportSize({width:860,height:1000});
  await page.screenshot({path:'docs/screenshots/material-narrow.png',fullPage:true});
  console.log(JSON.stringify({removedVolume:await page.getByTestId('removed-volume').textContent(),horizontalOverflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),errors}));
}finally{await browser.close();}

