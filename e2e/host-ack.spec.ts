import {test,expect} from '@playwright/test';
test('联调宿主不对EVENT_ACK的COMMAND_ACK再次确认',async({page})=>{
  await page.addInitScript(()=>{(window as any).ackReplies=0;window.addEventListener('message',e=>{if(e.data?.type==='COMMAND_ACK'&&e.data.payload?.eventId)(window as any).ackReplies++;});});
  await page.goto('/host.html');await expect(page.getByTestId('host-status')).toHaveText('已连接');
  await page.getByRole('button',{name:'下发示例',exact:true}).click();await expect(page.getByTestId('event-log')).toContainText('JOB_READY');
  const sim=page.frameLocator('iframe');for(let i=0;i<3;i++)await sim.getByRole('button',{name:'单步',exact:true}).click();
  await expect(page.getByTestId('event-log')).toContainText('TOOL_CHANGE');await page.waitForTimeout(250);
  expect(await page.evaluate(()=>(window as any).ackReplies)).toBe(1);
});
