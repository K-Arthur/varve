import json, pathlib, wave, re, csv
from pocketsphinx import Decoder
import argparse,subprocess
parser=argparse.ArgumentParser(description='PocketSphinx acoustic word alignment')
parser.add_argument('--source-dir', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parent)
parser.add_argument('--work-dir', type=pathlib.Path, default=pathlib.Path('work/audio-review'))
args=parser.parse_args()
root=args.work_dir.resolve();root.mkdir(parents=True,exist_ok=True)
for idx in range(1,7):
    wav=root/f'vo3-{idx}.wav'
    if not wav.exists():
        subprocess.run(['ffmpeg','-y','-v','error','-i',str(args.source_dir/f'vo3-{idx}.mp3'),'-ar','16000','-ac','1',str(wav)],check=True)
source=json.loads((args.source_dir/'vo3-timings.json').read_text())
out=[]
for beat in source['beats']:
    idx=beat['beat']
    dec=Decoder(loglevel='ERROR')
    dec.add_word('varve','V AA R V',True)
    text=re.sub(r'[^a-z -]','',beat['text'].lower()).replace('-',' ')
    dec.set_align_text(text)
    with wave.open(str(root/f'vo3-{idx}.wav')) as w:
        data=w.readframes(w.getnframes())
        duration=w.getnframes()/w.getframerate()
    dec.start_utt();dec.process_raw(data,full_utt=True);dec.end_utt()
    words=[{'word':s.word,'start':round(s.start_frame/100,3),'end':round((s.end_frame+1)/100,3),'prob':s.prob} for s in dec.seg()]
    try:
        dec.set_alignment();dec.start_utt();dec.process_raw(data,full_utt=True);dec.end_utt()
    except RuntimeError:
        pass
    phones=[{'word':w.name,'start':round(w.start/100,3),'end':round((w.start+w.duration)/100,3),'phones':[{'phone':p.name,'start':round(p.start/100,3),'end':round((p.start+p.duration)/100,3),'score':p.score} for p in w]} for w in dec.get_alignment()]
    out.append({'beat':idx,'audio_duration':duration,'normalized_text':text,'word_alignment':words,'phone_alignment':phones})
    print('\nBEAT',idx,'duration',duration)
    print('MODEL:',[(w['word'],w['start'],w['end']) for w in words])
    print('JSON:',[(w['word'],round(w['start']-beat['start'],3),round(w['end']-beat['start'],3)) for w in beat['words']])
(root/'pocketsphinx-alignment.json').write_text(json.dumps(out,indent=2))
