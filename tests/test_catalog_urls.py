import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from build_catalog import extra_url, normalize


class EventLinks(unittest.TestCase):
    def test_event_post_opens_the_actual_post(self):
        row = {'space': 'G-80', 'name': 'クレイジー村', 'x': 'https://x.com/cre_rabbi',
               'pixiv': '', 'web': '', 'extras': [
                   {'kind': 'event', 'url': 'https://twitter.com/cre_rabbi/status/2110990186129891511?s=20', 'label': 'お品書き'}]}
        result = normalize(row, row)
        self.assertEqual(result['x'], 'https://x.com/cre_rabbi')
        self.assertEqual(result['extras'][0]['url'], 'https://x.com/cre_rabbi/status/2110990186129891511')

    def test_profile_normalization_stays_the_same(self):
        self.assertEqual(extra_url('https://twitter.com/cre_rabbi/status/123', 'x'), 'https://x.com/cre_rabbi')

    def test_invalid_and_vendor_links_are_still_rejected(self):
        for url in ['javascript:alert(1)', 'https://user:pass@x.com/cre_rabbi/status/123', 'https://x.com/booth_pm/status/123']:
            self.assertEqual(extra_url(url, 'event'), '')


if __name__ == '__main__':
    unittest.main()
