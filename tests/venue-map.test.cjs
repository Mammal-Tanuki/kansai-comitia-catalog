const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const data=JSON.parse(fs.readFileSync(path.join(root,'map/venue77.json'),'utf8'));
const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/circles77.json'),'utf8'));
const elements={};
const context={window:{addEventListener(){}},document:{addEventListener(){}},$:id=>elements[id]??=( {} )};
vm.runInNewContext(fs.readFileSync(path.join(root,'venue-map.js'),'utf8'),context);
const validate=context.window.catalogMap.validate;

test('map covers every catalog space exactly once and leaves unlisted printed numbers unassigned',()=>{
  assert.equal(validate(data,catalog.circles),data);
  assert.deepEqual(data.spots.map(s=>s.space).sort(),catalog.circles.map(c=>c.space).sort());
  assert.equal(data.printedSpaces,1450);
  assert.deepEqual(data.unlistedSpaces,['C-92','E-94','H-08','H-94','J-46','K-90','M-93','P-11']);
  assert.equal(JSON.stringify(data).includes('"state"'),false);
});

test('rejects maps for another event, stale catalog membership, duplicate spaces and invalid boxes',()=>{
  assert.throws(()=>validate({...data,event:17},catalog.circles));
  assert.throws(()=>validate(data,catalog.circles.slice(1)));
  const changed=catalog.circles.map((c,i)=>i===0?{...c,space:'Z-99'}:c);
  assert.throws(()=>validate(data,changed));
  const duplicate={...data,spots:data.spots.map((s,i)=>i===0?data.spots[1]:s)};
  assert.throws(()=>validate(duplicate,catalog.circles));
  for(const x of [NaN,-1,Infinity,data.width]){
    assert.throws(()=>validate({...data,spots:data.spots.map((s,i)=>i===0?{...s,x}:s)},catalog.circles));
  }
});

test('number order follows the official diagram including descending columns, the aisle and the P-block gap',()=>{
  const spots=Object.fromEntries(data.spots.map(s=>[s.space,s]));
  const close=(a,b)=>assert.ok(Math.abs(a-b)<.002,`${a} != ${b}`);
  close(spots['A-48'].x,16.133);close(spots['A-48'].y,29.462);
  close(spots['A-49'].x,31.723);close(spots['A-49'].y,29.462);
  close(spots['A-47'].y-spots['A-48'].y,spots['A-48'].h);
  close(spots['A-01'].y,318.969);close(spots['A-96'].y,318.969);
  assert.ok(spots['A-73'].y-spots['A-72'].y>spots['A-72'].h*2);
  assert.ok(spots['P-50'].y-spots['P-51'].y>spots['P-51'].h*2);
  close(spots['O-20'].y,373.045);close(spots['P-86'].y,495.117);
  for(const view of data.views){
    const spaces=data.spots.filter(s=>s.x>=view.x&&s.y>=view.y&&s.x+s.w<=view.x+view.w+.01&&s.y+s.h<=view.y+view.h+.01);
    if(view.id==='main')assert.ok(spaces.every(s=>/^[A-N]-/.test(s.space))&&spaces.length===1337);
    if(view.id==='annex')assert.ok(spaces.every(s=>/^[OP]-/.test(s.space))&&spaces.length===105);
  }
});

test('bundled map data matches JSON and the worker precaches every local script, stylesheet and map asset',()=>{
  const script=fs.readFileSync(path.join(root,'map/venue77.js'),'utf8');
  assert.deepEqual(JSON.parse(script.slice('window.VENUE_MAP_DATA='.length,-2)),data);
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const worker=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const urls=[...html.matchAll(/(?:src|href)="(\.\/[^" ]+\.(?:js|css)(?:\?[^" ]+)?)"/g)].map(m=>m[1]);
  urls.push('./map/venue77.png','./map/venue77.json');
  for(const url of urls){
    assert.ok(worker.includes("'"+url+"'"),'Not precached: '+url);
    assert.ok(fs.existsSync(path.join(root,url.split('?')[0])),'Missing: '+url);
  }
});
