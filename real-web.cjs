const fs = require('node:fs/promises');
const path = require('node:path');
const { createInterface } = require('node:readline/promises');
const {ollamaPlan}=require('./ollama.cjs');
const { observe, execute, siliconflowPlan, rulePlan } = require('./agent.cjs');
const { chooseOption, createOptionResolver, createFirstPassResolver } = require('./option-mapping.cjs');
const {regionKeys,dateKeys,monthKeys,fillRegion,fillCalendar,fillMonth}=require('./complex-controls.cjs');

function fieldHandler(page, { planner = (fields, mapping, skill) => siliconflowPlan(fields, mapping, skill, { quiet: true }), guard, resolveOption, educationMonthDayOne=false } = {}) {
  return async (field, value, key) => {
    const input = page.locator(`[data-agent-field="${field.fieldId}"]`);
    const selected = await input.evaluate(el => el.value || el.closest('.ant-select')?.querySelector('.ant-select-selection-item')?.textContent.trim() || '');
    if (selected) return { status: 'skipped', reason: '已有填写内容，保留供用户检查' };
    if(regionKeys.has(key))return fillRegion(page,input,value,guard ? () => guard(field.fieldId) : undefined);
    const educationDate=['admission_date','graduation_date'].includes(key);
    const monthOnly=/^\d{4}-(0[1-9]|1[0-2])$/.test(value);
    const dateGuard=guard?()=>guard(field.fieldId):undefined;
    const withAgreedDay=result=>educationMonthDayOne&&educationDate&&monthOnly&&result.status==='pending_confirmation'
      ? {...result,status:'verified',assumedDay:1,reason:'按用户约定补1日，日期读回一致'}:result;
    if(educationDate && field.readonly && monthOnly && (educationMonthDayOne||monthKeys.has(key)))
      return withAgreedDay(await fillMonth(page,input,value,dateGuard,{allowDayOne:educationMonthDayOne}));
    if(monthKeys.has(key) && (field.readonly || field.type==='date')){
      if(monthOnly&&!educationMonthDayOne)return {status:'missing',reason:'入学日期缺少日，未授权补日'};
      return withAgreedDay(await fillCalendar(page,input,value,dateGuard));
    }
    if(dateKeys.has(key) && (field.readonly || field.type==='date')) {
      if(key==='birth_date' && !/^\d{4}-\d{2}-\d{2}$/.test(value))return {status:'missing',reason:'出生日期必须提供完整YYYY-MM-DD，不补造日期'};
      return withAgreedDay(await fillCalendar(page,input,value,dateGuard));
    }
    if(field.type==='select' && resolveOption) {
      const available=await input.evaluate(el=>[...el.options].filter(o=>!o.disabled&&o.value!=='').map(o=>({label:o.label,value:o.value})));
      const choice=await resolveOption(field,value,available.map(o=>o.label),key);
      if(!choice || choice.unavailable)return {status:'skipped',reason:choice?.reason||'没有等价的唯一选项'};
      if(guard)await guard(field.fieldId);
      const fresh=await input.evaluate(el=>[...el.options].filter(o=>!o.disabled&&o.value!=='').map(o=>({label:o.label,value:o.value})));
      if(await input.inputValue() || JSON.stringify(fresh)!==JSON.stringify(available))return {status:'skipped',reason:'确认期间内容或选项变化，请重新识别'};
      await input.selectOption({value:available[choice.index].value});
      if(guard)await guard(field.fieldId);
      return await input.evaluate(el=>el.selectedOptions[0]?.label)===available[choice.index].label ? {status:'verified',reason:'下拉选中后读回一致',matchSource:choice.source} : {status:'failed',reason:'下拉读回不一致'};
    }
    if(!field.custom || field.type==='select')return null;
    const supported = await input.evaluate(el => !!el.closest('.el-select,.ant-select') || el.getAttribute('role') === 'combobox');
    if (!supported) return { status: 'skipped', reason: '自定义控件尚未适配' };
    try {
      const wrapper = input.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," el-select ") or contains(concat(" ",normalize-space(@class)," ")," ant-select ")][1]');
      if (await wrapper.count()) await wrapper.click(); else await input.click();
      const options = page.locator('[role="option"],.el-select-dropdown__item,.ant-select-item-option').filter({ visible: true });
      await options.first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
      // Allow old popup transitions to finish; never combine two menus.
      const singleMenu = () => options.evaluateAll(nodes=>new Set(nodes.map(el=>el.closest('[role="listbox"],.el-select-dropdown,.ant-select-dropdown,ul') || el.parentElement)).size<=1);
      const menuDeadline=Date.now()+2000;
      while(!await singleMenu() && Date.now()<menuDeadline) await new Promise(resolve=>setTimeout(resolve,100));
      if(!await singleMenu()) return {status:'skipped',reason:'多个下拉菜单同时可见，无法确认归属，跳过避免串台'};
      const labels = [];
      for (let i = 0; i < await options.count(); i++) {
        const option = options.nth(i);
        if (!(await option.evaluate(el => el.getAttribute('aria-disabled') === 'true' || /is-disabled|option-disabled/.test(el.className)))) {
          labels.push((await option.innerText()).trim());
        }
      }
      const choice = resolveOption ? await resolveOption(field,value,labels,key) : await chooseOption(field, value, labels, key, planner);
      if(choice?.unavailable)return {status:'skipped',reason:choice.reason};
      if (!choice) return { status: 'skipped', reason: `未找到等价的唯一选项；可用选项：${labels.join('、') || '未读取到'}` };
      if (guard) await guard(field.fieldId);
      const freshLabels=await options.evaluateAll(nodes=>nodes.filter(el=>el.getAttribute('aria-disabled')!=='true'&&!/is-disabled|option-disabled/.test(el.className)).map(el=>el.innerText.trim()));
      if(JSON.stringify(freshLabels)!==JSON.stringify(labels))return {status:'skipped',reason:'选项集合在匹配或确认后变化，请重新识别'};
      if ((await input.inputValue()) || await input.evaluate(el => !!el.closest('.ant-select')?.querySelector('.ant-select-selection-item')?.textContent.trim())) return {status:'skipped',reason:'选择期间已有内容，保留供用户检查'};
      // Do not retain nth() indexes: closing animations can remove earlier menus.
      const expected = labels[choice.index];
      const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const option = options.filter({hasText:new RegExp('^\\s*'+escaped+'\\s*$')});
      if (await option.count() !== 1) return {status:'skipped',reason:'目标选项不唯一或已消失，未点击'};
      await option.click();
      if (guard) await guard(field.fieldId);
      await page.waitForFunction(({id,expected})=>{
        const el=document.querySelector(`[data-agent-field="${id}"]`);
        return el && (el.value || el.closest('.ant-select')?.querySelector('.ant-select-selection-item')?.textContent.trim() || '')===expected;
      },{id:field.fieldId,expected},{timeout:2000}).catch(()=>{});
      const actual = await input.evaluate(el => el.value || el.closest('.ant-select')?.querySelector('.ant-select-selection-item')?.textContent.trim() || '');
      return actual === labels[choice.index] ? { status: 'verified', matchSource:choice.source, reason: choice.semantic ? `语义匹配：${value} → ${actual}，选中后读回一致` : '下拉选择后读回显示文字一致' } : { status: 'failed', reason: '下拉选择后读回不一致' };
    } catch (error) { return { status: 'failed', reason: `自定义下拉失败：${error.message.includes('硅基流动') || error.message.includes('模型') ? error.message : '控件点击、选项读取或验证失败'}` }; }
    finally {
      await page.keyboard.press('Escape').catch(() => {});
      // Blur using the current field's label, without changing its value or clicking save.
      const label = input.locator('xpath=ancestor::*[contains(@class,"form-item") or contains(@class,"form-group")][1]').locator('label').first();
      if(await label.isVisible().catch(()=>false)) await label.click().catch(()=>{});
      await input.evaluate(el=>el.blur()).catch(()=>{});
      await page.waitForFunction(()=>![...document.querySelectorAll('[role="option"],.el-select-dropdown__item,.ant-select-item-option')].some(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'),null,{timeout:1500}).catch(()=>{});
    }
  };
}

