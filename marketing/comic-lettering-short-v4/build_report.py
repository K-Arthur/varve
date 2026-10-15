import pathlib,json,re,csv,copy,statistics,wave,array,html,math
import argparse
parser=argparse.ArgumentParser(description='Build acoustic comparison evidence and candidate intervals')
parser.add_argument('--source-dir', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parent)
parser.add_argument('--work-dir', type=pathlib.Path, default=pathlib.Path('work/audio-review'))
args=parser.parse_args()
root=args.work_dir.resolve();root.mkdir(parents=True,exist_ok=True)
source=json.loads((args.source_dir/'vo3-timings.json').read_text())
ps=json.loads((root/'pocketsphinx-alignment.json').read_text());wv=json.loads((root/'wav2vec-alignment.json').read_text());free=json.loads((root/'pocketsphinx-free-decoding.json').read_text())
def name(w): return re.sub('[^a-z-]','',re.sub(r'\(\d+\)','',w.lower()))
def merged(data):
 words=[copy.deepcopy(w) for w in data if not w['word'].startswith('<')]
 for i,w in enumerate(words[:-1]):
  if name(w['word'])=='local' and name(words[i+1]['word'])=='first':
   words[i:i+2]=[{'word':'local-first','start':w['start'],'end':words[i+1]['end']}];break
 return words
rows=[];candidate=copy.deepcopy(source);stats=[];candidate['method']='Independent PocketSphinx 5.1.1 forced word alignment (10 ms frames), checked against unconstrained PocketSphinx and Wav2Vec2 ASR/CTC (20 ms frames). Brand pronunciation V AA R V. Acoustic-model candidate, typical boundary uncertainty approximately 0.05–0.15 s; source intervals preserved separately.'
candidate['derived_from']='vo3-timings.json (uploaded original; unmodified)'
for b,p,v,f,c in zip(source['beats'],ps,wv,free,candidate['beats']):
 pw=merged(p['word_alignment']);vw=merged(v['word_alignment'])
 assert len(pw)==len(b['words'])==len(vw)
 # Two forced first-word starts absorb leading silence. Free decoding explicitly identifies it.
 if b['beat'] in [2,3]: pw[0]['start']=0.14
 # The short word AS follows a measured pause: unconstrained decoding places AS at 5.13.
 if b['beat']==2: pw[10]['start']=5.13
 errors=[]
 for i,(s,a,z) in enumerate(zip(b['words'],pw,vw)):
  assert name(s['word'])==name(a['word'])==name(z['word']),(s,a,z)
  start=round(b['start']+a['start'],3);end=round(b['start']+a['end'],3)
  c['words'][i]['start']=start;c['words'][i]['end']=end
  errors.append(abs(s['start']-start))
  rows.append({'beat':b['beat'],'word':s['word'],'uploaded_start':s['start'],'uploaded_end':s['end'],'candidate_start':start,'candidate_end':end,'candidate_minus_uploaded_start':round(start-s['start'],3),'wav2vec_start':round(b['start']+z['start'],3),'wav2vec_end':round(b['start']+z['end'],3),'ps_vs_ctc_start_difference':round(a['start']-z['start'],3),'confidence':'moderate (cross-model, approximate phoneme boundaries)'})
 c['duration']=round(c['words'][-1]['end']-c['start'],3)
 stats.append({'beat':b['beat'],'words':len(errors),'mean_onset_difference':round(statistics.mean(errors),3),'max_onset_difference':round(max(errors),3),'onsets_over_250ms':sum(x>.25 for x in errors),'last_acoustic_end':round(b['start']+pw[-1]['end'],3),'audio_duration':p['audio_duration']})
(root/'vo3-timings.audio-aligned-candidate.json').write_text(json.dumps(candidate,indent=2)+'\n')
with (root/'word-timing-comparison.csv').open('w',newline='') as f:
 writer=csv.DictWriter(f,fieldnames=rows[0]);writer.writeheader();writer.writerows(rows)
(root/'beat-timing-summary.json').write_text(json.dumps(stats,indent=2))
report=['# Independent VO timing audit','', 'The uploaded word labels do not follow the supplied MP3 speech. All six beats show meaningful semantic timing discrepancies. Original uploads are unchanged. A derived candidate is provided for review; it must not be represented as exact millisecond ground truth.','', 'Two independent acoustic models were run on decoded 16 kHz mono audio: PocketSphinx 5.1.1 (forced word alignment plus unconstrained ASR) and PyTorch/TorchAudio Wav2Vec2 base 960h (unconstrained ASR plus CTC forced alignment). Both models were applied to the real audio. The forced models use the intended script; unconstrained runs do not. ASR errors include homophones, the brand, and minor spelling, but strongly confirm the main word order and phrase locations.','', 'PocketSphinx frames are 10 ms; Wav2Vec2 frames are approximately 20 ms. CTC peaks commonly fall inside the phoneme, while PocketSphinx word spans include initial/trailing consonants. Treat boundaries as approximately ±0.05–0.15 s; this uncertainty cannot explain uploaded errors exceeding 1–2 s. First-word leading silence in beats 2 and 3 was removed using the unconstrained result (local 0.14 s), and beat 2 “as” starts at the unconstrained local 5.13 s following a pause. No other hand corrections were made.','', '“Varve” is not in the PocketSphinx stock dictionary; its forced pronunciation was V AA R V, consistent with the Wav2Vec2 recognition “INVARVE” (beat 2) and “FARVE” (beat 5). This confirms a Varve-like word at the relevant locations but does not establish a canonical brand pronunciation.','', '| Beat | Words | Mean absolute onset disagreement | Maximum | Onsets >250 ms | Last acoustic word end (absolute) |','|---|---:|---:|---:|---:|---:|']
for s in stats: report.append(f"| {s['beat']} | {s['words']} | {s['mean_onset_difference']:.3f}s | {s['max_onset_difference']:.3f}s | {s['onsets_over_250ms']} | {s['last_acoustic_end']:.3f}s |")
report+=['','Selected examples (all absolute seconds):','','| Beat / word | Uploaded interval | PocketSphinx word span | Wav2Vec2 CTC span |','|---|---:|---:|---:|']
select={(1,'comic'),(2,'dialogue'),(3,'fits'),(4,'Every'),(5,'Your'),(6,'comic')}
for r in rows:
 if (r['beat'],r['word'].rstrip(',.?')) in select:
  report.append(f"| {r['beat']} / {r['word']} | {r['uploaded_start']:.3f}–{r['uploaded_end']:.3f} | {r['candidate_start']:.3f}–{r['candidate_end']:.3f} | {r['wav2vec_start']:.3f}–{r['wav2vec_end']:.3f} |")
