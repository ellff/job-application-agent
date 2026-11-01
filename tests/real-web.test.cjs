const { test } = require('node:test');
const assert = require('node:assert/strict');
const { snapshot } = require('../src/real-web.cjs');
const { execute } = require('../src/agent.cjs');

test('首轮不请求模型，其他字段填完后第二轮确认政治面貌选项',async()=>{
  const {chromium}=require('playwright');
  const {supplement,fieldHandler}=require('../src/real-web.cjs');
  const {rulePlan}=require('../src/agent.cjs');
  const {createFirstPassResolver,createOptionResolver}=require('../src/option-mapping.cjs');
  const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL});
  try {
    const page=await browser.newPage();
    await page.setContent('<label>政治面貌<select id="politics"><option value="">请选择</option><option value="party">中共党员（含预备党员）</option><option value="other">群众</option></select></label><label>邮箱<input id="email"></label>');
    const initial=await snapshot(page);
    const mapping={fields:{political_status:{aliases:['政治面貌']},email:{aliases:['邮箱']}}};
    const profile={political_status:'中共党员',email:'test@example.com'};
    const deferred=[];let calls=0;
    const resolver=createOptionResolver({planner:async()=>{
      calls++;assert.equal(await page.locator('#email').inputValue(),profile.email);
      return [{fieldId:'choice',profileKey:'option_0'}];
    },confirm:async suggestion=>{assert.equal(suggestion.option,'中共党员（含预备党员）');return true;}});
    const first=await execute(page,initial.fields,rulePlan(initial.fields,mapping),profile,mapping,{guard:initial.guard,customHandler:fieldHandler(page,{guard:initial.guard,planner:null,resolveOption:createFirstPassResolver(deferred,true)})});
    assert.equal(calls,0);assert.equal(deferred.length,1);
    assert.equal(first[0].status,'skipped');assert.equal(await page.locator('#politics').inputValue(),'');
    const second=await supplement(page,initial.fields,profile,mapping,{deferred,resolveOption:resolver,approve:async()=>true});
    assert.equal(calls,1);assert.equal(second.results[0].status,'verified');
    assert.equal(second.results[0].matchSource,'model-confirmed');
    assert.equal(await page.locator('#politics').inputValue(),'party');
    await initial.dispose();
  }finally{await browser.close();}
});

test('补填只处理新增空字段：旧字段不覆盖，重复标签拒绝，第三轮字段只提示',async()=>{
  const {chromium}=require('playwright');
  const {supplement}=require('../src/real-web.cjs');
  const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL});
  try {
    const page=await browser.newPage();
    await page.setContent('<label>姓名<input value="已有姓名"></label>');
    const initial=await snapshot(page);
    await page.evaluate(()=>{
      document.body.insertAdjacentHTML('beforeend','<label>证件号码<input id="new-id"></label><label>已有人填<input value="保留"></label><label>重复<input></label><label>重复<input></label>');
      document.querySelector('#new-id').oninput=()=>{
        if(!document.querySelector('#later'))document.body.insertAdjacentHTML('beforeend','<label>邮箱<input id="later"></label>');
      };
    });
    let confirmations=0;
    const mapping={fields:{id_number:{aliases:['证件号码']},email:{aliases:['邮箱']},name:{aliases:['姓名']}}};
    const report=await supplement(page,initial.fields,{id_number:'DEMO-ID',email:'test@example.com',name:'不要覆盖'},mapping,{approve:async(fields)=>{
      confirmations++;assert.deepEqual(fields.map(f=>f.label),['证件号码']);return true;
    }});
    assert.equal(confirmations,1);
    assert.equal(report.results[0].status,'verified');
    assert.equal(await page.locator('#new-id').inputValue(),'DEMO-ID');
    assert.equal(await page.locator('input').first().inputValue(),'已有姓名');
    assert.equal(await page.locator('#later').inputValue(),'');
    assert.ok(report.remaining.some(f=>f.label==='邮箱'));
    assert.ok(report.remaining.some(f=>f.label==='重复'));
    await initial.dispose();
  }finally{await browser.close();}
});