async function snapshot(page) {
  const url = page.url();
  const fields = await observe(page, { editableOnly: true });
  const handles = await Promise.all(fields.map(f => page.locator(`[data-agent-field="${f.fieldId}"]`).elementHandle()));
  const signatures = await Promise.all(handles.map(h => h.evaluate(el => ({ tag: el.tagName, type: el.type,
    options: el.tagName === 'SELECT' ? [...el.options].map(o => [o.label, o.value, o.disabled]) : [] }))));
  // Keep the initial plan; restore its markers by meaning rather than DOM order.
  async function relocate() {
    const current = await observe(page, { editableOnly: true });
    const candidates = await Promise.all(current.map(f => page.locator(`[data-agent-field="${f.fieldId}"]`).elementHandle()));
    const next = fields.map(original => {
      const same = f => f.label === original.label && f.section === original.section &&
        f.type === original.type && f.custom === original.custom && f.readonly === original.readonly &&
        JSON.stringify(f.options) === JSON.stringify(original.options);
      const matches = current.map((f,i) => same(f) ? i : -1).filter(i => i >= 0);
      // Ambiguous duplicate labels must not be assigned by their new position.
      return matches.length === 1 ? candidates[matches[0]] : null;
    });
    await page.locator('[data-agent-field]').evaluateAll(elements => elements.forEach(el => el.removeAttribute('data-agent-field')));
    for (let i = 0; i < next.length; i++) {
      if (next[i]) await next[i].evaluate((el,id) => el.setAttribute('data-agent-field',id),fields[i].fieldId);
    }
    await Promise.all(handles.filter(Boolean).map(h => h.dispose()));
    handles.splice(0, handles.length, ...next);
    await Promise.all(candidates.filter(h => !next.includes(h)).map(h => h.dispose()));
  }
  async function intact(i) {
    if (!handles[i]) return false;
    return handles[i].evaluate((el, expected) => el.isConnected && el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== 'hidden' && !el.matches(':disabled') &&
      el.getAttribute('data-agent-field') === expected.id &&
      JSON.stringify({ tag: el.tagName, type: el.type, options: el.tagName === 'SELECT' ? [...el.options].map(o => [o.label, o.value, o.disabled]) : [] }) === JSON.stringify(expected.signature),
      { id: fields[i].fieldId, signature: signatures[i] }).catch(() => false);
  }
  async function guard(fieldId) {
    if (page.isClosed() || page.url() !== url) throw Object.assign(Error('页面已跳转或关闭，请重新识别'), {code:'PAGE_CHANGED'});
    for (let i = 0; i < handles.length; i++) {
      if (fieldId && fields[i].fieldId !== fieldId) continue;
      if (!(await intact(i)) && fieldId) await relocate();
      if (!(await intact(i))) throw Object.assign(Error('表单结构或编辑状态已变化，请重新识别'), {code:fieldId ? 'FIELD_UNAVAILABLE' : 'FIELD_CHANGED'});
    }
  }
  return { fields, guard, dispose: async () => Promise.all(handles.filter(Boolean).map(h => h.dispose())) };
}

