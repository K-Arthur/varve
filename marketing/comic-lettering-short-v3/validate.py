"""Validate encoded media, every caption frame, and absolute VO placement."""
import array
import hashlib
import importlib.util
import json
import math
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('v3', HERE / 'render.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
VIDEO = HERE / 'out/comic-lettering-short-v3.mp4'


def command(args):
    return subprocess.check_output(args)


def pcm(path):
    return array.array('h', command(['ffmpeg', '-v', 'error', '-i', str(path),
                                   '-ar', '48000', '-ac', '1', '-f', 's16le', '-']))


def validate():
    probe = json.loads(command(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(VIDEO)]))
    v, a = probe['streams']
    assert (v['width'], v['height'], v['r_frame_rate'], int(v['nb_frames'])) == (1080, 1920, '30/1', r.FRAMES)
    assert v['pix_fmt'] == 'yuv420p' and len(probe['streams']) == 2
    assert abs(float(probe['format']['duration']) - 36) < .001
    assert min(s['durationInFrames'] for s in r.EDL['scenes']) >= 120
    assert r.EDL['shots'][0]['fromFrame'] == 0 and r.EDL['shots'][-1]['toFrame'] == r.FRAMES
    assert all(x['toFrame'] == y['fromFrame'] for x, y in zip(r.EDL['shots'], r.EDL['shots'][1:]))
    # Decode the encoded caption strip for EVERY output frame; check the highlight
    # at each word's horizontal centre, above glyphs, against the uploaded times.
    proc = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', str(VIDEO), '-an',
                             '-vf', 'crop=1080:100:0:140', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    checked, active_frames, failures = 0, 0, []
    all_words = [w for b in r.TIMINGS['beats'] for w in b['words']]
    coverage = {w['start']: 0 for w in all_words}
    for n in range(r.FRAMES):
        data = proc.stdout.read(1080 * 100 * 3)
        assert len(data) == 1080 * 100 * 3
        t = n / 30
        group = next((g for g in r.GROUPS if g[0]['start'] <= t < g[-1]['end']), [])
        expected = [w for w in all_words if w['start'] <= t < w['end']]
        assert len(expected) <= 1
        widths = [r.width(w['word'], r.T['captionSize'], 'bold') for w in group]
        total = sum(widths) + 12 * max(0, len(group) - 1)
        x = round((1080 - math.ceil(total + 48)) / 2) + 24
        found = []
        for w, width in zip(group, widths):
            px = round(x + width / 2)
            k = ((r.T['captionY'] + 15 - 140) * 1080 + px) * 3
            red, green, blue = data[k:k + 3]
            if red > 200 and green > 170 and blue < 165:
                found.append(w)
            x += width + 12
        if found != expected:
            failures.append({'frame': n, 'time': t, 'expected': expected, 'found': found})
        if expected:
            coverage[expected[0]['start']] += 1
            active_frames += 1
        checked += 1
    proc.stdout.close()
    assert proc.wait() == 0
    assert not failures, failures[:5]
    assert min(coverage.values()) > 0
    # Correlation with each ORIGINAL MP3 at its absolute sample offset catches
    # double-added beat offsets, trims at the wrong end and mux delays.
    mixed = pcm(VIDEO)
    correlations = []
    for b in r.TIMINGS['beats']:
        original = pcm(HERE / f"vo3-{b['beat']}.mp3")
        offset = round(b['start'] * 48000)
        length = min(len(original), round(b['duration'] * 48000))
        source = original[:length:8]
        target = mixed[offset:offset + length:8]
        dot = sum(x * y for x, y in zip(source, target))
        corr = dot / math.sqrt(sum(x*x for x in source) * sum(y*y for y in target))
        # Dynamic loudness limiting changes gain within a sentence. Require
        # the strongest correlation at the exact scheduled offset as well.
        lag_scores = {}
        energy = sum(x*x for x in source)
        for lag in range(-240, 241, 12):
            if offset + lag < 0:
                continue
            candidate = mixed[offset + lag:offset + lag + length:8]
            lag_scores[lag] = sum(x*y for x, y in zip(source, candidate)) / math.sqrt(energy * sum(y*y for y in candidate))
        best_lag = max(lag_scores, key=lag_scores.get)
        assert corr > .95 and best_lag == 0, (b['beat'], corr, best_lag)
        correlations.append({'beat': b['beat'], 'sampleOffset': offset, 'correlation': corr, 'bestLagSamples': best_lag})
    grabs = []
    for i in range(6):
        n = (2*i + 1) * 90
        raw = command(['ffmpeg', '-v', 'error', '-i', str(VIDEO), '-vf', f'select=eq(n\\,{n})', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
        from PIL import Image
        png = Image.open(HERE / f'out/frame-{i+1:02}.png').convert('RGB')
        assert png.tobytes() == raw
        grabs.append({'frame': n, 'seconds': n / 30})
    report = {'format': probe, 'captionFramesChecked': checked, 'activeCaptionFrames': active_frames,
              'wordsChecked': len(all_words), 'captionMismatches': failures,
              'timingRule': 'start <= frame/30 < end; uploaded absolute seconds unchanged',
              'boundaryResolutionSeconds': 1/30, 'audioCorrelations': correlations,
              'sceneDurationsSeconds': [s['durationInFrames']/30 for s in r.EDL['scenes']],
              'grabs': grabs, 'music': None,
              'speechReviewLimit': 'Checks verify supplied word intervals against pixels and original audio placement. Independent phonetic alignment/listening is not established by these checks.',
              'inputSHA256': {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(HERE.iterdir()) if f.suffix in ('.mp3', '.ttf')}}
    (HERE / 'out/validation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ['captionFramesChecked', 'wordsChecked', 'captionMismatches', 'audioCorrelations', 'sceneDurationsSeconds']}, indent=2))


if __name__ == '__main__':
    validate()
