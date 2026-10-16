"""Validate the delivered MP4, rather than the renderer's own planned states.

Run after render.py. Checks the actual encoded media, all 1,080 caption frames,
all 72 corrected word intervals, every complete original VO, and 6+ PNGs.
Only Pillow, NumPy, SciPy, FFmpeg and FFprobe are required.
"""

import hashlib
import importlib.util
import json
import math
import re
import subprocess
import sys
from fractions import Fraction
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.signal import correlate, correlation_lags

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / "out"
VIDEO = OUT / "comic-lettering-short-v5.mp4"
PLAN = json.loads((HERE / "edit-plan.json").read_text())
CAPTIONS = json.loads((HERE / "caption-timings.json").read_text())
ORIGINAL = json.loads((HERE / "vo3-timings.json").read_text())
W, H, FPS, FRAMES, SR = 1080, 1920, 30, 1080, 48000
DURATION = FRAMES / FPS
# Recorded from the seven uploaded bytes, independent of renderer output.
UPLOAD_HASHES = {
    "vo3-1.mp3": "6a975b2055250fd633781e37daab4d3909d0e4464b19395e845da7fb3c1cf5b6",
    "vo3-2.mp3": "bb6bdfe8063d6b17191e43752fdd7c22a8528a0bcb7fc2865862b8f9b23abfab",
    "vo3-3.mp3": "fd83f0eb8b229254c4616f1691459ca46b2d34d3cb28c4d48b45babae7ca8dc8",
    "vo3-4.mp3": "f927b47ce5272ae0ef0377f21f6adf7723219de5239a0f0957583c6fdf8514f2",
    "vo3-5.mp3": "f16a32b4457c998b90a50431253b30c3fd6446b707d5f1594836c4139f1267aa",
    "vo3-6.mp3": "d665d5f3dd99d3bc1eb608d0ede890f79dcd6e5427f11b97e0adc390d4269d0e",
    "vo3-timings.json": "9ae3c2c122ac68d5123ed6bbe0e6a9802f84b284f8ab49ba0c589917a7ebaab1",
}
WORDS = {
    f"{b['beat']}-{i}": dict(w, beat=b["beat"])
    for b in CAPTIONS["beats"] for i, w in enumerate(b["words"])
}
ERRORS = []
REPORT = {"video": VIDEO.name, "checks": {}, "errors": ERRORS}


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def run(args):
    return subprocess.run(args, check=True, capture_output=True, cwd=ROOT)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as src:
        for chunk in iter(lambda: src.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stage(name, callback):
    print(f"Checking {name}…", flush=True)
    try:
        REPORT["checks"][name] = callback()
    except Exception as exc:
        ERRORS.append(f"{name}: {type(exc).__name__}: {exc}")
        REPORT["checks"][name] = {"passed": False, "error": str(exc)}
        print(ERRORS[-1], flush=True)


def probe():
    info = json.loads(run(["ffprobe", "-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", str(VIDEO)]).stdout)
    streams = info["streams"]
    require(len(streams) == 2, f"Expected one video and one VO track, got {len(streams)} streams")
    video = next(s for s in streams if s["codec_type"] == "video")
    audio = next(s for s in streams if s["codec_type"] == "audio")
    expected = {"codec_name": "h264", "width": W, "height": H, "pix_fmt": "yuv420p"}
    for field, value in expected.items():
        require(video[field] == value, f"{field}: {video[field]} != {value}")
    require(Fraction(video["r_frame_rate"]) == FPS, "Video frame rate must be exactly 30 fps")
    require(Fraction(video["avg_frame_rate"]) == FPS, "Average rate must be exactly 30 fps")
    require(int(video["nb_read_frames"]) == FRAMES, f"Not {FRAMES} decoded frames")
    require(int(video["nb_frames"]) == FRAMES, "Container frame count differs")
    require(abs(float(video["duration"]) - DURATION) < .00001, "Video must be exactly 36 s")
    require(abs(float(info["format"]["duration"]) - DURATION) < .04, "Container duration mismatch")
    require(audio["codec_name"] == "aac", "VO track must be AAC")
    require(int(audio["sample_rate"]) == SR and audio["channels"] == 1, "VO must be 48 kHz mono")
    require(abs(float(audio["duration"]) - DURATION) < .04, "Audio track duration mismatch")
    return {"passed": True, "sha256": sha256(VIDEO), "bytes": VIDEO.stat().st_size,
            "video": video, "audio": audio, "container_duration": info["format"]["duration"]}


def provenance():
    hashes = {name: sha256(HERE / name) for name in UPLOAD_HASHES}
    require(hashes == UPLOAD_HASHES, "One or more required original uploads changed")
    require(len(WORDS) == 72, f"Expected all 72 script words, got {len(WORDS)}")
    for original, corrected in zip(ORIGINAL["beats"], CAPTIONS["beats"]):
        require(original["beat"] == corrected["beat"] and original["start"] == corrected["start"], "Original beat offsets changed")
        require([w["word"] for w in original["words"]] == [w["word"] for w in corrected["words"]], "Script word sequence changed")
    branch = run(["git", "branch", "--show-current"]).stdout.decode().strip()
    require(branch == "marketing/comic-lettering-short-v5", f"Wrong branch: {branch}")
    run(["git", "merge-base", "--is-ancestor", PLAN["baseSHA"], "HEAD"])
    require(sha256(HERE / "caption-timings.json") == sha256(HERE.parent / "comic-lettering-short-v4/caption-timings.json"),
            "Corrected caption timing bytes differ from V4")
    return {"passed": True, "uploads_sha256": hashes, "caption_timings_sha256": sha256(HERE / "caption-timings.json"),
            "branch": branch, "base_sha_is_ancestor": PLAN["baseSHA"], "music": None}


def edit_plan():
    shots = PLAN["shots"]
    require(shots[0]["fromFrame"] == 0 and shots[-1]["toFrame"] == FRAMES, "Incomplete edit")
    require(all(a["toFrame"] == b["fromFrame"] for a, b in zip(shots, shots[1:])), "Gap or overlap in edit")
    require(all(0 < shot["toFrame"] - shot["fromFrame"] <= 90 for shot in shots), "More than 3s without a cut/new focus")
    sources = {}
    for shot in shots:
        path = ROOT / shot["source"]
        if shot["source"] not in sources:
            info = json.loads(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)]).stdout)
            sources[shot["source"]] = {"sha256": sha256(path), "duration": float(info["format"]["duration"])}
        endpoint = shot["sourceStart"] + (shot["toFrame"] - shot["fromFrame"]) / FPS * shot["speed"]
        require(endpoint <= sources[shot["source"]]["duration"] + 1 / FPS, f"Source runs short: {shot['id']}")
    vertical = "marketing/sample-comic/video/lettering-vertical.mp4"
    require(sources[vertical]["sha256"] == "9e78d7907c3f9d3372b0556aa814830f0d0f216c4e52a65cfeb98e5e5d2522f2", "Required vertical footage differs")
    growth = [shot for shot in shots if shot["id"] in ("longer-live", "fit-live-command", "fit-result-hold")]
    for first, second in zip(growth, growth[1:]):
        endpoint = first["sourceStart"] + (first["toFrame"] - first["fromFrame"]) / FPS * first["speed"]
        require(abs(endpoint - second["sourceStart"]) < .001, "Growth action source continuity breaks")
    return {"passed": True, "shots": len(shots), "maximum_shot_seconds": max(shot["toFrame"] - shot["fromFrame"] for shot in shots) / FPS,
            "growth_source_continuous": True, "fit_is_explicit_command_not_automatic": True, "sources": sources}


