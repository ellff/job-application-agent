const fs = require('node:fs/promises');
const path = require('node:path');
const { run } = require('../src/agent.cjs');
const root = path.join(__dirname, '..');
const expectedKeys = {
  '接收招聘通知的电子邮箱 *': 'email', '应聘者姓名 *': 'name', '本人常用手机号码 *': 'phone',
  '最高学历层次 *': 'degree', '最高学历对应的就读高校 *': 'school',
  '毕业年月 *': 'graduation_date', '所修读的专业名称 *': 'major'
};

async function cases() {
  const html = await fs.readFile(path.join(root, 'examples/application-realistic.html'), 'utf8');
  const profile = JSON.parse(await fs.readFile(path.join(root, 'examples/profile.json'), 'utf8'));
  const missing = { ...profile }; delete missing.phone;
  return [
    { name: 'missing-phone', description: '档案缺少手机号', html, profile: missing,
      special: { label: '本人常用手机号码 *', status: 'missing', value: '' } },
    { name: 'no-doctor-option', description: '学历选项没有博士', profile,
      html: html.replace('<option value="d">博士</option>', ''),
      special: { label: '最高学历层次 *', status: 'skipped', value: '' } },
    { name: 'existing-email', description: '已有不同邮箱，不能覆盖', profile,
      html: html.replace('id="r-email" type="email"', 'id="r-email" value="already-filled@example.com" type="email"'),
      special: { label: '接收招聘通知的电子邮箱 *', status: 'skipped', value: 'already-filled@example.com' } }
  ];
}

// 独立答案仅用于测试注入、或 Agent 完成后的比对；模型运行不接收这些答案。
function grade(output, scenario) {
  const errors = [];
  if (output.fields.length !== 15 || output.results.length !== 15) errors.push({ reason: '字段数量不正确' });
  for (const field of output.fields) {
    const key = expectedKeys[field.label] || null;
    const special = field.label === scenario.special.label;
    const result = output.results.find(r => r.label === field.label);
    const value = output.values.find(v => v.fieldId === field.fieldId)?.value;
    const status = special ? scenario.special.status : key ? 'verified' : 'skipped';
    let expectedValue = special ? scenario.special.value : key ? scenario.profile[key] : '';
    // 下拉的实际值不同于显示文字：评测档案博士对应模拟控件值 d。
    if (key === 'degree' && !special) expectedValue = 'd';
    if (result?.profileKey !== key || result?.status !== status || value !== expectedValue) {
      errors.push({ label: field.label, expectedKey: key, actualKey: result?.profileKey,
        expectedStatus: status, actualStatus: result?.status, valueMatches: value === expectedValue });
    }
  }
  return { scenario: scenario.name, description: scenario.description, total: 15, passed: errors.length ? false : true, errors };
}

async function suite({ planner, mode = 'model', channel, headless = true } = {}) {
  const evaluations = [];
  for (const scenario of await cases()) {
    console.log(`\n异常测试：${scenario.description}`);
    const output = await run({ html: scenario.html, profile: scenario.profile, mode, planner, channel, headless,
      artifactName: `exceptions/${planner ? 'executor' : mode}/${scenario.name}` });
    const evaluation = grade(output, scenario);
    evaluations.push(evaluation);
    console.log(`${evaluation.passed ? '通过' : '失败'}：${scenario.description}`);
  }
  const summary = { kind: planner ? 'executor-only' : mode, scenarios: evaluations.length,
    passed: evaluations.filter(e => e.passed).length, evaluations };
  const folder = path.join(root, 'artifacts/exceptions', planner ? 'executor' : mode);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, 'evaluation.json'), JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  if (!process.env.SILICONFLOW_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error('请在已配置 API Key 的 PowerShell 窗口运行异常模型评测。'); process.exitCode = 1;
  } else {
    suite({ channel: process.env.BROWSER_CHANNEL || undefined, headless: !process.argv.includes('--show') })
      .then(summary => { console.log(`异常模型评测：${summary.passed}/${summary.scenarios} 场景通过，详情：artifacts/exceptions/model/evaluation.json`); if (summary.passed !== summary.scenarios) process.exitCode = 1; })
      .catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
module.exports = { cases, grade, suite, expectedKeys };
