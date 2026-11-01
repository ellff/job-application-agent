const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const {FillWindow}=require('../src/window-controller.cjs');
async function cleanup(root){
  const resolved=path.resolve(root);
  assert.equal(path.dirname(resolved).toLowerCase(),path.resolve(os.tmpdir()).toLowerCase());
  assert.match(path.basename(resolved),/^fill-(window|ui)-/);
  await fs.rm(resolved,{recursive:true,force:true});
}

test('窗口单轮：规则跳过语义选项，模型自动补填，新增字段须手动再识别，旧计划不可复用',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'fill-window-'));
  const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL});
  const context=await browser.newContext();
  const page=await context.newPage();
  const mapping={fields:{name:{aliases:['姓名']},email:{aliases:['邮箱']},political_status:{aliases:['政治面貌']}}};
  const profileFile=path.join(root,'profile.json');
  await fs.writeFile(profileFile,JSON.stringify({name:'演示',email:'demo@example.com',political_status:'中共党员'}));
  let calls=0;
  const app=new FillWindow({context,root,mapping,planner:async()=>{calls++;return [{fieldId:'choice',profileKey:'option_0',reason:'合并身份'}];}});
  try{
    await page.setContent('<meta charset="utf-8"><label>姓名<input id="name"></label><label>政治面貌<select id="politics"><option value="">请选择</option><option value="party">中共党员（含预备党员）</option></select></label>');
    await page.locator('#name').evaluate(el=>el.addEventListener('input',()=>{if(!document.querySelector('#email'))document.body.insertAdjacentHTML('beforeend','<label>邮箱<input id="email"></label>');}));
    const pageId=app.pages()[0].id;
    await app.scan({pageId,mode:'rules',profileFile});assert.equal(app.status().canFill,true);
    await app.fill();
    assert.equal(calls,0);assert.equal(await page.locator('#name').inputValue(),'演示');
    assert.equal(await page.locator('#email').inputValue(),'');assert.equal(await page.locator('#politics').inputValue(),'');
    await assert.rejects(()=>app.fill(),/没有有效计划/);
    await app.scan({pageId,mode:'assist',profileFile});
    const filling=app.fill();
    await assert.rejects(()=>app.scan({pageId,mode:'rules',profileFile}),/尚未结束/);
    await filling;assert.equal(calls,1);
    const directories=await fs.readdir(path.join(root,'artifacts/window'));
    const reports=await Promise.all(directories.map(d=>fs.readFile(path.join(root,'artifacts/window',d,'report.json'),'utf8').then(JSON.parse)));
    assert.ok(reports.some(r=>r.results.some(item=>item.matchSource==='model-automatic')));
    assert.equal(await page.locator('#politics').inputValue(),'party');
    assert.equal(await page.locator('#email').inputValue(),'demo@example.com');
    assert.equal(await page.locator('#name').inputValue(),'演示');
    await page.locator('#email').fill('');await app.scan({pageId,mode:'rules',profileFile});
    await page.goto('data:text/html;charset=utf-8,'+encodeURIComponent('<label>邮箱<input></label>'));
    assert.equal(app.status().canFill,false);await assert.rejects(()=>app.fill(),/没有有效计划/);
    await app.scan({pageId,mode:'rules',profileFile});
    await page.locator('label').evaluate(el=>el.firstChild.textContent='联系人邮箱');
    await app.fill();assert.equal(await page.locator('input').inputValue(),'');
    assert.ok(app.logs.some(s=>s.includes('字段、标签或候选已变化')));
  }finally{await app.close();await browser.close();await cleanup(root);}
});

