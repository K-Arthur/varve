"""V3 delta rebuild of the V2 real-footage edit, extending V1's Pillow/FFmpeg rendering approach.

Run from anywhere: python3 marketing/comic-lettering-short-v3/render.py
Requires Python 3, Pillow, FFmpeg/FFprobe, and the two supplied fonts.
Use --preview for six layout previews; --frame N for a single output frame.
"""

import argparse
import functools
import json
import math
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
SCRATCH = ROOT.parent / "work" / "comic-lettering-v3"
W, H, FPS, FRAMES = 1080, 1920, 30, 1080
DURATION = FRAMES / FPS
TIMINGS = json.loads((HERE / "vo3-timings.json").read_text())
EDL = json.loads((HERE / "edit-plan.json").read_text())
STARTS = [round(b["start"] * FPS) for b in TIMINGS["beats"]]
LOOP_FRAME = FRAMES - 9

# Delivery graphics tokens, independent of the application UI, as in V1.
T = {
    "dark": "#10141E", "light": "#F4F2EB", "ink": "#141A26",
    "white": "#FFFFFF", "muted": "#A3AFBE", "blue": "#1765EB",
    "coral": "#FF806F", "lime": "#C6F574", "yellow": "#FFE16A",
    "red": "#DB3D39", "lineDark": "#293343", "lineLight": "#D4D5CF",
    "caption": (13, 18, 27, 218),
    "captionY": 146, "kickerY": 288, "headlineY": 350,
    "cardX": 81, "cardY": 678, "cardW": 918, "cardH": 914,
    "radius": 34, "captionSize": 44, "footerY": 1696,
}
FONT_FILES = {
    "heavy": HERE / "ArchivoBlack.ttf",
    "bold": HERE / "InterTight-ExtraBold.ttf",
    "regular": HERE / "InterTight-ExtraBold.ttf",
}
HEADLINES = [
    [[("Never ", None), ("baked", "coral")], [("into pixels.", None)]],
    [[("Rewrite", "blue")], [("inside the balloon.", None)]],
    [[("Balloons that", None)], [("fit themselves.", "lime")]],
    [[("Speech. Thoughts.", None)], [("Shouts.", "blue")]],
    [[("Free. Local-first.", None)], [("Yours.", "yellow")]],
    [[("What would", None)], [("YOUR", "boxed"), (" comic say?", None)]],
]
KICKERS = ["VARVE · COMIC LETTERING", "01 / CHANGE THE LINE",
           "02 / MAKE ROOM FOR WORDS", "03 / EVERY KIND OF VOICE",
           "04 / MADE ON YOUR MACHINE", "YOUR NEXT PANEL"]
BADGES = ["REAL APP. REAL LETTERING.", "LIVE TEXT", "LIVE BALLOON CONTROLS",
          "SPEECH / THOUGHT / SHOUT", "LOCAL-FIRST", "NEVER BAKED INTO PIXELS."]
ACCENTS = ["coral", "blue", "lime", "blue", "yellow", "blue"]


def run(cmd, **kwargs):
    return subprocess.run(cmd, check=True, **kwargs)


@functools.lru_cache(maxsize=80)
def font(size, weight="heavy"):
    return ImageFont.truetype(str(FONT_FILES[weight]), size)


def width(text, size, weight="heavy"):
    return font(size, weight).getlength(text)


def text(draw, xy, value, size, fill, weight="heavy", anchor="lt"):
    draw.text(xy, value, font=font(size, weight), fill=fill, anchor=anchor)


def ease(p):
    return 1 - (1 - min(1, max(0, p))) ** 3


def scene_for(n):
    return max(i for i, start in enumerate(STARTS) if n >= start)


def caption_groups():
    groups = []
    for beat in TIMINGS["beats"]:
        group = []
        for word in beat["words"]:
            proposed = " ".join(w["word"] for w in group + [word])
            if group and (width(proposed, T["captionSize"], "bold") > 820 or len(group) >= 5):
                groups.append(group)
                group = []
            group.append(word)
            if word["word"].endswith((".", "?")):
                groups.append(group)
                group = []
        if group:
            groups.append(group)
    return groups


GROUPS = caption_groups()


@functools.lru_cache(maxsize=12)
def background(scene):
    dark = scene % 2 == 0
    im = Image.new("RGB", (W, H), T["dark"] if dark else T["light"])
    d = ImageDraw.Draw(im)
    line = T["lineDark"] if dark else T["lineLight"]
    # Quiet print-like dots and hairline rings keep the type in control.
    for x in range(24, W, 36):
        for y in range(30, H, 36):
            d.ellipse((x, y, x + 1, y + 1), fill=line)
    d.ellipse((-400, 1190, 380, 1970), outline=line, width=2)
    d.ellipse((830, 275, 1360, 805), outline=line, width=2)
    return im


