const page = `<!doctype html><html lang="ja"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>CLUB KISS 新規来店</title><style>body{margin:0;background:#111;color:#eee;font-family:-apple-system,sans-serif}main{max-width:420px;margin:12vh auto;padding:24px;text-align:center}h1{color:#d6b66d;letter-spacing:3px}input,select,button{box-sizing:border-box;width:100%;padding:17px;margin:10px 0;border-radius:10px;font-size:19px}input,select{background:#222;color:white;border:1px solid #777}button{background:#d6b66d;border:0;color:#111;font-weight:bold}small{color:#aaa}#send{display:none}#msg{min-height:2em}</style><main><h1>CLUB KISS</h1><p>新規来店通知システム</p><section id="login"><input id="pin" type="password" inputmode="numeric" maxlength="4" placeholder="4桁のパスワード"><button onclick="login()">ログイン</button></section><section id="send"><p>新規来店人数</p><select id="count"><option value="1">新規1名</option><option value="2">新規2名</option><option value="3">新規3名</option><option value="4">新規4名</option><option value="5">新規5名</option></select><button id="btn" onclick="send()">🔔 LINEに通知する</button><button onclick="logout()" style="background:#333;color:#eee">ログアウト</button></section><p id="msg"></p><small>スタッフ専用</small></main><script>const m=document.getElementById('msg');async function api(path,body){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});let j=await r.json();if(!r.ok)throw Error(j.error||'エラー');return j}async function login(){try{await api('/login',{pin:document.getElementById('pin').value});document.getElementById('login').style.display='none';document.getElementById('send').style.display='block';m.textContent=''}catch(e){m.textContent=e.message}}async function send(){const n=Number(document.getElementById('count').value);if(!confirm('新規'+n+'名の来店をLINEに通知しますか？'))return;const b=document.getElementById('btn');b.disabled=true;try{await api('/send',{count:n});m.textContent='LINEに通知しました'}catch(e){m.textContent=e.message}finally{b.disabled=false}}async function logout(){await api('/logout',{});location.reload()}fetch('/session').then(r=>r.json()).then(j=>{if(j.ok){document.getElementById('login').style.display='none';document.getElementById('send').style.display='block'}})</script></html>`;
const enc=new TextEncoder();
function hex(a){return [...new Uint8Array(a)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function mac(secret,data){const k=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',k,enc.encode(data)))}
function response(obj,status=200,headers={}){return new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store',...headers}})}
function cookie(req){return (req.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('kiss_session='))?.slice(13)||''}
async function valid(req,env){const [exp,sig]=cookie(req).split('.');if(!exp||!sig||!/^\d+$/.test(exp)||Number(exp)<Date.now())return false;return (await mac(env.STAFF_PIN,exp))===sig}
export default {async fetch(req,env){
const url=new URL(req.url),path=url.pathname;
if(path==='/')return new Response(page,{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
if(path==='/session')return response({ok:await valid(req,env)});
if(req.method!=='POST')return response({error:'Not found'},404);
if(path==='/webhook'){
const body=await req.text(),sig=req.headers.get('x-line-signature')||'';
const k=await crypto.subtle.importKey('raw',enc.encode(env.LINE_CHANNEL_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
const signed=await crypto.subtle.sign('HMAC',k,enc.encode(body));
const expected=btoa(String.fromCharCode(...new Uint8Array(signed)));
if(sig!==expected)return response({error:'Invalid signature'},401);
let data;try{data=JSON.parse(body)}catch{return response({error:'Invalid JSON'},400)}
for(const event of data.events||[]){if(event.source?.type==='group'&&event.source.groupId){await env.KISS_DATA.put('groupId',event.source.groupId)}}
return response({ok:true});
}
if(path==='/login'){
const ip=req.headers.get('cf-connecting-ip')||'unknown',key='attempts:'+ip;
const attempts=Number(await env.KISS_DATA.get(key)||0);
if(attempts>=8)return response({error:'試行回数が多すぎます。15分後にお試しください'},429);
let data;try{data=await req.json()}catch{return response({error:'入力エラー'},400)}
if(!/^\d{4}$/.test(String(data.pin||''))||String(data.pin)!==env.STAFF_PIN){await env.KISS_DATA.put(key,String(attempts+1),{expirationTtl:900});return response({error:'パスワードが違います'},401)}
await env.KISS_DATA.delete(key);
const exp=String(Date.now()+12*60*60*1000),sig=await mac(env.STAFF_PIN,exp);
return response({ok:true},200,{'set-cookie':'kiss_session='+exp+'.'+sig+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200'});
}
if(path==='/logout')return response({ok:true},200,{'set-cookie':'kiss_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});
if(path==='/send'){
if(!await valid(req,env))return response({error:'再ログインしてください'},401);
let data;try{data=await req.json()}catch{return response({error:'入力エラー'},400)}
if(!Number.isInteger(data.count)||data.count<1||data.count>5)return response({error:'人数を選択してください'},400);
const groupId=await env.KISS_DATA.get('groupId');if(!groupId)return response({error:'LINEグループが未登録です。公式アカウントをグループに招待し、グループ内でメッセージを送ってください'},409);
const r=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{'authorization':'Bearer '+env.LINE_CHANNEL_ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify({to:groupId,messages:[{type:'text',text:'🔔 CLUB KISS 新規来店\n\n新規のお客様が'+data.count+'名ご来店されました。\n\nキャストの皆さん、ご対応をお願いします。'}]})});
if(!r.ok)return response({error:'LINE送信に失敗しました。設定を確認してください'},502);
return response({ok:true});
}
return response({error:'Not found'},404);
}};