const WebSocket = globalThis.WebSocket;
const http = require('http');
const fs = require('fs');

const CDP = 'http://127.0.0.1:9222';
const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

function cdpGet(url){return new Promise((res,rej)=>{const r=http.get(url,x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res(d));});r.on('error',rej);});}
function cdpSend(ws,method,params,to=60000){return new Promise((res,rej)=>{const id=Math.floor(Math.random()*1e6);const on=(ev)=>{let m;try{m=JSON.parse(ev.data);}catch{return;}if(m.id===id){ws.removeEventListener('message',on);res(m);}};ws.addEventListener('message',on);ws.send(JSON.stringify({id,method,params:params||{}}));setTimeout(()=>{ws.removeEventListener('message',on);rej(new Error('timeout '+method));},to);});}

(async()=>{
  const list=JSON.parse(await cdpGet(CDP+'/json'));
  const target=list.find(t=>/x\.com/.test(t.url))||list.find(t=>t.type==='page');
  console.log('target:',target.url);
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.onopen=()=>res();ws.onerror=e=>rej(e.error||new Error('ws'));});
  await cdpSend(ws,'Runtime.enable');
  console.log('[1] trivial eval 1+1 =', (await cdpSend(ws,'Runtime.evaluate',{expression:'1+1',returnByValue:true})).result.result.value);

  const cookies=JSON.parse(fs.readFileSync('D:/Workspace/workbuddy/cookies.json','utf8'));
  const ct0=cookies.find(c=>c.name==='ct0').value;
  const params=JSON.parse(fs.readFileSync('D:/Workspace/workbuddy/bookmarks_params.json','utf8'));
  const url=params.base_url+'?variables='+encodeURIComponent(JSON.stringify(params.variables))+'&features='+encodeURIComponent(JSON.stringify(params.features));

  const js=`(async()=>{
    const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),25000);
    try{
      const r=await fetch(${JSON.stringify(url)},{method:'GET',credentials:'include',signal:ctrl.signal,headers:{'Authorization':'Bearer ${BEARER}','x-csrf-token':${JSON.stringify(ct0)},'x-twitter-auth-type':'OAuth2Session','x-twitter-active-user':'yes','content-type':'application/json','x-twitter-client-language':'en'}});
      clearTimeout(t);
      const txt=await r.text();
      return 'STATUS:'+r.status+' LEN:'+txt.length+' HEAD:'+txt.slice(0,120);
    }catch(e){ clearTimeout(t); return 'FETCH_ERR:'+e.message; }
  })()`;
  console.log('[2] fetch test...');
  const res=await cdpSend(ws,'Runtime.evaluate',{expression:js,awaitPromise:true,returnByValue:true},70000);
  console.log('   ->', res.result && res.result.result.value);
  if(res.result&&res.result.exceptionDetails) console.log('   EXC:',JSON.stringify(res.result.exceptionDetails).slice(0,300));
  ws.close();
})().catch(e=>{console.error('[FATAL]',e.message);process.exit(1);});