@functools.lru_cache(maxsize=1)
def card_shadow():
    shadow = Image.new("RGBA", (W, H))
    d = ImageDraw.Draw(shadow)
    x, y, cw, ch = T["cardX"], T["cardY"], T["cardW"], T["cardH"]
    d.rounded_rectangle((x, y + 20, x + cw, y + ch + 20), radius=T["radius"], fill=(0, 0, 0, 65))
    return shadow.filter(ImageFilter.GaussianBlur(23))


@functools.lru_cache(maxsize=8)
def round_mask(size, radius):
    mask = Image.new("L", size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return mask


def headline(im, scene, local):
    d = ImageDraw.Draw(im)
    dark = scene % 2 == 0
    ink = T["white"] if dark else T["ink"]
    # The complete hook is on frame zero. Other scenes settle within 18 frames.
    dy = 0 if scene == 0 else round(13 * (1 - ease(local / 18)))
    text(d, (W / 2, T["kickerY"] + dy), KICKERS[scene], 25,
         T[ACCENTS[scene]] if dark else T["blue"], "bold", "mt")
    for row, segments in enumerate(HEADLINES[scene]):
        size = 100
        while sum(width(s, size) + (20 if c == "boxed" else 0) for s, c in segments) > 938:
            size -= 1
        assert size >= 70, "Headline below specified type size"
        total = sum(width(s, size) + (20 if c == "boxed" else 0) for s, c in segments)
        x = (W - total) / 2
        y = T["headlineY"] + row * 126 + dy
        for value, accent in segments:
            tw = width(value, size)
            if accent == "boxed":
                d.rounded_rectangle((x - 2, y - 3, x + tw + 18, y + 113), radius=12, fill=T["blue"])
                text(d, (x + 8, y), value, size, T["white"])
                x += tw + 20
            else:
                text(d, (x, y), value, size, T[accent] if accent else ink)
                x += tw


def captions(im, t, scene):
    group = next((g for g in GROUPS if g[0]["start"] <= t < g[-1]["end"]), None)
    if not group:
        return
    size, gap = T["captionSize"], 12
    widths = [width(w["word"], size, "bold") for w in group]
    total = sum(widths) + gap * (len(group) - 1)
    bw, bh = math.ceil(total + 48), 86
    x0, y0 = round((W - bw) / 2), T["captionY"]
    layer = Image.new("RGBA", im.size)
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((x0, y0, x0 + bw, y0 + bh), radius=22, fill=T["caption"])
    x = x0 + 24
    for word, tw in zip(group, widths):
        active = word["start"] <= t < word["end"]
        if active:
            d.rounded_rectangle((x - 6, y0 + 13, x + tw + 6, y0 + 74), radius=11, fill=T["yellow"])
        text(d, (x, y0 + 17), word["word"], size, T["ink"] if active else T["white"], "bold")
        x += tw + gap
    im.paste(layer, (0, 0), layer)


def pill(im, label, xy, scene, local):
    size = 24
    tw = width(label, size, "bold")
    x, y = xy
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((x, y, x + tw + 40, y + 55), radius=27, fill=T["yellow"])
    text(d, (x + 20, y + 10), label, size, T["ink"], "bold")


def stamp(im, label, n):
    layer = Image.new("RGBA", (310, 90))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((4, 4, 305, 85), radius=9, fill=T["light"], outline=T["red"], width=5)
    text(d, (155, 22), label, 28, T["red"], "heavy", "mt")
    layer = layer.rotate(-7, resample=Image.Resampling.BICUBIC, expand=True)
    im.paste(layer, (706, 1506), layer)


def follow_cta(im, t):
    if not 16.8 <= t < 19.0:
        return
    p = ease((t - 16.8) / 0.45) * ease((19.0 - t) / 0.4)
    size = (560, 96)
    layer = Image.new("RGBA", size)
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((0, 0, 559, 95), radius=48, fill=T["yellow"])
    d.ellipse((19, 17, 81, 79), fill=T["ink"])
    if t < 17.9:
        d.line((36, 48, 64, 48), fill=T["yellow"], width=5)
        d.line((50, 34, 50, 62), fill=T["yellow"], width=5)
    else:
        d.line((35, 48, 46, 60, 67, 36), fill=T["yellow"], width=5)
    text(d, (103, 25), "Follow for more Varve", 31, T["ink"], "bold")
    im.paste(layer, (260, round(1625 + 100 * (1 - p))), layer)


@functools.lru_cache(maxsize=1)
def app_icon():
    return Image.open(ROOT / "apps/desktop/src-tauri/icons/icon.png").convert("RGBA").resize((144, 144), Image.Resampling.LANCZOS)


def brand_card(im, local):
    # Real footage continues underneath a compact icon/domain card.
    p = ease(local / 18)
    layer = Image.new("RGBA", (768, 210))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((0, 0, 767, 209), radius=28, fill=(16, 20, 30, 242), outline=(255, 255, 255, 60), width=2)
    layer.paste(app_icon(), (28, 32), app_icon())
    text(d, (203, 30), "Varve", 56, T["white"])
    text(d, (205, 110), "varve.studio", 37, T["yellow"], "bold")
    text(d, (705, 65), "$0", 64, T["yellow"], anchor="rt")
    im.paste(layer, (156, round(1345 + 35 * (1 - p))), layer)


def footer(im, scene, t):
    d = ImageDraw.Draw(im)
    ink = T["muted"] if scene % 2 == 0 else "#626A74"
    label = "FOLLOW FOR THE NEXT DROP" if scene == 5 else "LETTER IT IN VARVE"
    if not 16.8 <= t < 19.0:
        text(d, (W / 2, T["footerY"]), label, 25, ink, "bold", "mt")
    for i in range(6):
        x = 424 + i * 40
        d.rounded_rectangle((x, 1750, x + 27, 1755), radius=2,
                            fill=T[ACCENTS[scene]] if i == scene else (T["lineDark"] if scene % 2 == 0 else T["lineLight"]))


class ShotReader:
    def __init__(self, shot):
        self.shot = shot
        self.proc = None

    def command(self, offset=0, one=False):
        s = self.shot
        crop = s["crop"]
        src_time = s["sourceStart"] + offset / FPS * s.get("speed", 1)
        vf = (f"crop={crop[2]}:{crop[3]}:{crop[0]}:{crop[1]},"
              f"setpts=(PTS-STARTPTS)/{s.get('speed', 1)},fps={FPS},"
              f"scale={T['cardW']}:{T['cardH']}:force_original_aspect_ratio=increase:flags=lanczos,"
              f"crop={T['cardW']}:{T['cardH']},setsar=1")
        cmd = ["ffmpeg", "-v", "error", "-threads", "2", "-ss", str(src_time),
               "-i", str(ROOT / s["source"]), "-an", "-vf", vf,
               "-frames:v", "1" if one else str(s["toFrame"] - s["fromFrame"])]
        return cmd + ["-f", "rawvideo", "-pix_fmt", "rgb24", "-"]

    def still(self, offset):
        result = run(self.command(offset, one=True), capture_output=True)
        return Image.frombytes("RGB", (T["cardW"], T["cardH"]), result.stdout)

    def next(self):
        if self.proc is None:
            self.proc = subprocess.Popen(self.command(), stdout=subprocess.PIPE)
        size = T["cardW"] * T["cardH"] * 3
        data = self.proc.stdout.read(size)
        if len(data) != size:
            raise RuntimeError(f"Source ended inside shot {self.shot['id']}: {len(data)}/{size}")
        return Image.frombytes("RGB", (T["cardW"], T["cardH"]), data)

    def close(self):
        if self.proc:
            try:
                self.proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.proc.terminate()
            self.proc.stdout.close()
            self.proc.wait()


def visual(n, evidence, shot):
    scene = scene_for(n)
    local = n - STARTS[scene]
    t = n / FPS
    im = background(scene).copy()
    im.paste(card_shadow(), (0, 0), card_shadow())
    # Actual recorded pixels move continuously; each source cut gets an entry pop.
    shot_local = n - shot["fromFrame"]
    span = shot["toFrame"] - shot["fromFrame"]
    zoom = 1.0 + 0.012 * ease(shot_local / max(1, span - 1))
    zw, zh = round(evidence.width * zoom), round(evidence.height * zoom)
    evidence = evidence.resize((zw, zh), Image.Resampling.BICUBIC)
    left = round((zw - T["cardW"]) * 0.48)
    top = round((zh - T["cardH"]) * 0.46)
    evidence = evidence.crop((left, top, left + T["cardW"], top + T["cardH"]))
    pop = 1 if n == 0 else 0.988 + 0.012 * ease(shot_local / 18)
    if pop < 0.999:
        sw, sh = round(T["cardW"] * pop), round(T["cardH"] * pop)
        evidence = evidence.resize((sw, sh), Image.Resampling.LANCZOS)
    x = round((W - evidence.width) / 2)
    y = T["cardY"] + round((T["cardH"] - evidence.height) / 2)
    im.paste(evidence, (x, y), round_mask(evidence.size, T["radius"]))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((x, y, x + evidence.width - 1, y + evidence.height - 1),
                        radius=T["radius"], outline=T["white"] if scene % 2 == 0 else "#CCD0D5", width=2)
    headline(im, scene, local)
    pill(im, BADGES[scene], (111, 641), scene, local)
    if scene == 0 and t >= 1.65:
        stamp(im, "STILL EDITABLE", n)
    if scene == 2 and t >= 14.0:
        stamp(im, "STILL LIVE", n)
    if scene == 4:
        brand_card(im, local)
    if scene == 5:
        pill(im, "YOUR WORDS. YOUR WORLD.", (300, 1612), scene, local)
    follow_cta(im, t)
    footer(im, scene, t)
    captions(im, t, scene)
    return im


def render_frame(n):
    n = 0 if n >= LOOP_FRAME else n
    shot = next(s for s in EDL["shots"] if s["fromFrame"] <= n < s["toFrame"])
    return visual(n, ShotReader(shot).still(n - shot["fromFrame"]), shot)


def mix_audio():
    inputs, filters, reports = [], [], []
    for i, beat in enumerate(TIMINGS["beats"]):
        path = HERE / f"vo3-{i + 1}.mp3"
        measure = run(["ffmpeg", "-v", "info", "-i", str(path), "-af",
                       "loudnorm=I=-16:TP=-1.5:LRA=7:print_format=json", "-f", "null", "-"], capture_output=True)
        log = measure.stderr.decode()
        info = json.loads(log[log.rfind("{"):log.rfind("}") + 1])
        reports.append({"beat": i + 1, **info})
        norm = (f"loudnorm=I=-16:TP=-1.5:LRA=7:measured_I={info['input_i']}:"
                f"measured_TP={info['input_tp']}:measured_LRA={info['input_lra']}:"
                f"measured_thresh={info['input_thresh']}:offset={info['target_offset']}:linear=true")
        inputs += ["-i", str(path)]
        filters.append(f"[{i}:a]{norm},aresample=48000,apad,atrim=duration={beat['duration']},"
                       f"adelay={round(beat['start'] * 48000)}S:all=1[a{i}]")
    filters.append("".join(f"[a{i}]" for i in range(6)) +
                   f"amix=inputs=6:normalize=0,apad,atrim=duration={DURATION}[vo]")
    run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", ";".join(filters),
         "-map", "[vo]", "-ar", "48000", "-c:a", "pcm_s16le", str(OUT / "voiceover.wav")])
    (OUT / "audio-normalization.json").write_text(json.dumps(reports, indent=2) + "\n")


