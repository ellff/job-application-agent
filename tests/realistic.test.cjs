const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {run,observe,execute}=require('../src/agent.cjs');
test('真实风格页面：独立答案驱动执行层，7个事实填对、8个其他字段留空、零提交',async()=>{
  const {chromium}=require('playwright');
  const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL});
  try{
    const page=await browser.newPage();
    await page.setContent(await fs.readFile(path.join(__dirname,'../examples/application-realistic.html'),'utf8'));
    await page.evaluate(()=>{window.submissions=0;document.querySelector('form').addEventListener('submit',()=>window.submissions++);});
    const fields=await observe(page);
    const expected={'r-email':'email','r-name':'name','r-phone':'phone','r-degree':'degree','r-school':'school','r-graduation':'graduation_date','r-major':'major'};
    const ids=await page.locator('[data-agent-field]').evaluateAll(els=>els.map(el=>el.id));
    const plan=fields.map((f,i)=>({fieldId:f.fieldId,profileKey:expected[ids[i]]||null,reason:'独立测试答案，仅测试执行层，不证明模型能力'}));
    const profile=JSON.parse(await fs.readFile(path.join(__dirname,'../examples/profile.json'),'utf8'));
    const mapping=JSON.parse(await fs.readFile(path.join(__dirname,'../config/field-mapping.json'),'utf8'));
    const results=await execute(page,fields,plan,profile,mapping);
    assert.equal(fields.length,15);
    assert.equal(results.filter(r=>r.status==='verified').length,7);
    for(const id of ids){
      const locator=page.locator('#'+id);
      const value=id==='r-degree'?await locator.evaluate(el=>el.selectedOptions[0].label):await locator.inputValue();
      assert.equal(value,expected[id]?profile[expected[id]]:'');
    }
    assert.equal(await page.evaluate(()=>window.submissions),0);
    await fs.mkdir(path.join(__dirname,'../artifacts/realistic-executor'),{recursive:true});
    await page.screenshot({path:path.join(__dirname,'../artifacts/realistic-executor/filled.png'),fullPage:true});
  }finally{await browser.close();}
});
test('不扩充同义词表：规则模式应暴露新表达识别不足',async()=>{
  const {results}=await run({realistic:true,channel:process.env.BROWSER_CHANNEL,artifactName:'realistic-rules'});
  assert.equal(results.length,15);
  assert.equal(results.filter(r=>r.status==='verified').length,1);
  assert.equal(results.find(r=>r.label==='紧急联系人姓名').profileKey,null);
});