test('窗口端到端：按钮启用、切换模式失效、单轮填写与本地请求访问校验',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'fill-ui-'));
  const fixture=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<label>姓名<input id="name"></label>');});
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
  const instance=await require('../src/window.cjs').main({headless:true,sessionDirectory:path.join(root,'session')});
  const profileFile=path.join(root,'profile.json');
  await fs.writeFile(profileFile,JSON.stringify({name:'演示人员'}));
  try{
    const ui=instance.control.contexts()[0].pages()[0];
    assert.equal(await ui.locator('#fill').isDisabled(),true);
    await fs.mkdir(path.join(__dirname,'../artifacts'),{recursive:true});
    await ui.screenshot({path:path.join(__dirname,'../artifacts/window-preview.png'),fullPage:true});
    await ui.locator('#settings summary').click();
    await ui.locator('#profile').fill(profileFile);
    await ui.locator('#url').fill(`http://127.0.0.1:${fixture.address().port}`);
    await ui.locator('#open').click();
    await ui.waitForFunction(()=>!document.querySelector('#scan').disabled);
    await ui.locator('#scan').click();await ui.waitForFunction(()=>!document.querySelector('#fill').disabled);
    await ui.locator('[value="assist"]').check();await ui.waitForFunction(()=>document.querySelector('#fill').disabled);
    await ui.locator('#scan').click();await ui.waitForFunction(()=>!document.querySelector('#fill').disabled);
    await ui.locator('#fill').click();
    await ui.waitForFunction(()=>document.querySelector('#log').value.includes('本轮结束'));
    assert.equal(await instance.app.context.pages()[0].locator('#name').inputValue(),'演示人员');
    assert.equal(await ui.locator('#fill').isDisabled(),true);
    assert.equal((await fetch(instance.origin+'/status')).status,403);
    assert.equal((await fetch(instance.origin+'/fill',{method:'POST',headers:{Origin:'https://example.com'},body:'{}'})).status,403);
  }finally{await instance.shutdown();await new Promise(r=>fixture.close(r));await cleanup(root);}
});

test('窗口入口保留地区级联和只读生日历，填写后继续邮箱，缺日出生日期不补造',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'fill-window-'));
  const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL});
  const context=await browser.newContext();const page=await context.newPage();
  const mapping={fields:{current_city:{aliases:['现居住城市']},birth_date:{aliases:['出生日期']},email:{aliases:['邮箱']}}};
  const profileFile=path.join(root,'profile.json');
  const profile={current_city:'河南省洛阳市涧西区',birth_date:'2001-03-02',email:'demo@example.com'};
  await fs.writeFile(profileFile,JSON.stringify(profile));
  const app=new FillWindow({context,root,mapping});
  try{
    await page.setContent(`<label>现居住城市<input id="region" readonly onclick="document.querySelector('#dialog').hidden=false"></label>
      <label>出生日期<input id="date" readonly onclick="document.querySelector('.s-date-picker').hidden=false"></label>
      <label>邮箱<input id="email"></label>
      <div id="dialog" hidden><h2>请选择行政区</h2><input placeholder="搜索城市名/区县"><button class="close" onclick="document.querySelector('#dialog').hidden=true">关闭</button><div id="choices"></div></div>
      <div class="s-date-picker" hidden><strong></strong><button class="el-icon-d-arrow-left">上一年</button><button class="el-icon-arrow-left">上月</button><table><tr><td class="prev-month">2</td><td class="available">2</td><td class="next-month">2</td></tr></table></div>`);
    await page.evaluate(()=>{
      const choices=document.querySelector('#choices');
      const show=(text,action)=>{const b=document.createElement('button');b.textContent=text;b.onclick=action;choices.replaceChildren(b);};
      show('河南',()=>show('洛阳',()=>show('涧西区',()=>{document.querySelector('#region').value='河南-洛阳-涧西区';document.querySelector('#dialog').hidden=true;})));
      let year=2026,month=10;const panel=document.querySelector('.s-date-picker');
      const render=()=>panel.querySelector('strong').textContent=year+' 年 '+month+' 月';render();
      panel.querySelector('.el-icon-d-arrow-left').onclick=()=>{year--;render();};
      panel.querySelector('.el-icon-arrow-left').onclick=()=>{month--;if(!month){month=12;year--;}render();};
      panel.querySelector('.available').onclick=()=>{document.querySelector('#date').value=year+'/'+month+'/2';panel.hidden=true;};
    });
    const pageId=app.pages()[0].id;
    await app.scan({pageId,mode:'rules',profileFile});await app.fill();
    assert.equal(await page.locator('#region').inputValue(),'河南-洛阳-涧西区');
    assert.equal(await page.locator('#date').inputValue(),'2001/3/2');
    assert.equal(await page.locator('#email').inputValue(),profile.email);
    assert.ok(app.logs.some(s=>s.includes('成功 3 项')));
    await page.locator('#date').evaluate(el=>el.value='');profile.birth_date='2001-03';
    await fs.writeFile(profileFile,JSON.stringify(profile));
    await app.scan({pageId,mode:'rules',profileFile});await app.fill();
    assert.equal(await page.locator('#date').inputValue(),'');
    assert.equal(await page.locator('.s-date-picker').isVisible(),false);
    assert.ok(app.logs.some(s=>s.includes('出生日期必须提供完整')));
  }finally{await app.close();await browser.close();await cleanup(root);}
});