def render():
    mix_audio()
    silent = SCRATCH / "visual.mp4"
    encoder = subprocess.Popen([
        "ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264",
        "-threads", "4", "-preset", "fast", "-crf", "17", "-pix_fmt", "yuv420p",
        "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
        "-movflags", "+faststart", str(silent)], stdin=subprocess.PIPE)
    opening = None
    try:
        for shot in EDL["shots"]:
            reader = ShotReader(shot)
            try:
                for n in range(shot["fromFrame"], shot["toFrame"]):
                    if n >= LOOP_FRAME:
                        im = opening
                    else:
                        im = visual(n, reader.next(), shot)
                    if n == 0:
                        opening = im.copy()
                    encoder.stdin.write(im.tobytes())
                    if n % 90 == 0:
                        print(f"Rendered {n}/{FRAMES} frames", flush=True)
            finally:
                reader.close()
        encoder.stdin.close()
        if encoder.wait():
            raise RuntimeError("FFmpeg video encoder failed")
    except BaseException:
        encoder.kill()
        raise
    run(["ffmpeg", "-y", "-v", "error", "-i", str(silent), "-i", str(OUT / "voiceover.wav"),
         "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
         "-t", str(DURATION), "-movflags", "+faststart", str(OUT / "comic-lettering-short-v3.mp4")])
    # Actual encoded frames at equal intervals, each at the centre of a sixth.
    for i in range(6):
        t = (i + 0.5) * DURATION / 6
        run(["ffmpeg", "-y", "-v", "error", "-ss", str(t), "-i", str(OUT / "comic-lettering-short-v3.mp4"),
             "-frames:v", "1", str(OUT / f"frame-{i + 1:02}.png")])
    print(f"Finished {OUT / 'comic-lettering-short-v3.mp4'}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--frame", type=int)
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    SCRATCH.mkdir(parents=True, exist_ok=True)
    if args.frame is not None:
        render_frame(args.frame).save(SCRATCH / f"preview-{args.frame:04}.png")
    elif args.preview:
        for i, n in enumerate([36, 225, 450, 660, 840, 1000], 1):
            render_frame(n).save(SCRATCH / f"layout-{i:02}.png")
        sheet = Image.new("RGB", (1080, 1280), T["dark"])
        for i in range(6):
            thumb = Image.open(SCRATCH / f"layout-{i + 1:02}.png").resize((360, 640), Image.Resampling.LANCZOS)
            sheet.paste(thumb, ((i % 3) * 360, (i // 3) * 640))
        sheet.save(SCRATCH / "layout-sheet.jpg", quality=94)
    else:
        render()
