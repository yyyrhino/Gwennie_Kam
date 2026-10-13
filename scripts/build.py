"""Build the standalone, static copy from editable page fragments."""
import argparse
import html
import json
import re
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlparse, parse_qsl, urlencode

ROOT = Path(__file__).resolve().parents[1]


class ContainerEnd(HTMLParser):
    """Locate the authored canvas without depending on its closing-tag whitespace."""
    def __init__(self, markup):
        super().__init__(convert_charrefs=False)
        self.lines = markup.splitlines(keepends=True)
        self.depth = 0
        self.target_depth = None
        self.end = None
        self.feed(markup)

    def handle_starttag(self, tag, attrs):
        if tag == 'div':
            self.depth += 1
            if 'page-content-container' in dict(attrs).get('class', '').split():
                self.target_depth = self.depth

    def handle_endtag(self, tag):
        if tag == 'div':
            if self.depth == self.target_depth:
                line, column = self.getpos()
                self.end = sum(map(len, self.lines[:line - 1])) + column
                self.target_depth = None
            self.depth -= 1


class WidgetText(HTMLParser):
    def __init__(self, markup):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.ignored = 0
        self.feed(markup)

    def handle_starttag(self, tag, attrs):
        if tag in {'style', 'script'}:
            self.ignored += 1
        elif tag == 'br' and not self.ignored:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in {'style', 'script'}:
            self.ignored -= 1
        elif tag in {'div', 'p', 'h1', 'h2', 'h3', 'h4', 'li'} and not self.ignored:
            self.parts.append('\n')

    def handle_data(self, data):
        if not self.ignored:
            self.parts.append(data)


def canonical(url):
    parsed = urlparse(html.unescape(url))
    query = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True) if k not in {'e', 'nll'}]
    return parsed._replace(query=urlencode(sorted(query))).geturl()