report+=['','The uploaded intervals overlap each adjacent word by approximately 60 ms. Exact use requires independently evaluating every interval; selecting only one “current word” loses some supplied overlap. At 30 fps, active state can only be sampled every 33.33 ms.','', 'Do not trim the audio at the uploaded duration: independently aligned final consonants extend beyond it in several beats. Mixing each complete MP3 at the uploaded beat start preserves the speech, with only silent tails overlapping the next beat. The 35.99 s total leaves the final audio tail intact.','', 'Files: `word-timing-comparison.csv` includes all 72 uploaded words; `vo3-timings.audio-aligned-candidate.json` retains original script and absolute beat starts with derived candidate intervals; `pocketsphinx-alignment.json` and `wav2vec-alignment.json` retain raw model outputs; `pocketsphinx-free-decoding.json` retains unconstrained recognition; `waveform-word-alignment.html` visualizes all six decoded waveforms.','', 'At present, “match uploaded intervals exactly” and “follow actual spoken words exactly” conflict. The derived candidate should only replace display timings if the owner chooses audio alignment.']
(root/'audio-timing-audit.md').write_text('\n'.join(report)+'\n')
# Standalone waveform comparison. Local seconds on each row; absolute offset in the title.
parts=['<!doctype html><meta charset="utf-8"><title>VO3 word timing audit</title><style>body{font:15px system-ui;background:#0b1323;color:#e8efff;max-width:1400px;margin:30px auto;padding:0 20px}svg{width:100%;height:auto}h1{font-size:24px}p{color:#b9c7de}audio{width:100%}.beat{margin:32px 0;border:1px solid #263449;border-radius:12px;padding:18px}</style><h1>VO3 audio / word interval audit</h1><p>Original upload intervals (red), acoustic candidate (blue), independent Wav2Vec2 CTC character-span intervals (green). Time axes show local seconds within each MP3. CTC spans are often narrower than acoustic word spans. Original uploads remain unchanged.</p>']
for b,p,v,c in zip(source['beats'],ps,wv,candidate['beats']):
 idx=b['beat'];dur=p['audio_duration'];W=1300;H=280;left=90;plot=1160
 with wave.open(str(root/f'vo3-{idx}.wav')) as w: samples=array.array('h',w.readframes(w.getnframes()))
 parts.append(f'<section class="beat"><h2>Beat {idx} · absolute offset {b["start"]:.3f}s</h2><p>{html.escape(b["text"])}</p><audio controls src="vo3-{idx}.wav"></audio>')
 parts.append(f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Waveform and word intervals for beat {idx}">')
 for sec in range(math.ceil(dur)+1):
  x=left+sec/dur*plot
  if x>left+plot:continue
  parts.append(f'<path d="M{x:.1f} 20V260" stroke="#24334a"/><text x="{x:.1f}" y="275" fill="#8496b2" font-size="12">{sec}s</text>')
 bins=1000;step=max(1,len(samples)//bins)
 for n in range(bins):
  chunk=samples[n*step:(n+1)*step]
  if not chunk:continue
  x=left+n/bins*plot;amp=max(abs(a) for a in chunk)/32768*36
  parts.append(f'<path d="M{x:.1f} {60-amp:.1f}V{60+amp:.1f}" stroke="#98abc5"/>')
 tracks=[('Upload',[(w['word'],w['start']-b['start'],w['end']-b['start']) for w in b['words']],'#f57981',125),('Candidate',[(w['word'],w['start']-b['start'],w['end']-b['start']) for w in c['words']],'#60a5fa',180),('CTC',[(w['word'],w['start'],w['end']) for w in merged(v['word_alignment'])],'#64d8a2',235)]
 for label,words,color,y in tracks:
  parts.append(f'<text x="0" y="{y+4}" fill="{color}" font-size="12">{label}</text>')
  for j,(text,start,end) in enumerate(words):
   x=left+start/dur*plot;width=(end-start)/dur*plot
   parts.append(f'<rect x="{x:.1f}" y="{y-8}" width="{width:.1f}" height="16" rx="3" fill="{color}" opacity=".27"><title>{html.escape(text)} {start:.3f}–{end:.3f}s local</title></rect><path d="M{x:.1f} {y-8}V{y+8}" stroke="{color}"/><text x="{x+2:.1f}" y="{y-12-(j%2)*11}" fill="{color}" font-size="10">{html.escape(text)}</text>')
 parts.append('</svg></section>')
(root/'waveform-word-alignment.html').write_text('\n'.join(parts))
print(json.dumps(stats,indent=2))
print('All words:',len(rows),'onsets >250ms:',sum(s['onsets_over_250ms'] for s in stats))
