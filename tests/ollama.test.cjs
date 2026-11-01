const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ollamaPlan}=require('../src/ollama.cjs');
const fields=[{fieldId:'choice',label:'政治面貌'}];
const mapping={fields:{option_0:{aliases:['中共党员（含预备党员）']}}};
const plan=[{fieldId:'choice',profileKey:'option_0',reason:'类别匹配'}];
test('本地接口使用回环地址，无认证、关闭思考、验证结构化响应',async()=>{
  const result=await ollamaPlan(fields,mapping,'TEST',{fetchImpl:async(url,req)=>{
    assert.equal(url,'http://127.0.0.1:11434/api/chat');assert.equal(req.redirect,'error');
    assert.equal(req.headers.Authorization,undefined);
    const body=JSON.parse(req.body);assert.equal(body.model,'qwen3:4b');assert.equal(body.think,false);assert.equal(body.stream,false);
    assert.deepEqual(body.format.properties.plan.items.properties.profileKey.enum,['option_0',null]);
    return {ok:true,json:async()=>({done:true,done_reason:'stop',message:{content:JSON.stringify({plan})}})};
  }});assert.deepEqual(result,plan);
});
test('本地缺模型、连接失败、截断、非法键均拒绝，不调用云端',async()=>{
  await assert.rejects(ollamaPlan(fields,mapping,'',{fetchImpl:async()=>({ok:false,status:404})}),/ollama pull/);
  await assert.rejects(ollamaPlan(fields,mapping,'',{fetchImpl:async()=>{throw Error('secret');}}),/本地模型连接失败/);
  for(const data of [{done:true,done_reason:'length',message:{content:JSON.stringify({plan})}},
    {done:true,done_reason:'stop',message:{content:'invalid'}},
    {done:true,done_reason:'stop',message:{content:JSON.stringify({plan:[{...plan[0],profileKey:'unknown'}]})}}]){
    await assert.rejects(ollamaPlan(fields,mapping,'',{fetchImpl:async()=>({ok:true,json:async()=>data})}));
  }
});
