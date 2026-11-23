const page = `<!doctype html><html lang="ja"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>CLUB KISS 新規来店</title><style>body{margin:0;background:#111;color:#eee;font-family:-apple-system,sans-serif}main{max-width:420px;margin:12vh auto;padding:24px;text-align:center}h1{color:#d6b66d;letter-spacing:3px}input,select,button{box-sizing:border-box;width:100%;padding:17px;margin:10px 0;border-radius:10px;font-size:19px}input,select{background:#222;color:white;border:1px solid #777}button{background:#d6b66d;border:0;color:#111;font-weight:bold}small{color:#aaa}#send{display:none}#msg{min-height:2em}</style><main><h1>CLUB KISS</h1><p>新規来店通知システム</p><section id="login"><input id="pin" type="password" inputmode="numeric" maxlength="4" placeholder="4桁のパスワード"><button onclick="login()">ログイン</button></section><section id="send"><p>新規来店人数</p><select id="count"><option value="1">新規1名</option><option value="2">新規2名</option><option value="3">新規3名</option><option value="4">新規4名</option><option value="5">新規5名</option></select><button id="btn" onclick="send()">🔔 LINEに通知する</button><button onclick="logout()" style="background:#333;color:#eee">ログアウト</button></section><p id="msg"></p><small>スタッフ専用</small></main><script>const m=document.getElementById('msg');async function api(path,body){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});let j=await r.json();if(!r.ok)throw Error(j.error||'エラー');return j}async function login(){try{await api('/login',{pin:document.getElementById('pin').value});document.getElementById('login').style.display='none';document.getElementById('send').style.display='block';m.textContent=''}catch(e){m.textContent=e.message}}async function send(){const n=Number(document.getElementById('count').value);if(!confirm('新規'+n+'名の来店をLINEに通知しますか？'))return;const b=document.getElementById('btn');b.disabled=true;try{await api('/send',{count:n});m.textContent='LINEに通知しました'}catch(e){m.textContent=e.message}finally{b.disabled=false}}async function logout(){await api('/logout',{});location.reload()}fetch('/session').then(r=>r.json()).then(j=>{if(j.ok){document.getElementById('login').style.display='none';document.getElementById('send').style.display='block'}})</script></html>`;
const enc=new TextEncoder();
function hex(a){return [...new Uint8Array(a)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function mac(secret,data){const k=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',k,enc.encode(data)))}
function response(obj,status=200,headers={}){return new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store',...headers}})}
function cookie(req){return (req.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('kiss_session='))?.slice(13)||''}
async function valid(req,env){const [exp,sig]=cookie(req).split('.');if(!exp||!sig||!/^\d+$/.test(exp)||Number(exp)<Date.now())return false;return (await mac(env.STAFF_PIN,exp))===sig}


const PUSH_PUBLIC_KEY='BG-HVtZNfdgnE0VklL0DeHfYvAJBac4cBRHVT9F5cm_ANb5H7QdjJdpbQE7nHVBFmW3OmunisUBfNrVOLQvSAQA';
const pushEnc=new TextEncoder();
function pushB64(bytes){let str='';for(const b of bytes)str+=String.fromCharCode(b);return btoa(str).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')}
function pushBytes(str){const bin=atob(str.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-str.length%4)%4));return Uint8Array.from(bin,c=>c.charCodeAt(0))}
function pushConcat(...arrays){const result=new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));let at=0;for(const a of arrays){result.set(a,at);at+=a.length}return result}
async function pushHmac(key,data){const k=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',k,data))}
async function pushExpand(prk,info,length){let output=new Uint8Array(0),prev=new Uint8Array(0),counter=1;while(output.length<length){prev=await pushHmac(prk,pushConcat(prev,info,new Uint8Array([counter++])));output=pushConcat(output,prev)}return output.slice(0,length)}
async function pushPayload(subscription,content){const client=pushBytes(subscription.keys.p256dh),auth=pushBytes(subscription.keys.auth),salt=crypto.getRandomValues(new Uint8Array(16));const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);const server=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey));const clientKey=await crypto.subtle.importKey('raw',client,{name:'ECDH',namedCurve:'P-256'},false,[]);const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:clientKey},pair.privateKey,256));const authPrk=await pushHmac(auth,shared);const ikm=await pushExpand(authPrk,pushConcat(pushEnc.encode('WebPush: info'),new Uint8Array([0]),client,server),32);const prk=await pushHmac(salt,ikm);const cek=await pushExpand(prk,pushEnc.encode('Content-Encoding: aes128gcm\0'),16);const nonce=await pushExpand(prk,pushEnc.encode('Content-Encoding: nonce\0'),12);const key=await crypto.subtle.importKey('raw',cek,{name:'AES-GCM'},false,['encrypt']);const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},key,pushConcat(pushEnc.encode(JSON.stringify(content)),new Uint8Array([2]))));return pushConcat(salt,new Uint8Array([0,0,16,0,server.length]),server,encrypted)}
async function pushVapid(endpoint,privateKey){const raw=pushBytes(privateKey);if(raw.length!==32)throw Error('Invalid VAPID private key');const pub=pushBytes(PUSH_PUBLIC_KEY);const key=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:pushB64(pub.slice(1,33)),y:pushB64(pub.slice(33,65)),d:pushB64(raw),ext:true}, {name:'ECDSA',namedCurve:'P-256'},false,['sign']);const audience=new URL(endpoint).origin;const head=pushB64(pushEnc.encode(JSON.stringify({typ:'JWT',alg:'ES256'})));const body=pushB64(pushEnc.encode(JSON.stringify({aud:audience,exp:Math.floor(Date.now()/1000)+3600,sub:'mailto:clubkiss-notify@example.com'})));const input=head+'.'+body;const sig=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,pushEnc.encode(input)));return input+'.'+pushB64(sig)}
async function sendOrderPush(env,item){if(!env.PUSH_VAPID_PRIVATE_KEY)return;const raw=await env.KISS_DATA.get('photo:push:owner');if(!raw)return;const sub=JSON.parse(raw);try{const endpoint=new URL(sub.endpoint);if(endpoint.protocol!=='https:'||!['web.push.apple.com','fcm.googleapis.com','updates.push.services.mozilla.com'].some(h=>endpoint.hostname===h||endpoint.hostname.endsWith('.'+h)))throw Error('Invalid push endpoint');const body=await pushPayload(sub,{title:'🔔 CLUB KISS '+item.type,body:item.type==='新規接客時間終了'?item.table+'卓 新規接客時間終了\n送り確認をお願いします':item.table+'卓｜'+item.castName+(item.can?'｜'+item.can+' ×'+item.quantity:''),url:'./notify.html?order='+encodeURIComponent(item.id),id:item.id});const token=await pushVapid(sub.endpoint,env.PUSH_VAPID_PRIVATE_KEY);const r=await fetch(sub.endpoint,{method:'POST',headers:{'TTL':'86400','Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream','Authorization':'vapid t='+token+', k='+PUSH_PUBLIC_KEY},body});if(r.status===404||r.status===410)await env.KISS_DATA.delete('photo:push:owner');if(!r.ok)console.error('push delivery failed',r.status)}catch(e){console.error('push error',String(e).slice(0,200))}}