test('窗口自动模型选项：不确定、非法输出与服务失败均不选，不调用逐项确认',async()=>{
  const {createOptionResolver}=require('../src/option-mapping.cjs');
  let confirms=0;
  for(const planner of [async()=>[{profileKey:null}],async()=>[{profileKey:'option_99'}],async()=>{throw Error('本地模型连接失败');}]){
    const resolve=createOptionResolver({planner,autoAccept:true,confirm:async()=>{confirms++;return true;}});
    const result=await resolve({label:'政治面貌'},'中共党员',['中共党员（含预备党员）'],'political_status');
    assert.ok(result===null||result.unavailable);
  }
  assert.equal(confirms,0);
});

test('同一手机标签的区号与号码分开：区号保留、空号码填写，真正重复号码仍跳过',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'fill-window-'));
  const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL});
  const context=await browser.newContext();const page=await context.newPage();
  const mapping={fields:{phone:{aliases:['手机号码']}}};const profileFile=path.join(root,'profile.json');
  await fs.writeFile(profileFile,JSON.stringify({phone:'13800000000'}));
  const app=new FillWindow({context,root,mapping});
  try{
    for(const prefix of ['<div class="el-select"><input id="prefix" readonly value="86"></div>','<select id="prefix"><option>86</option><option>1</option></select>']){
      await page.setContent(`<div class="el-form-item"><label>手机号码</label>${prefix}<input id="number" type="tel" placeholder="请准确填写您的手机号码"></div>`);
      const pageId=app.pages()[0].id;
      await app.scan({pageId,mode:'rules',profileFile});
      const fields=app.pending.state.fields;
      assert.equal(fields.find(f=>f.phonePart==='prefix').label,'手机号码');
      assert.equal(fields.find(f=>f.phonePart==='number').label,'手机号码');
      await app.fill();
      assert.equal(await page.locator('#prefix').inputValue(),'86');
      assert.equal(await page.locator('#number').inputValue(),'13800000000');
      await page.locator('#number').fill('13900000000');
      await app.scan({pageId,mode:'assist',profileFile});
      assert.equal(app.status().canFill,false);
      assert.equal(await page.locator('#number').inputValue(),'13900000000');
    }
    await page.setContent('<div class="el-form-item"><label>手机号码</label><input type="tel"><input type="tel"></div>');
    await app.scan({pageId:app.pages()[0].id,mode:'rules',profileFile});
    assert.equal(app.status().canFill,false);
    assert.deepEqual(await page.locator('input').evaluateAll(nodes=>nodes.map(n=>n.value)),['','']);
  }finally{await app.close();await browser.close();await cleanup(root);}
});

