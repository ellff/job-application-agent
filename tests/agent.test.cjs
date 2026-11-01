const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { run, validatePlan } = require('../src/agent.cjs');

test('基线和同义词：浏览器实际填写七字段', async () => {
  const html = (await fs.readFile(path.join(__dirname, '../examples/application.html'), 'utf8')).replace('毕业院校', '院校名称');
  const { results } = await run({ html, channel: process.env.BROWSER_CHANNEL, artifactName: 'baseline' });
  assert.equal(results.length, 7);
  assert.ok(results.every(r => r.status === 'verified'));
});

test('缺失、未知、歧义、学历不匹配：留空', async () => {
  const profile = JSON.parse(await fs.readFile(path.join(__dirname, '../examples/profile.json'), 'utf8'));
  delete profile.phone;
  let html = await fs.readFile(path.join(__dirname, '../examples/application.html'), 'utf8');
  html = html.replace('>姓名<', '>联系人姓名<').replace('<option value="doctor">博士</option>', '').replace('</form>', '<label>GPA<input type="text"></label></form>');
  const { results, fields, values } = await run({ html, profile, channel: process.env.BROWSER_CHANNEL, artifactName: 'exceptions' });
  assert.equal(results.find(r => r.label === '手机号').status, 'missing');
  for (const label of ['联系人姓名', 'GPA', '最高学历']) assert.equal(results.find(r => r.label === label).status, 'skipped');
  assert.equal(results.filter(r => r.status === 'verified').length, 4);
  for (const label of ['联系人姓名', '手机号', 'GPA', '最高学历']) {
    const field = fields.find(f => f.label === label);
    assert.equal(values.find(v => v.fieldId === field.fieldId).value, '');
  }
});

test('拒绝模型伪造的字段和重复计划', () => {
  const fields = [{ fieldId: 'a' }, { fieldId: 'b' }];
  const mapping = { fields: { name: {} } };
  assert.throws(() => validatePlan([{ fieldId: 'a', profileKey: 'name', reason: '' }, { fieldId: 'a', profileKey: 'name', reason: '' }], fields, mapping));
  assert.throws(() => validatePlan([{ fieldId: 'a', profileKey: 'salary', reason: '' }, { fieldId: 'b', profileKey: null, reason: '' }], fields, mapping));
});
