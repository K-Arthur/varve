import os
import pathlib,json,wave,array,re
import torch,torchaudio
import argparse
parser=argparse.ArgumentParser(description='Independent Wav2Vec2 recognition and CTC word alignment')
parser.add_argument('--source-dir', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parent)
parser.add_argument('--work-dir', type=pathlib.Path, default=pathlib.Path('work/audio-review'))
args=parser.parse_args()
root=args.work_dir.resolve();root.mkdir(parents=True,exist_ok=True)
os.environ.setdefault('TORCH_HOME',str(root/'model-cache'))
torch.set_num_threads(4)
bundle=torchaudio.pipelines.WAV2VEC2_ASR_BASE_960H
model=bundle.get_model();model.eval()
labels=bundle.get_labels();tokens={v:k for k,v in enumerate(labels)}
source=json.loads((args.source_dir/'vo3-timings.json').read_text())
result=[]
for beat in source['beats']:
 idx=beat['beat']
 with wave.open(str(root/f'vo3-{idx}.wav')) as w:
  data=array.array('h',w.readframes(w.getnframes()));duration=w.getnframes()/16000
 waveform=torch.tensor(data,dtype=torch.float32).unsqueeze(0)/32768.0
 with torch.inference_mode(): emission,_=model(waveform)
 emission=torch.log_softmax(emission,dim=-1)
 transcript=''.join(labels[i] for i in torch.unique_consecutive(emission.argmax(-1)[0]).tolist() if i!=0).replace('|',' ')
 text=re.sub(r"[^A-Z' -]",'',beat['text'].upper()).replace('-',' ')
 chars='|'.join(text.split())
 target=torch.tensor([[tokens[c] for c in chars]],dtype=torch.int32)
 aligned,scores=torchaudio.functional.forced_align(emission,target,blank=0)
 spans=torchaudio.functional.merge_tokens(aligned[0],scores[0])
 ratio=duration/emission.shape[1]
 words=[];current=[]
 for span in spans:
  char=labels[span.token]
  if char=='|':
   if current:
    words.append({'word':''.join(x['char'] for x in current),'start':round(current[0]['start'],3),'end':round(current[-1]['end'],3),'chars':current});current=[]
  else: current.append({'char':char,'start':round(span.start*ratio,3),'end':round(span.end*ratio,3),'score':round(span.score,5)})
 if current: words.append({'word':''.join(x['char'] for x in current),'start':round(current[0]['start'],3),'end':round(current[-1]['end'],3),'chars':current})
 result.append({'beat':idx,'greedy_transcript':transcript,'frame_resolution':ratio,'word_alignment':words})
 print(idx,transcript,flush=True);print([(w['word'],w['start'],w['end']) for w in words],flush=True)
(root/'wav2vec-alignment.json').write_text(json.dumps(result,indent=2))
