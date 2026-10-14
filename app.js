'use strict';
const VERSION = '2026-10-14-kc5';
const OFFICIAL = 'https://www.k-comitia.com/list77/';
const KEY = 'kansai_comitia_catalog_v1';
const PREF = 'kansai_comitia_catalog_prefs_v1';
const SYNC = 'kansai_comitia_catalog_sync_v1';
const ARCHIVE = KEY + '_archive';
const PERSONAL = KEY + '_personal_v2';
const PAGE_SIZE = 60;
const colors = ['red','orange','yellow','green','blue','gray'];
const colorLabel = {red:'赤',orange:'橙',yellow:'黄',green:'緑',blue:'青',gray:'灰'};
const extrasLabel = {bluesky:'Bluesky',booth:'BOOTH',fanbox:'FANBOX',skeb:'Skeb',instagram:'Instagram',misskey:'Misskey',web:'Web',x:'X',pixiv:'pixiv'};
const statusLabel = {not_found:'未発見',blocked:'要確認',ambiguous:'要確認',unresearched:'未調査',pending:'確認待ち'};
let prefs = {...{q:'',view:'all',review:'all',linkFilter:'all'},...load(PREF,{})};
const savedPersonal = load(PERSONAL,null);
const savedLegacy = load(KEY,[]);
let circles = (Array.isArray(savedPersonal)?savedPersonal:(Array.isArray(savedLegacy)?savedLegacy:[])).filter(c=>c&&typeof c.space==='string'&&typeof c.name==='string').map(c=>({...c,state:state(c.state)}));
let syncInfo = load(SYNC,null);
let dataset = null;
let visibleCount = PAGE_SIZE;
let storageError = '';
const $ = id => document.getElementById(id);
function load(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function save(){try{const personal=circles.filter(c=>c.state.color!=='gray'||c.state.reviewed||c.state.visited||c.state.item||c.state.budget||c.state.memo).map(c=>({id:c.id,space:c.space,name:c.name,state:c.state}));localStorage.setItem(PERSONAL,JSON.stringify(personal));localStorage.setItem(PREF,JSON.stringify(prefs));if(syncInfo)localStorage.setItem(SYNC,JSON.stringify(syncInfo));storageError='';}catch{storageError='保存できませんでした。バックアップ保存でデータを保管してください。';meta(storageError);}}
function esc(s=''){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function state(x={}){x=x&&typeof x==='object'?x:{};return {color:colors.includes(x.color)?x.color:'gray',reviewed:x.reviewed===true,item:String(x.item??''),budget:String(x.budget??''),memo:String(x.memo??''),visited:x.visited===true};}
function normSpace(s=''){return String(s).normalize('NFKC').replace(/[‐‑‒–—−]/g,'-').replace(/\s+/g,'').toUpperCase();}
function idOf(space,name){return normSpace(space)+'|'+String(name).trim();}
function safeUrl(value){try{const u=new URL(String(value));return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}}
function hasLink(c){return ['web','pixiv','x'].some(k=>safeUrl(c[k]))||(c.extras||[]).some(e=>safeUrl(e.url));}
// Identity is the official space for this event, so name corrections preserve personal notes.
function mergeCatalog(data,old){
  if(!data||data.event?.number!==77||!Array.isArray(data.circles)||data.circles.length<1000)throw new Error('カタログデータの形式を確認できませんでした');
  const spaces=new Set();
  for(const c of data.circles){const space=normSpace(c.space);if(!/^[A-P]-\d{2}$/.test(space)||!c.name||spaces.has(space))throw new Error('配置データが不正または重複しています');spaces.add(space);}
  const byId=new Map(old.map(c=>[c.id||idOf(c.space,c.name),c]));
  const bySpace=new Map(old.map(c=>[normSpace(c.space),c]));
  const merged=data.circles.map(c=>{const id=idOf(c.space,c.name);const previous=byId.get(id)||bySpace.get(normSpace(c.space));return {...c,id,space:normSpace(c.space),state:state(previous?.state)};});
  return {circles:merged,orphans:old.filter(c=>!spaces.has(normSpace(c.space)))};
}
function applyCatalog(data){
  const result=mergeCatalog(data,circles);
  if(result.orphans.length){try{const archived=load(ARCHIVE,[]);const combined=new Map((Array.isArray(archived)?archived:[]).concat(result.orphans).map(c=>[c.id||idOf(c.space,c.name),c]));localStorage.setItem(ARCHIVE,JSON.stringify([...combined.values()]));}catch{throw new Error('旧データの退避ができないため更新を中止しました。先にバックアップを保存してください');}}
  circles=result.circles;dataset=data;syncInfo={at:new Date().toISOString(),count:circles.length,revision:data.revision,researchedAt:data.researchedAt,source:OFFICIAL};save();render();
}
function summaryText(){if(storageError)return storageError;const date=dataset?.researchedAt||syncInfo?.researchedAt;const pending=circles.filter(c=>c.additionalSearchPending).length;const unknown=circles.filter(c=>!(c.x||c.pixiv||c.web||c.extras?.length)).length;return `${circles.length.toLocaleString('ja-JP')}件 · ${date?new Date(date).toLocaleDateString('ja-JP')+' 調査版':'保存済みデータ'} · 本人リンクあり ${circles.length-unknown}件／未特定 ${unknown}件`+(pending?` · 追加確認待ち ${pending}件`:'')+(dataset?'':'（更新データを読み込めませんでした）');}
function meta(text){$('syncMeta').textContent=text;}
function filtered(){const q=String(prefs.q||'').normalize('NFKC').toLowerCase();return circles.filter(c=>{
  if(prefs.view==='check'&&c.state.color==='gray')return false;
  if(prefs.review==='yes'&&!c.state.reviewed)return false;
  if(prefs.review==='no'&&c.state.reviewed)return false;
  const lf=prefs.linkFilter;
  if(lf==='any'&&!hasLink(c))return false;if(lf==='none'&&hasLink(c))return false;
  if(['x','pixiv','web'].includes(lf)&&!safeUrl(c[lf]))return false;
  if(lf==='pending'&&!Object.values(c.status||{}).some(s=>['blocked','ambiguous','pending','unresearched'].includes(s)))return false;
  if(q&&!`${c.space} ${c.name} ${c.state.item} ${c.state.memo}`.normalize('NFKC').toLowerCase().includes(q))return false;
  return true;
}).sort((a,b)=>a.space.localeCompare(b.space,'ja',{numeric:true}));}
function link(url,label,status){const u=safeUrl(url);return u?`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`:`<span class="off">${label} ${statusLabel[status]||'未調査'}</span>`;}
function card(c){
  const extras=(c.extras||[]).filter(e=>safeUrl(e.url));
  const sources=(c.sources||[]).filter(s=>safeUrl(s.url));
  const sourceList=sources.map(s=>`<li><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title||s.kind||'確認元')} ↗</a>${s.note?` — ${esc(s.note)}`:''}</li>`).join('');
  const query=`"${c.name}" 関西コミティア`;
  const searchLinks=[['Xで検索','https://x.com/search?q='+encodeURIComponent(query)+'&src=typed_query'],['pixivで検索','https://www.pixiv.net/users?nick='+encodeURIComponent(c.name)],['Webで検索','https://www.google.com/search?q='+encodeURIComponent(query)]];
  return `<article class="card" data-id="${esc(c.id)}"><div class="top"><div class="space">${esc(c.space)}</div><div class="name">${esc(c.name)}</div></div>
  <div class="links">${link(c.web,'Web',c.status?.web)}${link(c.pixiv,'pixiv',c.status?.pixiv)}${link(c.x,'X',c.status?.x)}</div>
  ${extras.length?`<div class="extra-links">${extras.map(e=>`<a href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener noreferrer">${esc(e.label||extrasLabel[e.kind]||'関連リンク')} ↗</a>`).join('')}</div>`:''}
  <div class="chips">${colors.map(k=>`<button class="chip c-${k} ${c.state.color===k?'on':''}" data-color="${k}" aria-pressed="${c.state.color===k}" aria-label="${esc(c.name)}を${colorLabel[k]}にする">${colorLabel[k]}</button>`).join('')}</div>
  <div class="checks"><label><input type="checkbox" data-field="reviewed" ${c.state.reviewed?'checked':''}> 確認済み</label><label><input type="checkbox" data-field="visited" ${c.state.visited?'checked':''}> 訪問済み</label></div>
  <div class="fields"><input data-field="item" value="${esc(c.state.item)}" placeholder="購入予定品" aria-label="購入予定品"><input data-field="budget" value="${esc(c.state.budget)}" inputmode="decimal" placeholder="予算" aria-label="予算"><textarea data-field="memo" placeholder="メモ" aria-label="メモ">${esc(c.state.memo)}</textarea></div>
  <details class="evidence"><summary>リンクの確認元・再検索${c.notes?' · 確認メモあり':''}</summary>${c.notes?`<p>${esc(c.notes)}</p>`:''}<ul>${sourceList||'<li>照合できるリンクはまだ確認できていません。</li>'}</ul><div class="search-links">${searchLinks.map(([label,u])=>`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`).join('')}</div></details></article>`;
}
function render(){
  $('q').value=prefs.q;$('view').value=prefs.view;$('review').value=prefs.review;$('linkFilter').value=prefs.linkFilter;
  meta(summaryText());
  const count=k=>circles.filter(c=>safeUrl(c[k])).length;
  $('stats').innerHTML=`<span class="stat">全 ${circles.length}</span><span class="stat">X ${count('x')}</span><span class="stat">pixiv ${count('pixiv')}</span><span class="stat">Web ${count('web')}</span><span class="stat">リンク未特定 ${circles.filter(c=>!hasLink(c)).length}</span>${colors.map(k=>`<span class="stat">${colorLabel[k]} ${circles.filter(c=>c.state.color===k).length}</span>`).join('')}<span class="stat">訪問済 ${circles.filter(c=>c.state.visited).length}</span>`;
  const rows=filtered(),shown=rows.slice(0,visibleCount);$('resultCount').textContent=`${rows.length}件中 ${shown.length}件表示`;
  $('list').innerHTML=rows.length?shown.map(card).join(''):'<div class="empty">条件に合うサークルがありません</div>';
  $('moreBtn').hidden=shown.length>=rows.length;$('moreBtn').textContent=`続きを表示（あと${rows.length-shown.length}件）`;$('version').textContent=VERSION;
}
function update(id,fn){const c=circles.find(c=>c.id===id);if(!c)return;fn(c);save();}
function setFilter(key,value){prefs[key]=value;visibleCount=PAGE_SIZE;save();render();}
document.addEventListener('click',e=>{const article=e.target.closest('.card');if(article&&e.target.dataset.color){update(article.dataset.id,c=>c.state.color=e.target.dataset.color);render();}});
document.addEventListener('change',e=>{const article=e.target.closest('.card');if(article&&e.target.dataset.field){const f=e.target.dataset.field;update(article.dataset.id,c=>c.state[f]=e.target.type==='checkbox'?e.target.checked:e.target.value);if(e.target.type==='checkbox')render();}});
document.addEventListener('input',e=>{const article=e.target.closest('.card');if(article&&e.target.dataset.field){update(article.dataset.id,c=>c.state[e.target.dataset.field]=e.target.value);}});
$('q').oninput=e=>setFilter('q',e.target.value);$('view').onchange=e=>setFilter('view',e.target.value);$('review').onchange=e=>setFilter('review',e.target.value);$('linkFilter').onchange=e=>setFilter('linkFilter',e.target.value);
$('moreBtn').onclick=()=>{visibleCount+=PAGE_SIZE;render();};
$('exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify({version:VERSION,event:77,circles,prefs,syncInfo,archived:load(ARCHIVE,[])},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='kansai-comitia-catalog-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
$('importBtn').onclick=()=>$('importFile').click();
$('importFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const d=JSON.parse(await file.text());if(d.event&&d.event!==77)throw new Error('関西コミティア77のバックアップを選んでください');const all=d.circles?.concat(Array.isArray(d.archived)?d.archived:[]);if(!Array.isArray(all)||all.some(c=>!c||typeof c.space!=='string'||typeof c.name!=='string'))throw new Error('バックアップの形式が不正です');const imported=all.map(c=>({...c,id:idOf(c.space,c.name),space:normSpace(c.space),state:state(c.state)}));const previous=new Map(circles.map(c=>[c.space,c]));for(const c of imported)previous.set(c.space,c);circles=[...previous.values()];prefs={...prefs,...(d.prefs||{})};if(dataset)applyCatalog(dataset);else{save();render();}meta('バックアップを読み込みました。'+summaryText());}catch(error){alert(error.message||'バックアップを読み込めませんでした');}e.target.value='';};
$('resetBtn').onclick=()=>{if(!confirm('色・確認済み・購入予定・予算・メモ・訪問済みをすべて初期化しますか？'))return;circles=circles.map(c=>({...c,state:state()}));save();render();};
$('syncBtn').onclick=async()=>{const b=$('syncBtn');b.disabled=true;b.textContent='更新中…';try{const r=await fetch('./data/circles77.json?update='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('カタログ更新を取得できませんでした');const data=await r.json();applyCatalog(data);if('serviceWorker'in navigator){const reg=await navigator.serviceWorker.getRegistration();if(reg)reg.update().catch(()=>{});}meta('カタログを更新しました。色分け・メモを引き継ぎました。');}catch(error){meta('更新できませんでした：'+error.message+'。保存済みの一覧は引き続き使えます。');}finally{b.disabled=false;b.textContent='カタログを更新';}};
try{if(window.CATALOG_DATA)applyCatalog(window.CATALOG_DATA);else render();}catch(error){render();meta('保存済みデータを表示しています：'+error.message);}
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').then(reg=>{reg.update().catch(()=>{});}).catch(()=>{});
