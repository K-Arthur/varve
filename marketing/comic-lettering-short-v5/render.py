"""V5: live lettering actions with the V4 / email-v6 visual language.

Python 3 + Pillow + NumPy + FFmpeg; run --preview before the full render.
The uploaded VO/timing files remain byte-for-byte originals.
"""

import argparse
import functools
import json
import math
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / "out"
WORK = ROOT / "work" / "comic-lettering-v5"
W, H, FPS, FRAMES = 1080, 1920, 30, 1080
DURATION = FRAMES / FPS
PLAN = json.loads((HERE / "edit-plan.json").read_text())
TIMINGS = json.loads((HERE / "vo3-timings.json").read_text())
# The source is explicit so audio-corrected timing can be reviewed separately
# without modifying the required original upload.
CAPTION_FILE = HERE / "caption-timings.json"
CAPTION_TIMINGS = json.loads((CAPTION_FILE if CAPTION_FILE.exists() else HERE / "vo3-timings.json").read_text())
WORDS = [dict(w, id=f"{b['beat']}-{i}") for b in CAPTION_TIMINGS["beats"] for i, w in enumerate(b["words"])]
T = {
    "blue": (59, 130, 246), "keyword": (37, 99, 235),
    "white": (247, 250, 255), "muted": (174, 191, 213),
    "caption": (7, 12, 22, 245), "border": (66, 86, 116),
    "chip": (13, 27, 46), "captionY": 310, "captionSize": 76,
    "cx": 540, "cy": 1000, "radius": 20,
}
FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")


def run(cmd, **kwargs):
    return subprocess.run(cmd, check=True, **kwargs)


@functools.lru_cache(maxsize=40)
def font(size, bold=False):
    return ImageFont.truetype(str(FONT_DIR / ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf")), size)


def ease(p):
    p = min(1, max(0, p))
    return 4 * p**3 if p < .5 else 1 - (-2 * p + 2)**3 / 2


@functools.lru_cache(maxsize=1)
def background():
    # Same navy/teal field as email-v6 helpers6.py, with static restrained grain.
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    base = np.zeros((H, W, 3), np.float32) + np.array([7, 8, 11])
    base += np.exp(-(((x - 300) / 700)**2 + ((y - 700) / 800)**2))[..., None] * np.array([12, 22, 52])
    base += np.exp(-(((x - 850) / 600)**2 + ((y - 1500) / 700)**2))[..., None] * np.array([6, 26, 30])
    base += np.random.default_rng(3).normal(0, 1.8, (H, W, 1))
    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).convert("RGBA")


@functools.lru_cache(maxsize=24)
def mask(size):
    m = Image.new("L", size)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), T["radius"], fill=255)
    return m


@functools.lru_cache(maxsize=24)
def shadow(size, cy=1000):
    sh = Image.new("RGBA", (W, H))
    x, y = (W - size[0]) // 2, cy - size[1] // 2
    ImageDraw.Draw(sh).rounded_rectangle((x + 8, y + 30, x + size[0] + 8, y + size[1] + 30),
                                       T["radius"], fill=(0, 0, 0, 160))
    return sh.filter(ImageFilter.GaussianBlur(32))


def caption_groups():
    groups = []
    for b, counts in zip(CAPTION_TIMINGS["beats"], PLAN["captionPhraseWordCounts"]):
        ws = [w for w in WORDS if w["id"].startswith(f"{b['beat']}-")]
        # One shared boundary word keeps intentional overlapping source intervals
        # visible across phrase changes, without dropping either blue highlight.
        j = 0
        assert sum(counts) == len(ws)
        for count in counts:
            overlaps = j > 0 and ws[j - 1]["end"] > ws[j]["start"]
            group = ws[j - 1 if overlaps else j:j + count]
            groups.append(dict(words=group, start=ws[j]["start"],
                               end=ws[j + count - 1]["end"]))
            j += count
    for a, b in zip(groups, groups[1:]):
        if b["start"] < a["end"]:
            a["end"] = b["start"]
    return groups


GROUPS = caption_groups()