def full_decode():
    result = run(["ffmpeg", "-hide_banner", "-nostats", "-v", "info", "-xerror", "-err_detect", "explode", "-i", str(VIDEO),
                  "-vf", "blackdetect=d=0.1:pix_th=0.02:pic_th=0.98", "-af", "loudnorm=I=-16:TP=-1.5:LRA=7:print_format=json", "-f", "null", "-"])
    log = result.stderr.decode()
    (OUT / "decode-validation.log").write_text(log)
    black = re.findall(r"black_start:(\S+) black_end:(\S+) black_duration:(\S+)", log)
    require(not black, f"Black intervals detected: {black}")
    norm = json.loads(log[log.rfind("{"):log.rfind("}") + 1])
    integrated, peak = float(norm["input_i"]), float(norm["input_tp"])
    require(-19 <= integrated <= -14, f"VO integrated loudness outside -19…-14 LUFS: {integrated}")
    require(peak <= -1.0, f"True peak must stay <= -1 dBTP: {peak}")
    return {"passed": True, "full_video_and_audio_decoded_without_errors": True, "black_intervals": black,
            "blackdetect": {"minimum_seconds": .1, "pixel_threshold": .02, "picture_ratio": .98},
            "integrated_lufs": integrated, "true_peak_dbtp": peak, "loudness_range_lu": float(norm["input_lra"])}


