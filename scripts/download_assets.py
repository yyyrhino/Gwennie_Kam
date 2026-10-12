"""Download publicly served image assets used by the replicated Readymag pages.
Run again after additional .reference/rendered/*.json files have appeared.
Images keep all layout/crop/size parameters; e and nll are transport aliases.
"""
import concurrent.futures
import hashlib
import html
import json
import pathlib
import re
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'assets'
IMAGES = ASSETS / 'images'
MANIFEST = ASSETS / 'manifest.json'
ERRORS = ASSETS / 'download-errors.json'
CSS_URL = 'https://st-p.rmcdn1.net/21b0b7b5/dist/viewer.css'
URL_PATTERN = re.compile(r'https?://[^\s"\'<>);]+')
IMAGE_PATTERN = re.compile(r'\.(?:png|jpe?g|webp|gif|avif)(?:\?|$)', re.I)
ALLOWED_HOSTS = {'i-p.rmcdn.net', 'c-p.rmcdn1.net', 'c-p.rmcdn.net', 'v-p.rmcdn1.net'}
MAX_IMAGE_BYTES = 50 * 1024 * 1024

def canonical_url(value):
    value = html.unescape(value)
    parts = urllib.parse.urlsplit(value)
    query = sorted((k, v) for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
                   if k not in {'e', 'nll'})
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path,
                                  urllib.parse.urlencode(query), ''))

def collect_from_text(text, found):
    for url in URL_PATTERN.findall(html.unescape(text)):
        if not IMAGE_PATTERN.search(url):
            continue
        parts = urllib.parse.urlsplit(url)
        if parts.netloc not in ALLOWED_HOSTS:
            continue
        found.add(url)

def collect_urls():
    found = set()
    snippets = sorted((ROOT / '.reference' / 'pages').glob('*.html'))
    rendered = sorted((ROOT / '.reference' / 'rendered').glob('*.json'))
    for path in snippets:
        collect_from_text(path.read_text(encoding='utf-8-sig'), found)
    for path in rendered:
        try:
            data = json.loads(path.read_text(encoding='utf-8-sig'))
        except (json.JSONDecodeError, OSError):
            continue
        collect_from_text(data.get('html', ''), found)
        for item in data.get('images', []):
            if isinstance(item, str):
                collect_from_text(item, found)
            elif isinstance(item, dict):
                collect_from_text(item.get('src', ''), found)
                collect_from_text(item.get('srcset', ''), found)
    print(f'Inputs: {len(snippets)} snippets, {len(rendered)} rendered pages; {len(found)} image URL aliases', flush=True)
    return found

def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=50) as response:
        content_type = response.headers.get('Content-Type', '').split(';')[0].lower()
        length = response.headers.get('Content-Length')
        if length and int(length) > MAX_IMAGE_BYTES:
            raise ValueError('Image exceeds 50 MiB size limit')
        data = response.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError('Image exceeds 50 MiB size limit')
    return data, content_type

def download_image(url):
    try:
        data, content_type = fetch(url)
        ext = pathlib.PurePosixPath(urllib.parse.urlsplit(url).path).suffix.lower()
        ext = {'image/webp': '.webp', 'image/png': '.png', 'image/jpeg': '.jpg',
               'image/gif': '.gif', 'image/avif': '.avif'}.get(content_type, ext)
        if content_type and not content_type.startswith('image/'):
            raise ValueError(f'Unexpected content type {content_type}')
        filename = hashlib.sha256(url.encode()).hexdigest()[:20] + ext
        relative = 'assets/images/' + filename
        (IMAGES / filename).write_bytes(data)
        return url, relative, len(data), None
    except Exception as error:
        return url, None, 0, str(error)

def main():
    IMAGES.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8')) if MANIFEST.exists() else {}
    failures = json.loads(ERRORS.read_text(encoding='utf-8')) if ERRORS.exists() else {}
    originals = collect_urls()
    aliases = {}
    for original in originals:
        aliases.setdefault(canonical_url(original), []).append(original)
    pending = []
    for canonical, originals_for_url in aliases.items():
        local = manifest.get(canonical)
        if not local:
            local = next((manifest.get(original) for original in originals_for_url if manifest.get(original)), None)
        if local and (ROOT / local).is_file():
            manifest[canonical] = local
            for original in originals_for_url:
                manifest[original] = local
        elif canonical not in failures:
            pending.append(canonical)
    print(f'Download: {len(pending)} new canonical images; {len(aliases)} canonical images total', flush=True)
    completed = 0
    total_bytes = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(download_image, url) for url in pending]
        for future in concurrent.futures.as_completed(futures):
            canonical, relative, size, error = future.result()
            completed += 1
            if error:
                failures[canonical] = error
                print(f'FAILED {canonical}: {error}', flush=True)
            else:
                manifest[canonical] = relative
                for original in aliases[canonical]:
                    manifest[original] = relative
                total_bytes += size
            if completed % 20 == 0:
                print(f'Progress: {completed}/{len(pending)}, {total_bytes/1024/1024:.1f} MiB', flush=True)
    MANIFEST.write_text(json.dumps(dict(sorted(manifest.items())), ensure_ascii=False, indent=2), encoding='utf-8')
    ERRORS.write_text(json.dumps(dict(sorted(failures.items())), ensure_ascii=False, indent=2), encoding='utf-8')
    css_path = ASSETS / 'readymag-base.css'
    if not css_path.exists():
        try:
            data, _ = fetch(CSS_URL)
            css_path.write_bytes(data)
            print(f'Base CSS: {len(data)} bytes', flush=True)
        except Exception as error:
            print(f'Base CSS failed: {error}', flush=True)
    print(f'Finished: {len(set(manifest.values()))} files, {len(manifest)} mapped URL aliases, {len(failures)} failed URLs', flush=True)

if __name__ == '__main__':
    main()
