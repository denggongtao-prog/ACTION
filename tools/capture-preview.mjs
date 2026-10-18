import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
await mkdir('docs/screenshots',{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  await page.goto('http://127.0.0.1:8786');
  await page.getByTestId('state').getByText('就绪',{exact:true}).waitFor();
  await page.screenshot({path:'docs/screenshots/workbench-desktop.png',fullPage:true});
  await page.setViewportSize({width:860,height:1000});
  await page.screenshot({path:'docs/screenshots/workbench-narrow.png',fullPage:true});
  console.log(JSON.stringify({title:await page.title(),horizontalOverflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),canvasCount:await page.locator('canvas').count()}));
}finally{await browser.close();}

