"""Compile the researched circle records and public evidence into the static catalog.

Usage: python scripts/build_catalog.py --research-dir /absolute/path/to/research
Use --allow-incomplete to publish saved findings while marking remaining checks.
"""
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlunparse, urlencode
from datetime import datetime, timezone
from collections import Counter
import argparse, csv, io, json, re

ROOT = Path(__file__).resolve().parents[1]
OFFICIAL = 'https://www.k-comitia.com/list77/'
CHANNELS = ('x','pixiv','web')
STATUS = {'found','not_found','blocked','ambiguous','unresearched','pending'}
LABELS = {'bluesky':'Bluesky','booth':'BOOTH','fanbox':'FANBOX','skeb':'Skeb','instagram':'Instagram','misskey':'Misskey','x':'X','pixiv':'pixiv','web':'Web'}
VENDORS = {'wixjp','xfolio_jp','profcard_info','potofu_me','litlink_jp','linktree_','pixiv','booth_pm','skeb_jp','note_pr'}

def valid_url(raw):
    if not isinstance(raw,str):return ''
    raw=raw.strip().replace('http:/twitter.com','https://twitter.com')
    try:
        p=urlparse(raw)
        if p.scheme not in ('https','http') or not p.hostname or p.username or p.password:return ''
        host=p.hostname.lower().removeprefix('www.')
        if host in ('x.com','twitter.com'):
            match=re.match(r'^/([A-Za-z0-9_]{1,15})(?:/(?:status/\d+|media|with_replies))?/?$',p.path)
            if not match or match[1].lower() in VENDORS:return ''
            return 'https://x.com/'+match[1]
        if host=='pixiv.net':
            match=re.match(r'^/(?:en/)?users/(\d+)',p.path)
            if match:return 'https://www.pixiv.net/users/'+match[1]
            if p.path=='/member.php' and parse_qs(p.query).get('id'):return 'https://www.pixiv.net/users/'+parse_qs(p.query)['id'][0]
        query=[(k,v) for k,vals in parse_qs(p.query).items() if not k.startswith('utm_') and k not in ('ref_src','s','t') for v in vals]
        return urlunparse((p.scheme,p.netloc,p.path or '/', '',urlencode(query),''))
    except ValueError:return ''

def kind_of(url):
    host=(urlparse(url).hostname or '').lower().removeprefix('www.')
    if host in ('x.com','twitter.com'):return 'x'
    if host in ('pixiv.net','pixiv.me'):return 'pixiv'
    if host.endswith('.booth.pm') or host=='booth.pm':return 'booth'
    if host.endswith('.fanbox.cc'):return 'fanbox'
    return {'bsky.app':'bluesky','skeb.jp':'skeb','instagram.com':'instagram','misskey.io':'misskey'}.get(host,'web')

def combine_sources(base,more):
    out=[];seen=set()
    for s in base+more:
        if not isinstance(s,dict):continue
        # Preserve exact source post URLs, including /status IDs, as evidence.
        u=s.get('url','')
        try:p=urlparse(u)
        except (ValueError,TypeError):continue
        if p.scheme not in ('http','https') or not p.hostname:continue
        item={'url':u,'title':str(s.get('title') or '確認元'),'note':str(s.get('note') or '')}
        key=(item['url'],item['note'])
        if key not in seen:seen.add(key);out.append(item)
    return out

def apply_native_profile_urls(records,evidence):
    """Recover an author's selected website from identity-matched X profile metadata.

    Only the profile's URL field is eligible for primary links. Mentions and other
    URLs in biography text are not assumed to belong to the same author.
    """
    excluded={'portal.circle.ms','wavebox.me','marshmallow-qa.com','spoon.onelink.me'}
    aliases={'tabihito':'37778','rino_cnc':'3442151','sunsun28':'4718780'}
    for item in evidence:
        r=records.get(item.get('space'))
        if not r or not valid_url(r.get('x','')):continue
        if valid_url(item.get('owner','')).lower()!=valid_url(r['x']).lower():continue
        selected=[]
        for link in item.get('websiteLinks',[]):
            u=valid_url(link.get('url',''))
            if not u:continue
            p=urlparse(u);host=(p.hostname or '').lower().removeprefix('www.')
            if host in excluded:continue
            if host=='pixiv.me':
                alias=p.path.strip('/')
                u='https://www.pixiv.net/users/'+aliases[alias] if alias in aliases else 'https://pixiv.me/'+alias
            selected.append((kind_of(u),u))
        selected=list(dict.fromkeys(selected))
        added=[]
        for channel in ('pixiv','web'):
            candidates=[u for kind,u in selected if (kind=='pixiv' if channel=='pixiv' else kind not in ('pixiv','x'))]
            if not r.get(channel) and len(candidates)==1:
                r[channel]=candidates[0];r.setdefault('status',{})[channel]='found';added.append(channel)
        if added:
            if r.get('notes'):
                r['notes']='追加照合で本人XのURL欄から'+'・'.join('Web' if k=='web' else k for k in added)+'を確認。以前の確認メモ：'+r['notes'].strip()
            r['sources']=combine_sources(r.get('sources',[]),[{
                'url':item['owner'],'title':'本人XプロフィールのURL欄',
                'note':'保存済み公開ページのprofile_bio内URL欄から取得。screen_nameが登録済み本人Xと一致することを照合。本文の他者へのリンクは採用しない。'
            }])