const fieldIdentity = field => JSON.stringify([field.section,field.label.replace(/[\s：:*＊]/g,''),field.type,!!field.custom]);

async function supplement(page, initialFields, profile, mapping, {resolveOption,deferred=[],approve=async()=>false}={}) {
  const report={fields:[],plan:[],results:[],remaining:[],approved:false};
  const startUrl=page.url();
  // One bounded settling period before the supplementary scan, not after each field.
  await page.evaluate(()=>new Promise(resolve=>{
    let quiet;let cap;const done=()=>{observer.disconnect();clearTimeout(quiet);clearTimeout(cap);resolve();};
    const observer=new MutationObserver(()=>{clearTimeout(quiet);quiet=setTimeout(done,350);});
    observer.observe(document.body,{childList:true,subtree:true});quiet=setTimeout(done,350);cap=setTimeout(done,2000);
  }));
  if(page.url()!==startUrl)throw Object.assign(Error('补扫期间页面跳转'),{code:'PAGE_CHANGED'});
  const state=await snapshot(page);
  try {
    const previous=new Set(initialFields.map(fieldIdentity));
    const counts=new Map();
    for(const f of state.fields)counts.set(fieldIdentity(f),(counts.get(fieldIdentity(f))||0)+1);
    for(const f of state.fields) {
      if(previous.has(fieldIdentity(f)) && !deferred.some(item=>fieldIdentity(item.field)===fieldIdentity(f)))continue;
      if(counts.get(fieldIdentity(f))!==1 || !f.label.trim()) {
        report.remaining.push({label:f.label,reason:'补填字段含义重复或无标签，需人工处理'});continue;
      }
      const occupied=await page.locator(`[data-agent-field="${f.fieldId}"]`).evaluate(el=>el.value || el.closest('.ant-select')?.querySelector('.ant-select-selection-item')?.textContent.trim() || '');
      if(!occupied)report.fields.push(f);
    }
    report.plan=rulePlan(report.fields,mapping);
    for(const item of report.plan) {
      const f=report.fields.find(f=>f.fieldId===item.fieldId);
      const retry=deferred.find(entry=>fieldIdentity(entry.field)===fieldIdentity(f));
      if(retry){item.profileKey=retry.key;item.reason='第一轮选项未匹配，第二轮重新读取选项';}
      if(item.profileKey==='phone'&&f.custom){item.profileKey=null;item.reason='电话区号下拉不填完整手机号';}
    }
    if(!report.fields.length)return report;
    report.approved=await approve(report.fields,report.plan);
    if(!report.approved){report.results=report.plan.map(p=>({label:report.fields.find(f=>f.fieldId===p.fieldId).label,profileKey:p.profileKey,status:'skipped',reason:'补填未确认'}));return report;}
    if(page.url()!==startUrl)throw Object.assign(Error('补填确认期间页面跳转'),{code:'PAGE_CHANGED'});
    try {
      report.results=await execute(page,report.fields,report.plan,profile,mapping,{guard:state.guard,customHandler:fieldHandler(page,{guard:state.guard,planner:null,resolveOption})});
    } catch(error) {report.results=error.results||[];report.error=error.message;return report;}
    // Only inspect after the second pass; never run a third pass automatically.
    if(page.url()!==startUrl) {report.error='补填后页面已跳转';return report;}
    const after=await observe(page,{editableOnly:true});
    const known=new Set(state.fields.map(fieldIdentity));
    report.remaining.push(...after.filter(f=>!known.has(fieldIdentity(f))).map(f=>({label:f.label,reason:'补填后新增，已达到一轮补填上限'})));
    return report;
  } finally {await state.dispose();}
}

