const fs = require('node:fs/promises');
const path = require('node:path');
const root = __dirname;
async function build() {
  const realistic = JSON.parse(await fs.readFile(path.join(root, 'artifacts/realistic/evaluation.json'), 'utf8'));
  const exceptions = JSON.parse(await fs.readFile(path.join(root, 'artifacts/exceptions/model/evaluation.json'), 'utf8'));
  const report = JSON.parse(await fs.readFile(path.join(root, 'artifacts/realistic/report.json'), 'utf8'));
  if (report.mode !== 'model' || realistic.model !== report.model || realistic.provider !== report.provider || exceptions.kind !== 'model') throw Error('缺少匹配的真实模型评测记录');
  const recorded = (await fs.stat(path.join(root, 'artifacts/realistic/report.json'))).mtime.toISOString();
  const data = { recorded, provider: report.provider, model: report.model, realistic, exceptions,
    fields: report.results.map(r => ({ label: r.label, key: r.profileKey, status: r.status })) };
  // 不展示联系方式、档案值或模型自由文本；HTML 仅包含评测摘要。
  const safe = JSON.stringify(data).replace(/</g, '\\u003c');
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Job Application Agent · Demo</title><style>
*{box-sizing:border-box}body{margin:0;background:#f2f5fa;color:#22324a;font:16px/1.65 system-ui,sans-serif}main{max-width:1080px;margin:auto;padding:40px 24px}h1{font-size:34px;line-height:1.25}h2{font-size:21px}.tag{color:#2864ab;font-weight:700}.muted{color:#64758b}.flow{background:#153356;color:white;border-radius:14px;padding:22px;font-size:18px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin:24px 0}.card,section{background:white;border:1px solid #dfe6ee;border-radius:12px;padding:22px;margin-bottom:18px}.metric{font-size:32px;font-weight:700;color:#237253}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:10px;border-bottom:1px solid #e3e8ef}code{background:#eef2f7;padding:3px 6px;border-radius:4px}a{color:#2864ab}.note{background:#fff4db;padding:16px;border-radius:8px}@media(max-width:700px){.cards{grid-template-columns:1fr}h1{font-size:27px}section{overflow:auto}}
</style></head><body><main><div class="tag">SANDBOX MVP · 演示与评测记录</div><h1>一份个人档案，理解不同网申字段</h1><p class="muted">面向春秋招学生：减少重复输入姓名、联系方式与教育信息。</p><div class="flow">标准档案 → Skill 指导 → 模型映射 → 浏览器填写 → 读回验证 → 独立评测</div>
<p class="note">此页面展示已保存的真实模型评测结果，不是当前实时运行，也不是通用准确率承诺。演示使用本地模拟招聘网站，不自动提交。</p>
<div class="cards"><div class="card"><div>新表达测试</div><div class="metric" id="normal"></div><div>7项事实填写 · 8项留空</div></div><div class="card"><div>异常场景</div><div class="metric" id="exceptions"></div><div>缺失资料 · 无匹配选项 · 已有内容</div></div><div class="card"><div>执行模型</div><strong id="model"></strong><p class="muted" id="recorded"></p></div></div>
<section><h2>现场演示</h2><p>在已配置 API Key 的 PowerShell 窗口运行 <code>.\\start.ps1 -Demo</code>。浏览器填好后检查七项事实、八项留空，按回车继续独立评测并刷新此记录。</p><p>异常演示运行 <code>.\\start.ps1 -Exceptions</code>，重新生成记录运行 <code>node build-demo.cjs</code>。</p><a href="application-realistic.html">查看空白测试表单</a> · <a href="DEMO.md">查看演示讲稿</a></section>
<section><h2>字段处理记录</h2><table><thead><tr><th>网页字段</th><th>标准档案键</th><th>处理</th></tr></thead><tbody id="fields"></tbody></table></section>
<section><h2>异常评测</h2><ul id="cases"></ul><p class="muted">每个场景核对15项字段的映射、状态和实际控件值。既有邮箱仅保留，仍需用户确认。</p></section>
<section><h2>能力边界</h2><p>支持单页本地表单中的七类档案事实；缺失、不支持或歧义字段留空。开放题暂不生成。真实招聘网站、登录、验证码、多页申请尚未实现。</p><p>一次样本成功不能证明长期稳定：已观察到一次接口连接失败，后续重跑通过，根因尚未确定。</p></section>
</main><script>const data=${safe};document.getElementById('normal').textContent=data.realistic.passed+'/'+data.realistic.total;document.getElementById('exceptions').textContent=data.exceptions.passed+'/'+data.exceptions.scenarios;document.getElementById('model').textContent=data.model;document.getElementById('recorded').textContent='基线记录时间：'+new Date(data.recorded).toLocaleString('zh-CN');for(const f of data.fields){const row=document.createElement('tr');for(const text of [f.label,f.key||'—',f.status==='verified'?'已填写并验证':f.status==='skipped'?'留空':f.status]){const cell=document.createElement('td');cell.textContent=text;row.append(cell)}document.getElementById('fields').append(row)}for(const c of data.exceptions.evaluations){const li=document.createElement('li');li.textContent=c.description+'：'+(c.passed?'通过':'失败');document.getElementById('cases').append(li)}</script></body></html>`;
  await fs.writeFile(path.join(root, 'demo.html'), html);
  console.log('演示页已更新：demo.html（已保存记录，不是实时结果）');
}
if (require.main === module) build().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { build };
