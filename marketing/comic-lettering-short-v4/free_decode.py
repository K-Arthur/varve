from pocketsphinx import Decoder
import pathlib,wave,json
import argparse
parser=argparse.ArgumentParser(description='Unconstrained PocketSphinx recognition')
parser.add_argument('--source-dir', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parent)
parser.add_argument('--work-dir', type=pathlib.Path, default=pathlib.Path('work/audio-review'))
args=parser.parse_args()
root=args.work_dir.resolve();root.mkdir(parents=True,exist_ok=True)
all=[]
for idx in range(1,7):
 d=Decoder(loglevel='ERROR');d.add_word('varve','V AA R V',True)
 with wave.open(str(root/f'vo3-{idx}.wav')) as w: data=w.readframes(w.getnframes())
 d.start_utt();d.process_raw(data,full_utt=True);d.end_utt()
 seg=[{'word':s.word,'start':s.start_frame/100,'end':(s.end_frame+1)/100} for s in d.seg()]
 all.append({'beat':idx,'transcript':d.hyp().hypstr,'segments':seg})
 print(idx,d.hyp().hypstr)
 print(seg)
(root/'pocketsphinx-free-decoding.json').write_text(json.dumps(all,indent=2))
