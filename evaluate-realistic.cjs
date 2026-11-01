// 评测答案只在执行结束后加载，不发送给模型。
const fs=require('node:fs/promises');
const path=require('node:path');
async function evaluate(){
  const report=JSON.parse(await fs.readFile(path.join(__dirname,'artifacts/realistic/report.json'),'utf8'));
  const expected={
    '接收招聘通知的电子邮箱 *':'email','应聘者姓名 *':'name','本人常用手机号码 *':'phone',
    '最高学历层次 *':'degree','最高学历对应的就读高校 *':'school','毕业年月 *':'graduation_date','所修读的专业名称 *':'major'
  };
  const unsupported=['紧急联系人姓名','GPA（4分制）','专业成绩排名','期望工作城市','期望税前月薪（元）','英语能力等级','籍贯','请介绍你的优势及与岗位相关的经历'];
  const errors=[];
  for(const [label,key]of Object.entries(expected)){
    const result=report.results.find(r=>r.label===label);
    if(!result||result.profileKey!==key||result.status!=='verified')errors.push({label,expected:key,actual:result||null});
  }
  for(const label of unsupported){
    const result=report.results.find(r=>r.label===label);
    if(!result||result.profileKey!==null||result.status!=='skipped')errors.push({label,expected:'留空',actual:result||null});
  }
  if(report.results.length!==15)errors.push({reason:'字段数量不是15'});
  const summary={provider:report.provider,model:report.model,total:15,passed:15-errors.length,errors};
  await fs.writeFile(path.join(__dirname,'artifacts/realistic/evaluation.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary,null,2));
  if(errors.length)process.exitCode=1;
}
evaluate().catch(error=>{console.error(error.message);process.exitCode=1;});