def import_reference():
    reference = ROOT / '.reference'
    project = json.loads((reference / 'project.json').read_text(encoding='utf-8'))['project']
    manifest = json.loads((ROOT / 'assets/manifest.json').read_text(encoding='utf-8'))
    # The downloader exposes a flat mapping. Also accept a nested mapping for future updates.
    manifest = manifest.get('urls', manifest)
    content = ROOT / 'content'
    content.mkdir(exist_ok=True)
    supplements_file = reference / 'details/missing-widgets.json'
    supplements = json.loads(supplements_file.read_text(encoding='utf-8')) if supplements_file.exists() else {}
    pages = []
    for spec in project['pages']:
        slug = spec['pagePath']
        snapshot = reference / 'rendered' / f'{slug}.json'
        if snapshot.exists():
            data = json.loads(snapshot.read_text(encoding='utf-8'))
            fragment = data['html']
            text = data['text']
            head_styles = data.get('headStyles', '')
        else:
            fragment = (reference / 'pages' / f'{slug}.html').read_text(encoding='utf-8')
            fragment = re.sub(r'^<div id="mags">|</div>\s*$', '', fragment)
            text = ''
            head_styles = ''

        # Source React snapshots omit far-down widgets until the viewport approaches.
        # Restore their exact published HTML, rather than dropping the end of an article.
        missing = [item for item in supplements.get(slug, []) if f'data-id="{item["id"]}"' not in fragment]
        if missing:
            end = ContainerEnd(fragment).end
            if end is None:
                raise ValueError(f'Could not locate the {slug} canvas for lazy widgets')
            fragment = fragment[:end] + ''.join(item['html'] for item in missing) + fragment[end:]
            text += '\n' + '\n'.join(''.join(WidgetText(item['html']).parts).strip() for item in missing)

        def replace_url(match):
            raw = match.group()
            suffix = '&quot;' if raw.endswith('&quot;') else ''
            url = html.unescape(raw[:-6] if suffix else raw)
            local = manifest.get(url) or manifest.get(canonical(url))
            if isinstance(local, dict):
                local = local.get('path')
            return f'{{{{BASE}}}}{local}{suffix}' if local else match.group()

        fragment = re.sub(r'https://[^/\s"<>]+/[^\s"<>\)]+', replace_url, fragment)
        fragment = re.sub(r'<script\b[^>]*>.*?</script>', '', fragment, flags=re.S | re.I)
        # Published playback sessions use temporary blob URLs that cannot survive an export.
        fragment = re.sub(r'\s(?:src|data-src)="blob:[^"]*"', '', fragment)
        fragment = re.sub(r'(/u3079902493/5653771/)([a-z0-9]+)?/?', lambda m: '{{BASE}}' + ('' if (m[2] or 'cover') == 'cover' else m[2] + '/'), fragment)
        fragment = re.sub(r'<article\b[^>]*>', '<article class="page center-page neighbour" aria-label="Page content">', fragment, count=1)
        # Exported slideshow clones stay in the source; the native controller filters them.
        fragment = re.sub(r'(<a\b[^>]*target="_blank")(?![^>]*rel=)', r'\1 rel="noopener noreferrer"', fragment)
        (content / f'{slug}.html').write_text(fragment, encoding='utf-8')
        (content / f'{slug}.css').write_text(head_styles, encoding='utf-8')
        pages.append({'slug': slug, 'title': spec.get('title') or str(spec['num']), 'number': spec['num'], 'height': spec['height'], 'text': text})
    (content / 'pages.json').write_text(json.dumps(pages, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Imported {len(pages)} pages into content/')


def build():
    pages = json.loads((ROOT / 'content/pages.json').read_text(encoding='utf-8'))
    for spec in pages:
        slug = spec['slug']
        paths = [ROOT / slug / 'index.html']
        if slug == 'cover':
            paths.insert(0, ROOT / 'index.html')
        for output in paths:
            base = './' if output.parent == ROOT else '../'
            fragment = (ROOT / 'content' / f'{slug}.html').read_text(encoding='utf-8').replace('{{BASE}}', base)
            title = 'GWENDOLINE KAM' if slug == 'cover' else f'{spec["title"].strip()} · GWENDOLINE KAM'
            config = json.dumps({'slug': slug, 'height': spec['height'], 'designWidth': 1500, 'canvasWidth': 1024}, ensure_ascii=False)
            media_scripts = ''
            if slug == 'p06':
                media = json.loads((ROOT / 'assets/video-manifest.json').read_text(encoding='utf-8'))
                for item in media.values():
                    item['path'] = base + item['path']
                    item['poster'] = base + item['poster']
                media_scripts = f'<script>window.REPLICA_MEDIA_CONFIG = {json.dumps(media)};</script>\n  <script defer src="{base}assets/vendor/hls.min.js"></script>\n  <script defer src="{base}scripts/media.js"></script>'
            cover_script = f'\n  <script defer src="{base}scripts/cover-carousel.js"></script>' if slug == 'cover' else ''
            document = f'''<!doctype html>
<html lang="zh-Hant" class="js isdesktop no-isphone no-istablet cssanimations csstransforms csspositionsticky new-settings mobile-screenshots page-loaded">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
  <title>{html.escape(title)}</title>
  <meta name="description" content="Gwendoline Cho-ning Kam — artist, curator, writer and ethnomusicologist.">
  <link rel="stylesheet" href="{base}assets/fonts.css">
  <link rel="stylesheet" href="{base}assets/readymag-base.css">
  <link rel="stylesheet" href="{base}content/{slug}.css">
  <link rel="stylesheet" href="{base}styles.css">
  <script>window.REPLICA_PAGE = {config};</script>
  <script defer src="{base}scripts/layout.js"></script>
  <script defer src="{base}scripts/animation-config.js"></script>{cover_script}
  <script defer src="{base}scripts/interactions.js"></script>
  {media_scripts}
</head>
<body><main id="mags" aria-label="Gwendoline Kam portfolio">{fragment}</main></body>
</html>'''
            output.parent.mkdir(exist_ok=True)
            output.write_text(document, encoding='utf-8')
    print(f'Built {len(pages)} standalone pages and the homepage alias')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--import-reference', action='store_true')
    args = parser.parse_args()
    if args.import_reference:
        import_reference()
    build()
