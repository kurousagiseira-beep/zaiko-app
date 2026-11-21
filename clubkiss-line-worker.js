const page = `<!doctype html><html lang="ja"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>CLUB KISS 新規来店</title><style>body{margin:0;background:#111;color:#eee;font-family:-apple-system,sans-serif}main{max-width:420px;margin:12vh auto;padding:24px;text-align:center}h1{color:#d6b66d;letter-spacing:3px}input,select,button{box-sizing:border-box;width:100%;padding:17px;margin:10px 0;border-radius:10px;font-size:19px}input,select{background:#222;color:white;border:1px solid #777}button{background:#d6b66d;border:0;color:#111;font-weight:bold}small{color:#aaa}#send{display:none}#msg{min-height:2em}</style><main><h1>CLUB KISS</h1><p>新規来店通知システム</p><section id="login"><input id="pin" type="password" inputmode="numeric" maxlength="4" placeholder="4桁のパスワード"><button onclick="login()">ログイン</button></section><section id="send"><p>新規来店人数</p><select id="count"><option value="1">新規1名</option><option value="2">新規2名</option><option value="3">新規3名</option><option value="4">新規4名</option><option value="5">新規5名</option></select><button id="btn" onclick="send()">🔔 LINEに通知する</button><button onclick="logout()" style="background:#333;color:#eee">ログアウト</button></section><p id="msg"></p><small>スタッフ専用</small></main><script>const m=document.getElementById('msg');async function api(path,body){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});let j=await r.json();if(!r.ok)throw Error(j.error||'エラー');return j}async function login(){try{await api('/login',{pin:document.getElementById('pin').value});document.getElementById('login').style.display='none';document.getElementById('send').style.display='block';m.textContent=''}catch(e){m.textContent=e.message}}async function send(){const n=Number(document.getElementById('count').value);if(!confirm('新規'+n+'名の来店をLINEに通知しますか？'))return;const b=document.getElementById('btn');b.disabled=true;try{await api('/send',{count:n});m.textContent='LINEに通知しました'}catch(e){m.textContent=e.message}finally{b.disabled=false}}async function logout(){await api('/logout',{});location.reload()}fetch('/session').then(r=>r.json()).then(j=>{if(j.ok){document.getElementById('login').style.display='none';document.getElementById('send').style.display='block'}})</script></html>`;
const enc=new TextEncoder();
function hex(a){return [...new Uint8Array(a)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function mac(secret,data){const k=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',k,enc.encode(data)))}
function response(obj,status=200,headers={}){return new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store',...headers}})}
function cookie(req){return (req.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('kiss_session='))?.slice(13)||''}
async function valid(req,env){const [exp,sig]=cookie(req).split('.');if(!exp||!sig||!/^\d+$/.test(exp)||Number(exp)<Date.now())return false;return (await mac(env.STAFF_PIN,exp))===sig}

const photoCors={'access-control-allow-origin':'https://kurousagiseira-beep.github.io','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'Content-Type','vary':'Origin'};
function photoResponse(obj,status=200){return response(obj,status,photoCors)}
async function readPhotoRequests(env){return JSON.parse(await env.KISS_DATA.get('photo:requests')||'[]')}

export default {async fetch(req,env){
const url=new URL(req.url),path=url.pathname;
if(path==='/')return new Response(page,{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});

if(path.startsWith('/photo/')){
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:photoCors});
 if(req.headers.get('origin')&&req.headers.get('origin')!=='https://kurousagiseira-beep.github.io')return photoResponse({error:'許可されていません'},403);
 if(path==='/photo/casts'&&req.method==='GET'){
  const casts=JSON.parse(await env.KISS_DATA.get('photo:casts')||'[]');
  return photoResponse({casts});
 }
 if(path==='/photo/publish'&&req.method==='POST'){
  const data=await req.json().catch(()=>({}));
  if(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN)return photoResponse({error:'スタッフPINが違います'},401);
  if(!Array.isArray(data.casts)||data.casts.length>100)return photoResponse({error:'登録内容が不正です'},400);
  const casts=data.casts.map(c=>({id:String(c.id),name:String(c.name||'').slice(0,60),bio:String(c.bio||'').slice(0,500),active:c.active!==false,photos:Array.isArray(c.photos)?c.photos.filter(p=>typeof p==='string'&&p.startsWith('data:image/')).slice(0,10):[]}));
  if(casts.some(c=>!c.name))return photoResponse({error:'キャスト名を確認してください'},400);
  try{await env.KISS_DATA.put('photo:casts',JSON.stringify(casts))}catch{return photoResponse({error:'写真の容量が大きすぎます。枚数を減らしてください'},413)}
  return photoResponse({ok:true,count:casts.length});
 }
 if(path==='/photo/submit'&&req.method==='POST'){
  const ip=req.headers.get('cf-connecting-ip')||'unknown',key='photo:rate:'+ip;
  const n=Number(await env.KISS_DATA.get(key)||0);
  if(n>=12)return photoResponse({error:'送信回数が多すぎます。しばらくお待ちください'},429);
  const data=await req.json().catch(()=>({}));
  if(!Array.isArray(data.ids)||data.ids.length<1||data.ids.length>20)return photoResponse({error:'キャストを選んでください'},400);
  const casts=JSON.parse(await env.KISS_DATA.get('photo:casts')||'[]');
  const ids=[...new Set(data.ids.map(String))];
  if(ids.some(id=>!casts.some(c=>c.id===id&&c.active)))return photoResponse({error:'選択したキャストが見つかりません。画面を更新してください'},400);
  const item={id:crypto.randomUUID(),ids,names:ids.map(id=>casts.find(c=>c.id===id).name),status:'pending',time:Date.now()};
  const groupId=await env.KISS_DATA.get('groupId');
  if(!groupId)return photoResponse({error:'LINEグループが未登録です'},409);
  const line=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{authorization:'Bearer '+env.LINE_CHANNEL_ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify({to:groupId,messages:[{type:'text',text:'📸 CLUB KISS 写真指名\nお客様から指名が入りました。\n'+item.names.join('・')}]})});
  if(!line.ok)return photoResponse({error:'LINE送信に失敗しました'},502);
  const list=await readPhotoRequests(env);list.push(item);
  await env.KISS_DATA.put('photo:requests',JSON.stringify(list.slice(-200)));
  await env.KISS_DATA.put(key,String(n+1),{expirationTtl:900});
  return photoResponse({ok:true,id:item.id});
 }
 if(path==='/photo/requests'&&req.method==='POST'){
  const data=await req.json().catch(()=>({}));
  if(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN)return photoResponse({error:'スタッフPINが違います'},401);
  return photoResponse({requests:await readPhotoRequests(env)});
 }
 if(path==='/photo/status'&&req.method==='POST'){
  const data=await req.json().catch(()=>({}));
  if(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN)return photoResponse({error:'スタッフPINが違います'},401);
  if(!['done','cancel'].includes(data.status))return photoResponse({error:'操作が不正です'},400);
  const list=await readPhotoRequests(env),item=list.find(r=>r.id===data.id);
  if(!item)return photoResponse({error:'受付が見つかりません'},404);
  if(item.status!=='pending')return photoResponse({error:'すでに処理されています'},409);
  item.status=data.status;
  await env.KISS_DATA.put('photo:requests',JSON.stringify(list));
  return photoResponse({ok:true});
 }
 return photoResponse({error:'Not found'},404);
}

if(path==='/session')return response({ok:await valid(req,env)});
if(req.method==='OPTIONS'&&path==='/photo-confirm'){
const origin=req.headers.get('origin')||'';
if(origin!=='https://kurousagiseira-beep.github.io')return response({error:'Forbidden'},403);
return new Response(null,{status:204,headers:{'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'Content-Type','vary':'Origin'}});
}
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
if(path==='/photo-confirm'){
const origin=req.headers.get('origin')||'';
const allowed='https://kurousagiseira-beep.github.io';
const cors={'access-control-allow-origin':allowed,'vary':'Origin','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'Content-Type'};
if(origin!==allowed)return response({error:'許可されていないアクセスです'},403);
if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
if(req.method!=='POST')return response({error:'Method not allowed'},405,cors);
const ip=req.headers.get('cf-connecting-ip')||'unknown',key='photo-attempts:'+ip;
const attempts=Number(await env.KISS_DATA.get(key)||0);
if(attempts>=8)return response({error:'試行回数が多すぎます。15分後にお試しください'},429,cors);
let data;try{data=await req.json()}catch{return response({error:'入力エラー'},400,cors)}
if(String(data.pin||'')!==env.STAFF_PIN){await env.KISS_DATA.put(key,String(attempts+1),{expirationTtl:900});return response({error:'スタッフPINが違います'},401,cors)}
await env.KISS_DATA.delete(key);
if(!Array.isArray(data.names)||!data.names.length||data.names.length>20||data.names.some(n=>typeof n!=='string'||!n.trim()||n.length>40))return response({error:'キャスト名を確認してください'},400,cors);
const groupId=await env.KISS_DATA.get('groupId');
if(!groupId)return response({error:'LINEグループが未登録です'},409,cors);
const names=[...new Set(data.names.map(n=>n.trim()))];
const message='📸 CLUB KISS 写真指名通知\\n\\n写真指名が確定しました。\\n\\n【指名キャスト】\\n'+names.map(n=>'・'+n).join('\\n')+'\\n\\nキャストの皆さん、ご対応をお願いします。';
const line=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{'authorization':'Bearer '+env.LINE_CHANNEL_ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify({to:groupId,messages:[{type:'text',text:message}]})});
if(!line.ok)return response({error:'LINE通知に失敗しました'},502,cors);
return response({ok:true},200,cors);
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