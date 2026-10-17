const CACHE = 'kansai-comitia-catalog-v11';
const PREFIX = 'kansai-comitia-catalog-';
const CORE = ['./','./index.html','./app.js','./style.css','./data/circles77.js','./data/circles77.json','./data/research77.csv','./RESEARCH.md','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
  if(url.searchParams.has('update')){event.respondWith(fetch(request));return;}
  if(request.mode==='navigate'){
    event.respondWith(caches.open(CACHE).then(async cache=>{try{const response=await fetch(request);if(response.ok)await cache.put('./index.html',response.clone()).catch(()=>{});return response;}catch{return cache.match('./index.html');}}));return;
  }
  if(url.pathname.endsWith('/data/circles77.js')||url.pathname.endsWith('/data/circles77.json')){
    event.respondWith(caches.open(CACHE).then(async cache=>{try{const response=await fetch(request);if(!response.ok)throw new Error('Catalog not available');await cache.put(request,response.clone()).catch(()=>{});return response;}catch{return cache.match(request);}}));return;
  }
  event.respondWith(caches.open(CACHE).then(async cache=>{const cached=await cache.match(request);if(cached)return cached;const response=await fetch(request);if(response.ok)await cache.put(request,response.clone()).catch(()=>{});return response;}));
});