def caption_layout(t):
    g = next((g for g in GROUPS if g["start"] <= t < g["end"]), None)
    # Let the engagement question breathe between its VO and the follow line.
    # Every blue word still uses its original, exact start/end interval.
    if not g and 32.447 <= t < 33.477:
        g = next(g for g in GROUPS if g["words"][0]["id"] == "6-0")
    if not g:
        return []
    size, gap = T["captionSize"], 18
    lines, line, total = [], [], 0
    for w in g["words"]:
        tw = font(size, True).getlength(w["word"])
        if line and total + gap + tw > 706:
            lines.append(line)
            line, total = [], 0
        line.append((w, tw))
        total += tw + (gap if len(line) > 1 else 0)
    if line:
        lines.append(line)
    assert len(lines) <= 2
    result = []
    for row, line in enumerate(lines):
        total = sum(tw for _, tw in line) + gap * (len(line) - 1)
        x = (W - total) / 2
        y = T["captionY"] + 20 + row * 92
        for w, tw in line:
            result.append(dict(word=w, rect=(round(x - 5), y - 6, round(x + tw + 5), y + 77),
                               xy=(x, y), active=w["start"] <= t < w["end"]))
            x += tw + gap
    return result


def captions(im, t):
    layout = caption_layout(t)
    if not layout:
        return
    box = (min(p["rect"][0] for p in layout) - 17, T["captionY"],
           max(p["rect"][2] for p in layout) + 17,
           max(p["rect"][3] for p in layout) + 14)
    assert box[0] >= 150 and box[2] <= 930 and box[3] < 580
    d = ImageDraw.Draw(im)
    d.rounded_rectangle(box, 17, fill=T["caption"], outline=T["border"], width=2)
    for p in layout:
        if p["active"]:
            d.rounded_rectangle(p["rect"], 9, fill=T["keyword"])
        d.text(p["xy"], p["word"]["word"], font=font(T["captionSize"], True), fill=T["white"], anchor="lt")


def focus_card(card, box, label):
    if not box:
        return card
    x0, y0, x1, y1 = [round(v) for v in box]
    x0, y0 = max(5, x0), max(5, y0)
    x1, y1 = min(card.width - 6, x1), min(card.height - 6, y1)
    assert x1 > x0 and y1 > y0, (label, box)
    shade = Image.new("RGBA", card.size, (5, 8, 16, 175))
    ImageDraw.Draw(shade).rounded_rectangle((x0, y0, x1, y1), 8, fill=(0, 0, 0, 0))
    card = Image.alpha_composite(card.convert("RGBA"), shade)
    d = ImageDraw.Draw(card)
    d.rounded_rectangle((x0, y0, x1, y1), 8, outline=T["blue"], width=3)
    for hx, hy in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
        d.rectangle((hx - 4, hy - 4, hx + 4, hy + 4), fill=T["white"], outline=T["blue"], width=1)
    cw, ch = math.ceil(font(24).getlength(label)) + 24, 42
    tx = max(7, min(card.width - cw - 7, x0))
    ty = y0 - ch - 8 if y0 > ch + 14 else y1 + 8
    ty = min(card.height - ch - 7, ty)
    d.rounded_rectangle((tx, ty, tx + cw, ty + ch), 7, fill=T["chip"], outline=T["blue"], width=1)
    d.text((tx + 12, ty + 8), label, font=font(24), fill=T["white"], anchor="lt")
    return card


def brand(im):
    icon = Image.open(ROOT / "apps/desktop/src-tauri/icons/icon.png").convert("RGBA").resize((44, 44), Image.Resampling.LANCZOS)
    x, y = 448, 1380
    im.alpha_composite(icon, (x, y - 6))
    d = ImageDraw.Draw(im)
    d.text((x + 58, y), "Varve", font=font(32, True), fill=T["white"], anchor="lt")
    d.text((x + 58, y + 37), "varve.studio", font=font(20), fill=T["muted"], anchor="lt")