test('模型选项：规则优先、确认后缓存、选项变化重新确认、失败及拒绝不填',async()=>{
  const {createOptionResolver}=require('../src/option-mapping.cjs');
  let calls=0,confirms=0;
  const planner=async()=>{calls++;return [{fieldId:'choice',profileKey:'option_0',reason:'测试建议'}];};
  const resolver=createOptionResolver({planner,confirm:async()=>{confirms++;return true;}});
  const field={label:'健康状况',section:'个人信息'};
  assert.equal((await resolver(field,'健康',['健康'],'health_status')).source,'rules');
  assert.equal(calls,0);
  assert.equal((await resolver(field,'良好',['健康','一般'],'health_status')).source,'model-confirmed');
  assert.equal((await resolver(field,'良好',['健康','一般'],'health_status')).source,'confirmed-cache');
  assert.equal(calls,1);assert.equal(confirms,1);
  await resolver(field,'良好',['健康','一般','其他'],'health_status');
  assert.equal(confirms,2);
  const denied=createOptionResolver({planner});
  assert.equal((await denied(field,'良好',['健康'],'health_status')).unavailable,true);
  const broken=createOptionResolver({planner:async()=>{throw Error('硅基流动 HTTP 503：服务繁忙，请稍后重试');}});
  const failure=await broken(field,'良好',['健康'],'health_status');
  assert.equal(failure.unavailable,true);
  assert.match(failure.reason,/HTTP 503/);
  const missingKey=createOptionResolver({planner:async()=>{throw Error('请先在当前窗口设置 SILICONFLOW_API_KEY');}});
  assert.match((await missingKey(field,'良好',['健康'],'health_status')).reason,/SILICONFLOW_API_KEY/);
  const raw=createOptionResolver({planner:async()=>{throw Error('sensitive-response-body');}});
  assert.doesNotMatch((await raw(field,'良好',['健康'],'health_status')).reason,/sensitive-response-body/);
  assert.equal(await resolver({label:'姓名'},'某人',['其他人'],'name'),null);
});

test('原生下拉模型确认期间选项变化：拒绝执行旧建议并继续后续字段',async()=>{
  const {chromium}=require('playwright');
  const {fieldHandler}=require('../src/real-web.cjs');
  const {createOptionResolver}=require('../src/option-mapping.cjs');
  const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL});
  try {
    const page=await browser.newPage();
    await page.setContent('<label>健康状况<select><option value="">请选择</option><option>健康</option></select></label><label>邮箱<input></label>');
    const state=await snapshot(page);
    const resolver=createOptionResolver({planner:async()=>[{fieldId:'choice',profileKey:'option_0',reason:'测试'}],confirm:async()=>{
      await page.locator('select').evaluate(el=>el.options[1].text='其他');return true;
    }});
    const results=await execute(page,state.fields,state.fields.map((f,i)=>({fieldId:f.fieldId,profileKey:i?'email':'health_status',reason:'测试'})),
      {health_status:'良好',email:'test@example.com'},{fields:{health_status:{},email:{}}},
      {guard:state.guard,customHandler:fieldHandler(page,{guard:state.guard,resolveOption:resolver})});
    assert.equal(results[0].status,'skipped');assert.equal(results[1].status,'verified');
    assert.equal(await page.locator('select').inputValue(),'');
    await state.dispose();
  }finally{await browser.close();}
});

test('证件类型选择后重建输入框并新增证件号：读回成功，继续邮箱',async()=>{
  const {chromium}=require('playwright');
  const {fieldHandler}=require('../src/real-web.cjs');
  const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL});
  try {
    const page=await browser.newPage();
    await page.setContent(`<div class="el-form-item"><label>证件类型</label><div class="el-select" onclick="document.querySelector('ul').hidden=false"><input readonly></div></div><ul hidden><li class="el-select-dropdown__item">身份证</li></ul><label>邮箱<input id="email"></label>`);
    await page.locator('li').evaluate(el=>el.onclick=()=>{
      const old=document.querySelector('.el-select input');
      const fresh=old.cloneNode(true);fresh.removeAttribute('data-agent-field');fresh.value='身份证';old.replaceWith(fresh);
      el.parentElement.hidden=true;
      const label=document.createElement('label');label.textContent='证件号码';label.append(document.createElement('input'));document.body.append(label);
    });
    const state=await snapshot(page);
    const results=await execute(page,state.fields,state.fields.map((f,i)=>({fieldId:f.fieldId,profileKey:i?'email':'id_type',reason:'测试'})),
      {id_type:'身份证',email:'test@example.com'},{fields:{id_type:{},email:{}}},
      {guard:state.guard,customHandler:fieldHandler(page,{guard:state.guard,planner:null})});
    assert.deepEqual(results.map(r=>r.status),['verified','verified']);
    assert.equal(await page.locator('label').filter({hasText:'证件号码'}).locator('input').inputValue(),'');
    await state.dispose();
  } finally {await browser.close();}
});

