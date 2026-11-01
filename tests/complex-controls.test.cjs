const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fillRegion,fillCalendar,fullDate,regionParts}=require('../src/complex-controls.cjs');

test('出生日期入口：跨年跨月选择完整日期，跳过邻月同号并验证斜杠日期',async()=>{
  const {chromium}=require('playwright');
  const {snapshot,fieldHandler}=require('../src/real-web.cjs');
  const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL});
  try {
    const page=await browser.newPage();
    await page.setContent(`<label>出生日期<input readonly onclick="document.querySelector('.s-date-picker').hidden=false"></label>
      <div class="s-date-picker" hidden><strong></strong><button class="el-picker-panel__icon-btn el-date-picker__prev-btn el-icon-d-arrow-left">上一年</button><button class="el-picker-panel__icon-btn el-date-picker__prev-btn el-icon-arrow-left">上月</button>
      <table><tr><td class="prev-month">2</td><td class="available">2</td><td class="next-month">2</td></tr></table></div>`);
    await page.evaluate(()=>{
      let year=2026,month=10;const panel=document.querySelector('.s-date-picker');
      const render=()=>panel.querySelector('strong').textContent=year+' 年 '+month+' 月';render();
      panel.querySelector('.el-icon-d-arrow-left').onclick=()=>{year--;render();};
      panel.querySelector('.el-icon-arrow-left').onclick=()=>{month--;if(!month){month=12;year--;}render();};
      panel.querySelector('.available').onclick=()=>{document.querySelector('input').value=year+'/'+month+'/2';panel.hidden=true;};
    });
    const state=await snapshot(page);
    const handler=fieldHandler(page,{guard:state.guard,planner:null});
    assert.equal((await handler(state.fields[0],'2001-03','birth_date')).status,'missing');
    assert.equal(await page.locator('.s-date-picker').isVisible(),false);
    assert.equal((await handler(state.fields[0],'2001-03-02','birth_date')).status,'verified');
    assert.equal(await page.locator('input').inputValue(),'2001/3/2');
    await state.dispose();
  }finally{await browser.close();}
});

test('政治面貌无专用映射：合并选项留给模型，不按包含关系选择',async()=>{
  const {chooseOption}=require('../src/option-mapping.cjs');
  const field={label:'政治面貌'};
  for(const value of ['中共党员','中国共产党党员','中共预备党员','中国共产党预备党员']) {
    assert.equal(await chooseOption(field,value,['群众','中共党员（含预备党员）'],'political_status',null),null);
  }
  assert.equal(await chooseOption(field,'中共党员（含预备党员）',['中共党员'],'political_status',null),null);
  assert.equal(await chooseOption(field,'群众',['中共党员（含预备党员）'],'political_status',null),null);
  assert.equal(await chooseOption(field,'中共党员',['中共党员（含预备党员）','中共党员(含预备党员)'],'political_status',null),null);
});

