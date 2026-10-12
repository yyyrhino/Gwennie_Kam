"""Save the site's public, unencrypted HLS clips and rewrite references locally.
No software is installed. Encrypted playlists and HTTP 403 stop that clip.
"""
import concurrent.futures
import hashlib
import json
import pathlib
import re
import threading
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
VIDEO_ROOT = ROOT / 'assets/videos'
MAX_BYTES = 50 * 1024 * 1024
ALLOWED_HOSTS = {'v-p.rmcdn1.net'}


def fetch(url):
    if urllib.parse.urlsplit(url).hostname not in ALLOWED_HOSTS:
        raise ValueError('Unexpected media host: ' + url)
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(request, timeout=45) as response:
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError('Media resource exceeds 50 MiB')
    return data


def attributes(line):
    return {key: value.strip('"') for key, value in
            re.findall(r'([A-Z0-9-]+)=("[^"]*"|[^,]*)', line)}


def build_plan(source, directory):
    playlists = {}
    binaries = {}
    seen = {}

    def local_name(url, playlist=False):
        suffix = '.m3u8' if playlist else pathlib.PurePosixPath(urllib.parse.urlsplit(url).path).suffix
        return hashlib.sha256(url.encode()).hexdigest()[:16] + (suffix or '.bin')

    def visit(url, filename='playlist.m3u8', depth=0):
        if depth > 5:
            raise ValueError('Playlist recursion exceeds five levels')
        if url in seen:
            return seen[url]
        text = fetch(url).decode('utf-8-sig')
        if not text.lstrip().startswith('#EXTM3U'):
            raise ValueError('Not an HLS playlist')
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        for line in lines:
            if line.startswith(('#EXT-X-KEY:', '#EXT-X-SESSION-KEY:')):
                if attributes(line).get('METHOD', '').upper() != 'NONE':
                    raise ValueError('Encrypted HLS detected; no keys or media will be downloaded')
        seen[url] = filename
        variants = []
        for index, line in enumerate(lines):
            if line.startswith('#EXT-X-STREAM-INF:'):
                attrs = attributes(line)
                resolution = attrs.get('RESOLUTION', '0x0').split('x')
                height = int(resolution[-1]) if resolution[-1].isdigit() else 0
                variants.append((index, attrs, height, int(attrs.get('BANDWIDTH', '0'))))
        selected = None
        audio_group = None
        if variants:
            suitable = [variant for variant in variants if variant[2] <= 1080]
            if not suitable:
                raise ValueError('No HLS variant at or below 1080p')
            selected = max(suitable, key=lambda variant: (variant[2], variant[3]))
            audio_group = selected[1].get('AUDIO')
        rewritten = []
        skip_next_variant_uri = False
        for index, line in enumerate(lines):
            if line.startswith('#EXT-X-I-FRAME-STREAM-INF:'):
                continue
            if line.startswith('#EXT-X-STREAM-INF:'):
                skip_next_variant_uri = index != selected[0]
                if not skip_next_variant_uri:
                    rewritten.append(line)
                continue
            if not line.startswith('#'):
                if skip_next_variant_uri:
                    skip_next_variant_uri = False
                    continue
                remote = urllib.parse.urljoin(url, line)
                if variants or urllib.parse.urlsplit(remote).path.endswith('.m3u8'):
                    local = visit(remote, local_name(remote, True), depth + 1)
                else:
                    local = local_name(remote)
                    binaries[remote] = directory / local
                rewritten.append(local)
                continue
            if line.startswith('#EXT-X-MEDIA:'):
                attrs = attributes(line)
                if attrs.get('TYPE') != 'AUDIO' or attrs.get('GROUP-ID') != audio_group:
                    continue
            match = re.search(r'URI="([^"]+)"', line)
            if match and not line.startswith(('#EXT-X-KEY:', '#EXT-X-SESSION-KEY:')):
                remote = urllib.parse.urljoin(url, match.group(1))
                if urllib.parse.urlsplit(remote).path.endswith('.m3u8'):
                    local = visit(remote, local_name(remote, True), depth + 1)
                else:
                    local = local_name(remote)
                    binaries[remote] = directory / local
                line = line[:match.start(1)] + local + line[match.end(1):]
            rewritten.append(line)
        playlists[directory / filename] = '\n'.join(rewritten) + '\n'
        return filename

    visit(source)
    return playlists, binaries