def follow(im, t, start, end, final=False):
    """A small directional nudge below the artwork, animated on real VO."""
    if not start <= t < end:
        return
    enter = ease((t - start) / .3)
    leave = ease((end - t) / .25)
    layer = Image.new("RGBA", (W, H))
    d = ImageDraw.Draw(layer)
    y = round(1363 + 24 * (1 - enter))
    size = 34 if final else 28
    text = "Follow for the next drop" if final else "Follow the next drop"
    width = math.ceil(font(size, True).getlength(text)) + 94
    x = (W - width) // 2
    d.rounded_rectangle((x, y, x + width, y + 68), 12,
                        fill=T["chip"], outline=T["blue"], width=2)
    d.text((x + 20, y + 19), text, font=font(size, True), fill=T["white"], anchor="lt")
    ax = x + width - 40 + round(5 * math.sin((t - start) * 5))
    d.line((ax - 13, y + 34, ax + 10, y + 34), fill=T["blue"], width=3)
    d.line((ax + 2, y + 26, ax + 10, y + 34, ax + 2, y + 42), fill=T["blue"], width=3)
    progress = min(1, (t - start) / 1.2)
    d.line((x + 15, y + 65, x + 15 + (width - 30) * progress, y + 65), fill=T["blue"], width=3)
    layer.putalpha(layer.getchannel("A").point(lambda a: round(a * enter * leave)))
    im.alpha_composite(layer)