test('真实网页入口：动态地区弹窗完成后继续填写邮箱，不检查整页旧元素',async()=>{
  const {chromium}=require('playwright');
  const {snapshot,fieldHandler}=require('../src/real-web.cjs');
  const {execute}=require('../src/agent.cjs');
  const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL});
  try {
    const page=await browser.newPage();
    await page.setContent(`<label>籍贯<input id="region" readonly onclick="document.querySelector('#dialog').hidden=false"></label>
      <label>邮箱<input id="email"></label><div id="dialog" hidden><h2>请选择行政区</h2>
      <input placeholder="搜索城市名/区县"><button class="close" onclick="document.querySelector('#dialog').hidden=true">关闭</button><div id="choices"></div></div>`);
    await page.evaluate(()=>{
      const choices=document.querySelector('#choices');
      const show=(text,action)=>{const b=document.createElement('button');b.textContent=text;b.onclick=action;choices.replaceChildren(b);};
      show('河南',()=>setTimeout(()=>show('洛阳',()=>setTimeout(()=>show('涧西区',()=>{
        document.querySelector('#region').value='河南-洛阳-涧西区';document.querySelector('#dialog').hidden=true;
      }),100)),100));
    });
    const state=await snapshot(page);
    const guard=async id=>{assert.ok(id,'地区步骤必须只检查当前字段');await state.guard(id);};
    const plan=state.fields.map(f=>({fieldId:f.fieldId,profileKey:f.label==='籍贯'?'native_place':'email',reason:'测试指定映射'}));
    const result=await execute(page,state.fields,plan,{native_place:'河南省洛阳市涧西区',email:'test@example.com'},
      {fields:{native_place:{},email:{}}},{guard,customHandler:fieldHandler(page,{guard})});
    assert.deepEqual(result.map(r=>r.status),['verified','verified']);
    assert.equal(await page.locator('#region').inputValue(),'河南-洛阳-涧西区');
    await state.dispose();
  } finally {await browser.close();}
});
test('日期与地区解析：只补明确授权的1日，不接受不存在的日期',()=>{
  assert.deepEqual(regionParts('广东省深圳市福田区'),['广东省','深圳市','福田区']);
  assert.deepEqual(regionParts('北京市海淀区'),['北京市','海淀区']);
  assert.equal(fullDate('2026-06').text,'2026-06-01');
  assert.equal(fullDate('2026-06').provisional,true);
  assert.equal(fullDate('2026-02-30'),null);
});
test('地区级联逐层点击并读回；不存在区县不误选；日历切换年月与1日待确认',async()=>{
  const {chromium}=require('playwright');
  const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL});
  try{
    const page=await browser.newPage();
    await page.setContent(`<input id="region" readonly onclick="document.querySelector('#dialog').hidden=false">
    <div id="dialog" hidden><header><h2>请选择行政区</h2><input placeholder="搜索城市名/区县"><button class="close" onclick="document.querySelector('#dialog').hidden=true">关闭</button></header>
    <div id="options"><button onclick="document.querySelector('#options').innerHTML=\'<button onclick=&quot;document.querySelector(\\\'#options\\\').innerHTML=\\\'<button onclick=&quot;document.querySelector(\\\\\\\'#region\\\\\\\').value=\\\\\\\'广东-深圳-福田区\\\\\\\';document.querySelector(\\\\\\\'#dialog\\\\\\\').hidden=true&quot;>福田区</button>\\\'&quot;>深圳</button>\'">广东</button></div></div>`);
    // 动态级联事件由测试页实现，确保工具不能直接赋值代替点击。
    await page.evaluate(()=>{
      const options=document.querySelector('#options');
      const add=(name,next)=>{options.replaceChildren();const b=document.createElement('button');b.textContent=name;b.onclick=next;options.append(b);};
      add('广东',()=>add('深圳',()=>add('福田区',()=>{document.querySelector('#region').value='广东-深圳-福田区';document.querySelector('#dialog').hidden=true;})));
    });
    const result=await fillRegion(page,page.locator('#region'),'广东省深圳市福田区');
    assert.equal(result.status,'verified');
    assert.equal(await page.locator('#region').inputValue(),'广东-深圳-福田区');
    await page.locator('#region').evaluate(el=>el.value='');
    await page.evaluate(()=>{
      const options=document.querySelector('#options');options.replaceChildren();
      const b=document.createElement('button');b.textContent='广东';
      b.onclick=()=>{b.textContent='深圳';b.onclick=()=>{b.textContent='福田区';b.onclick=()=>{window.wrongClick=true;};};};options.append(b);
    });
    const missing=await fillRegion(page,page.locator('#region'),'广东省深圳市不存在区');
    assert.equal(missing.status,'skipped');
    assert.equal(await page.locator('#region').inputValue(),'');
    assert.equal(await page.evaluate(()=>window.wrongClick),undefined);
    await page.setContent(`<input id="date" readonly onclick="document.querySelector('[data-calendar-panel]').hidden=false"><div data-calendar-panel hidden><strong id="heading"></strong>
    <button data-calendar-nav="prev-year">上一年</button><button data-calendar-nav="next-year">下一年</button><button data-calendar-nav="prev-month">上月</button><button data-calendar-nav="next-month">下月</button><table><tbody><tr><td id="day">1</td></tr></tbody></table></div>`);
    await page.evaluate(()=>{
      let year=2026,month=9;const update=()=>document.querySelector('#heading').textContent=year+'年 '+month+'月';update();
      for(const button of document.querySelectorAll('[data-calendar-nav]'))button.onclick=()=>{const action=button.dataset.calendarNav;if(action.endsWith('year'))year+=action.startsWith('next')?1:-1;else{month+=action.startsWith('next')?1:-1;if(month===0){month=12;year--;}if(month===13){month=1;year++;}}update();};
      document.querySelector('#day').onclick=()=>{document.querySelector('#date').value=year+'-'+String(month).padStart(2,'0')+'-01';document.querySelector('[data-calendar-panel]').hidden=true;};
    });
    const dateResult=await fillCalendar(page,page.locator('#date'),'2025-06');
    assert.equal(dateResult.status,'pending_confirmation');
    assert.equal(await page.locator('#date').inputValue(),'2025-06-01');
  }finally{await browser.close();}
});

test('入学月份：已适配的只读月份面板跨年选择，不补造1日',async()=>{
  const {chromium}=require('playwright');const {fillMonth}=require('../src/complex-controls.cjs');
  const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL});
  try{
    const page=await browser.newPage();
    await page.setContent('<input id="month" readonly onclick="document.querySelector(\'.s-month-picker\').hidden=false"><div class="s-month-picker" hidden><strong></strong><button data-calendar-nav="prev-year">上一年</button><table data-month-table><tr><td>9月</td></tr></table></div>');
    await page.evaluate(()=>{
      let year=2026;const panel=document.querySelector('.s-month-picker');const render=()=>panel.querySelector('strong').textContent=year+'年';render();
      panel.querySelector('button').onclick=()=>{year--;render();};
      panel.querySelector('td').onclick=()=>{document.querySelector('#month').value=year+'-09';panel.hidden=true;};
    });
    assert.equal((await fillMonth(page,page.locator('#month'),'2023-09')).status,'verified');
    assert.equal(await page.locator('#month').inputValue(),'2023-09');
  }finally{await browser.close();}
});
