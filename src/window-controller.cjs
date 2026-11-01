const fs = require('node:fs/promises');
const path = require('node:path');
const {snapshot, fieldHandler} = require('./real-web.cjs');
const {rulePlan, execute} = require('./agent.cjs');
const {createOptionResolver} = require('./option-mapping.cjs');
const {ollamaPlan} = require('./ollama.cjs');

class FillWindow {
  constructor({context, mapping, root=path.join(__dirname,'..'), planner=ollamaPlan}) {
    Object.assign(this,{context,mapping,root,planner});
    this.pending=null; this.busy=false; this.logs=[];
    this.pageIds=new Map(); this.nextId=1;
  }
  log(message) { this.logs.push(message); if(this.logs.length>500)this.logs.shift(); }
  pages() {
    return this.context.pages().filter(p=>!p.isClosed()).map(p=>{
      if(!this.pageIds.has(p))this.pageIds.set(p,String(this.nextId++));
      return {id:this.pageIds.get(p),label:p.url().split('?')[0]};
    });
  }
  status() {
    const canFill=!!this.pending && this.pending.valid && !this.pending.page.isClosed();
    return {busy:this.busy,canFill:canFill&&!this.busy,logs:this.logs,pages:this.pages()};
  }
  async invalidate() {
    const old=this.pending; this.pending=null;
    if(old){old.page.off('framenavigated',old.onNavigate);await old.state.dispose();}
  }
  async action(task) {
    if(this.busy)throw Error('当前操作尚未结束');
    this.busy=true;
    try{return await task();}finally{this.busy=false;}
  }
  async open(url) {
    return this.action(async()=>{
      const parsed=new URL(url);
      if(!['http:','https:'].includes(parsed.protocol))throw Error('网址须以 http:// 或 https:// 开头');
      await this.invalidate();
      const page=this.context.pages().find(p=>!p.isClosed())||await this.context.newPage();
      await page.goto(parsed.href,{waitUntil:'domcontentloaded',timeout:60000});
      await page.bringToFront();
      this.log('网页已打开。请登录并进入编辑状态，再选择目标标签页并识别。');
    });
  }
  async scan({pageId,mode,profileFile}) {
    return this.action(async()=>{
      await this.invalidate();
      if(!['rules','assist'].includes(mode))throw Error('请选择有效模式');
      this.logs=[];
      this.pages();
      const page=[...this.pageIds].find(([p,id])=>id===pageId&&!p.isClosed())?.[0];
      if(!page)throw Error('请选择当前目标标签页');
      const profile=JSON.parse(await fs.readFile(path.resolve(this.root,profileFile),'utf8'));
      if(!profile||typeof profile!=='object'||Array.isArray(profile))throw Error('档案必须是 JSON 对象');
      page.setDefaultTimeout(5000);
      const state=await snapshot(page);
      try {
        const plan=rulePlan(state.fields,this.mapping);
        const meanings=new Map();
        for(const f of state.fields){if(f.phonePart==='prefix')continue;const key=JSON.stringify([f.section,f.label]);meanings.set(key,(meanings.get(key)||0)+1);}
        const occupied=await page.locator('[data-agent-field]').evaluateAll(nodes=>Object.fromEntries(nodes.map(el=>[
          el.getAttribute('data-agent-field'),!!(el.value||el.closest('.ant-select')?.querySelector('.ant-select-selection-item')?.textContent.trim())])));
        for(const item of plan){
          const f=state.fields.find(f=>f.fieldId===item.fieldId);
          if(f.phonePart==='prefix'){
            item.profileKey=null;item.reason='电话区号，保持不变';continue;
          }
          if(!f.label.trim()||meanings.get(JSON.stringify([f.section,f.label]))>1||(item.profileKey==='phone'&&f.custom)||occupied[f.fieldId]){
            item.profileKey=null;item.reason=occupied[f.fieldId]?'已有内容，保留':'含义不明确，跳过';
          }
        }
        this.log('\n【'+(mode==='assist'?'规则＋本地模型辅助':'规则填写')+'】本轮计划');
        for(const item of plan){
          const f=state.fields.find(f=>f.fieldId===item.fieldId);
          const provided=item.profileKey&&typeof profile[item.profileKey]==='string'&&profile[item.profileKey].trim();
          const keyLabel=this.mapping.fields[item.profileKey]?.aliases?.[0]||item.profileKey;
          const dateNote=provided&&['admission_date','graduation_date'].includes(item.profileKey)&&/^\d{4}-\d{2}$/.test(profile[item.profileKey])?'（控件要求日时按约定补1日）':'';
          this.log(`${f.phonePart==='prefix'?'电话区号':f.label||'无标签'} → ${keyLabel||'不填写'} ｜ ${provided?'可填写'+dateNote:item.profileKey?'资料缺失':item.reason}`);
        }
        if(!plan.some(p=>p.profileKey&&typeof profile[p.profileKey]==='string'&&profile[p.profileKey].trim())){
          this.log('没有可执行的档案匹配项。可检查编辑状态、档案或换模式重新识别。');
          await state.dispose();return;
        }
        const pending={page,state,plan,profile,mode,valid:true,url:page.url()};
        pending.onNavigate=frame=>{if(frame===page.mainFrame()){pending.valid=false;this.log('目标页已跳转或刷新，请重新识别。');}};
        page.on('framenavigated',pending.onNavigate);
        this.pending=pending;
        this.log('核对后点击“确认填写”。');
      }catch(error){await state.dispose();throw error;}
    });
  }
  async fill() {
    return this.action(async()=>{
      const p=this.pending;
      if(!p||!p.valid||p.page.isClosed())throw Error('没有有效计划，请重新识别');
      // Consume once; a failed or completed run can never replay an old plan.
      this.pending=null;
      let fresh,results=[],interrupted=null;
      try {
        if(p.page.url()!==p.url)throw Error('页面已变化，请重新识别');
        fresh=await snapshot(p.page);
        if(JSON.stringify(fresh.fields)!==JSON.stringify(p.state.fields))throw Error('字段、标签或候选已变化，请重新识别');
        const resolver=createOptionResolver({planner:p.mode==='assist'?async(...args)=>{
          this.log('正在请求本地 Ollama / qwen3:4b…');return this.planner(...args);
        }:null,autoAccept:true});
        const guard=async id=>{
          if(!p.valid)throw Object.assign(Error('页面已跳转或刷新，请重新识别'),{code:'PAGE_CHANGED'});
          await fresh.guard(id);
        };
        const handler=fieldHandler(p.page,{guard,planner:null,resolveOption:resolver,educationMonthDayOne:true});
        results=await execute(p.page,fresh.fields,p.plan,p.profile,this.mapping,{guard,customHandler:handler});
      }catch(error){results=error.results||results;interrupted=error.message;}
      finally {p.page.off('framenavigated',p.onNavigate);await p.state.dispose();if(fresh)await fresh.dispose();}
      const statusLabel={verified:'成功',skipped:'跳过',missing:'缺失',failed:'失败',pending_confirmation:'待核对'};
      for(const r of results)this.log(`${r.label} ｜ ${statusLabel[r.status]||r.status} ｜ ${r.reason}`);
      const directory=path.join(this.root,'artifacts/window',require('node:crypto').randomUUID());
      await fs.mkdir(directory,{recursive:true});
      await fs.writeFile(path.join(directory,'report.json'),JSON.stringify({mode:p.mode,site:new URL(p.url).hostname,
        fields:p.state.fields,plan:p.plan,results,interrupted,automaticFollowup:false,optionConfirmation:'automatic',educationDatePolicy:'missing-day-01-user-authorized',
        submissionPolicy:'no-save-or-submit-clicks; site-autosave-possible'},null,2));
      this.log(`本轮结束：读回验证成功 ${results.filter(r=>r.status==='verified').length} 项。`);
      if(interrupted)this.log('本轮停止：'+interrupted);
      this.log('换页后点击“识别当前页”继续。');
    });
  }
  async close(){await this.invalidate();}
}
module.exports={FillWindow};