def normalize(record,official):
    r=dict(record)
    r['space']=official['space'];r['name']=official['name']
    r['sources']=combine_sources([{'url':OFFICIAL,'title':'関西コミティア77 公式一覧','note':'サークル名・配置を照合'}],r.get('sources',[]))
    statuses=dict(r.get('status',{}));extras=[];seen=set()
    for key in CHANNELS:
        original=r.get(key,'');u=valid_url(original);r[key]=u
        statuses[key]='found' if u else (statuses.get(key) if statuses.get(key) in STATUS-{'found'} else 'not_found')
        if original and not u:
            r.setdefault('rejectedLinks',[]).append({'kind':key,'url':original,'reason':'安全な公開プロフィールURLとして確認できず、またはサービス運営者アカウント'})
    for item in r.get('extras',[]):
        if not isinstance(item,dict):continue
        u=valid_url(item.get('url',''))
        if not u or u in seen or u in [r[k] for k in CHANNELS]:continue
        kind=item.get('kind') or kind_of(u)
        # Data from joint circles may contain multiple legitimate owner accounts.
        extras.append({'kind':kind,'url':u,'label':str(item.get('label') or LABELS.get(kind,kind))});seen.add(u)
    r['extras']=extras;r['status']=statuses
    # An official author-supplied URL remains useful even when its host is not a supported SNS.
    if not r['web']:
        for raw in official.get('officialLinks',[]):
            u=valid_url(raw)
            if u and kind_of(u) not in ('x','pixiv'):
                r['web']=u;r['status']['web']='found';break
    r['queries']=list(dict.fromkeys(str(q) for q in r.get('queries',[]) if q))
    r['searched']=bool(r.get('searched') or r['queries'] or r.get('pageChecks'))
    notes=str(r.get('notes',''))
    if any(r[k] for k in CHANNELS) or extras:
        notes=notes.replace('サークル名の独立検索を実施。本人と照合できる公開リンクは未確認。存在しないという意味ではない。','')
        notes=notes.replace('本人と照合できる公開リンクは未確認。存在しないという意味ではない。','')
    r['notes']=notes.strip()
    r['officialLinks']=official.get('officialLinks',[])
    return r