test('无模型规则模式：学历别名匹配，未知或歧义选项留空', async () => {
  const {chooseOption}=require('../src/option-mapping.cjs');
  const {rulePlan}=require('../src/agent.cjs');
  const original=global.fetch;
  global.fetch=()=>{throw Error('规则模式禁止模型网络请求');};
  try {
    assert.equal((await chooseOption({label:'学历'},'博士研究生',['博士','硕士'],'degree',null)).index,0);
    assert.equal(await chooseOption({label:'学历'},'博士',['硕士'],'degree',null),null);
    assert.equal(await chooseOption({label:'学历'},'大学专科',['专科','大专'],'degree',null),null);
    assert.equal(await chooseOption({label:'学位'},'博士学位',['博士'],'degree',null),null);
    const fields=[{fieldId:'a',label:'姓名 *'},{fieldId:'b',label:'未知含义'}];
    assert.deepEqual(rulePlan(fields,{fields:{name:{aliases:['姓名']}}}).map(p=>p.profileKey),['name',null]);
  } finally {global.fetch=original;}
});
test('学历语义选项：博士映射博士研究生并读回，模型无匹配时不选硕士', async () => {
  const { chromium } = require('playwright');
  const { fieldHandler } = require('../src/real-web.cjs');
  const browser = await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL});
  try {
    const page = await browser.newPage();
    const html = '<div class="el-form-item"><label>全日制最高学历</label><div class="el-select" onclick="document.querySelector(\'ul\').hidden=false"><input readonly></div></div><ul hidden><li class="el-select-dropdown__item" onclick="document.querySelector(\'input\').value=this.textContent">博士研究生</li><li class="el-select-dropdown__item">硕士研究生</li></ul>';
    await page.setContent(html);
    const state = await snapshot(page);
    const handler = fieldHandler(page,{guard:state.guard,planner:async (fields,mapping) => {
      assert.ok(fields[0].label.includes('博士'));
      assert.equal(mapping.fields.option_0.aliases[0],'博士研究生');
      return [{fieldId:'choice',profileKey:'option_0',reason:'等价'}];
    }});
    const result = await handler(state.fields[0],'博士','full_time_degree');
    assert.equal(result.status,'verified');
    assert.equal(await page.locator('input').inputValue(),'博士研究生');
    await state.dispose();
    await page.setContent(html.replace(/<li class="el-select-dropdown__item" onclick="[^\"]*">博士研究生<\/li>/,''));
    const next = await snapshot(page);
    const rejected = await fieldHandler(page,{planner:async ()=>[{fieldId:'choice',profileKey:null,reason:'没有等价选项'}]})(next.fields[0],'博士','full_time_degree');
    assert.equal(rejected.status,'skipped');
    assert.equal(await page.locator('input').inputValue(),'');
    await next.dispose();
  }finally{await browser.close();}
});
test('只读下拉也被发现，并能按显示文字选择；数字字段可填写', async () => {
  const { chromium } = require('playwright');
  const { fieldHandler } = require('../src/real-web.cjs');
  const browser = await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL});
  try {
    const page = await browser.newPage();
    await page.setContent('<div class="el-form-item"><label>健康状况</label><div class="el-select" onclick="document.querySelector(\'ul\').hidden=false"><input readonly></div></div><ul hidden><li class="el-select-dropdown__item" onclick="document.querySelector(\'input\').value=this.textContent">健康</li></ul><label>年龄<input type="number"></label>');
    const state = await snapshot(page);
    assert.equal(state.fields.length,2);
    const plan = state.fields.map((f,i)=>({fieldId:f.fieldId,profileKey:i?'age':'health_status',reason:'测试'}));
    const results = await execute(page,state.fields,plan,{health_status:'健康',age:'28'},{fields:{health_status:{},age:{}}},{guard:state.guard,customHandler:fieldHandler(page)});
    assert.ok(results.every(r=>r.status==='verified'));
    assert.equal(await page.locator('input').nth(0).inputValue(),'健康');
    assert.equal(await page.locator('input').nth(1).inputValue(),'28');
    await state.dispose();
  }finally{await browser.close();}
});
test('网络页面操作：编辑后识别、输入事件、保留既有值、隐藏及自定义控件跳过、结构变化停止', async () => {
  const { createServer } = require('node:http');
  const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<button id="edit" onclick="document.querySelector('fieldset').disabled=false">编辑</button>
    <fieldset disabled><div class="ant-form-item"><label>毕业院校</label><input id="school" oninput="window.inputSeen=true"></div>
    <label>邮箱<input id="email" value="existing@example.com"></label>
    <label>专业<input id="major" role="combobox"></label></fieldset><input type="hidden"><input type="password"><input style="display:none"><button onclick="window.saved=true">保存</button>`); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL });
  try {
    const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
    let state = await snapshot(page); assert.equal(state.fields.length, 0); await state.dispose();
    await page.locator('#edit').click(); state = await snapshot(page);
    assert.equal(state.fields.length, 3); assert.equal(state.fields[0].label, '毕业院校');
    const keys = ['school','email','major'];
    const plan = state.fields.map((f,i) => ({fieldId:f.fieldId,profileKey:keys[i],reason:'测试'}));
    const results = await execute(page,state.fields,plan,{school:'北京大学',email:'new@example.com',major:'计算机'}, {fields:{school:{},email:{},major:{}}},{guard:state.guard});
    assert.equal(results[0].status,'verified'); assert.equal(await page.locator('#email').inputValue(),'existing@example.com');
    assert.equal(await page.locator('#major').inputValue(),''); assert.equal(await page.evaluate(()=>window.inputSeen),true);
    assert.equal(await page.evaluate(()=>window.saved),undefined);
    await page.locator('#school').evaluate(el=>el.outerHTML='<input id="school">');
    await assert.rejects(state.guard(),/结构或编辑状态/); await state.dispose();
  } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
});

test('地区弹窗未识别时跳过，单项重渲染不阻断后续邮箱填写', async () => {
  const { chromium } = require('playwright');
  const { fieldHandler } = require('../src/real-web.cjs');
  const browser = await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL});
  try {
    const page = await browser.newPage();
    await page.setContent(`<label>籍贯<input onclick="window.regionOpened=true"></label><label>年龄<input></label><label>邮箱<input type="email"></label>`);
    const state = await snapshot(page);
    await page.locator('input').nth(1).evaluate(el => el.replaceWith(el.cloneNode(true)));
    const mapping = {fields:{native_place:{aliases:['籍贯']},age:{aliases:['年龄']},email:{aliases:['邮箱']}}};
    const keys = ['native_place','age','email'];
    const plan = state.fields.map((f,i)=>({fieldId:f.fieldId,profileKey:keys[i],reason:'测试'}));
    const results = await execute(page,state.fields,plan,{native_place:'北京市海淀区',age:'28',email:'demo@example.com'},mapping,{guard:state.guard,customHandler:fieldHandler(page,{guard:state.guard})});
    assert.deepEqual(results.map(r=>r.status),['skipped','verified','verified']);
    assert.equal(await page.evaluate(()=>!!window.regionOpened),true);
    assert.equal(await page.locator('input[type=email]').inputValue(),'demo@example.com');
    await state.dispose();
  } finally {await browser.close();}
});


test('联动新增字段与删除旧字段：保持原计划，重新定位后续邮箱', async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL});
  try {
    const page = await browser.newPage();
    await page.setContent(`<label>是否北京户口<select onchange="document.querySelector('section').innerHTML='<label>户口类型<input></label><label>邮箱<input type=email></label>'"><option value=""></option><option>是</option><option>否</option></select></label><section><label>年龄<input></label><label>邮箱<input type="email"></label></section>`);
    const state = await snapshot(page);
    const keys=['is_beijing_household','age','email'];
    const mapping={fields:Object.fromEntries(keys.map(k=>[k,{}]))};
    const plan=state.fields.map((f,i)=>({fieldId:f.fieldId,profileKey:keys[i],reason:'测试'}));
    const results=await execute(page,state.fields,plan,{is_beijing_household:'是',age:'28',email:'demo@example.com'},mapping,{guard:state.guard});
    assert.deepEqual(results.map(r=>r.status),['verified','skipped','verified']);
    assert.equal(await page.locator('input[type=email]').inputValue(),'demo@example.com');
    assert.equal(await page.locator('input').first().inputValue(),'');
    await state.dispose();
  } finally {await browser.close();}
});

test('切换页面后重新观察生成新计划，旧计划拒绝执行', async()=>{
  const {chromium}=require('playwright');
  const {rulePlan}=require('../src/agent.cjs');
  const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL});
  try {
    const page=await browser.newPage();
    await page.goto('data:text/html;charset=utf-8,'+encodeURIComponent('<label>姓名<input></label>'));
    const first=await snapshot(page);
    try {
      await page.goto('data:text/html;charset=utf-8,'+encodeURIComponent('<label>邮箱<input></label>'));
      await assert.rejects(()=>first.guard(first.fields[0].fieldId),/跳转|变化|改变/);
      const second=await snapshot(page);
      try {
        const mapping={fields:{name:{aliases:['姓名']},email:{aliases:['邮箱']}}};
        const plan=rulePlan(second.fields,mapping);
        assert.equal(plan[0].profileKey,'email');
        const results=await execute(page,second.fields,plan,{email:'demo@example.com'},mapping,{guard:second.guard});
        assert.equal(results[0].status,'verified');
        assert.equal(await page.locator('input').inputValue(),'demo@example.com');
      } finally {await second.dispose();}
    } finally {await first.dispose();}
  } finally {await browser.close();}
});
