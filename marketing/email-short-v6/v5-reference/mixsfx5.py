import json,numpy as np,soundfile as sf
sr=48000;N=int(34.6*sr);o=np.zeros(N)
S={'pop':('drop_002',-9),'tick':('click_002',-20),'mclick':('click_004',-6),'chime':('confirmation_002',-10),'whoosh':('whoosh',-12),'focus':('select_002',-16)}
for k,t in json.load(open('events5.json')):
    f,db=S[k]; a,_=sf.read(f'sfx_{f}.wav'); i=int(t*sr); a=a[:N-i]*10**(db/20); o[i:i+len(a)]+=a
sf.write('sfx5.wav',o,sr); print(np.abs(o).max())
