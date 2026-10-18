import {chromium,expect} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const url=process.argv[2]??'http://127.0.0.1:8786/';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw new Error('Only local verification URLs are supported');
const ids=['O0001','O0008','O0020','O0021','O0022','O0023','O0025','O0314','O0315'];
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true}),errors=[],rows=[];
  page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)errors.push(`HTTP ${response.status()} ${response.url()}`);});
  await mkdir('docs/screenshots',{recursive:true});
  await page.goto(url);await expect(page.getByTestId('state')).toHaveText('就绪');
  for(const id of ids){
    await page.getByLabel('原始案例').selectOption(id);await page.getByRole('button',{name:'载入案例',exact:true}).click();
    await expect(page.getByTestId('state')).toHaveText('就绪');await expect(page.getByLabel('G代码程序',{exact:true})).toHaveValue(new RegExp('^'+id));
    await page.getByLabel('碰撞处理').selectOption('true');await page.getByRole('button',{name:'应用设置',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('就绪');
    await page.getByTestId('case-information').locator('summary').click();
    const documentUrls=await page.getByTestId('case-information').getByRole('link').evaluateAll(links=>links.map(link=>link.href));
    const pdf=documentUrls.find(path=>/\.pdf(?:$|\?)/.test(path));if(!pdf)throw new Error(id+' has no PDF');
    const response=await page.request.get(pdf);if(!response.ok())throw new Error(id+' PDF unavailable: '+response.status());
    await page.getByTestId('case-information').locator('summary').click();
    for(let step=0;step<200&&['就绪','已暂停'].includes((await page.getByTestId('state').textContent()).trim());step++){
      const before=await page.getByTestId('state').getAttribute('data-instruction-index');
      await page.getByRole('button',{name:'单步',exact:true}).click();
      await expect.poll(async()=>{const state=(await page.getByTestId('state').textContent()).trim();return !['就绪','已暂停'].includes(state)||(await page.getByTestId('state').getAttribute('data-instruction-index'))!==before;}).toBe(true);
    }
    const state=(await page.getByTestId('state').textContent()).trim();if(!['已完成','碰撞暂停'].includes(state))throw new Error(id+' stopped unexpectedly: '+state);
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'导出报告',exact:true}).click();const download=await pending;const report=JSON.parse(await readFile(await download.path(),'utf8'));
    const row={id,state,verification:report.verification,source:report.collisions?.[0]?.source??null,collisionType:report.collisions?.[0]?.collisionType??null,removedVolumeMm3:report.state.stock.removedVolumeMm3,programSha256:report.inputManifest.program.sha256,documentCount:documentUrls.length,pdfStatus:response.status(),caseSource:report.caseSource};rows.push(row);console.log(JSON.stringify(row));
    if(['O0001','O0008','O0315'].includes(id)){await page.evaluate(()=>window.scrollTo(0,0));await page.mouse.move(0,0);await page.screenshot({path:`docs/screenshots/case-${id}.png`,fullPage:true});}
  }
  await page.setViewportSize({width:860,height:1000});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'docs/screenshots/case-narrow.png',fullPage:true});
  const narrowHorizontalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(narrowHorizontalOverflow||errors.length)throw new Error(JSON.stringify({narrowHorizontalOverflow,errors}));
  await writeFile('docs/case-browser-evidence.json',JSON.stringify({measuredAt:new Date().toISOString(),url,browserVersion:browser.version(),method:'Real Edge pages, bundled original programs/models/PDF, source-line steps through every case, real Worker and downloaded reports',rows,narrowHorizontalOverflow,errors},null,2)+'\n');
}finally{await browser.close();}
