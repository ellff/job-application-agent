const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {FillWindow}=require('./window-controller.cjs');

async function main({headless=false,sessionDirectory=path.join(__dirname,'.local/browser-session')}={}){
  const {chromium}=require('playwright');
  const browserOptions={headless,chromiumSandbox:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})};
  const context=await chromium.launchPersistentContext(sessionDirectory,browserOptions);
  const mapping=JSON.parse(await fs.readFile(path.join(__dirname,'real-field-mapping.json'),'utf8'));
  const app=new FillWindow({context,mapping});
  const token=crypto.randomBytes(32).toString('hex');
  const html=await fs.readFile(path.join(__dirname,'window.html'),'utf8');
  const script=await fs.readFile(path.join(__dirname,'try-zhaopin.ps1'),'utf8');
  const defaultUrl=/\$targetUrl = '([^']+)'/.exec(script)?.[1]||'';
  let origin,control,closing=false;
  async function shutdown(){
    if(closing)return;closing=true;
    await app.close();await context.close().catch(()=>{});
    if(control)await control.close().catch(()=>{});
    server.close();
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
    if(req.headers.host!==new URL(origin).host){res.writeHead(403);return res.end();}
    if(req.method==='GET'&&req.url==='/'){
      res.setHeader('Content-Type','text/html; charset=utf-8');
      return res.end(html.replace('__TOKEN__',token).replace('__DEFAULT_URL__',JSON.stringify(defaultUrl).replace(/</g,'\\u003c')));
    }
    if(req.headers['x-session-token']!==token|| (req.headers.origin&&req.headers.origin!==origin)){
      res.writeHead(403);return res.end();
    }
    res.setHeader('Content-Type','application/json; charset=utf-8');
    if(req.method==='GET'&&req.url==='/status')return res.end(JSON.stringify(app.status()));
    if(req.method!=='POST'){res.writeHead(404);return res.end('{}');}
    try {
      let body='';for await(const chunk of req){body+=chunk;if(body.length>16384)throw Error('请求过大');}
      const data=JSON.parse(body||'{}');
      if(req.url==='/invalidate'){if(app.busy)throw Error('请等待当前操作结束');await app.invalidate();}
      else if(req.url==='/exit'){res.end('{}');setImmediate(shutdown);return;}
      else if(['/open','/scan','/fill'].includes(req.url)){
        if(app.busy)throw Error('当前操作尚未结束');
        const task=req.url==='/open'?app.open(data.url):req.url==='/scan'?app.scan(data):app.fill();
        task.catch(error=>app.log('操作失败：'+error.message));
      }else{res.writeHead(404);return res.end('{}');}
      res.end('{}');
    }catch(error){res.writeHead(400);res.end(JSON.stringify({error:error.message}));}
  });
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    origin=`http://127.0.0.1:${server.address().port}`;
    control=await chromium.launch(browserOptions);
    const page=await control.newPage({viewport:{width:880,height:720}});
    await page.goto(origin);page.on('close',shutdown);
    app.log('打开网页并登录，再点击“识别当前页”。');
    return {app,origin,control,shutdown};
  }catch(error){await shutdown();throw error;}
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={main};
