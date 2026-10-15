# Independent VO timing audit

The uploaded word labels do not follow the supplied MP3 speech. All six beats show meaningful semantic timing discrepancies. Original uploads are unchanged. The owner selected corrected display timings. `caption-timings.json` uses the audio-derived word spans below; these must not be represented as exact millisecond ground truth.

Two independent acoustic models were run on decoded 16 kHz mono audio: PocketSphinx 5.1.1 (forced word alignment plus unconstrained ASR) and PyTorch/TorchAudio Wav2Vec2 base 960h (unconstrained ASR plus CTC forced alignment). Both models were applied to the real audio. The forced models use the intended script; unconstrained runs do not. ASR errors include homophones, the brand, and minor spelling, but strongly confirm the main word order and phrase locations.

PocketSphinx frames are 10 ms; Wav2Vec2 frames are approximately 20 ms. CTC peaks commonly fall inside the phoneme, while PocketSphinx word spans include initial/trailing consonants. Treat boundaries as approximately ±0.05–0.15 s; this uncertainty cannot explain uploaded errors exceeding 1–2 s. First-word leading silence in beats 2 and 3 was removed using the unconstrained result (local 0.14 s), and beat 2 “as” starts at the unconstrained local 5.13 s following a pause. No other hand corrections were made.

“Varve” is not in the PocketSphinx stock dictionary; its forced pronunciation was V AA R V, consistent with the Wav2Vec2 recognition “INVARVE” (beat 2) and “FARVE” (beat 5). This confirms a Varve-like word at the relevant locations but does not establish a canonical brand pronunciation.

| Beat | Words | Mean absolute onset disagreement | Maximum | Onsets >250 ms | Last acoustic word end (absolute) |
|---|---:|---:|---:|---:|---:|
| 1 | 10 | 0.482s | 1.064s | 7 | 4.110s |
| 2 | 14 | 0.645s | 1.318s | 12 | 10.830s |
| 3 | 17 | 0.634s | 1.504s | 13 | 19.123s |
| 4 | 10 | 1.137s | 2.244s | 8 | 24.868s |
| 5 | 11 | 0.672s | 1.328s | 6 | 30.441s |
| 6 | 10 | 0.494s | 0.909s | 7 | 34.887s |

Selected examples (all absolute seconds):

| Beat / word | Uploaded interval | PocketSphinx word span | Wav2Vec2 CTC span |
|---|---:|---:|---:|
| 1 / comic | 1.904–2.192 | 0.840–1.300 | 0.922–1.242 |
| 2 / dialogue | 5.363–5.649 | 5.800–6.340 | 5.833–6.313 |
| 3 / fits | 14.787–14.992 | 13.283–13.633 | 13.408–13.629 |
| 4 / Every | 20.816–21.142 | 22.888–23.148 | 22.963–23.143 |
| 5 / Your | 27.555–27.851 | 28.601–28.781 | 28.668–28.808 |
| 6 / comic | 32.576–32.821 | 31.667–32.057 | 31.731–32.012 |

The uploaded intervals overlap each adjacent word by approximately 60 ms. Exact use requires independently evaluating every interval; selecting only one “current word” loses some supplied overlap. At 30 fps, active state can only be sampled every 33.33 ms.

Do not trim the audio at the uploaded duration: independently aligned final consonants extend beyond it in several beats. Mixing each complete MP3 at the uploaded beat start preserves the speech, with only silent tails overlapping the next beat. The 35.99 s total leaves the final audio tail intact.

Files: `word-timing-comparison.csv` includes all 72 uploaded words; `caption-timings.json` retains original script and absolute beat starts with derived acoustic word intervals; `pocketsphinx-alignment.json` and `wav2vec-alignment.json` retain raw model outputs; `pocketsphinx-free-decoding.json` retains unconstrained recognition; `waveform-word-alignment.html` visualizes all six decoded waveforms.

The owner chose audio alignment. The original upload is retained unchanged as `vo3-timings.json`; corrected display timings are isolated in `caption-timings.json`. Highlights evaluate `start <= time < end` with no extra anticipation, lag, or gap filling. Original audio starts are unchanged and complete MP3s are mixed without duration trims.

Reproduction (optional audit dependencies, separate from rendering):

```sh
python -m venv work/audio-audit-env
work/audio-audit-env/bin/pip install pocketsphinx==5.1.1 numpy
work/audio-audit-env/bin/pip install --index-url https://download.pytorch.org/whl/cpu torch==2.8.0 torchaudio==2.8.0
work/audio-audit-env/bin/python marketing/comic-lettering-short-v4/align.py
work/audio-audit-env/bin/python marketing/comic-lettering-short-v4/free_decode.py
work/audio-audit-env/bin/python marketing/comic-lettering-short-v4/wav2vec.py
work/audio-audit-env/bin/python marketing/comic-lettering-short-v4/build_report.py
```

Run from the repository root with FFmpeg available. Models and intermediate WAVs are written to `work/audio-review/`. Each script accepts `--source-dir` and `--work-dir`. PocketSphinx may need `CC=gcc CXX=g++` when a source build is required. The optional phone-level second pass fails for beat 1 in this model; the valid first-pass word segmentation is retained. The report uses first-pass word spans, not failed phone-state scores. The report builder emits a review candidate and does not overwrite the committed final `caption-timings.json`.
