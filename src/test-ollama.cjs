const {ollamaPlan}=require('./ollama.cjs');
const {chooseOption}=require('./option-mapping.cjs');
(async()=>{
  console.log('独立测试本地 qwen3:4b，不读取档案、不操作网页。首次加载可能较慢。');
  const start=Date.now();
  const labels=['团员','中共党员（含预备党员）','民主党派','无党派人士','群众'];
  const choice=await chooseOption({label:'政治面貌'},'中共党员',labels,'political_status',ollamaPlan);
  console.log(`耗时 ${((Date.now()-start)/1000).toFixed(1)} 秒`);
  if(choice?.index===1)console.log('测试通过：本地模型选中了中共党员（含预备党员）。');
  else {console.log('接口已响应，但此例匹配未通过；不会执行网页填写。');process.exitCode=1;}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
