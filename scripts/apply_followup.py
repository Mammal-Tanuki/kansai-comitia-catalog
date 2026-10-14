"""Apply a reviewed follow-up round to the published catalog and research log.

Usage: python3 scripts/apply_followup.py data/research77.followup-2026-10-14.json
The update keeps official identities and earlier research history intact.
"""
import argparse
import csv
import io
import json
from datetime import datetime, timezone
from pathlib import Path

from build_catalog import CHANNELS, ROOT, combine_sources, normalize, valid_url


def linked(record):
    return any(record.get(k) for k in CHANNELS) or bool(record.get('extras'))


def apply(path):
    round_data = json.loads(path.read_text())
    research = json.loads((ROOT / 'data/research77.full.json').read_text())
    catalog = json.loads((ROOT / 'data/circles77.json').read_text())
    records = {c['space']: c for c in research['circles']}
    checks = {c['space']: c for c in round_data['checks']}
    updates = {c['space']: c for c in round_data['updates']}
    assert len(checks) == len(round_data['checks']) == round_data['initialUnidentified']
    assert len(updates) == len(round_data['updates'])
    assert set(updates) <= set(checks) <= set(records)
    history = research.setdefault('followupRounds', [])
    applied = any(r['id'] == round_data['id'] for r in history)
    if not applied:
        assert sum(not linked(c) for c in records.values()) == round_data['initialUnidentified']
        assert all(not linked(records[space]) for space in checks)

    for space, check in checks.items():
        c = records[space]
        assert c['name'] == check['name']
        new_queries = [str(q).strip() for q in [check['query'], *check.get('additionalQueries', [])] if str(q).strip()]
        c['queries'] = list(dict.fromkeys(str(q).strip() for q in c.get('queries', []) + new_queries if str(q).strip()))
        logs = c.setdefault('followupSearches', [])
        log = next((item for item in logs if item['roundId'] == round_data['id']), None)
        if log is None:
            log = {'roundId': round_data['id']}
            logs.append(log)
        log.update(checkedDate=round_data['checkedDate'], query=check['query'].strip())
        for field in ('additionalQueries', 'methods'):
            if check.get(field):
                log[field] = [str(v).strip() for v in check[field]]

    for space, patch in updates.items():
        c = records[space]
        if not applied:
            c.setdefault('previousNotes', []).append({'roundId': round_data['id'], 'notes': c.get('notes', '')})
        for channel, url in patch['links'].items():
            assert channel in CHANNELS
            if url:
                assert valid_url(url), (space, channel, url)
                assert not c.get(channel) or valid_url(c[channel]) == valid_url(url), (space, channel)
                c[channel] = url
        for extra in patch['extras']:
            assert valid_url(extra['url']), (space, extra['url'])
        c['extras'] = c.get('extras', []) + patch['extras']
        c['sources'] = combine_sources(c.get('sources', []), patch['sources'])
        c['notes'] = round_data['checkedDate'] + ' 追加照合：' + patch['note']
        c['checkedAt'] = round_data['checkedDate']
        if space == 'J-42':
            c.setdefault('status', {})['x'] = 'ambiguous'
        records[space] = normalize(c, c)
        assert linked(records[space]), space

    for item in round_data.get('unresolved', []):
        c = records[item['space']]
        if not applied:
            c.setdefault('previousNotes', []).append({'roundId': round_data['id'], 'notes': c.get('notes', '')})
        c['notes'] = round_data['checkedDate'] + ' 追加確認：' + item['note']
        c['sources'] = combine_sources(c.get('sources', []), [
            {'url': url, 'title': '追加照合・候補を保留した確認元', 'note': item['note']}
            for url in item['sources']
        ])
        candidates = c.setdefault('candidateLinks', [])
        for candidate in item.get('candidateLinks', []):
            if not any(v.get('url') == candidate['url'] for v in candidates):
                candidates.append(candidate)
        for candidate in item.get('candidateLinks', []):
            channel = candidate.get('kind')
            if channel in CHANNELS:
                c.setdefault('status', {})[channel] = 'ambiguous'
        assert not linked(c), item['space']

    final = [records[c['space']] for c in research['circles']]
    counts = dict(research['summary'])
    for channel in CHANNELS:
        counts[channel] = sum(bool(c.get(channel)) for c in final)
    counts['anyLink'] = sum(linked(c) for c in final)
    counts['unidentified'] = len(final) - counts['anyLink']
    counts['individuallyQueried'] = sum(bool(c.get('queries')) for c in final)
    deep = [c for c in final if c.get('wasUnidentifiedAtDeepStart')]
    counts['deepSearchIdentified'] = sum(linked(c) for c in deep)
    counts['followupSearchTarget'] = len(checks)
    counts['followupSearchChecked'] = len(checks)
    counts['followupSearchIdentified'] = len(updates)
    if not applied:
        assert counts['unidentified'] == round_data['initialUnidentified'] - len(updates)
        history.append({'id': round_data['id'], 'checkedDate': round_data['checkedDate'],
                        'initialUnidentified': round_data['initialUnidentified'],
                        'checked': len(checks), 'identified': len(updates),
                        'unidentifiedAfter': counts['unidentified']})
        now = datetime.now(timezone.utc).isoformat(timespec='seconds')
    else:
        now = research['generatedAt']

    research.update(summary=counts, generatedAt=now, circles=final)
    catalog.update(counts=counts, revision=now, researchedAt=now)
    public_fields = ('space', 'name', 'x', 'pixiv', 'web', 'extras', 'status', 'sources', 'notes', 'additionalSearchPending')
    catalog['circles'] = [{k: c[k] for k in public_fields} for c in final]
    compact = json.dumps(catalog, ensure_ascii=False, separators=(',', ':'))
    (ROOT / 'data/circles77.json').write_text(compact + '\n')
    (ROOT / 'data/circles77.js').write_text('window.CATALOG_DATA=' + compact + ';\n')
    (ROOT / 'data/research77.full.json').write_text(json.dumps(research, ensure_ascii=False, indent=2) + '\n')

    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator='\n')
    writer.writerow(['配置', 'サークル名', 'X', 'pixiv', 'Web', 'X調査状況', 'pixiv調査状況', 'Web調査状況', '補助リンク', '根拠URL', '検索語', '確認メモ'])
    labels = {'found':'発見済み', 'not_found':'調査済み・未発見', 'blocked':'要確認・閲覧制限等',
              'ambiguous':'要確認・同一性未確定', 'pending':'追加確認待ち', 'unresearched':'未調査'}
    def safe(value):
        s = str(value)
        return "'" + s if s.startswith(('=', '+', '-', '@', '\t', '\r')) else s
    for c in final:
        row = [c['space'], c['name'], c['x'], c['pixiv'], c['web'],
               *[labels[c['status'][k]] for k in CHANNELS],
               '\n'.join(e['label'] + ': ' + e['url'] for e in c['extras']),
               '\n'.join(s['url'] for s in c['sources']), '\n'.join(c['queries']), c['notes']]
        writer.writerow([safe(v) for v in row])
    (ROOT / 'data/research77.csv').write_text(buffer.getvalue(), encoding='utf-8-sig')
    print(json.dumps({'roundId': round_data['id'], 'alreadyApplied': applied, 'counts': counts}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('round_file', type=Path)
    apply(parser.parse_args().round_file.resolve())