async function main() {
  const args = process.argv.slice(2);
  const url = args[0];
  const profileFile = args[1];
  if (!url || !['http:', 'https:'].includes(new URL(url).protocol)) throw Error('请提供 http/https 网页地址');
  if (!profileFile) throw Error('真实网页必须指定已核对的个人档案文件，不默认使用测试 profile.json');
  const profile = JSON.parse(await fs.readFile(path.resolve(profileFile), 'utf8'));
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw Error('个人档案必须是 JSON 对象');
  const previewOnly = args.includes('--preview');
  const rulesOnly = args.includes('--rules');
  const assistOptions=args.includes('--assist-options');
  if (!rulesOnly && !process.env.SILICONFLOW_API_KEY) throw Error('请在当前窗口设置 SILICONFLOW_API_KEY');
  if (!process.stdin.isTTY) throw Error('真实网页需要交互终端，请在 PowerShell 中运行');
  const { chromium } = require('playwright');
  const sessionDirectory = path.join(__dirname, '.local/browser-session');
  await fs.mkdir(sessionDirectory, { recursive: true });
  const context = await chromium.launchPersistentContext(sessionDirectory, { headless: false, chromiumSandbox: true,
    ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('连续填写模式：在此浏览器中手动切换页面或模块，每轮按回车重新识别；输入 q 退出。不会自动点击下一步。');
    while (true) {
      const command = (await input.question('切换到要填写的页面并进入编辑状态，按回车识别；q 退出：')).trim().toLowerCase();
      if (command === 'q') break;
      try {
    const pages = context.pages().filter(p => !p.isClosed());
    let target = pages[0];
    if (!target) { console.log('没有可用标签页，请重新启动。'); break; }
    if (pages.length > 1) {
      console.table(pages.map((p, index) => ({ index, page: p.url().split('?')[0] })));
      const selected = Number(await input.question('输入目标标签页编号：'));
      if (!Number.isInteger(selected) || !pages[selected]) throw Error('标签页编号无效');
      target = pages[selected];
    }
    await target.bringToFront(); target.setDefaultTimeout(5000);
    const state = await snapshot(target);
    try {
      if (!state.fields.length) throw Error('没有发现可编辑的原生表单控件；请检查编辑状态。iframe 与自定义选择器暂不支持');
      const mapping = JSON.parse(await fs.readFile(path.join(__dirname, 'real-field-mapping.json'), 'utf8'));
      const instructions = '处理用户已进入编辑状态的当前表单。标准键见mapping，每个字段选唯一对应键或null。同义词仅是参考，结合标签和模块理解。本人姓名与紧急联系人姓名、本人电话与联系人电话必须分开。学历与学位分开。GPA、排名、偏好和英语成绩可以是用户明确提供的信息，不应称为推测性信息。缺失事实不编造，开放题留空。不要登录、切换模块、保存或提交。';
      console.log(rulesOnly ? '规则模式：不调用模型，按明确字段别名匹配。' : '调用模型…');
      const plan = rulesOnly ? rulePlan(state.fields, mapping) : await siliconflowPlan(state.fields, mapping, instructions, { quiet: true });
      // 没有可解释标签的控件不能仅凭类型猜测事实键。
      for (const item of plan) {
        const observedField=state.fields.find(f=>f.fieldId===item.fieldId);
        if(observedField.phonePart==='prefix' || (item.profileKey==='phone' && observedField.custom)) {
          item.profileKey=null;item.reason='手机号旁的下拉可能为国家区号，不将完整手机号填入';
        }
        if (!state.fields.find(f => f.fieldId === item.fieldId).label.trim()) {
          item.profileKey = null; item.reason = '控件没有可识别标签，留空供人工处理';
        }
      }
      const matched = plan.filter(p => p.profileKey && typeof profile[p.profileKey] === 'string' && profile[p.profileKey].trim()).length;
      console.log(`识别到 ${state.fields.length} 个字段，匹配到 ${matched} 项资料。`);
      console.table(plan.map(item => ({
        '网页字段': state.fields.find(field => field.fieldId === item.fieldId).label || '无标签',
        '档案字段': item.profileKey || '不填写',
        '资料状态': !item.profileKey ? '不匹配' :
          typeof profile[item.profileKey] === 'string' && profile[item.profileKey].trim() ? '有资料，执行时检查控件' : '缺失，留空',
        '匹配理由': item.reason
      })));
      console.log('请逐项核对字段对应关系。匹配不代表一定可填写；已有内容保留，缺失和不支持的项目跳过。');
      if (previewOnly) {
        const directory = path.join(__dirname, 'artifacts/real-web-preview');
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify({ mode: 'preview-only',
          site: new URL(target.url()).hostname, fields: state.fields, plan, filled: 0 }, null, 2));
        console.log(`识别预览完成，未填写任何内容。报告：${directory}`);
        console.log('预览结束，可以切换页面继续识别。');
        continue;
      }
      if ((await input.question('输入 fill 开始填写，其他输入取消本轮：')).trim() !== 'fill') continue;
      const deferred=[];
      const firstPassResolver=createFirstPassResolver(deferred,assistOptions);
      const resolveOption=createOptionResolver({
        planner:assistOptions ? (fields,mapping,skill)=>{
          const provider=process.env.OPTION_MODEL_PROVIDER || 'siliconflow';
          console.log(`第二轮：正在请求 ${provider} 匹配下拉选项…`);
          return provider==='ollama' ? ollamaPlan(fields,mapping,skill) : siliconflowPlan(fields,mapping,skill,{quiet:true,provider});
        } : null,
        confirm:async ({field,value,option})=>{
          console.log(`模型建议：${field}，档案类别“${value}” → 网页选项“${option}”`);
          return (await input.question('输入 yes 接受此建议，其他输入跳过：')).trim()==='yes';
        }
      });
      let results, interruption;
      try {
        results = await execute(target, state.fields, plan, profile, mapping, { guard: state.guard, customHandler: fieldHandler(target, { guard: state.guard, planner:null,resolveOption:firstPassResolver }) });
      } catch (error) {
        results = error.results || []; interruption = error;
      }
      let followup=null;
      if(!interruption) {
        try {
          followup=await supplement(target,state.fields,profile,mapping,{resolveOption,deferred,approve:async(fields,plan)=>{
            console.log('第二轮：补填新增空字段及第一轮未匹配的下拉框。');
            console.table(plan.map(p=>({'字段':fields.find(f=>f.fieldId===p.fieldId).label,'档案字段':p.profileKey||'无法匹配','资料':p.profileKey&&typeof profile[p.profileKey]==='string'&&profile[p.profileKey].trim()?'已提供':'缺失/不匹配'})));
            return (await input.question('输入 fill 开始以上第二轮补填，其他输入跳过：')).trim()==='fill';
          }});
          if(followup.error)interruption=Error(followup.error);
        }catch(error){interruption=error;}
      }
      const directory = path.join(__dirname, 'artifacts/real-web', new Date().toISOString().replace(/[:.]/g, '-'));
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify({ mode: 'real-web', matchingMode: rulesOnly ? 'rules' : 'model', model: rulesOnly ? null : process.env.SILICONFLOW_MODEL || 'Qwen/Qwen3.5-4B',
        site: new URL(target.url()).hostname, fields: state.fields, plan, results, followup, assistOptions,
        optionProvider:assistOptions ? process.env.OPTION_MODEL_PROVIDER || 'siliconflow' : null,
        optionModel:assistOptions ? (process.env.OPTION_MODEL_PROVIDER==='ollama'?'qwen3:4b':process.env.OPTION_MODEL_PROVIDER==='sinomach'?'deepseek-v4-flash':process.env.SILICONFLOW_MODEL || 'Qwen/Qwen3.5-4B') : null,
        interrupted: !!interruption, submissionPolicy: 'no-save-or-submit-clicks; site-autosave-possible' }, null, 2));
      if (interruption) throw interruption;
      results=results.concat(followup?.results||[]);
      const count = status => results.filter(r => r.status === status).length;
      console.table(results.map(r=>({'字段':r.label,'状态':r.status,'原因':r.reason})));
      if(followup?.remaining.length)console.table(followup.remaining);
      console.log(`两轮操作记录（同一字段可能记录两次）：成功 ${count('verified')} 次，待确认 ${count('pending_confirmation')} 次，跳过 ${count('skipped') + count('missing')} 次，失败 ${count('failed')} 次。`);
      console.log('本轮完成。请检查结果，可手动保存、切换模块或页面，再回终端按回车继续。');
    } finally { await state.dispose(); }
      } catch (error) {
        console.error('本轮已停止：' + error.message);
        console.log('检查页面后可重新识别，或输入 q 退出。');
      }
    }
  } catch (error) {
    console.error(error.message);
    await input.question('执行已停止，浏览器保留供检查；按回车关闭。');
    process.exitCode = 1;
  } finally { input.close(); await context.close(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { snapshot, fieldHandler, supplement };