test('教育动态表单：学历触发新增字段，手动再识别补填；学历学位分别映射，空排名不造值',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'fill-window-'));
  const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL});
  const context=await browser.newContext();const page=await context.newPage();
  const mapping=JSON.parse(await fs.readFile(path.join(__dirname,'../config/real-field-mapping.json'),'utf8'));
  const profileFile=path.join(root,'profile.json');
  await fs.writeFile(profileFile,JSON.stringify({school:'演示工业大学',admission_date:'2023-09',graduation_date:'2026-06',education_type:'全日制普通高等教育',academic_degree:'硕士学位',degree:'硕士研究生',class_rank:'',overseas_study:'否',research_direction:'多模态情感分析',department:'计算机学院',major:'计算机科学与技术',major_courses:'机器学习、深度学习'}));
  const app=new FillWindow({context,root,mapping});
  try{
    await page.setContent(`<section><h2>教育经历</h2><label>学校名称<input id="school"></label><label>入学时间<input id="admission" type="month"></label><label>毕业时间<input type="month" id="graduation"></label><label>受教育类型<select><option value="">请选择</option><option>全日制普通高等教育</option></select></label><label>学位<select id="academic"><option value="">请选择</option><option>硕士学位</option></select></label><label>学历<select id="education"><option value="">请选择</option><option>硕士研究生</option><option>博士研究生</option></select></label><div id="dynamic"></div><label>年级排名<select id="rank"><option value="">请选择</option><option>前20%</option></select></label><label>是否有海外学习经历<select id="overseas"><option value="">请选择</option><option>否</option><option>是</option></select></label><button id="add" onclick="window.added=true">添加</button></section>`);
    await page.locator('#education').evaluate(el=>el.addEventListener('change',()=>{document.querySelector('#dynamic').innerHTML='<label>研究方向<input id="research"></label><label>院系<input id="department"></label><label>专业<input id="major"></label><label>专业课程<input id="courses"></label>';}));
    const pageId=app.pages()[0].id;
    await app.scan({pageId,mode:'rules',profileFile});await app.fill();
    assert.equal(await page.locator('#academic').inputValue(),'硕士学位');
    assert.equal(await page.locator('#education').inputValue(),'硕士研究生');
    assert.equal(await page.locator('#admission').inputValue(),'2023-09');
    assert.equal(await page.locator('#research').inputValue(),'');
    await app.scan({pageId,mode:'rules',profileFile});await app.fill();
    assert.equal(await page.locator('#research').inputValue(),'多模态情感分析');
    assert.equal(await page.locator('#department').inputValue(),'计算机学院');
    assert.equal(await page.locator('#courses').inputValue(),'机器学习、深度学习');
    assert.equal(await page.locator('#rank').inputValue(),'');
    assert.equal(await page.locator('#overseas').inputValue(),'否');
    assert.equal(await page.evaluate(()=>!!window.added),false);
  }finally{await app.close();await browser.close();await cleanup(root);}
});

test('窗口教育年月按授权补1日：日期面板含隐藏月份表，出生日期仍不补日',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'fill-window-'));
  const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL});
  const context=await browser.newContext();const page=await context.newPage();
  const mapping={fields:{admission_date:{aliases:['入学时间']},graduation_date:{aliases:['毕业时间']},birth_date:{aliases:['出生日期']}}};
  const profileFile=path.join(root,'profile.json');
  await fs.writeFile(profileFile,JSON.stringify({admission_date:'2023-09',graduation_date:'2026-06',birth_date:'2001-01'}));
  const app=new FillWindow({context,root,mapping});
  try{
    await page.setContent(`<label>入学时间<input id="admission" readonly onclick="document.querySelector('.s-date-picker').hidden=false"></label><label>毕业时间<input id="graduation" type="date"></label><label>出生日期<input id="birth" type="date"></label>
    <div class="s-date-picker" hidden><strong>2023 年 9 月</strong><table class="el-month-table" hidden><tr><td>9月</td></tr></table><table class="el-date-table"><tr><td class="prev-month">1</td><td class="available">1</td><td class="next-month">1</td></tr></table></div>`);
    await page.locator('.available').evaluate(el=>el.onclick=()=>{document.querySelector('#admission').value='2023-09-01';document.querySelector('.s-date-picker').hidden=true;});
    await app.scan({pageId:app.pages()[0].id,mode:'rules',profileFile});
    assert.ok(app.logs.some(s=>s.includes('按约定补1日')));
    await app.fill();
    assert.equal(await page.locator('#admission').inputValue(),'2023-09-01');
    assert.equal(await page.locator('#graduation').inputValue(),'2026-06-01');
    assert.equal(await page.locator('#birth').inputValue(),'');
    assert.ok(app.logs.some(s=>s.includes('按用户约定补1日')));
    const dirs=await fs.readdir(path.join(root,'artifacts/window'));
    const report=JSON.parse(await fs.readFile(path.join(root,'artifacts/window',dirs[0],'report.json'),'utf8'));
    assert.deepEqual(report.results.map(r=>r.status),['verified','verified','missing']);
    assert.equal(report.results[0].assumedDay,1);
    assert.equal(await page.locator('.s-date-picker').isVisible(),false);
  }finally{await app.close();await browser.close();await cleanup(root);}
});
