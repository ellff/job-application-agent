const { test } = require('node:test');
const assert = require('node:assert/strict');
const { suite, expectedKeys } = require('../evaluation/exceptions.cjs');
test('执行层异常回归：缺失手机号、无博士选项、已有邮箱；每场景核对15个实际值', async () => {
  const summary = await suite({ mode: 'rules', channel: process.env.BROWSER_CHANNEL,
    planner: async fields => fields.map(f => ({ fieldId: f.fieldId, profileKey: expectedKeys[f.label] || null, reason: '独立答案测试执行层' })) });
  assert.equal(summary.kind, 'executor-only');
  assert.equal(summary.passed, 3);
  assert.ok(summary.evaluations.every(e => e.errors.length === 0));
});
