const dns = require('node:dns').promises;
const tls = require('node:tls');
const {siliconflowPlan}=require('./agent.cjs');
const host='ai.sinomach.com.cn';
function connection() {
  return new Promise((resolve,reject)=>{
    const socket=tls.connect({host,port:443,servername:host});
    const timer=setTimeout(()=>socket.destroy(Object.assign(Error('timeout'),{code:'CONNECT_TIMEOUT'})),10000);
    socket.once('secureConnect',()=>{clearTimeout(timer);socket.destroy();resolve();});
    socket.once('error',error=>{clearTimeout(timer);socket.destroy();reject(error);});
  });
}
async function main(){
  console.log('独立测试集团接口；不读取个人档案、不打开招聘网页。');
  console.log('1/3 检查域名解析…');
  let timer;
  try {
    await Promise.race([dns.lookup(host),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Object.assign(Error('timeout'),{code:'DNS_TIMEOUT'})),10000);
    })]);
  }finally{clearTimeout(timer);}
  console.log('域名解析成功。\n2/3 检查 HTTPS 连接与证书（最长10秒）…');
  await connection();
  console.log('HTTPS 连接与证书验证成功。\n3/3 使用 Token 发送一条合成测试请求（最长60秒）…');
  const plan=await siliconflowPlan([{fieldId:'test',label:'测试颜色：红色',type:'select'}],
    {fields:{red:{aliases:['红色']}}},'将测试颜色对应到标准键；仅返回要求的JSON。',
    {provider:'sinomach',quiet:true});
  console.log('接口调用成功，已收到通过格式验证的模型响应。');
  console.log(plan[0].profileKey==='red'?'简单匹配测试通过。':'接口可用，但简单匹配未通过，需另查模型效果。');
}
if(require.main===module)main().catch(error=>{
  const code=String(error.code||'');
  if(code)console.error(`连接检查失败：${/^[A-Z0-9_]+$/.test(code)?code:'UNKNOWN'}。`);
  else console.error(error.message);
  console.error('若连接超时，请确认公司网络/VPN、接口访问白名单及代理要求。超时本身不能确定是网速慢。');
  process.exitCode=1;
});
