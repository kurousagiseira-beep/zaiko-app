const page = `<!doctype html><html lang="ja"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>CLUB KISS 新規来店</title><style>body{margin:0;background:#111;color:#eee;font-family:-apple-system,sans-serif}main{max-width:420px;margin:12vh auto;padding:24px;text-align:center}h1{color:#d6b66d;letter-spacing:3px}input,select,button{box-sizing:border-box;width:100%;padding:17px;margin:10px 0;border-radius:10px;font-size:19px}input,select{background:#222;color:white;border:1px solid #777}button{background:#d6b66d;border:0;color:#111;font-weight:bold}small{color:#aaa}#send{display:none}#msg{min-height:2em}</style><main><h1>CLUB KISS</h1><p>新規来店通知システム</p><section id="login"><input id="pin" type="password" inputmode="numeric" maxlength="4" placeholder="4桁のパスワード"><button onclick="login()">ログイン</button></section><section id="send"><p>新規来店人数</p><select id="count"><option value="1">新規1名</option><option value="2">新規2名</option><option value="3">新規3名</option><option value="4">新規4名</option><option value="5">新規5名</option></select><button id="btn" onclick="send()">🔔 LINEに通知する</button><button onclick="logout()" style="background:#333;color:#eee">ログアウト</button></section><p id="msg"></p><small>スタッフ専用</small></main><script>const m=document.getElementById('msg');async function api(path,body){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});let j=await r.json();if(!r.ok)throw Error(j.error||'エラー');return j}async function login(){try{await api('/login',{pin:document.getElementById('pin').value});document.getElementById('login').style.display='none';document.getElementById('send').style.display='block';m.textContent=''}catch(e){m.textContent=e.message}}async function send(){const n=Number(document.getElementById('count').value);if(!confirm('新規'+n+'名の来店をLINEに通知しますか？'))return;const b=document.getElementById('btn');b.disabled=true;try{await api('/send',{count:n});m.textContent='LINEに通知しました'}catch(e){m.textContent=e.message}finally{b.disabled=false}}async function logout(){await api('/logout',{});location.reload()}fetch('/session').then(r=>r.json()).then(j=>{if(j.ok){document.getElementById('login').style.display='none';document.getElementById('send').style.display='block'}})</script></html>`;
const enc=new TextEncoder();
function hex(a){return [...new Uint8Array(a)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function mac(secret,data){const k=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',k,enc.encode(data)))}
function response(obj,status=200,headers={}){return new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store',...headers}})}
function cookie(req){return (req.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('kiss_session='))?.slice(13)||''}
async function valid(req,env){const [exp,sig]=cookie(req).split('.');if(!exp||!sig||!/^\d+$/.test(exp)||Number(exp)<Date.now())return false;return (await mac(env.STAFF_PIN,exp))===sig}

const photoCors={'access-control-allow-origin':'https://kurousagiseira-beep.github.io','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'Content-Type','vary':'Origin'};
function photoResponse(obj,status=200){return response(obj,status,photoCors)}
function photoClock(m){return String(Math.floor(m/60)%24).padStart(2,'0')+':'+String(m%60).padStart(2,'0')}
function makePhotoSchedule(item,casts,previous){
 const jp=new Date(item.time+9*3600000);
 const day=jp.toISOString().slice(0,10);
 let minute=jp.getUTCHours()*60+jp.getUTCMinutes()+3+(jp.getUTCSeconds()>0?1:0);
 const sameDay=previous.filter(r=>r.schedule?.length&&new Date(r.time+9*3600000).toISOString().slice(0,10)===day);
 for(const r of sameDay){const end=r.schedule.reduce((m,x)=>Math.max(m,Number(x.endMinute)||0),0);minute=Math.max(minute,end)}
 const chosen=new Set(item.ids.map(String));
 const registered=casts.filter(c=>c.name&&String(c.name).trim()&&c.attending!==false);
 const priority=registered.filter(c=>chosen.has(String(c.id)));
 const others=registered.filter(c=>!chosen.has(String(c.id)));
 const groups=[...priority.map(c=>[c])];
 for(let i=0;i<others.length;i+=2)groups.push(others.slice(i,i+2));
 if(!groups.length)return [];
 const durations=groups.map((g,i)=>i<priority.length?15:5);
 const schedule=[];
 groups.forEach((group,i)=>{const startMinute=minute;minute+=durations[i];for(const c of group)schedule.push({name:c.name,start:photoClock(startMinute),end:photoClock(minute),startMinute,endMinute:minute,priority:chosen.has(String(c.id)),duration:durations[i]})});
 return schedule;
}
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
 return state;
}
async function readPhotoRequests(env){return JSON.parse(await env.KISS_DATA.get('photo:requests')||'[]')}

export default {async fetch(req,env){
const url=new URL(req.url),path=url.pathname;
if(path==='/')return new Response(page,{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});

if(path.startsWith('/photo/')){
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:photoCors});
 if(req.headers.get('origin')&&req.headers.get('origin')!=='https://kurousagiseira-beep.github.io')return photoResponse({error:'許可されていません'},403);
 if(path==='/photo/casts'&&req.method==='GET'){
  const casts=JSON.parse(await env.KISS_DATA.get('photo:casts')||'[]');
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const attendance=await readAttendance(env,today,casts);
  return photoResponse({casts,attendance,date:today});
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
 if(path==='/photo/attendance'&&req.method==='POST'){
  const data=await req.json().catch(()=>({}));
  if(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN)return photoResponse({error:'スタッフPINが違います'},401);
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
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
 if(path==='/photo/table-status'&&req.method==='GET'){
  const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const tables=['2','3','4','5','6','7','8','9','VIP1','VIP2','VIP3'];
  const list=await readPhotoRequests(env);
  const closed=await Promise.all(tables.map(t=>env.KISS_DATA.get('photo:closed:'+day+':'+t)));
  return photoResponse({tables:Object.fromEntries(tables.map((t,i)=>{
    const latest=list.filter(r=>String(r.table)===t&&r.status!=='cancel'&&new Date(r.time+9*3600000).toISOString().slice(0,10)===day).sort((a,b)=>b.time-a.time)[0];
    return [t,!!latest&&(!closed[i]||Number(closed[i])<latest.time)];
  }))});
 }
 if(path==='/photo/table-close'&&req.method==='POST'){
  const data=await req.json().catch(()=>({})),table=String(data.table||'');
  if(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN)return photoResponse({error:'スタッフPINが違います'},401);
  if(!/^(?:[2-9]|VIP[1-3])$/.test(table))return photoResponse({error:'卓番号が不正です'},400);
  const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  await env.KISS_DATA.put('photo:closed:'+day+':'+table,String(Date.now()),{expirationTtl:86400});
  return photoResponse({ok:true});
 }
 if(path==='/photo/shared'&&(req.method==='GET'||req.method==='POST')){
  const data=req.method==='POST'?await req.json().catch(()=>({})):{table:url.searchParams.get('table')};
  const table=String(data.table||'').trim();
  if(!/^(?:[2-9]|VIP[1-3])$/.test(table))return photoResponse({error:'卓番号が不正です'},400);
  const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10),key='photo:shared:'+day+':'+table;
  const list=await readPhotoRequests(env);
  if(list.some(r=>String(r.table)===table&&r.status!=='cancel'&&new Date(r.time+9*3600000).toISOString().slice(0,10)===day))return photoResponse({error:'この卓の受付は確定済みです',completed:true},409);
  let state=JSON.parse(await env.KISS_DATA.get(key)||'null');
  if(req.method==='GET')return photoResponse({state:state||null});
  if(data.action==='init'){
    const count=Number(data.partySize);
    if(!Number.isInteger(count)||count<1||count>20)return photoResponse({error:'人数は1〜20名にしてください'},400);
    if(!state){state={table,partySize:count,guestSelections:Array.from({length:count},()=>[]),revision:1,updatedAt:Date.now()};await env.KISS_DATA.put(key,JSON.stringify(state),{expirationTtl:86400})}
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
  if(!/^(?:[2-9]|VIP[1-3])$/.test(table))return photoResponse({error:'卓番号を確認してください'},400);
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
  if(!/^(?:[2-9]|VIP[1-3])$/.test(table))return photoResponse({error:'卓番号を選択してください'},400);
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
 if(path==='/photo/submit'&&req.method==='POST'){
  const ip=req.headers.get('cf-connecting-ip')||'unknown',key='photo:rate:'+ip;
  const n=Number(await env.KISS_DATA.get(key)||0);
  if(n>=12)return photoResponse({error:'送信回数が多すぎます。しばらくお待ちください'},429);
  const data=await req.json().catch(()=>({}));
  const table=String(data.table||'').trim();
  if(!/^(?:[2-9]|VIP[1-3])$/.test(table))return photoResponse({error:'卓番号を入力してください'},400);
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
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const attendance=JSON.parse(await env.KISS_DATA.get('photo:attendance:'+today)||'{}');
  if(ids.some(id=>attendance[id]===false))return photoResponse({error:'休みのキャストは写真指名できません。画面を更新してください'},409);
  const item={id:crypto.randomUUID(),ids,names:ids.map(id=>casts.find(c=>c.id===id).name),table,partySize,guestSelections:groupIds,status:'pending',time:Date.now()};
  const list=await readPhotoRequests(env);
  if(list.some(r=>String(r.table)===table&&r.status!=='cancel'&&new Date(r.time+9*3600000).toISOString().slice(0,10)===today))return photoResponse({error:table+'は本日すでに受付済みです。スタッフに確認してください'},409);
  item.schedule=makePhotoSchedule(item,casts.map(c=>({...c,attending:attendance[c.id]!==false})),list.filter(r=>r.status!=='cancel'));
  const groupId=await env.KISS_DATA.get('groupId');
  if(!groupId)return photoResponse({error:'LINEグループが未登録です'},409);
  const scheduleText=item.schedule.map(r=>r.start+'〜'+r.end+'  '+r.name+(r.priority?' ★写真指名':'')).join('\n');
  const message=['📸 CLUB KISS 写真指名','お客様から写真指名が入りました。','【'+(table?table+'卓・':'')+partySize+'名席・1組】',...groupIds.map((group,i)=>(i+1)+'人目：'+group.map(id=>casts.find(c=>c.id===id)?.name||'不明').join('・')),'','━━━━━━━━━━━━','📋 自動タイムテーブル','━━━━━━━━━━━━',scheduleText,'','★ 写真指名キャスト15分','その他キャストは最大2人組で5分','全体90分以内／受付から最短3分後開始'].join('\n');
  const line=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{authorization:'Bearer '+env.LINE_CHANNEL_ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify({to:groupId,messages:[{type:'text',text:message}]})});
  if(!line.ok)return photoResponse({error:'LINE送信に失敗しました'},502);
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
 if(path==='/photo/all-rankings'&&req.method==='POST'){
  const data=await req.json().catch(()=>({}));
  if(!env.STAFF_PIN||String(data.pin)!==env.STAFF_PIN)return photoResponse({error:'スタッフPINが違います'},401);
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
  if(!/^(?:[2-9]|VIP[1-3])$/.test(table)||!Number.isInteger(partySize)||partySize<1||partySize>20)return photoResponse({error:'卓番号・人数を確認してください'},400);
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
  item.schedule=makePhotoSchedule(item,casts.map(c=>({...c,attending:attendance[c.id]!==false})),earlier);
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