const photoCors={'access-control-allow-origin':'https://kurousagiseira-beep.github.io','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'Content-Type','vary':'Origin'};
function photoResponse(obj,status=200){return response(obj,status,photoCors)}
function photoClock(m){return String(Math.floor(m/60)%24).padStart(2,'0')+':'+String(m%60).padStart(2,'0')}
function makePhotoSchedule(item,casts,previous,sales={},rankOrder=[]){
 const jp=new Date(item.time+9*3600000);
 const day=jp.toISOString().slice(0,10);
 let minute=jp.getUTCHours()*60+jp.getUTCMinutes()+3+(jp.getUTCSeconds()>0?1:0);
 const sameDay=previous.filter(r=>r.schedule?.length&&new Date(r.time+9*3600000).toISOString().slice(0,10)===day);
 for(const r of sameDay){const end=r.schedule.reduce((m,x)=>Math.max(m,Number(x.endMinute)||0),0);minute=Math.max(minute,end)}
 const chosen=new Set(item.ids.map(String));
 const registered=casts.filter(c=>c.name&&String(c.name).trim()&&c.attending!==false);
 const priority=registered.filter(c=>chosen.has(String(c.id)));
 const others=registered.filter(c=>!chosen.has(String(c.id))).sort((a,b)=>{const ai=rankOrder.indexOf(String(a.id)),bi=rankOrder.indexOf(String(b.id));if(ai>=0&&bi>=0)return bi-ai;if(ai>=0)return 1;if(bi>=0)return -1;return (Number(sales[String(a.id)])||0)-(Number(sales[String(b.id)])||0)||String(a.name).localeCompare(String(b.name),'ja')});
 const groups=[];
 for(let i=0;i<others.length;i+=2)groups.push(others.slice(i,i+2));
 for(const c of priority)groups.push([c]);
 if(!groups.length)return [];
 // 全グループ同一持ち時間。合計60分を超えない最大の整数分数を使う。
 // 60グループ超の場合は1分枠でも収まらないため、先頭60グループに限定する。
 if(groups.length>60)groups.length=60;
 const slotMinutes=Math.max(1,Math.floor(60/groups.length));
 const durations=groups.map(()=>slotMinutes);
 const schedule=[];
 groups.forEach((group,i)=>{const startMinute=minute;minute+=durations[i];for(const c of group)schedule.push({name:c.name,start:photoClock(startMinute),end:photoClock(minute),startMinute,endMinute:minute,priority:chosen.has(String(c.id)),duration:durations[i]})});
 return schedule;
}
function photoBusinessDay(now=Date.now()){return new Date(now+9*3600000-5*3600000).toISOString().slice(0,10)}
async function readAttendance(env,day,casts){
 const key='photo:attendance:'+day;
 const state=JSON.parse(await env.KISS_DATA.get(key)||'{}');
 const migrationKey='photo:shuu-default-fix-v1';
 if(!(await env.KISS_DATA.get(migrationKey))){
  const shuu=casts.filter(c=>['しゅう','シュウ','SHU','Shu'].includes(String(c.name||'').trim()));
  let changed=false;
  for(const c of shuu){if(state[String(c.id)]===false){delete state[String(c.id)];changed=true}}
  if(changed)await env.KISS_DATA.put(key,JSON.stringify(state),{expirationTtl:172800});
  await env.KISS_DATA.put(migrationKey,'done');
 }
 return Object.fromEntries(casts.map(c=>[String(c.id),state[String(c.id)]!==false]));
}
const DEFAULT_PHOTO_TABLES=['2','3','4','5','6','7','8','9','VIP1','VIP2','VIP3'];
async function photoTableList(env){const stored=JSON.parse(await env.KISS_DATA.get('photo:table-config')||'null');return Array.isArray(stored)&&stored.length?stored:DEFAULT_PHOTO_TABLES}
function validPhotoTable(t){return /^(?:[1-9][0-9]{0,2}|VIP[1-9][0-9]{0,2})$/.test(t)}
async function photoTableAllowed(env,t){return validPhotoTable(t)&&(await photoTableList(env)).includes(t)}
async function readPhotoRequests(env){return JSON.parse(await env.KISS_DATA.get('photo:requests')||'[]')}

async function sendFinishedPhotoSchedules(env,now=Date.now()){
 const requests=await readPhotoRequests(env);
 const due=[];
 for(const r of requests){
  if(r.status==='cancel'||!Array.isArray(r.schedule)||!r.schedule.length)continue;
  const end=Math.max(...r.schedule.map(x=>Number(x.endMinute)));
  if(!Number.isFinite(end))continue;
  const jstDay=new Date(r.time+9*3600000).toISOString().slice(0,10);
  const endAt=Date.parse(jstDay+'T00:00:00Z')-9*3600000+end*60000;
  if(endAt<=now&&endAt>=now-24*3600000)due.push({request:r,endAt});
 }
 if(!due.length)return;
 const key='photo:notifications';
 const notifications=JSON.parse(await env.KISS_DATA.get(key)||'[]');
 const pushed=[];
 for(const {request:r,endAt} of due){
  const id='finish:'+r.id;
  if(notifications.some(x=>x.id===id))continue;
  const notice={id,type:'新規接客時間終了',table:r.table,castName:'送り確認をお願いします',time:endAt,ackAt:null,sourceRequestId:r.id};
  notifications.push(notice);pushed.push(notice);
 }
 if(!pushed.length)return;
 await env.KISS_DATA.put(key,JSON.stringify(notifications.slice(-300)));
 await Promise.allSettled(pushed.map(x=>sendOrderPush(env,x)));
}
export default {async scheduled(event,env,ctx){ctx.waitUntil(sendFinishedPhotoSchedules(env,event.scheduledTime||Date.now()))},async fetch(req,env,ctx){
const url=new URL(req.url),path=url.pathname;
if(path==='/')return new Response(page,{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});

if(path.startsWith('/photo/')){
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:photoCors});
 if(req.headers.get('origin')&&req.headers.get('origin')!=='https://kurousagiseira-beep.github.io')return photoResponse({error:'許可されていません'},403);
 if(path==='/photo/casts'&&req.method==='GET'){
  const casts=JSON.parse(await env.KISS_DATA.get('photo:casts')||'[]');
  const today=photoBusinessDay();
  const attendance=await readAttendance(env,today,casts);
  const sales=JSON.parse(await env.KISS_DATA.get('photo:previous-sales')||'{}');
  const savedOrder=JSON.parse(await env.KISS_DATA.get('photo:previous-rank-order')||'[]');
  const ranked=savedOrder.length?savedOrder.map(id=>casts.find(c=>String(c.id)===String(id))).filter(c=>c&&c.active!==false):casts.filter(c=>c.active!==false&&Object.prototype.hasOwnProperty.call(sales,String(c.id))).sort((a,b)=>Number(sales[String(b.id)])-Number(sales[String(a.id)])||String(a.name).localeCompare(String(b.name),'ja'));
  const autoRank=new Map(ranked.slice(0,3).map((c,i)=>[String(c.id),i+1]));
  const visibleCasts=casts.map(c=>({...c,displayNo:c.noOverride===0?null:Number.isInteger(c.noOverride)&&c.noOverride>=1&&c.noOverride<=3?c.noOverride:(autoRank.get(String(c.id))||null)}));
  return photoResponse({casts:visibleCasts,attendance,date:today,featureVersion:'rank-order-v2',rankConfigured:savedOrder.length>0});
 }
 if(path==='/photo/publish'&&req.method==='POST'){
  const data=await req.json().catch(()=>({}));
  if(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN)return photoResponse({error:'スタッフPINが違います'},401);
  if(!Array.isArray(data.casts)||data.casts.length>100)return photoResponse({error:'登録内容が不正です'},400);
  const casts=data.casts.map(c=>({id:String(c.id),name:String(c.name||'').slice(0,60),bio:String(c.bio||'').slice(0,500),birthday:/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(String(c.birthday||''))?String(c.birthday):'',active:c.active!==false,role:c.role==='officer'?'officer':'general',noOverride:c.noOverride===0?0:[1,2,3].includes(Number(c.noOverride))?Number(c.noOverride):null,photos:Array.isArray(c.photos)?c.photos.filter(p=>typeof p==='string'&&p.startsWith('data:image/')).slice(0,10):[]}));
  if(casts.some(c=>!c.name))return photoResponse({error:'キャスト名を確認してください'},400);
  try{await env.KISS_DATA.put('photo:casts',JSON.stringify(casts))}catch{return photoResponse({error:'写真の容量が大きすぎます。枚数を減らしてください'},413)}
  return photoResponse({ok:true,count:casts.length});
 }
 if(path==='/photo/attendance'&&req.method==='POST'){
  const data=await req.json().catch(()=>({}));
  if(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN)return photoResponse({error:'スタッフPINが違います'},401);
  const today=photoBusinessDay();
  const key='photo:attendance:'+today;
  const casts=JSON.parse(await env.KISS_DATA.get('photo:casts')||'[]');
  const state=await readAttendance(env,today,casts);
  if(Array.isArray(data.updates)){
   if(data.updates.length>100||data.updates.some(x=>!casts.some(c=>c.id===String(x.id))||typeof x.attending!=='boolean'))return photoResponse({error:'出勤設定が不正です'},400);
   for(const x of data.updates)state[String(x.id)]=x.attending;
   await env.KISS_DATA.put(key,JSON.stringify(state),{expirationTtl:172800});
  }
  if(data.id!==undefined){
   const id=String(data.id);
   if(!casts.some(c=>c.id===id))return photoResponse({error:'キャストが見つかりません'},404);
   if(typeof data.attending!=='boolean')return photoResponse({error:'出勤状況が不正です'},400);
   state[id]=data.attending;
   await env.KISS_DATA.put(key,JSON.stringify(state),{expirationTtl:172800});
  }
  return photoResponse({date:today,attendance:state});
 }
 if(path==='/photo/table-config'&&req.method==='GET'){return photoResponse({tables:await photoTableList(env)})}
 if(path==='/photo/table-config'&&req.method==='POST'){
  const data=await req.json().catch(()=>({}));
  if(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN)return photoResponse({error:'スタッフPINが違います'},401);
  const tables=Array.isArray(data.tables)?data.tables.map(x=>String(x).trim().toUpperCase()):[];
  if(!tables.length||tables.length>80||new Set(tables).size!==tables.length||tables.some(t=>!validPhotoTable(t)))return photoResponse({error:'席番号が不正です。1〜999卓またはVIP1〜VIP999で重複なく登録してください'},400);
  const old=await photoTableList(env),removed=old.filter(t=>!tables.includes(t));
  if(removed.length){const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10),requests=await readPhotoRequests(env);const active=requests.filter(r=>r.status!=='cancel'&&new Date(r.time+9*3600000).toISOString().slice(0,10)===day&&removed.includes(String(r.table)));if(active.length)return photoResponse({error:'本日受付済みの席（'+[...new Set(active.map(r=>r.table))].join('・')+'）は削除・変更できません。先に受付内容を修正してください'},409)}
  await env.KISS_DATA.put('photo:table-config',JSON.stringify(tables));return photoResponse({ok:true,tables});
 }
 if(path==='/photo/table-details'&&req.method==='POST'){
  const data=await req.json().catch(()=>({}));
  if(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN)return photoResponse({error:'スタッフPINが違います'},401);
  const tables=await photoTableList(env),day=new Date(Date.now()+9*3600000).toISOString().slice(0,10),list=await readPhotoRequests(env);
  const closed=await Promise.all(tables.map(t=>env.KISS_DATA.get('photo:closed:'+day+':'+t)));
  const manual=JSON.parse(await env.KISS_DATA.get('photo:table-manual:'+day)||'{}');
  return photoResponse({tables:tables.map((table,i)=>{const latest=list.filter(r=>String(r.table)===table&&r.status!=='cancel'&&new Date(r.time+9*3600000).toISOString().slice(0,10)===day).sort((a,b)=>b.time-a.time)[0];const occupied=!!latest&&(!closed[i]||Number(closed[i])<latest.time);return {table,occupied:manual[table]?.occupied??occupied,partySize:manual[table]?.partySize??latest?.partySize??null,castNames:manual[table]?.castNames??latest?.names??[],note:manual[table]?.note??'',manual:!!manual[table]}})});
 }
 if(path==='/photo/table-details-update'&&req.method==='POST'){
  const data=await req.json().catch(()=>({}));
  if(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN)return photoResponse({error:'スタッフPINが違います'},401);
  const table=String(data.table||'').trim().toUpperCase();if(!(await photoTableAllowed(env,table)))return photoResponse({error:'登録されていない席です'},400);
  const partySize=Number(data.partySize);if(!Number.isInteger(partySize)||partySize<0||partySize>20)return photoResponse({error:'人数は0〜20名にしてください'},400);
  const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10),key='photo:table-manual:'+day,manual=JSON.parse(await env.KISS_DATA.get(key)||'{}');
  manual[table]={occupied:data.occupied===true,partySize,castNames:String(data.castNames||'').slice(0,200).split(/[・,、]/).map(x=>x.trim()).filter(Boolean),note:String(data.note||'').slice(0,300),updatedAt:Date.now()};
  await env.KISS_DATA.put(key,JSON.stringify(manual),{expirationTtl:172800});return photoResponse({ok:true,detail:manual[table]});
 }
 if(path==='/photo/table-status'&&req.method==='GET'){
  const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const tables=await photoTableList(env);
  const list=await readPhotoRequests(env);
  const closed=await Promise.all(tables.map(t=>env.KISS_DATA.get('photo:closed:'+day+':'+t)));
  const manual=JSON.parse(await env.KISS_DATA.get('photo:table-manual:'+day)||'{}');
  return photoResponse({tables:Object.fromEntries(tables.map((t,i)=>{
    const latest=list.filter(r=>String(r.table)===t&&r.status!=='cancel'&&new Date(r.time+9*3600000).toISOString().slice(0,10)===day).sort((a,b)=>b.time-a.time)[0];
    return [t,manual[t]?.occupied??(!!latest&&(!closed[i]||Number(closed[i])<latest.time))];
  }))});
 }
 if(path==='/photo/table-close'&&req.method==='POST'){
  const data=await req.json().catch(()=>({})),table=String(data.table||'');
  if(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN)return photoResponse({error:'スタッフPINが違います'},401);
  if(!(await photoTableAllowed(env,table)))return photoResponse({error:'卓番号が不正です'},400);
  const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  await env.KISS_DATA.put('photo:closed:'+day+':'+table,String(Date.now()),{expirationTtl:86400});
  return photoResponse({ok:true});
 }
 if(path==='/photo/shared-reset'&&req.method==='POST'){
  const data=await req.json().catch(()=>({}));
  if(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN)return photoResponse({error:'スタッフPINが違います'},401);
  const table=String(data.table||'').trim();
  if(!(await photoTableAllowed(env,table)))return photoResponse({error:'卓番号が不正です'},400);
  const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const key='photo:shared:'+day+':'+table;
  const current=JSON.parse(await env.KISS_DATA.get(key)||'null');
  const partySize=Number(data.partySize||current?.partySize||1);
  if(!Number.isInteger(partySize)||partySize<1||partySize>20)return photoResponse({error:'人数が不正です'},400);
  const state={table,partySize,guestSelections:Array.from({length:partySize},()=>[]),revision:(current?.revision||0)+1,updatedAt:Date.now()};
  await env.KISS_DATA.put(key,JSON.stringify(state),{expirationTtl:86400});
  return photoResponse({ok:true,state});
 }
 if(path==='/photo/shared'&&(req.method==='GET'||req.method==='POST')){
  const data=req.method==='POST'?await req.json().catch(()=>({})):{table:url.searchParams.get('table')};
  const table=String(data.table||'').trim();
  if(!(await photoTableAllowed(env,table)))return photoResponse({error:'卓番号が不正です'},400);
  const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10),key='photo:shared:'+day+':'+table;
  const list=await readPhotoRequests(env);
  if(list.some(r=>String(r.table)===table&&r.status!=='cancel'&&new Date(r.time+9*3600000).toISOString().slice(0,10)===day))return photoResponse({error:'この卓の受付は確定済みです',completed:true},409);
  let state=JSON.parse(await env.KISS_DATA.get(key)||'null');
  if(req.method==='GET')return photoResponse({state:state||null});
  if(data.action==='init'){
    const count=Number(data.partySize);
    if(!Number.isInteger(count)||count<1||count>20)return photoResponse({error:'人数は1〜20名にしてください'},400);
    if(!state||data.fresh===true){state={table,partySize:count,guestSelections:Array.from({length:count},()=>[]),revision:(state?.revision||0)+1,updatedAt:Date.now()};await env.KISS_DATA.put(key,JSON.stringify(state),{expirationTtl:86400})}
    return photoResponse({state});
  }
  if(!state)return photoResponse({error:'卓の共有データがありません。人数を選んで開始してください'},404);
  if(data.action==='select'){
    const index=Number(data.index),ids=Array.isArray(data.ids)?[...new Set(data.ids.map(String))]:[];
    if(!Number.isInteger(index)||index<0||index>=state.partySize||ids.length>3)return photoResponse({error:'選択内容が不正です'},400);
    if(Number(data.revision)!==state.revision)return photoResponse({error:'別の端末で変更されました。最新の内容を読み込みました',state,conflict:true},409);
    const casts=JSON.parse(await env.KISS_DATA.get('photo:casts')||'[]');
    if(ids.some(id=>!casts.some(c=>String(c.id)===id&&c.active!==false)))return photoResponse({error:'選択したキャストが見つかりません'},400);
    const next=state.guestSelections.map((v,i)=>i===index?ids:v);
    if(new Set(next.flat()).size>3)return photoResponse({error:'同じ卓で指名できるキャストは合計3名までです',state},400);
    state.guestSelections=next;state.revision++;state.updatedAt=Date.now();
    await env.KISS_DATA.put(key,JSON.stringify(state),{expirationTtl:86400});
    return photoResponse({state});
  }
  return photoResponse({error:'操作が不正です'},400);
 }
 if(path==='/photo/table-check'&&req.method==='GET'){
  const table=String(url.searchParams.get('table')||'').trim();
  if(!(await photoTableAllowed(env,table)))return photoResponse({error:'卓番号を確認してください'},400);
  const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const list=await readPhotoRequests(env);
  const active=list.find(r=>String(r.table)===table&&r.status!=='cancel'&&new Date(r.time+9*3600000).toISOString().slice(0,10)===day);
  return photoResponse({occupied:!!active,table});
 }
 if(path==='/photo/special-history'&&req.method==='POST'){
  const data=await req.json().catch(()=>({}));
  if(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN)return photoResponse({error:'スタッフPINが違います'},401);
  const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const history=JSON.parse(await env.KISS_DATA.get('photo:special:history')||'[]');
  return photoResponse({history:history.filter(x=>new Date(x.time+9*3600000).toISOString().slice(0,10)===day).slice(-100)});
 }
 if(path==='/photo/special-notify'&&req.method==='POST'){
  const data=await req.json().catch(()=>({}));
  if(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN)return photoResponse({error:'スタッフPINが違います'},401);
  const table=String(data.table||''),kind=String(data.kind||''),castId=String(data.castId||'');
  if(!(await photoTableAllowed(env,table)))return photoResponse({error:'卓番号を選択してください'},400);
  if(!['送り指名','飲み直し'].includes(kind))return photoResponse({error:'通知の種類を選択してください'},400);
  const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const list=await readPhotoRequests(env);
  const latest=list.filter(r=>String(r.table)===table&&r.status!=='cancel'&&new Date(r.time+9*3600000).toISOString().slice(0,10)===day).sort((a,b)=>b.time-a.time)[0];
  const closed=Number(await env.KISS_DATA.get('photo:closed:'+day+':'+table)||0);
  if(!latest||closed>=latest.time)return photoResponse({error:'この席は新規受付中ではありません'},409);
  const casts=JSON.parse(await env.KISS_DATA.get('photo:casts')||'[]');
  const cast=casts.find(c=>String(c.id)===castId&&c.active!==false);
  if(!cast)return photoResponse({error:'キャストを選択してください'},400);
  const groupId=await env.KISS_DATA.get('groupId');
  if(!groupId)return photoResponse({error:'LINEグループが未登録です'},409);
  const historyKey='photo:special:history',history=JSON.parse(await env.KISS_DATA.get(historyKey)||'[]');
  const correctionId=String(data.correctionId||'');
  const previous=correctionId?history.find(x=>x.id===correctionId&&x.table===table):null;
  if(correctionId&&(!previous||previous.correctedBy))return photoResponse({error:'変更元の通知が見つからないか、すでに変更されています。履歴を更新してください'},409);
  if(previous&&previous.kind===kind&&previous.castId===castId)return photoResponse({error:'変更前と同じ内容です'},400);
  const message=previous?['🔄 CLUB KISS｜送り・飲み直し【変更通知】','卓番号：'+(table.startsWith('VIP')?table:table+'卓'),'変更前：'+previous.castName+'／'+previous.kind,'変更後：'+cast.name+'／'+kind,'※前の通知は変更されました。最新の内容を優先してください'].join('\\n'):['🔔 CLUB KISS｜'+kind+'通知','卓番号：'+(table.startsWith('VIP')?table:table+'卓'),'指名キャスト：'+cast.name,'内容：'+kind].join('\n');
  const line=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{authorization:'Bearer '+env.LINE_CHANNEL_ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify({to:groupId,messages:[{type:'text',text:message}]})});
  if(!line.ok)return photoResponse({error:'LINE通知に失敗しました。再送前にLINEを確認してください'},502);
  const now=Date.now(),id=crypto.randomUUID();
  if(previous)previous.correctedBy=id;
  history.push({id,table,kind,castId,castName:cast.name,time:now,correctionOf:previous?.id||null});
  await env.KISS_DATA.put(historyKey,JSON.stringify(history.slice(-200)));
  return photoResponse({ok:true,id,table,kind,castName:cast.name,corrected:!!previous});
 }
 if(path==='/photo/push-key'&&req.method==='GET')return photoResponse({publicKey:PUSH_PUBLIC_KEY,configured:!!env.PUSH_VAPID_PRIVATE_KEY});
 if(path==='/photo/push-subscribe'&&req.method==='POST'){
  const data=await req.json().catch(()=>({}));
  if(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN)return photoResponse({error:'スタッフPINが違います'},401);
  if(!env.PUSH_VAPID_PRIVATE_KEY)return photoResponse({error:'CloudflareにPUSH_VAPID_PRIVATE_KEYを設定してください'},503);
  const sub=data.subscription;
  if(!sub||typeof sub.endpoint!=='string'||!sub.keys||typeof sub.keys.p256dh!=='string'||typeof sub.keys.auth!=='string')return photoResponse({error:'通知登録データが不正です'},400);
  try{const url=new URL(sub.endpoint);if(url.protocol!=='https:'||!['web.push.apple.com','fcm.googleapis.com','updates.push.services.mozilla.com'].some(h=>url.hostname===h||url.hostname.endsWith('.'+h)))throw Error('Invalid endpoint')}catch(e){return photoResponse({error:'通知先が不正です'},400)}
  await env.KISS_DATA.put('photo:push:owner',JSON.stringify({endpoint:sub.endpoint,keys:{p256dh:sub.keys.p256dh,auth:sub.keys.auth}}));
  return photoResponse({ok:true});
 }
 if(path==='/photo/notifications'&&req.method==='POST'){
  const data=await req.json().catch(()=>({}));
  if(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN)return photoResponse({error:'スタッフPINが違います'},401);
  const key='photo:notifications',items=JSON.parse(await env.KISS_DATA.get(key)||'[]');
  if(data.action==='delete'){
   const id=String(data.id||'');
   const index=items.findIndex(x=>x.id===id);
   if(index<0)return photoResponse({error:'通知が見つかりません'},404);
   items.splice(index,1);
   await env.KISS_DATA.put(key,JSON.stringify(items));
   return photoResponse({ok:true});
  }
  if(data.action==='ack'){
   const item=items.find(x=>x.id===String(data.id||''));
   if(!item)return photoResponse({error:'通知が見つかりません'},404);
   if(!item.ackAt){item.ackAt=Date.now();await env.KISS_DATA.put(key,JSON.stringify(items));}
   return photoResponse({ok:true});
  }
  return photoResponse({notifications:items.slice(-100).reverse()});
 }
 if(path==='/photo/named-entry'&&req.method==='POST'){
  const data=await req.json().catch(()=>({}));
  const table=String(data.table||'').trim(),castId=String(data.castId||''),can=String(data.can||''),plan=String(data.plan||'');
  const allowedCans=['瓶ビール','スラットピーチ','スラットシャルドネ','スラットアロエ','スラットレモン','オレンジジュース','アップルジュース','パイナップルジュース','コーラ','レッドブル'];
  if(!(await photoTableAllowed(env,table)))return photoResponse({error:'卓番号が不正です'},400);
  if(plan!=='2時間飲み放題'||!allowedCans.includes(can))return photoResponse({error:'飲み放題プラン・缶ものを選び直してください'},400);
  const casts=JSON.parse(await env.KISS_DATA.get('photo:casts')||'[]');
  const cast=casts.find(c=>String(c.id)===castId&&c.active!==false);
  if(!cast)return photoResponse({error:'指名キャストが見つかりません'},400);
  const day=photoBusinessDay();
  const attendance=await readAttendance(env,day,casts);
  if(attendance[castId]===false)return photoResponse({error:'お休みのキャストは選べません'},409);
  const ip=req.headers.get('cf-connecting-ip')||'unknown',rateKey='photo:named:rate:'+ip;
  const rate=Number(await env.KISS_DATA.get(rateKey)||0);
  if(rate>=8)return photoResponse({error:'送信回数が多すぎます。しばらくお待ちください'},429);
  const historyKey='photo:named:history:'+day;
  const history=JSON.parse(await env.KISS_DATA.get(historyKey)||'[]');
  if(history.some(x=>x.table===table))return photoResponse({error:'この卓は本日すでに新規指名を受付済みです。スタッフに確認してください'},409);
  const existing=await readPhotoRequests(env);
  if(existing.some(x=>String(x.table)===table&&x.status!=='cancel'&&new Date(x.time+9*3600000).toISOString().slice(0,10)===day))return photoResponse({error:'この卓は本日すでに受付済みです'},409);
  const softDrinks=['オレンジジュース','アップルジュース','パイナップルジュース','コーラ','レッドブル'];
  const quantity=softDrinks.includes(can)?1:2;
  const id=crypto.randomUUID(),time=Date.now();
  const notification={id,type:'新規指名',table,castName:cast.name,plan,can,quantity,time,ackAt:null};
  const key='photo:notifications',notifications=JSON.parse(await env.KISS_DATA.get(key)||'[]');
  notifications.push(notification);
  await env.KISS_DATA.put(key,JSON.stringify(notifications.slice(-300)));
  ctx.waitUntil(sendOrderPush(env,notification));
  history.push({id,table,castId,castName:cast.name,can,plan,time});
  await env.KISS_DATA.put(historyKey,JSON.stringify(history.slice(-100)),{expirationTtl:172800});
  await env.KISS_DATA.put(rateKey,String(rate+1),{expirationTtl:900});
  return photoResponse({ok:true,table,castName:cast.name,can,quantity});
 }
 if(path==='/photo/submit'&&req.method==='POST'){
  const ip=req.headers.get('cf-connecting-ip')||'unknown',key='photo:rate:'+ip;
  const n=Number(await env.KISS_DATA.get(key)||0);
  if(n>=12)return photoResponse({error:'送信回数が多すぎます。しばらくお待ちください'},429);
  const data=await req.json().catch(()=>({}));
  const table=String(data.table||'').trim();
  if(!(await photoTableAllowed(env,table)))return photoResponse({error:'卓番号を入力してください'},400);
  const partySize=Number(data.partySize||1);
  if(!Number.isInteger(partySize)||partySize<1||partySize>20)return photoResponse({error:'お客様の人数を確認してください'},400);
  const sharedKey='photo:shared:'+new Date(Date.now()+9*3600000).toISOString().slice(0,10)+':'+table;
  const shared=JSON.parse(await env.KISS_DATA.get(sharedKey)||'null');
  if(!shared||shared.partySize!==partySize||Number(data.revision)!==shared.revision)return photoResponse({error:'共有データが更新されています。画面を更新して確認してください'},409);
  const guestSelections=shared.guestSelections;
  if(!Array.isArray(guestSelections)||guestSelections.length!==partySize||guestSelections.some(ids=>!Array.isArray(ids)||ids.length<1||ids.length>3))return photoResponse({error:'全員分の写真指名を確認してください（1人最大3人）'},400);
  const groupIds=guestSelections.map(ids=>[...new Set(ids.map(String))]);
  if(new Set(groupIds.flat()).size>3)return photoResponse({error:'写真指名は1組につき最大3名までです'},400);
  if(!Array.isArray(data.ids)||new Set(data.ids.map(String)).size!==new Set(groupIds.flat()).size||groupIds.flat().some(id=>!data.ids.map(String).includes(id)))return photoResponse({error:'指名内容が一致しません'},400);
  const casts=JSON.parse(await env.KISS_DATA.get('photo:casts')||'[]');
  const ids=[...new Set(data.ids.map(String))];
  if(ids.some(id=>!casts.some(c=>c.id===id&&c.active)))return photoResponse({error:'選択したキャストが見つかりません。画面を更新してください'},400);
  const today=photoBusinessDay();
  const attendance=await readAttendance(env,today,casts);
  if(ids.some(id=>attendance[id]===false))return photoResponse({error:'休みのキャストは写真指名できません。画面を更新してください'},409);
  const item={id:crypto.randomUUID(),ids,names:ids.map(id=>casts.find(c=>c.id===id).name),table,partySize,guestSelections:groupIds,status:'pending',time:Date.now()};
  const list=await readPhotoRequests(env);
  if(list.some(r=>String(r.table)===table&&r.status!=='cancel'&&new Date(r.time+9*3600000).toISOString().slice(0,10)===today))return photoResponse({error:table+'は本日すでに受付済みです。スタッフに確認してください'},409);
  const sales=JSON.parse(await env.KISS_DATA.get('photo:previous-sales')||'{}');
  item.schedule=makePhotoSchedule(item,casts.map(c=>({...c,attending:attendance[String(c.id)]!==false})),list.filter(r=>r.status!=='cancel'),sales,JSON.parse(await env.KISS_DATA.get('photo:previous-rank-order')||'[]'));
  const notifyKey='photo:notifications',notifications=JSON.parse(await env.KISS_DATA.get(notifyKey)||'[]');
  notifications.push({id:item.id,type:'写真指名',table,partySize,castName:item.names.join('・'),schedule:item.schedule,time:item.time,ackAt:null});
  await env.KISS_DATA.put(notifyKey,JSON.stringify(notifications.slice(-300)));
  ctx.waitUntil(sendOrderPush(env,notifications[notifications.length-1]));
  list.push(item);
  await env.KISS_DATA.put('photo:requests',JSON.stringify(list.slice(-200)));
  await env.KISS_DATA.put(key,String(n+1),{expirationTtl:900});
  return photoResponse({ok:true,id:item.id});
 }
 if(path==='/photo/schedule'&&req.method==='POST'){
  const data=await req.json().catch(()=>({}));
  if(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN)return photoResponse({error:'スタッフPINが違います'},401);
  const list=await readPhotoRequests(env),item=list.find(x=>x.id===data.id);
  if(!item||item.status==='cancel')return photoResponse({error:'受付が見つかりません'},404);
  if(!Array.isArray(data.schedule)||data.schedule.length!==(item.schedule||[]).length||data.schedule.length>100)return photoResponse({error:'行数が一致しません'},400);
  const existing=(item.schedule||[]).map(x=>x.name).sort().join('|');
  if(data.schedule.map(x=>String(x.name||'')).sort().join('|')!==existing)return photoResponse({error:'キャスト構成は変更できません'},400);
  const parsed=[];
  for(const x of data.schedule){
   if(!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(x.start)||!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(x.end))return photoResponse({error:'時間はHH:MMで入力してください'},400);
   const old=item.schedule.find(y=>y.name===x.name);
   const startMinute=Number(x.start.slice(0,2))*60+Number(x.start.slice(3));
   let endMinute=Number(x.end.slice(0,2))*60+Number(x.end.slice(3));if(endMinute<=startMinute)endMinute+=1440;
   if(endMinute-startMinute>180)return photoResponse({error:'1枠は180分以内にしてください'},400);
   parsed.push({...old,start:x.start,end:x.end,startMinute,endMinute,duration:endMinute-startMinute});
  }
  item.schedule=parsed;item.scheduleEditedAt=Date.now();
  await env.KISS_DATA.put('photo:requests',JSON.stringify(list));
  return photoResponse({ok:true,schedule:parsed});
 }
 if(path==='/photo/stats'&&req.method==='POST'){
  const data=await req.json().catch(()=>({}));
  if(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN)return photoResponse({error:'スタッフPINが違います'},401);
  const list=await readPhotoRequests(env),today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const month=today.slice(0,7),day={},monthly={};
  for(const r of list){if(r.status==='cancel')continue;const date=new Date(r.time+9*3600000).toISOString().slice(0,10);for(const id of new Set((r.ids||[]).map(String))){const name=(r.names||[])[(r.ids||[]).map(String).indexOf(id)]||id;if(date===today)day[name]=(day[name]||0)+1;if(date.startsWith(month))monthly[name]=(monthly[name]||0)+1}}
  return photoResponse({date:today,month,day,monthly,historyLimit:200});
 }
 if(path==='/photo/previous-sales'&&req.method==='POST'){
  const data=await req.json().catch(()=>({}));
  if(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN)return photoResponse({error:'スタッフPINが違います'},401);
  const previous=new Date(Date.now()+9*3600000);previous.setUTCDate(1);previous.setUTCMonth(previous.getUTCMonth()-1);
  const month=previous.toISOString().slice(0,7);
  if(data.sales!==undefined){
   if(!data.sales||typeof data.sales!=='object'||Array.isArray(data.sales))return photoResponse({error:'売上データが不正です'},400);
   const casts=JSON.parse(await env.KISS_DATA.get('photo:casts')||'[]');
   const allowed=new Set(casts.map(c=>String(c.id)));
   if(Object.keys(data.sales).some(id=>!allowed.has(id)||!Number.isFinite(Number(data.sales[id]))||Number(data.sales[id])<0))return photoResponse({error:'売上の数値を確認してください'},400);
   await env.KISS_DATA.put('photo:previous-sales',JSON.stringify(Object.fromEntries(Object.entries(data.sales).map(([id,n])=>[id,Number(n)]))));
  }
  if(data.rankOrder!==undefined){
   const order=data.rankOrder;
   const casts=JSON.parse(await env.KISS_DATA.get('photo:casts')||'[]');
   const allowed=new Set(casts.map(c=>String(c.id)));
   if(!Array.isArray(order)||order.length>100||new Set(order.map(String)).size!==order.length||order.some(id=>!allowed.has(String(id))))return photoResponse({error:'順位の登録内容が不正です'},400);
   await env.KISS_DATA.put('photo:previous-rank-order',JSON.stringify(order.map(String)));
  }
  return photoResponse({month,sales:JSON.parse(await env.KISS_DATA.get('photo:previous-sales')||'{}'),rankOrder:JSON.parse(await env.KISS_DATA.get('photo:previous-rank-order')||'[]'),featureVersion:'rank-order-v2'});
 }
 if(path==='/photo/all-rankings'&&(req.method==='POST'||req.method==='GET')){
  const data=req.method==='GET'?{month:new URL(req.url).searchParams.get('month')}:await req.json().catch(()=>({}));
  if(req.method==='POST'&&(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN))return photoResponse({error:'スタッフPINが違います'},401);
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const currentMonth=today.slice(0,7);
  const requests=await readPhotoRequests(env),history=JSON.parse(await env.KISS_DATA.get('photo:special:history')||'[]');
  const monthOf=time=>new Date(Number(time)+9*3600000).toISOString().slice(0,7);
  const available=new Set([currentMonth]);
  for(const r of requests)if(r.status!=='cancel'&&Number.isFinite(Number(r.time)))available.add(monthOf(r.time));
  for(const x of history)if(Number.isFinite(Number(x.time)))available.add(monthOf(x.time));
  const months=[...available].sort().reverse();
  const selected=typeof data.month==='string'&&/^\d{4}-\d{2}$/.test(data.month)?data.month:currentMonth;
  if(!months.includes(selected))return photoResponse({error:'この月の集計データはありません',months},404);
  const rankings={photo:{},send:{},drink:{}},totals={photo:0,send:0,drink:0},newGuests={groups:0,people:0};
  const count=(key,name)=>{rankings[key][name]=(rankings[key][name]||0)+1;totals[key]++};
  for(const r of requests){
   if(r.status==='cancel'||monthOf(r.time)!==selected)continue;
   newGuests.groups++;newGuests.people+=Number(r.partySize)||0;
   for(const id of new Set((r.ids||[]).map(String))){
    const name=(r.names||[])[(r.ids||[]).map(String).indexOf(id)]||id;
    count('photo',name);
   }
  }
  for(const x of history){
   if(x.correctedBy||monthOf(x.time)!==selected)continue;
   const key=x.kind==='送り指名'?'send':x.kind==='飲み直し'?'drink':null;
   if(key)count(key,x.castName||String(x.castId));
  }
  return photoResponse({month:selected,months,rankings,totals,newGuests,limitedHistory:true,requestHistoryLimit:200,specialHistoryLimit:200});
 }
 if(path==='/photo/requests'&&req.method==='POST'){
  const data=await req.json().catch(()=>({}));
  if(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN)return photoResponse({error:'スタッフPINが違います'},401);
  return photoResponse({requests:await readPhotoRequests(env)});
 }
 if(path==='/photo/edit'&&req.method==='POST'){
  const data=await req.json().catch(()=>({}));
  if(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN)return photoResponse({error:'スタッフPINが違います'},401);
  const list=await readPhotoRequests(env),item=list.find(r=>r.id===data.id);
  if(!item||item.status==='cancel')return photoResponse({error:'受付が見つかりません'},404);
  const table=String(data.table||'').trim(),partySize=Number(data.partySize);
  if(!(await photoTableAllowed(env,table))||!Number.isInteger(partySize)||partySize<1||partySize>20)return photoResponse({error:'卓番号・人数を確認してください'},400);
  const ids=Array.isArray(data.ids)?[...new Set(data.ids.map(String))]:[];
  if(ids.length<1||ids.length>3)return photoResponse({error:'指名キャストは1〜3名にしてください'},400);
  const casts=JSON.parse(await env.KISS_DATA.get('photo:casts')||'[]');
  if(ids.some(id=>!casts.some(c=>c.id===id&&c.active!==false)))return photoResponse({error:'キャストが見つかりません'},400);
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  if(list.some(r=>r.id!==item.id&&r.status!=='cancel'&&String(r.table)===table&&new Date(r.time+9*3600000).toISOString().slice(0,10)===today))return photoResponse({error:table+'は受付済みです'},409);
  const before={table:item.table,partySize:item.partySize,ids:item.ids,names:item.names};
  item.table=table;item.partySize=partySize;item.ids=ids;item.names=ids.map(id=>casts.find(c=>c.id===id).name);
  item.guestSelections=Array.from({length:partySize},()=>[...ids]);
  item.editHistory=Array.isArray(item.editHistory)?item.editHistory:[];
  item.editHistory.push({time:Date.now(),before,after:{table,partySize,ids,names:item.names}});
  const attendance=await readAttendance(env,today,casts);
  const earlier=list.filter(r=>r.id!==item.id&&r.status!=='cancel'&&r.time<item.time);
  const sales=JSON.parse(await env.KISS_DATA.get('photo:previous-sales')||'{}');
  item.schedule=makePhotoSchedule(item,casts.map(c=>({...c,attending:attendance[c.id]!==false})),earlier,sales,JSON.parse(await env.KISS_DATA.get('photo:previous-rank-order')||'[]'));
  await env.KISS_DATA.put('photo:requests',JSON.stringify(list));
  return photoResponse({ok:true,item});
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
  if(data.status==='cancel'){
   // 受付取消と同時に同卓の写真指名共有状態を未選択へ戻す。
   // revisionを増やし、開いたままの端末にも変更を同期する。
   const day=new Date(item.time+9*3600000).toISOString().slice(0,10);
   const sharedKey='photo:shared:'+day+':'+String(item.table);
   const previous=JSON.parse(await env.KISS_DATA.get(sharedKey)||'null');
   const partySize=Number(previous?.partySize||item.partySize||1);
   const count=Number.isInteger(partySize)&&partySize>=1&&partySize<=20?partySize:1;
   const cleared={table:String(item.table),partySize:count,guestSelections:Array.from({length:count},()=>[]),revision:(Number(previous?.revision)||0)+1,updatedAt:Date.now()};
   await env.KISS_DATA.put(sharedKey,JSON.stringify(cleared),{expirationTtl:86400});
  }
  return photoResponse({ok:true,reset:data.status==='cancel'});
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