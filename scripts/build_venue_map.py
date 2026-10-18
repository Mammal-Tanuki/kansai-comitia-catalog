"""Extract the official KC77 page-10 floor plan and its numbered cells.

Usage: python scripts/build_venue_map.py /path/to/77csanka.pdf
Requires PyMuPDF. Only the public diagram and geometry enter the repository.
"""
import argparse
import hashlib
import json
import unicodedata
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://www.k-comitia.com/pdf/77csanka.pdf#page=10'
DIGITS = {0xF6B1 + i: str(i) for i in range(10)}


def build(pdf_path):
    pdf = fitz.open(pdf_path)
    page = pdf[9]
    crop = fitz.Rect(18, 16, 500, 568)
    spans = [s for b in page.get_text('dict', flags=fitz.TEXTFLAGS_TEXT)['blocks']
             for line in b.get('lines', []) for s in line['spans']]
    numbers, labels = [], []
    for s in spans:
        text = unicodedata.normalize('NFKC', s['text'].translate(DIGITS))
        if s['font'] == 'SourceHanSans-Regular' and abs(s['size'] - 4.8218) < .01 and len(text) == 2 and text.isdecimal():
            numbers.append((text, fitz.Point(s['origin'])))
        if len(text) == 1 and text in 'ABCDEFGHIJKLMNOP' and s['size'] > 8:
            labels.append((text, (s['bbox'][0] + s['bbox'][2]) / 2))
    # Every outlined table holds two vertically stacked numbered spaces.
    tables = [d['rect'] for d in page.get_drawings()
              if len(d['items']) == 1 and d['items'][0][0] == 're'
              and 6 < d['rect'].width < 6.5 and 11 < d['rect'].height < 12]
    assert len(numbers) == 1450 and len(tables) == 725
    spots = {}
    for table in tables:
        pair = sorted([(text, point) for text, point in numbers if table.contains(point)], key=lambda n: n[1].y)
        assert len(pair) == 2, (table, pair)
        candidates = [(letter, x) for letter, x in labels if (letter in 'OP') == (table.y0 > 380)]
        letter = min(candidates, key=lambda item: abs(item[1] - (table.x0 + table.x1) / 2))[0]
        for half, (text, point) in enumerate(pair):
            space = letter + '-' + text
            assert space not in spots, space
            y = table.y0 + half * table.height / 2
            assert y <= point.y <= y + table.height / 2
            spots[space] = dict(space=space, x=round(table.x0 - crop.x0, 4), y=round(y - crop.y0, 4),
                                w=round(table.width, 4), h=round(table.height / 2, 4))
    roster = json.loads((ROOT / 'data/circles77.json').read_text())['circles']
    wanted = {c['space'] for c in roster}
    assert len(wanted) == 1442 and wanted <= spots.keys()
    omitted = sorted(spots.keys() - wanted)
    assert len(omitted) == 8
    out = ROOT / 'map'
    out.mkdir(exist_ok=True)
    page.get_pixmap(matrix=fitz.Matrix(4, 4), clip=crop, alpha=False).save(out / 'venue77.png')
    data = dict(schema='kansai-comitia-venue-v1', event=77, width=crop.width, height=crop.height,
                image='./map/venue77.png', source=SOURCE, sourcePage=10,
                sourceSha256=hashlib.sha256(pdf_path.read_bytes()).hexdigest(),
                printedSpaces=1450, catalogSpaces=1442, unlistedSpaces=omitted,
                views=[dict(id='all', label='全体', x=0, y=0, w=crop.width, h=crop.height),
                       dict(id='main', label='大展示場 A〜N', x=0, y=0, w=crop.width, h=368),
                       dict(id='annex', label='1階 O・P', x=47, y=367, w=155, h=185)],
                spots=[spots[s] for s in sorted(wanted)])
    encoded = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    (out / 'venue77.json').write_text(encoded + '\n')
    (out / 'venue77.js').write_text('window.VENUE_MAP_DATA=' + encoded + ';\n')
    print(json.dumps(dict(mapped=len(wanted), unlisted=omitted, imageBytes=(out / 'venue77.png').stat().st_size)))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('pdf', type=Path)
    build(parser.parse_args().pdf)
