const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8');
const origin='https://mammal-tanuki.github.io';
const scope=origin+'/kansai-comitia-catalog/';

function worker(){
  const handlers={},stored=new Map(),deleted=[];
  const key=request=>new URL(typeof request==='string'?request:request.url,scope).href;
  const cache={match:async request=>stored.get(key(request))?.clone(),put:async(request,response)=>stored.set(key(request),response),addAll:async()=>{}};
  vm.runInNewContext(script,{
    self:{location:{origin},registration:{scope},addEventListener:(type,fn)=>handlers[type]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{}}},
    caches:{open:async()=>cache,keys:async()=>['kansai-comitia-catalog-v1','kansai-comitia-catalog-v2','kemoket-catalog-v12R15'],delete:async k=>deleted.push(k)},
    URL,fetch:async()=>{throw new Error('offline');}
  });
  async function get(url,mode='cors'){
    let response;
    handlers.fetch({request:{url,method:'GET',mode},respondWith:p=>response=p});
    return response;
  }
  return {handlers,stored,deleted,get};
}

test('activation removes only outdated caches belonging to this catalog',async()=>{
  const w=worker();let pending;w.handlers.activate({waitUntil:p=>pending=p});await pending;
  assert.deepEqual(w.deleted,['kansai-comitia-catalog-v1']);
});
test('external profiles and the other catalog are not intercepted',async()=>{
  const w=worker();
  assert.equal(await w.get('https://x.com/owner'),undefined);
  assert.equal(await w.get(origin+'/kemoket-catalog/app.js'),undefined);
});
test('offline data requests return cached JSON; HTML fallback is reserved for navigation',async()=>{
  const w=worker();
  w.stored.set(scope+'data/circles77.json',new Response('{"event":77}',{headers:{'content-type':'application/json'}}));
  w.stored.set(scope+'index.html',new Response('<html>offline catalog</html>',{headers:{'content-type':'text/html'}}));
  const json=await w.get(scope+'data/circles77.json');assert.equal(await json.text(),'{"event":77}');
  const page=await w.get(scope,'navigate');assert.match(await page.text(),/offline catalog/);
  await assert.rejects(w.get(scope+'data/missing.json'),/offline/);
});
test('explicit update is rejected offline instead of pretending the cached copy is fresh',async()=>{
  const w=worker();
  w.stored.set(scope+'data/circles77.json',new Response('{"old":true}'));
  await assert.rejects(w.get(scope+'data/circles77.json?update=123'),/offline/);
});
