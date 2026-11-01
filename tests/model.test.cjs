const { test } = require('node:test');
const assert = require('node:assert/strict');
const { siliconflowPlan } = require('../src/agent.cjs');
const fields = [{ fieldId: 'a', label: '毕业高校名称', type: 'text', options: [] }];
const mapping = { fields: { school: { aliases: ['学校'] } } };
const env = { SILICONFLOW_API_KEY: 'test-secret' };
const plan = [{ fieldId: 'a', profileKey: 'school', reason: '高校对应学校' }];

test('集团接口使用独立密钥和文档参数，不回退硅基流动',async()=>{
  const result=await siliconflowPlan(fields,mapping,'TEST',{provider:'sinomach',quiet:true,
    env:{SINOMACH_API_KEY:'Bearer internal-test',SILICONFLOW_API_KEY:'other-secret'},fetchImpl:async(url,options)=>{
      assert.equal(url,'https://ai.sinomach.com.cn/ai-gateway/04100230/v1/chat/completions');
      assert.equal(options.headers.Authorization,'Bearer internal-test');
      const body=JSON.parse(options.body);
      assert.equal(body.model,'deepseek-v4-flash');
      assert.deepEqual(body.chat_template_kwargs,{enable_thinking:false});
      assert.equal(body.max_tokens,1500);assert.equal(body.stream,false);
      assert.equal(Object.hasOwn(body,'enable_thinking'),false);
      return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({plan})}}]})};
    }});
  assert.deepEqual(result,plan);
  await assert.rejects(siliconflowPlan(fields,mapping,'',{provider:'sinomach',env,fetchImpl:async()=>assert.fail('must not request')}),/SINOMACH_API_KEY/);
  await assert.rejects(siliconflowPlan(fields,mapping,'',{provider:'sinomach',env:{SINOMACH_API_KEY:'test'},fetchImpl:async()=>({ok:false,status:401})}),/集团模型 HTTP 401/);
});

test('硅基流动请求与响应协议：默认模型、Skill、映射及授权', async () => {
  const result = await siliconflowPlan(fields, mapping, 'TEST SKILL', { env, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.siliconflow.cn/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'Qwen/Qwen3.5-4B');
    assert.equal(body.enable_thinking, false);
    assert.ok(body.messages[0].content.includes('TEST SKILL'));
    assert.deepEqual(JSON.parse(body.messages[1].content), { fields, mapping });
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ plan }) } }] }) };
  } });
  assert.deepEqual(result, plan);
});

test('失败、截断及非法映射均停止，不回退规则或泄露密钥', async () => {
  await assert.rejects(siliconflowPlan(fields, mapping, '', { env: {}, fetchImpl: async () => { throw Error('should not call'); } }), /SILICONFLOW_API_KEY/);
  await assert.rejects(siliconflowPlan(fields, mapping, '', { env, fetchImpl: async () => ({ ok: false, status: 401 }) }), /Key 无效/);
  for (const [finish_reason, content] of [['length', '{}'], ['stop', 'invalid'], ['stop', JSON.stringify({ plan: [{ ...plan[0], value: 'invented' }] })], ['stop', JSON.stringify({ plan: [{ ...plan[0], profileKey: 'salary' }] })]]) {
    await assert.rejects(siliconflowPlan(fields, mapping, '', { env, fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason, message: { content } }] }) }) }));
  }
});

test('区分请求超时和连接断开，并且不输出原始错误中的密钥', async () => {
  for (const [error, pattern] of [
    [Object.assign(new Error('test-secret'), { name: 'TimeoutError' }), /超过60秒/],
    [Object.assign(new Error('test-secret'), { cause: { code: 'ECONNRESET' } }), /ECONNRESET.*连接被中途断开/]
  ]) {
    await assert.rejects(siliconflowPlan(fields, mapping, '', { env, fetchImpl: async () => { throw error; } }), actual => {
      assert.match(actual.message, pattern);
      assert.ok(!actual.message.includes('test-secret'));
      return true;
    });
  }
});
