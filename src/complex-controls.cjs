const regionKeys = new Set(['birthplace','native_place','gaokao_source_place','household_location','pre_school_household_location','current_city']);
const dateKeys = new Set(['birth_date','party_or_league_join_date','degree_awarded_date','graduation_date']);
const monthKeys = new Set(['admission_date']);
async function fillMonth(page,input,value,guard,{allowDayOne=false}={}){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))return {status:'missing',reason:'入学时间需提供YYYY-MM'};
  if(await input.inputValue())return {status:'skipped',reason:'已有内容，保留'};
  const year=Number(value.slice(0,4)),month=Number(value.slice(5));let panel;
  try{
    await input.click();
    panel=page.locator('.el-date-picker,.s-date-picker,.s-month-picker,.ant-picker-dropdown,[data-month-panel]').filter({visible:true});
    if(!await until(async()=>await panel.count()===1?true:null))return {status:'skipped',reason:'未找到唯一月份面板'};
    const monthTable=panel.locator('.el-month-table,.ant-picker-month-panel,[data-month-table]').filter({visible:true});
    if(!await monthTable.count()){
      if(allowDayOne && await calendarHeader(panel) && await panel.locator('td').filter({visible:true}).count()){
        return await fillCalendar(page,input,value,guard,{openedPanel:panel});
      }
      return {status:'skipped',reason:'页面要求具体日期或月份组件尚未适配'};
    }
    for(let step=0;step<100;step++){
      if(guard)await guard();
      const text=await panel.innerText(),match=/(\d{4})\s*年/.exec(text);
      if(!match)return {status:'skipped',reason:'月份面板年份无法识别'};
      const current=Number(match[1]);if(current===year)break;
      const direction=current>year?'prev':'next';
      const nav=panel.locator(`.el-icon-d-arrow-${direction==='prev'?'left':'right'},.s-icon-d-arrow-${direction==='prev'?'left':'right'},.ant-picker-header-super-${direction}-btn,[data-calendar-nav="${direction}-year"]`).filter({visible:true});
      if(await nav.count()!==1)return {status:'skipped',reason:'月份面板年份按钮不唯一'};
      await nav.click();
      if(!await until(async()=>!new RegExp(current+'\\s*年').test(await panel.innerText())))return {status:'failed',reason:'月份面板年份未更新'};
    }
    if(!(new RegExp(year+'\\s*年')).test(await panel.innerText()))return {status:'skipped',reason:'月份超出导航上限'};
    const table=monthTable;
    let choice=table.locator(`[title="${value}"],[title="${year}-${month}"],[data-month="${value}"]`).filter({visible:true});
    if(!await choice.count())choice=table.locator('td').filter({hasText:new RegExp('^\\s*'+month+'月\\s*$')}).filter({visible:true});
    if(await choice.count()!==1||await choice.evaluate(el=>el.getAttribute('aria-disabled')==='true'||/disabled/.test(el.className)))return {status:'skipped',reason:'月份不可选或不唯一'};
    if(guard)await guard();await choice.click();
    const matched=await until(async()=>{
      if(guard)await guard();
      const raw=await input.inputValue(),m=/^(\d{4})[-/年](\d{1,2})月?$/.exec(raw.trim());
      return m&&Number(m[1])===year&&Number(m[2])===month;
    });
    return matched?{status:'verified',reason:'月份选择后读回一致，未补造日期'}:{status:'failed',reason:'月份读回不一致'};
  }finally{if(panel&&await panel.count()===1)try{await closePanel(page,panel);}catch(error){throw Object.assign(error,{code:'PANEL_BLOCKED'});}}
}
function regionParts(value) {
  const separated = value.split(/[\s/－—>-]+/).filter(Boolean);
  if (separated.length > 1) return separated;
  return value.match(/[^省市区县]+(?:省|市|区|县)/g) || [];
}
const normalizeRegion = value => value.replace(/\s|[/－—>-]/g,'').replace(/省|市/g,'');
function fullDate(value) {
  const provisional = /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  const text = provisional ? value + '-01' : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(text+'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== text) return null;
  return {text, provisional, year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate()};
}
async function until(check, timeout=4000) {
  const end=Date.now()+timeout;
  while(Date.now()<end){const result=await check();if(result)return result;await new Promise(r=>setTimeout(r,100));}
  return null;
}
async function closePanel(page,panel) {
  if (!panel || !await panel.isVisible().catch(()=>false)) return;
  await page.keyboard.press('Escape');
  if (await panel.isVisible().catch(()=>false)) {
    const button=panel.locator('[aria-label="关闭"],[aria-label="Close"],.el-dialog__headerbtn,.ant-modal-close,.close-icon,.close,.el-icon-close,.anticon-close,[class*="closeIcon"],[class*="close-icon"]').filter({visible:true});
    if(await button.count()===1)await button.click();
  }
  if (await panel.isVisible().catch(()=>false)) {
    // 仅在面板右上角识别唯一图形关闭按钮，不点击其他页面图标。
    await panel.evaluate(root=>{
      const box=root.getBoundingClientRect();
      const icons=[...root.querySelectorAll('svg,i,[class*="close"],[class*="Close"]')].filter(el=>{
        const r=el.getBoundingClientRect();return r.width>0&&r.width<=60&&r.height<=60&&r.top>=box.top&&r.top<box.top+100&&r.left>box.right-100;
      });
      const unique=icons.filter(el=>!icons.some(other=>other!==el&&other.contains(el)));
      if(unique.length===1)unique[0].setAttribute('data-agent-close-panel','active');
    });
    const icon=panel.locator('[data-agent-close-panel="active"]').filter({visible:true});
    if(await icon.count()===1)await icon.click();
  }
  await until(async()=>!await panel.isVisible().catch(()=>false),1000);
  if(await panel.isVisible().catch(()=>false))throw Error('弹窗未能关闭，已停止后续填写；请手动关闭后重新识别');
}
async function regionPanel(page) {
  // 使用已知弹窗标题和搜索框定位，不在整个网页里点击同名地区。
  await until(async()=>{
    return page.evaluate(()=>{
      document.querySelectorAll('[data-agent-region-panel]').forEach(el=>el.removeAttribute('data-agent-region-panel'));
      const inputs=[...document.querySelectorAll('input')].filter(el=>el.getClientRects().length&&/搜索城市|区县/.test(el.placeholder));
      for(const input of inputs){for(let el=input.parentElement;el&&el!==document.body;el=el.parentElement){
        // 标题与搜索框常在独立的header里，不能把header误认作整个弹窗。
        const hasChoices=[...el.querySelectorAll('button,li,span,div')].some(node=>{
          const text=node.textContent.trim();return node!==el&&text.length>=2&&text.length<=12&&!/请选择行政区|关闭|取消|确定/.test(text)&&!node.contains(input)&&node.getClientRects().length;
        });
        if(el.textContent.includes('请选择行政区')&&hasChoices){el.setAttribute('data-agent-region-panel','active');return true;}
      }}return false;
    });
  });
  const panel=page.locator('[data-agent-region-panel="active"]').filter({visible:true});
  return await panel.count()===1?panel:null;
}
async function fillRegion(page, input, value, guard) {
  const parts=regionParts(value);
  if(!parts.length)return {status:'skipped',reason:'地区资料无法拆分，请使用省/市/区完整名称'};
  let panel;
  let detail='地区选择尚未完成';
  try {
    if(await input.inputValue())return {status:'skipped',reason:'已有填写内容，保留供用户检查'};
    await input.click();panel=await regionPanel(page);
    if(!panel)return {status:'skipped',reason:'未识别到带行政区标题及搜索框的地区弹窗'};
    for(const part of parts){
      if(guard)await guard();
      const short=part.replace(/省$|市$/,'');
      const escaped=short.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const option=panel.getByText(new RegExp('^\\s*'+escaped+'(?:省|市)?\\s*$')).filter({visible:true});
      const found=await until(async()=>await option.count()===1?true:null);
      if(!found){detail=`地区层级“${part}”匹配到${await option.count()}个可见选项，未选择其他地区`;return {status:'skipped',reason:detail};}
      await option.click();
    }
    const matched=await until(async()=>{
      const actual=await input.inputValue();return normalizeRegion(actual)===normalizeRegion(value)?actual:null;
    });
    if(!matched && parts.length < 3 && await panel.locator('.s-checkbutton__item').filter({visible:true}).count()) {
      detail='已到达城市，但页面仍要求区县；档案缺少区县，不猜填';
      return {status:'missing',reason:detail};
    }
    detail=matched?'地区已选中并验证':'地区选择后未读回完整目标地区，可能需要额外确认或完整区县资料';
    return matched?{status:'verified',reason:'地区逐层选择后读回一致'}:{status:'failed',reason:detail};
  } finally {
    if(panel&&await panel.isVisible().catch(()=>false)){
      const fs=require('node:fs/promises'),path=require('node:path');
      const diagnostic=await panel.evaluate(root=>[...root.querySelectorAll('*')].filter(el=>el.getClientRects().length).slice(0,300).map(el=>({tag:el.tagName,classes:typeof el.className==='string'?el.className:'',role:el.getAttribute('role'),placeholder:el.tagName==='INPUT'?el.placeholder:null,text:el.childElementCount===0&&el.tagName!=='INPUT'?el.textContent.trim().slice(0,80):''})));
      const directory=path.join(__dirname,'..','artifacts/region-debug');await fs.mkdir(directory,{recursive:true});
      await fs.writeFile(path.join(directory,'latest.json'),JSON.stringify({reason:detail,nodes:diagnostic},null,2));
    }
    try{await closePanel(page,panel);}catch(error){throw Object.assign(Error(`${detail}；${error.message}。诊断：artifacts/region-debug/latest.json`),{code:'PANEL_BLOCKED'});}
  }
}
async function calendarHeader(panel) {
  const text=await panel.innerText();
  const match=/(\d{4})\s*年\s*(\d{1,2})\s*月/.exec(text);
  return match?{year:Number(match[1]),month:Number(match[2])}:null;
}
async function fillCalendar(page,input,value,guard,{openedPanel}={}) {
  const date=fullDate(value);
  if(!date)return {status:'skipped',reason:'日期格式无效，要求YYYY-MM或YYYY-MM-DD'};
  if(await input.inputValue())return {status:'skipped',reason:'已有填写内容，保留供用户检查'};
  if(await input.getAttribute('type')==='date') {
    await input.fill(date.text);
    return await input.inputValue()===date.text?{status:date.provisional?'pending_confirmation':'verified',reason:date.provisional?'月份暂按1日填写，待用户确认':'日期读回一致'}:{status:'failed',reason:'日期读回失败'};
  }
  let panel;
  try {
    if(!openedPanel)await input.click();
    panel=openedPanel||page.locator('.el-date-picker,.s-date-picker,.ant-picker-dropdown,[data-calendar-panel]').filter({visible:true});
    if(!await until(async()=>await panel.count()===1?true:null))return {status:'skipped',reason:'未找到唯一可识别日历面板'};
    for(let step=0;step<160;step++){
      if(guard)await guard();
      const current=await calendarHeader(panel);
      if(!current)return {status:'skipped',reason:'无法读取日历年月标题，尚未适配该日历'};
      const delta=(date.year-current.year)*12+date.month-current.month;
      if(!delta)break;
      const direction=delta>0?'next':'prev';
      const useYear=Math.abs(delta)>=12;
      const selector=useYear?`.el-icon-d-arrow-${direction==='next'?'right':'left'},.s-icon-d-arrow-${direction==='next'?'right':'left'},.ant-picker-header-super-${direction}-btn,[data-calendar-nav="${direction}-year"]`:
        `.el-icon-arrow-${direction==='next'?'right':'left'},.s-icon-arrow-${direction==='next'?'right':'left'},.ant-picker-header-${direction}-btn,[data-calendar-nav="${direction}-month"]`;
      const button=panel.locator(selector).filter({visible:true});
      if(await button.count()!==1)return {status:'skipped',reason:'未找到唯一年月切换按钮'};
      await button.click();
      if(!await until(async()=>{const next=await calendarHeader(panel);return next&&(next.year!==current.year||next.month!==current.month);}))return {status:'failed',reason:'点击年月切换后日历没有更新'};
    }
    const current=await calendarHeader(panel);
    if(!current||current.year!==date.year||current.month!==date.month)return {status:'skipped',reason:'日期超出当前导航步数范围'};
    let day=panel.locator(`[title="${date.text}"],td[data-date="${date.text}"]`).filter({visible:true});
    if(!await day.count())day=panel.locator('td:not(.prev-month):not(.next-month):not(.disabled)').filter({hasText:new RegExp('^\\s*'+date.day+'\\s*$')}).filter({visible:true});
    if(await day.count()!==1||await day.evaluate(el=>el.getAttribute('aria-disabled')==='true'||/disabled|prev-month|next-month/.test(el.className)))return {status:'skipped',reason:'目标日期不可选或存在多个同名日期'};
    await day.click();
    const matched=await until(async()=>{
      if(guard)await guard();
      const raw=(await input.inputValue()).replace(/[年/.]/g,'-').replace(/月/g,'-').replace(/日/g,'');
      const pieces=/^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
      return pieces && `${pieces[1]}-${pieces[2].padStart(2,'0')}-${pieces[3].padStart(2,'0')}`===date.text;
    });
    return matched?{status:date.provisional?'pending_confirmation':'verified',reason:date.provisional?'日期暂按该月1日填写，待用户确认':'日历选择后读回一致'}:{status:'failed',reason:'日历选择后读回不一致'};
  }finally{
    if(panel && await panel.count()===1 && await panel.isVisible().catch(()=>false)) {
      const fs=require('node:fs/promises'),path=require('node:path');
      const nodes=await panel.evaluate(root=>[...root.querySelectorAll('*')].filter(el=>el.getClientRects().length).slice(0,200).map(el=>({tag:el.tagName,classes:typeof el.className==='string'?el.className:'',role:el.getAttribute('role'),title:el.getAttribute('title'),text:el.childElementCount===0?el.textContent.trim().slice(0,40):''})));
      const directory=path.join(__dirname,'..','artifacts/calendar-debug');
      await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'latest.json'),JSON.stringify({nodes},null,2));
    }
    try {await closePanel(page,panel);} catch(error) {throw Object.assign(error,{code:'PANEL_BLOCKED'});}
  }
}
module.exports={regionKeys,dateKeys,monthKeys,regionParts,fullDate,fillRegion,fillCalendar,fillMonth};
