import json,numpy as np,soundfile as sf
from faster_whisper import WhisperModel
v,sr=sf.read('vo.wav'); a=np.interp(np.arange(0,len(v),1.5),np.arange(len(v)),v).astype(np.float32)
segs,_=WhisperModel('small.en',device='cpu',compute_type='int8').transcribe(a,word_timestamps=True,language='en')
W=[(w.word.strip().strip('.,?:').lower(),w.start) for s in segs for w in s.words]
caps=json.load(open('caps5.json')); cw=[(w.strip('.,?:').lower(),t) for c in caps for w,t in zip(c['words'],c['ws'])]
rms=np.array([np.sqrt((v[i:i+240]**2).mean()) for i in range(0,len(v),240)])
j=0;d=[]
for w,t in cw:
    for k in range(j,min(j+4,len(W))):
        if W[k][0][:4]==w[:4] or w[:4] in W[k][0]:
            # reference onset = later of whisper start and first voiced 10ms frame after it (whisper starts often sit in silence)
            i=int(W[k][1]*100); on=next((x/100 for x in range(i,i+50) if rms[x]>0.015),W[k][1])
            d.append((w,round(t-on,3))); j=k+1; break
x=np.array([e for _,e in d]); early=[p for p in d if p[1]<-0.15]
print('matched %d/%d; reveal-minus-onset mean %.3f median %.3f; earliest %.3f; >0.15s early: %d; within +/-0.15: %d%%'%(len(d),len(cw),x.mean(),np.median(x),x.min(),len(early),100*(np.abs(x)<=0.15).mean()))
print('early:',early); print('late >0.15:',[p for p in d if p[1]>0.15])
