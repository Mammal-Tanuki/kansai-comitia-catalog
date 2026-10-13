const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname,'..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT,'data/circles77.json'),'utf8'));
const script = fs.readFileSync(path.join(ROOT,'app.js'),'utf8');
const key = 'kansai_comitia_catalog_v1';
const personal = key + '_personal_v2';

function boot(stored={}) {
  const storage = new Map(Object.entries(stored));
  const ids = ['q','view','review','linkFilter','stats','list','resultCount','moreBtn','version','syncMeta','exportBtn','importBtn','importFile','resetBtn','syncBtn'];
  const elements = Object.fromEntries(ids.map(id=>[id,{id,value:'',innerHTML:'',textContent:'',hidden:false,click(){}}]));
  const events = {};
  const context = vm.createContext({
    window:{CATALOG_DATA:data},
    document:{getElementById:id=>elements[id],addEventListener:(name,handler)=>events[name]=handler,createElement:()=>({click(){}})},
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},
    navigator:{},location:{protocol:'https:'},URL,Blob,setTimeout,clearTimeout,console,alert(){},confirm:()=>true,
    fetch:async()=>{throw new Error('offline');}
  });
  vm.runInContext(script,context);
  return {context,storage,elements,events,run:source=>vm.runInContext(source,context)};
}

test('loads the complete official roster without pressing sync; renders a bounded page',()=>{
  const a=boot();
  assert.equal(a.run('circles.length'),1442);
  assert.equal((a.elements.list.innerHTML.match(/<article /g)||[]).length,60);
  assert.equal(a.run("circles.find(c=>c.space==='A-03').name"),'10/19');
  assert.equal(a.storage.get(personal),'[]');
});

test('migrates six personal fields by space when the old name/id differ',()=>{
  const old={id:'A-01|旧表示',space:'A-01',name:'旧表示',state:{color:'red',reviewed:true,visited:true,item:'新刊',budget:'1500',memo:'現金で購入'}};
  const a=boot({[key]:JSON.stringify([old])});
  const state=JSON.parse(a.run("JSON.stringify(circles.find(c=>c.space==='A-01').state)"));
  assert.deepEqual(state,old.state);
  assert.equal(JSON.parse(a.storage.get(personal)).length,1);
  assert.equal(a.storage.get(key),JSON.stringify([old]));
  a.run('applyCatalog(window.CATALOG_DATA)');
  assert.equal(a.run("circles.find(c=>c.space==='A-01').state.memo"),'現金で購入');
});

test('new personal data wins over legacy storage; clearing stays cleared on reopen',()=>{
  const old={space:'A-01',name:'旧名',state:{color:'red',memo:'古いメモ'}};
  const a=boot({[key]:JSON.stringify([old]),[personal]:'[]'});
  assert.equal(a.run("circles.find(c=>c.space==='A-01').state.color"),'gray');
  assert.equal(a.run("circles.find(c=>c.space==='A-01').state.memo"),'');
});

test('archives unmatched saved spaces instead of dropping the personal state',()=>{
  const orphan={id:'Z-99|手動登録',space:'Z-99',name:'手動登録',state:{color:'blue',memo:'退避するメモ'}};
  const a=boot({[key]:JSON.stringify([orphan])});
  assert.equal(JSON.parse(a.storage.get(key+'_archive'))[0].state.memo,'退避するメモ');
  assert.equal(a.run('circles.length'),1442);
});

test('filters all records, including those beyond the first displayed page',()=>{
  const a=boot();
  a.run("setFilter('q','Ｐ－８５')");
  assert.equal(a.run('filtered().length'),1);
  assert.equal(a.run('filtered()[0].space'),'P-85');
  a.run("setFilter('q','');setFilter('linkFilter','x')");
  assert.equal(a.run('filtered().length'),data.counts.x);
  a.run("setFilter('linkFilter','none')");
  assert.equal(a.run('filtered().length'),data.counts.unidentified);
});

test('failed refresh preserves the roster and personal selections',async()=>{
  const a=boot();
  a.run("update(circles[0].id,c=>{c.state.color='green';c.state.memo='更新失敗でも残す';})");
  await a.elements.syncBtn.onclick();
  assert.equal(a.run('circles.length'),1442);
  assert.equal(a.run('circles[0].state.memo'),'更新失敗でも残す');
  assert.match(a.elements.syncMeta.textContent,/更新できませんでした/);
  assert.equal(a.elements.syncBtn.disabled,false);
});

test('rejects duplicate or incomplete refreshed data without altering live records',()=>{
  const a=boot();
  assert.throws(()=>a.run('applyCatalog({...window.CATALOG_DATA,circles:[window.CATALOG_DATA.circles[0]]})'));
  assert.throws(()=>a.run('applyCatalog({...window.CATALOG_DATA,circles:window.CATALOG_DATA.circles.map((c,i)=>i===1?window.CATALOG_DATA.circles[0]:c)})'));
  assert.equal(a.run('circles.length'),1442);
});

test('rejects executable URLs and escapes names/notes when rendering links',()=>{
  const a=boot();
  assert.equal(a.run("safeUrl('javascript:alert(1)')"),'');
  assert.equal(a.run("safeUrl('https://user:password@example.com/')"),'');
  const html=a.run("card({...circles[0],name:'<img onerror=alert(1)>',notes:'<script>alert(1)</script>',x:'javascript:alert(1)'})");
  assert.ok(!html.includes('<img onerror'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript:'));
});

test('backup import restores states and archived records against the current roster',async()=>{
  const a=boot();
  const backup={event:77,circles:[{space:'A-01',name:'以前の名前',state:{color:'yellow',memo:'復元したメモ'}}],archived:[{space:'Z-99',name:'退避対象',state:{memo:'退避の復元'}}]};
  await a.elements.importFile.onchange({target:{files:[{text:async()=>JSON.stringify(backup)}],value:'file'}});
  assert.equal(a.run("circles.find(c=>c.space==='A-01').state.memo"),'復元したメモ');
  assert.equal(a.run("circles.find(c=>c.space==='A-01').state.color"),'yellow');
  assert.equal(JSON.parse(a.storage.get(key+'_archive'))[0].state.memo,'退避の復元');
});
