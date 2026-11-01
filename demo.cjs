const { run } = require('./agent.cjs');
const { build } = require('./build-demo.cjs');
const { spawnSync } = require('node:child_process');
async function demo() {
  if (!process.env.SILICONFLOW_API_KEY) throw Error('请在已配置 SILICONFLOW_API_KEY 的窗口启动 Demo');
  console.log('Demo：模型识别新表达，填写七项事实，八项其他字段留空。');
  await run({ mode: 'model', realistic: true, headless: false, inspect: true, channel: process.env.BROWSER_CHANNEL || undefined });
  const evaluation = spawnSync(process.execPath, ['evaluate-realistic.cjs'], { cwd: __dirname, stdio: 'inherit' });
  if (evaluation.error || evaluation.status !== 0) throw Error('独立评测未通过，请检查 artifacts/realistic/evaluation.json');
  await build();
  console.log('现场演示完成。打开 demo.html 查看更新的评测摘要。');
}
demo().catch(error => { console.error(error.message); process.exitCode = 1; });