def main():
    widgets = json.loads((ROOT / '.reference/widgets/p06.json').read_text(encoding='utf-8-sig'))
    image_manifest = json.loads((ROOT / 'assets/manifest.json').read_text(encoding='utf-8'))
    plans = {}
    errors = {}
    manifest = {}
    for widget in widgets:
        if widget.get('type') != 'video' or widget.get('provider_name') != 'File':
            continue
        widget_id = widget['_id']
        if not re.fullmatch(r'[a-f0-9]+', widget_id):
            raise ValueError('Invalid widget ID')
        source = widget['url']
        if not source.startswith('https://'):
            source = 'https://v-p.rmcdn1.net/' + source
        poster = widget.get('thumbnail_url', '')
        if poster and not poster.startswith('https://'):
            poster = 'https://v-p.rmcdn1.net/' + poster
        manifest[widget_id] = {'source': source, 'path': None,
                               'poster': image_manifest.get(poster, poster)}
        try:
            directory = VIDEO_ROOT / widget_id
            playlists, binaries = build_plan(source, directory)
            directory.mkdir(parents=True, exist_ok=True)
            plans[widget_id] = (playlists, binaries)
            print(widget_id, 'unencrypted playlists', len(playlists), 'media resources', len(binaries), flush=True)
        except Exception as error:
            errors[widget_id] = str(error)
            print(widget_id, 'STOPPED', str(error), flush=True)
    lock = threading.Lock()

    def download(widget_id, url, destination):
        with lock:
            if widget_id in errors:
                return 0
        if destination.is_file() and destination.stat().st_size:
            return 0
        try:
            data = fetch(url)
            with lock:
                if widget_id in errors:
                    return 0
            destination.write_bytes(data)
            return len(data)
        except Exception as error:
            with lock:
                errors[widget_id] = str(error)
            print(widget_id, 'STOPPED', str(error), flush=True)
            return 0

    tasks = [(widget_id, url, destination) for widget_id, (_, binaries) in plans.items()
             for url, destination in binaries.items()]
    total = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(download, *task) for task in tasks]
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            total += future.result()
            if index % 20 == 0:
                print('Progress', index, '/', len(tasks), f'{total/1024/1024:.1f} MiB', flush=True)
    for widget_id, (playlists, binaries) in plans.items():
        if widget_id in errors:
            continue
        missing = [str(path) for path in binaries.values() if not path.is_file()]
        if missing:
            errors[widget_id] = 'Missing local segment files: ' + ', '.join(missing)
            continue
        for path, text in playlists.items():
            path.write_text(text, encoding='utf-8')
        for path, text in playlists.items():
            references = [line for line in text.splitlines() if line and not line.startswith('#')]
            references += re.findall(r'URI="([^"]+)"', text)
            missing = [reference for reference in references if not (path.parent / reference).is_file()]
            if missing:
                errors[widget_id] = 'Playlist references missing files: ' + ', '.join(missing)
                break
        if widget_id not in errors:
            manifest[widget_id]['path'] = f'assets/videos/{widget_id}/playlist.m3u8'
            print(widget_id, 'COMPLETE', len(binaries), 'media files', flush=True)
    for widget_id, error in errors.items():
        manifest[widget_id]['error'] = error
    (ROOT / 'assets/video-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print('Saved video manifest; completed', sum(bool(item['path']) for item in manifest.values()), 'of', len(manifest), flush=True)


if __name__ == '__main__':
    main()