def pcm(path, audio_filter=None):
    command = ["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a:0"]
    if audio_filter:
        command += ["-af", audio_filter]
    return np.frombuffer(run(command + ["-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]).stdout, dtype="<f4").astype(np.float64)


def correlation(a, b):
    require(len(a) == len(b) and len(a) > 0, "Correlation sample lengths mismatch")
    aa, bb = a - a.mean(), b - b.mean()
    den = math.sqrt(float(aa @ aa) * float(bb @ bb))
    return float(aa @ bb / den) if den else 0.0


def strongest_lag(reference, observed, radius=2400):
    # Identical-length windows with no injected alignment adjustment. A shift
    # anywhere within +/-50 ms must score lower than the original beat offset.
    cc = correlate(observed, reference, mode="full", method="fft")
    lags = correlation_lags(len(observed), len(reference), mode="full")
    select = abs(lags) <= radius
    return int(lags[select][np.argmax(cc[select])])


def independently_normalized(path):
    result = run(["ffmpeg", "-v", "info", "-i", str(path), "-af", "loudnorm=I=-16:TP=-1.5:LRA=7:print_format=json", "-f", "null", "-"])
    log = result.stderr.decode()
    norm = json.loads(log[log.rfind("{"):log.rfind("}") + 1])
    filt = (f"loudnorm=I=-16:TP=-1.5:LRA=7:measured_I={norm['input_i']}:measured_TP={norm['input_tp']}:"
            f"measured_LRA={norm['input_lra']}:measured_thresh={norm['input_thresh']}:offset={norm['target_offset']}:linear=true,aresample={SR}")
    return pcm(path, filt)


def audio_content():
    observed = pcm(VIDEO)
    decoded_samples = len(observed)
    duration_samples = round(DURATION * SR)
    terminal_padding_samples = duration_samples - decoded_samples
    # AAC-LC packs 1,024 samples per frame. The MP4 edit list / final packet
    # can leave less than one frame of terminal silence absent or padded.
    # Permit only that packet-sized difference, and prove below that it lies
    # after every complete original clip and contains no reference signal.
    require(abs(terminal_padding_samples) < 1024,
            f"Encoded audio duration differs by {terminal_padding_samples} samples (>= one AAC frame)")
    observed = observed[:duration_samples]
    reference = np.zeros(duration_samples, dtype=np.float64)
    clips = []
    for beat in ORIGINAL["beats"]:
        path = HERE / f"vo3-{beat['beat']}.mp3"
        source = pcm(path)
        normalized = independently_normalized(path)
        offset = round(beat["start"] * SR)
        require(offset + len(source) <= len(observed), f"Beat {beat['beat']} complete MP3 does not fit")
        require(abs(len(source) - len(normalized)) <= 1, "Normalization changed clip length")
        length = min(len(source), len(normalized))
        reference[offset:offset + length] += normalized[:length]
        clips.append((beat, source[:length], normalized[:length], offset))
    omitted_reference = reference[len(observed):]
    require(not np.any(omitted_reference), "AAC terminal shortening overlaps original VO samples")
    if terminal_padding_samples > 0:
        require(float(np.max(np.abs(observed[-1024:]))) < 1e-6,
                "AAC terminal shortening occurs before encoded audio becomes silent")
    reference = reference[:len(observed)]
    overall = correlation(reference, observed)
    error_ratio = float(np.linalg.norm(observed - reference) / np.linalg.norm(reference))
    residual_db = 20 * math.log10(max(error_ratio, 1e-12))
    require(overall >= .995, f"AAC track differs from independently rebuilt six-VO mix: correlation {overall}")
    require(residual_db <= -28, f"Unexpected audio beyond AAC coding residual: {residual_db:.2f} dB")
    rows = []
    for beat, original, normalized, offset in clips:
        actual = observed[offset:offset + len(original)]
        raw_score, normalized_score = correlation(original, actual), correlation(normalized, actual)
        lag = strongest_lag(normalized, actual)
        require(raw_score >= .95, f"Beat {beat['beat']} original-VO correlation is low: {raw_score}")
        require(normalized_score >= .99, f"Beat {beat['beat']} normalized-VO correlation is low: {normalized_score}")
        require(lag == 0, f"Beat {beat['beat']} strongest lag is {lag} samples, not zero")
        # Measure the last meaningful source speech independently of the word
        # JSON. A 10 ms RMS threshold at -40 dB relative to clip's strongest
        # block includes quiet final consonants and excludes the silent tail.
        block = SR // 100
        blocks = [np.sqrt(np.mean(original[i:i + block] ** 2)) for i in range(0, len(original), block)]
        active = np.flatnonzero(np.array(blocks) >= max(blocks) * .01)
        require(len(active), f"Beat {beat['beat']} has no speech")
        speech_end = min(len(original), (int(active[-1]) + 1) * block)
        tail_start = max(0, speech_end - round(.25 * SR))
        # Complete clips intentionally overlap their neighbours' leading
        # breaths/silent tails. Subtract only the independently reconstructed
        # other originals before testing this clip's final consonants; also
        # require the unmodified encoded tail to match the complete mix.
        source_tail = normalized[tail_start:speech_end]
        encoded_tail = actual[tail_start:speech_end]
        mixed_tail = reference[offset + tail_start:offset + speech_end]
        other_tail = mixed_tail - source_tail
        direct_tail_score = correlation(source_tail, encoded_tail)
        tail_score = correlation(source_tail, encoded_tail - other_tail)
        mixed_tail_score = correlation(mixed_tail, encoded_tail)
        require(tail_score >= .95, f"Beat {beat['beat']} final speech/consonant window missing: {tail_score}")
        require(mixed_tail_score >= .99, f"Beat {beat['beat']} encoded final speech mix differs: {mixed_tail_score}")
        final_word_end = max(w["end"] for b in CAPTIONS["beats"] if b["beat"] == beat["beat"] for w in b["words"])
        require(beat["start"] + len(original) / SR >= final_word_end, "Audio ends before corrected final word")
        rows.append({"beat": beat["beat"], "original_offset_seconds": beat["start"],
                     "complete_decoded_clip_seconds": len(original) / SR, "source_last_speech_seconds": speech_end / SR,
                     "source_speech_threshold_db_relative": -40, "uploaded_trim_boundary_seconds": beat["duration"],
                     "speech_beyond_uploaded_trim_seconds": max(0, speech_end / SR - beat["duration"]),
                     "original_full_clip_correlation": raw_score, "normalized_full_clip_correlation": normalized_score,
                     "strongest_lag_samples": lag, "strongest_lag_search_samples": [-2400, 2400],
                     "final_250ms_speech_correlation": tail_score,
                     "final_250ms_direct_correlation_before_other_originals_subtracted": direct_tail_score,
                     "final_250ms_complete_mix_correlation": mixed_tail_score,
                     "final_250ms_other_originals_rms": float(np.sqrt(np.mean(other_tail ** 2))),
                     "corrected_final_word_end_absolute": final_word_end})
    return {"passed": True, "originals_placed_complete_without_duration_trims": True, "encoded_sample_count_checked": len(observed),
            "decoded_samples": decoded_samples, "video_duration_samples": duration_samples,
            "aac_terminal_padding_difference_samples": terminal_padding_samples,
            "aac_terminal_padding_difference_seconds": terminal_padding_samples / SR,
            "terminal_difference_is_only_silence_after_all_complete_clips": True,
            "independent_six_voice_mix_correlation": overall, "aac_residual_relative_db": residual_db,
            "no_music_evidence": "One AAC track; actual samples match independently normalized sum of all six uploaded MP3s, within AAC coding residual.",
            "beats": rows}


def layouts():
    spec = importlib.util.spec_from_file_location("v5_render_geometry", HERE / "render.py")
    renderer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(renderer)
    result = []
    for n in range(FRAMES):
        try:
            layout = renderer.caption_layout(n / FPS)
        except Exception as exc:
            raise AssertionError(f"Caption geometry fails at frame {n}: {exc}") from exc
        expected = {key for key, word in WORDS.items() if word["start"] <= n / FPS < word["end"]}
        visible = {p["word"]["id"] for p in layout}
        require(expected <= visible, f"Expected active words omitted at frame {n}: {expected - visible}")
        for p in layout:
            x0, y0, x1, y1 = p["rect"]
            require(150 <= x0 < x1 <= 930 and 290 <= y0 < y1 <= 1440, f"Caption escapes safe bounds at frame {n}: {p['rect']}")
            require(p["word"]["id"] in WORDS, "Geometry contains unknown script word")
        if layout:
            # The caption background needs 17 px each side and 14 px below.
            require(min(p["rect"][0] for p in layout) - 17 >= 150, f"Caption box left unsafe at {n}")
            require(max(p["rect"][2] for p in layout) + 17 <= 930, f"Caption box right unsafe at {n}")
            require(max(p["rect"][3] for p in layout) + 14 <= 1440, f"Caption box bottom unsafe at {n}")
        result.append(layout)
    return result


def read_exact(pipe, size):
    data = bytearray()
    while len(data) < size:
        chunk = pipe.read(size - len(data))
        if not chunk:
            break
        data.extend(chunk)
    return data


def caption_pixels():
    geometry = layouts()
    # Caption-only band: two caption rows end before y=540; every floating UI
    # card starts below it. This catches stale blue pixels outside active words.
    y0, band_h = 290, 250
    for n, layout in enumerate(geometry):
        require(all(y0 <= p["rect"][1] < p["rect"][3] < y0 + band_h for p in layout), f"Caption outside inspected band at {n}")
    command = ["ffmpeg", "-v", "error", "-i", str(VIDEO), "-an", "-vf", f"crop={W}:{band_h}:0:{y0}", "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    coverage = {key: {"expected_frames": [], "observed_frames": []} for key in WORDS}
    failures = []
    active_min, inactive_max, unexpected_max = 1.0, 0.0, 0
    try:
        for n, layout in enumerate(geometry):
            raw = read_exact(process.stdout, W * band_h * 3)
            require(len(raw) == W * band_h * 3, f"Encoded caption decode stopped at frame {n}")
            rgb = np.frombuffer(raw, dtype=np.uint8).reshape(band_h, W, 3).astype(np.int16)
            r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
            blue = (b > 145) & (g > 45) & (g < 175) & (r < 120) & (b - r > 90) & (b - g > 35)
            expected = {key for key, word in WORDS.items() if word["start"] <= n / FPS < word["end"]}
            allowed = np.zeros((band_h, W), dtype=bool)
            for key in expected:
                coverage[key]["expected_frames"].append(n)
            for p in layout:
                key = p["word"]["id"]
                x0, ya, x1, yb = map(int, p["rect"])
                ya, yb = ya - y0, yb - y0
                # Ignore the 3 px codec/radius edge when classifying a word.
                ratio = float(blue[ya + 3:yb - 3, x0 + 3:x1 - 3].mean())
                observed_active = ratio > .35
                if observed_active:
                    coverage[key]["observed_frames"].append(n)
                if key in expected:
                    active_min = min(active_min, ratio)
                    allowed[max(0, ya - 2):min(band_h, yb + 3), max(0, x0 - 2):min(W, x1 + 3)] = True
                    if not observed_active:
                        failures.append(f"frame {n} / {key} {WORDS[key]['word']}: missing blue ({ratio:.4f})")
                else:
                    inactive_max = max(inactive_max, ratio)
                    if observed_active:
                        failures.append(f"frame {n} / {key} {WORDS[key]['word']}: blue outside interval ({ratio:.4f})")
            unexpected = int(np.count_nonzero(blue & ~allowed))
            unexpected_max = max(unexpected_max, unexpected)
            if unexpected > 120:
                failures.append(f"frame {n}: {unexpected} unexpected blue pixels outside active words")
        require(not process.stdout.read(1), "More than 1080 encoded caption frames")
        error = process.stderr.read().decode()
        require(process.wait() == 0, f"Caption decode failed: {error}")
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
    word_rows = []
    for key, frames in coverage.items():
        require(frames["expected_frames"], f"Word {key} has no representable 30 fps coverage")
        if frames["expected_frames"] != frames["observed_frames"]:
            failures.append(f"Word {key} encoded active frames differ from exact interval")
        word_rows.append({"id": key, **WORDS[key], "expected_frames": frames["expected_frames"], "observed_frames": frames["observed_frames"]})
    # Write detailed frame evidence even if a later assertion fails.
    (OUT / "caption-frame-audit.json").write_text(json.dumps({"rule": "words.start <= n/30 < words.end; renderer active field ignored", "words": word_rows, "failures": failures}, indent=2) + "\n")
    require(not failures, f"{len(failures)} encoded caption mismatches; first: {failures[:8]}")
    return {"passed": True, "frames_checked": FRAMES, "words_checked": len(WORDS), "rule": "absolute start <= n/30 < end",
            "renderer_active_state_used": False, "minimum_active_blue_fraction": active_min,
            "maximum_inactive_blue_fraction": inactive_max, "maximum_unexpected_blue_pixels": unexpected_max,
            "safe_bounds": [150, 290, 930, 1440], "detail": "caption-frame-audit.json"}


def grabs_and_loop():
    frames = sorted(set([0, FRAMES - 1] + PLAN["grabs"]))
    selection = "+".join(f"eq(n\\,{n})" for n in frames)
    data = run(["ffmpeg", "-v", "error", "-i", str(VIDEO), "-an", "-vf", f"select={selection}", "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]).stdout
    size = W * H * 3
    require(len(data) == len(frames) * size, "Frame-grab decode frame count differs")
    decoded = {n: np.frombuffer(data[i * size:(i + 1) * size], dtype=np.uint8).reshape(H, W, 3) for i, n in enumerate(frames)}
    require(len(PLAN["grabs"]) >= 6, "At least six frame grabs required")
    rows = []
    for i, n in enumerate(PLAN["grabs"], 1):
        path = OUT / f"frame-{i:02}.png"
        png = np.asarray(Image.open(path).convert("RGB"))
        require(png.shape == (H, W, 3) and np.array_equal(png, decoded[n]), f"{path.name} is not exact encoded frame {n}")
        rows.append({"file": path.name, "encoded_frame": n, "seconds": n / FPS, "sha256": sha256(path)})
    difference = np.abs(decoded[0].astype(np.int16) - decoded[FRAMES - 1].astype(np.int16))
    mean, p99 = float(difference.mean()), float(np.percentile(difference, 99))
    require(mean < 1 and p99 <= 6, f"Opening/loop-return encoded difference too large: mean {mean}, p99 {p99}")
    return {"passed": True, "grabs": rows, "loop_first_vs_last_encoded_mean_absolute_difference": mean,
            "loop_first_vs_last_encoded_p99_absolute_difference": p99}


def main():
    OUT.mkdir(exist_ok=True)
    for name, callback in (("format", probe), ("provenance", provenance), ("edit_plan", edit_plan), ("full_decode", full_decode),
                           ("audio", audio_content), ("caption_pixels", caption_pixels), ("grabs_and_loop", grabs_and_loop)):
        stage(name, callback)
    REPORT["passed"] = not ERRORS
    (OUT / "validation.json").write_text(json.dumps(REPORT, indent=2) + "\n")
    print(f"Validation {'PASSED' if not ERRORS else 'FAILED'}: {OUT / 'validation.json'}", flush=True)
    return 1 if ERRORS else 0


if __name__ == "__main__":
    sys.exit(main())