def build(research,draft=False):
    roster=json.loads((research.parent/'roster.raw.json').read_text())
    base=json.loads((research/'official-records.json').read_text())
    records={r['space']:r for r in base}
    initial_count=supp_count=0
    supplementary_done=set()
    for i in range(1,7):
        initial=json.loads((research/f'results-{i}.json').read_text())
        initial_count+=sum(bool(r.get('queries')) for r in initial)
        for r in initial:records[r['space']]=r
        path=research/f'official-results-{i}.json'
        if not path.exists():
            if not draft:raise ValueError(f'Missing research file {path.name}')
            continue
        supplemental=json.loads(path.read_text())
        for r in supplemental:
            prior=records[r['space']]
            if not r.get('searched') and not r.get('queries'):continue
            merged={**prior,**r}
            merged['sources']=combine_sources(prior.get('sources',[]),r.get('sources',[]))
            records[r['space']]=merged;supp_count+=1;supplementary_done.add(r['space'])
    expected_supp=sum(len(json.loads((research/'batches'/f'official-{i}.json').read_text())) for i in range(1,7))
    if not draft and (initial_count!=743 or supp_count!=expected_supp):raise ValueError(f'Research unfinished: initial {initial_count}/743; supplemental {supp_count}/{expected_supp}')
    native_path=research/'native-profile-url-evidence.json'
    if native_path.exists():apply_native_profile_urls(records,json.loads(native_path.read_text()))
    final=[normalize(records[c['space']],c) for c in roster]
    supplemental_spaces={c['space'] for i in range(1,7) for c in json.loads((research/'batches'/f'official-{i}.json').read_text())}
    for c in final:
        c['additionalSearchPending']=c['space'] in supplemental_spaces and c['space'] not in supplementary_done
        if c['additionalSearchPending']:
            for k in CHANNELS:
                if not c[k] and c['status'][k]=='not_found':c['status'][k]='pending'
            c['notes']+=((' ' if c['notes'] else '')+'公式掲載先は確認済み。外部検索による追加照合は確認待ち。')
    final.sort(key=lambda c:c['space'])
    assert len(final)==1442 and len({c['space'] for c in final})==1442
    assert all(c['sources'] for c in final)
    counts={k:sum(bool(c[k]) for c in final) for k in CHANNELS}
    counts['anyLink']=sum(any(c[k] for k in CHANNELS) or bool(c['extras']) for c in final)
    counts['unidentified']=len(final)-counts['anyLink']
    counts['officiallyLinked']=sum(bool(c['officialLinks']) for c in final)
    counts['individuallyQueried']=sum(bool(c['queries']) for c in final)
    counts['sourceChecked']=sum(c['searched'] for c in final)
    counts['additionalSearchPending']=sum(c['additionalSearchPending'] for c in final)
    deep=[c for c in final if c.get('wasUnidentifiedAtDeepStart')]
    if deep:
        counts['deepSearchTarget']=len(deep)
        counts['deepSearchChecked']=sum(bool(c.get('deepSearched')) for c in deep)
        counts['deepSearchIdentified']=sum(any(c[k] for k in CHANNELS) or bool(c['extras']) for c in deep)
    now=datetime.now(timezone.utc).isoformat(timespec='seconds')
    data={'schemaVersion':2,'revision':now,'researchedAt':now,'event':{'number':77,'name':'関西コミティア77','date':'2026-10-18','official':OFFICIAL},'counts':counts,'circles':[]}
    for c in final:
        data['circles'].append({k:c[k] for k in ('space','name','x','pixiv','web','extras','status','sources','notes','additionalSearchPending')})
    (ROOT/'data').mkdir(exist_ok=True)
    compact=json.dumps(data,ensure_ascii=False,separators=(',',':'))
    (ROOT/'data/circles77.json').write_text(compact+'\n')
    (ROOT/'data/circles77.js').write_text('window.CATALOG_DATA='+compact+';\n')
    (ROOT/'data/research77.full.json').write_text(json.dumps({'summary':counts,'generatedAt':now,'complete':counts['additionalSearchPending']==0,'circles':final},ensure_ascii=False,indent=2)+'\n')
    buffer=io.StringIO();writer=csv.writer(buffer,lineterminator='\n')
    writer.writerow(['配置','サークル名','X','pixiv','Web','X調査状況','pixiv調査状況','Web調査状況','補助リンク','根拠URL','検索語','確認メモ'])
    labels={'found':'発見済み','not_found':'調査済み・未発見','blocked':'要確認・閲覧制限等','ambiguous':'要確認・同一性未確定','pending':'追加確認待ち','unresearched':'未調査'}
    def csv_safe(s):
        s=str(s)
        return "'"+s if s.startswith(('=','+','-','@','\t','\r')) else s
    for c in final:
        row=[c['space'],c['name'],c['x'],c['pixiv'],c['web'],*[labels[c['status'][k]] for k in CHANNELS],'\n'.join(e['label']+': '+e['url'] for e in c['extras']),'\n'.join(s['url'] for s in c['sources']),'\n'.join(c['queries']),c['notes']]
        writer.writerow([csv_safe(v) for v in row])
    (ROOT/'data/research77.csv').write_text(buffer.getvalue(),encoding='utf-8-sig')
    print(json.dumps({'counts':counts,'draft':draft,'initialSearched':initial_count,'supplementalSearched':supp_count,'expectedSupplemental':expected_supp,'dataBytes':len(compact.encode())},ensure_ascii=False))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--research-dir',type=Path,required=True);parser.add_argument('--draft',action='store_true');parser.add_argument('--allow-incomplete',action='store_true');args=parser.parse_args();build(args.research_dir.resolve(),args.draft or args.allow_incomplete)