class Reader:
    def __init__(self, shot):
        self.s, self.proc = shot, None
        self.still_image = None
        self.size = None

    def command(self, offset=0, one=False):
        s = self.s
        probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", str(ROOT / s["source"])]))
        stream = probe["streams"][0]
        self.size = (stream["width"], stream["height"])
        rate = s["speed"]
        cmd = ["ffmpeg", "-v", "error", "-threads", "2", "-ss", str(s["sourceStart"] + offset / FPS * rate), "-i", str(ROOT / s["source"]), "-an"]
        if rate:
            cmd += ["-vf", f"setpts=(PTS-STARTPTS)/{rate},fps={FPS}"]
        cmd += ["-frames:v", "1" if one or not rate else str(s["toFrame"] - s["fromFrame"]), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
        return cmd

    def still(self, offset=0):
        data = subprocess.check_output(self.command(offset, True))
        return Image.frombytes("RGB", self.size, data)

    def next(self):
        if not self.s["speed"]:
            if self.still_image is None:
                self.still_image = self.still()
            return self.still_image
        if self.proc is None:
            self.proc = subprocess.Popen(self.command(), stdout=subprocess.PIPE)
        data = self.proc.stdout.read(self.size[0] * self.size[1] * 3)
        if len(data) != self.size[0] * self.size[1] * 3:
            raise RuntimeError(f"Source ended in {self.s['id']}")
        return Image.frombytes("RGB", self.size, data)

    def close(self):
        if self.proc:
            self.proc.stdout.close()
            if self.proc.wait():
                raise RuntimeError(f"Decode failed in {self.s['id']}")


def visual(n, shot, evidence=None):
    im = background().copy()
    if not shot.get("kind"):
        t = (n - shot["fromFrame"]) / FPS
        e = ease(t / shot["moveSeconds"])
        crop = tuple(a + (b - a) * e for a, b in zip(shot["crop"], shot["endCrop"]))
        cw, ch = shot["cardSize"]
        card = evidence.resize((cw, ch), Image.Resampling.BICUBIC, box=crop).convert("RGBA")
        f = shot.get("focus")
        label = shot.get("label", "")
        if shot.get("focusSteps"):
            step = max((step for step in shot["focusSteps"] if step["start"] <= n / FPS + 1e-8), key=lambda step: step["start"])
            f, label = step["box"], step["label"]
        if f:
            box = ((f[0] - crop[0]) * cw / (crop[2] - crop[0]), (f[1] - crop[1]) * ch / (crop[3] - crop[1]),
                   (f[2] - crop[0]) * cw / (crop[2] - crop[0]), (f[3] - crop[1]) * ch / (crop[3] - crop[1]))
            card = focus_card(card, box, label)
        card.putalpha(mask((cw, ch)))
        ImageDraw.Draw(card).rounded_rectangle((0, 0, cw - 1, ch - 1), T["radius"], outline=(255, 255, 255, 46), width=2)
        cy = shot.get("cardCenterY", T["cy"])
        im.alpha_composite(shadow((cw, ch), cy))
        im.alpha_composite(card, ((W - cw) // 2, cy - ch // 2))
        if 25.2333 <= n / FPS < 30.8:
            brand(im)
    follow(im, n / FPS, 22.5, 24.8)
    follow(im, n / FPS, 33.477, 35.5, final=True)
    captions(im, n / FPS)
    return im.convert("RGB")


def render_frame(n):
    s = next(s for s in PLAN["shots"] if s["fromFrame"] <= n < s["toFrame"])
    evidence = None if s.get("kind") else Reader(s).still(n - s["fromFrame"])
    return visual(n, s, evidence)


def mix_audio():
    inputs, filters, reports = [], [], []
    for i, b in enumerate(TIMINGS["beats"]):
        path = HERE / f"vo3-{i + 1}.mp3"
        p = run(["ffmpeg", "-v", "info", "-i", str(path), "-af", "loudnorm=I=-16:TP=-1.5:LRA=7:print_format=json", "-f", "null", "-"], capture_output=True)
        log = p.stderr.decode()
        info = json.loads(log[log.rfind("{"):log.rfind("}") + 1])
        reports.append(dict(beat=i + 1, **info))
        norm = (f"loudnorm=I=-16:TP=-1.5:LRA=7:measured_I={info['input_i']}:measured_TP={info['input_tp']}:"
                f"measured_LRA={info['input_lra']}:measured_thresh={info['input_thresh']}:offset={info['target_offset']}:linear=true")
        inputs += ["-i", str(path)]
        # Keep the complete original clip: JSON beat durations omit audible tails.
        filters.append(f"[{i}:a]{norm},aresample=48000,adelay={round(b['start'] * 48000)}S:all=1[a{i}]")
    filters.append("".join(f"[a{i}]" for i in range(6)) + f"amix=inputs=6:normalize=0,apad,atrim=duration={DURATION}[vo]")
    run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", ";".join(filters), "-map", "[vo]", "-ar", "48000", "-c:a", "pcm_s16le", str(OUT / "voiceover.wav")])
    (OUT / "audio-normalization.json").write_text(json.dumps(reports, indent=2) + "\n")


def render():
    mix_audio()
    silent = WORK / "visual.mp4"
    enc = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264", "-threads", "4", "-preset", "fast", "-crf", "17", "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-movflags", "+faststart", str(silent)], stdin=subprocess.PIPE)
    try:
        for s in PLAN["shots"]:
            reader = None if s.get("kind") else Reader(s)
            for n in range(s["fromFrame"], s["toFrame"]):
                im = visual(n, s, reader.next() if reader else None)
                enc.stdin.write(im.tobytes())
                if n % 90 == 0:
                    print(f"Rendered {n}/{FRAMES}", flush=True)
            if reader:
                reader.close()
        enc.stdin.close()
        if enc.wait():
            raise RuntimeError("Video encoder failed")
    except BaseException:
        enc.kill()
        raise
    video = OUT / "comic-lettering-short-v5.mp4"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(silent), "-i", str(OUT / "voiceover.wav"), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", str(DURATION), "-movflags", "+faststart", str(video)])
    for i, n in enumerate(PLAN["grabs"], 1):
        run(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-vf", f"select=eq(n\\,{n})", "-frames:v", "1", str(OUT / f"frame-{i:02}.png")])
    print(f"Finished {video}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--frame", type=int)
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    if args.frame is not None:
        render_frame(args.frame).save(WORK / f"preview-{args.frame:04}.png")
    elif args.preview:
        sheet = Image.new("RGB", (1080, math.ceil(len(PLAN["grabs"]) / 3) * 640))
        for i, n in enumerate(PLAN["grabs"]):
            im = render_frame(n)
            im.save(WORK / f"preview-{n:04}.png")
            sheet.paste(im.resize((360, 640), Image.Resampling.LANCZOS), ((i % 3) * 360, (i // 3) * 640))
        sheet.save(WORK / "preview-sheet.jpg", quality=94)
    else:
        render()
