"""Apply a reviewed set of link additions to specific existing circles.

Usage: python3 scripts/apply_enrichment.py data/research77.enrichment-*.json
Official identities, existing links, and all other circles remain unchanged.
"""
import argparse
import csv
import io
import json
from datetime import datetime, timezone
from pathlib import Path

from build_catalog import CHANNELS, ROOT, combine_sources, normalize, valid_url


def apply(path):
    rd = json.loads(path.read_text())
    assert rd['scope'] == 'specific_circles'
    research = json.loads((ROOT / 'data/research77.full.json').read_text())
    catalog = json.loads((ROOT / 'data/circles77.json').read_text())
    records = {c['space']: c for c in research['circles']}
    patches = {p['space']: p for p in rd['updates']}
    assert len(patches) == len(rd['updates']) == rd['statistics']['checked']
    rounds = research.setdefault('enrichmentRounds', [])
    applied = any(r['id'] == rd['id'] for r in rounds)
    for space, patch in patches.items():
        c = records[space]
        assert c['name'] == patch['name']
        if not applied:
            c.setdefault('previousNotes', []).append({'roundId': rd['id'], 'notes': c.get('notes', '')})
        for channel, url in patch['links'].items():
            assert channel in CHANNELS and valid_url(url)
            assert not c.get(channel) or valid_url(c[channel]) == valid_url(url)
            c[channel] = url
        assert all(valid_url(e['url']) for e in patch['extras'])
        c['extras'] = c.get('extras', []) + patch['extras']
        c['sources'] = combine_sources(c.get('sources', []), patch['sources'])
        c['queries'] = list(dict.fromkeys(c.get('queries', []) + patch.get('queries', [])))
        logs = c.setdefault('enrichmentSearches', [])
        log = next((r for r in logs if r['roundId'] == rd['id']), None)
        if log is None:
            log = {'roundId': rd['id']}
            logs.append(log)
        log.update(checkedDate=rd['checkedDate'], methods=patch['methods'], queries=patch.get('queries', []))
        c['notes'] = rd['checkedDate'] + ' 追加確認：' + patch['note']
        c['checkedAt'] = rd['checkedDate']
        records[space] = normalize(c, c)
    final = [records[c['space']] for c in research['circles']]
    counts = dict(research['summary'])
    for k in CHANNELS:
        counts[k] = sum(bool(c.get(k)) for c in final)
    counts['anyLink'] = sum(any(c.get(k) for k in CHANNELS) or bool(c['extras']) for c in final)
    counts['unidentified'] = len(final) - counts['anyLink']
    counts['enrichmentTarget'] = len(patches)
    counts['enrichmentChecked'] = len(patches)
    counts['enrichmentRecordsWithNewLinks'] = rd['statistics']['recordsWithNewLinks']
    counts['enrichmentNewUrls'] = rd['statistics']['newUrls']
    if not applied:
        rounds.append({'id': rd['id'], 'checkedDate': rd['checkedDate'], **rd['statistics']})
        now = datetime.now(timezone.utc).isoformat(timespec='seconds')
    else:
        now = research['generatedAt']
    research.update(summary=counts, generatedAt=now, circles=final)
    catalog.update(counts=counts, revision=now, researchedAt=now)
    fields = ('space', 'name', 'x', 'pixiv', 'web', 'extras', 'status', 'sources', 'notes', 'additionalSearchPending')
    catalog['circles'] = [{k: c[k] for k in fields} for c in final]
    compact = json.dumps(catalog, ensure_ascii=False, separators=(',', ':'))
    (ROOT / 'data/circles77.json').write_text(compact + '\n')
    (ROOT / 'data/circles77.js').write_text('window.CATALOG_DATA=' + compact + ';\n')
    (ROOT / 'data/research77.full.json').write_text(json.dumps(research, ensure_ascii=False, indent=2) + '\n')
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator='\n')
    writer.writerow(['配置', 'サークル名', 'X', 'pixiv', 'Web', 'X調査状況', 'pixiv調査状況', 'Web調査状況', '補助リンク', '根拠URL', '検索語', '確認メモ'])
    labels = {'found':'発見済み', 'not_found':'調査済み・未発見', 'blocked':'要確認・閲覧制限等', 'ambiguous':'要確認・同一性未確定', 'pending':'追加確認待ち', 'unresearched':'未調査'}
    def safe(value):
        s = str(value)
        return "'" + s if s.startswith(('=', '+', '-', '@', '\t', '\r')) else s
    for c in final:
        row = [c['space'], c['name'], c['x'], c['pixiv'], c['web'], *[labels[c['status'][k]] for k in CHANNELS], '\n'.join(e['label'] + ': ' + e['url'] for e in c['extras']), '\n'.join(s['url'] for s in c['sources']), '\n'.join(c['queries']), c['notes']]
        writer.writerow([safe(v) for v in row])
    (ROOT / 'data/research77.csv').write_text(buffer.getvalue(), encoding='utf-8-sig')
    print(json.dumps({'roundId': rd['id'], 'alreadyApplied': applied, 'counts': counts}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('round_file', type=Path)
    apply(parser.parse_args().round_file.resolve())
