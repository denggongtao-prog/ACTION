import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8786/');await expect(page.getByTestId('state')).toHaveText('就绪');
  await page.getByLabel('原始案例').selectOption('O0008');await page.getByRole('button',{name:'载入案例',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('就绪');
  await expect(page.getByLabel('碰撞处理')).toHaveValue('false');await page.getByLabel('回放倍率').selectOption('20');await page.getByRole('button',{name:'开始',exact:true}).click();
  await expect(page.getByTestId('state')).toHaveText('已完成',{timeout:20000});await page.getByRole('button',{name:'定位第95行',exact:true}).click();
  await expect(page.getByTestId('collision-detail')).toContainText('N910');
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'导出报告',exact:true}).click();const stream=await(await pending).createReadStream();let raw='';for await(const chunk of stream)raw+=chunk;const report=JSON.parse(raw);
  await mkdir('docs/screenshots',{recursive:true});await page.screenshot({path:'docs/screenshots/collision-warning-O0008.png',fullPage:true});
  await page.setViewportSize({width:860,height:1080});await page.screenshot({path:'docs/screenshots/collision-warning-narrow.png',fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  const result={measuredAt:new Date().toISOString(),browser:browser.version(),programId:report.programId,programSha256:report.inputManifest.program.sha256,collisionResponse:report.inputManifest.simulation.stopOnCollision?'pause':'warn_continue',state:report.state.state,progress:report.state.progress,finalPhysicalLine:report.state.physicalLine,verification:report.verification,warningCount:report.collisions.length,warnings:report.collisions.map(i=>({eventId:i.eventId,line:i.source.physicalLine,block:i.source.blockNumber,type:i.collisionType,response:i.response,contact:i.contact?.point})),stock:report.state.stock,narrowHorizontalOverflow:overflow,errors};
  if(errors.length||overflow||result.state!=='COMPLETED'||result.progress!==1||result.verification!=='collision_detected'||!result.warnings.some(i=>i.line===95&&i.block===910))throw new Error(JSON.stringify(result));
  await writeFile('docs/collision-warning-evidence.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({state:result.state,progress:result.progress,warningCount:result.warningCount,finalPhysicalLine:result.finalPhysicalLine,verification:result.verification,errors,overflow}));
}finally{await browser.close();}
