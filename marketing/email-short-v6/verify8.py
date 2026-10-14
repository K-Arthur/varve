"""Verify v8 against the approved v6 timeline and check every rendered frame.

Usage: python verify8.py [output.mp4]
The render path collects projected UI/focus geometry from the production renderer,
checks actual caption pixels, and copies v6's AAC stream without re-encoding.
"""
from pathlib import Path
import ast
import hashlib
import importlib.util
import json
import subprocess
import sys
from multiprocessing import Pool
from PIL import Image

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
import render8 as V

def load_v6():
    spec=importlib.util.spec_from_file_location('approved_v6',ROOT/'render6.py')
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def ast_member(path,name):
    return next(n for n in ast.parse(path.read_text()).body if isinstance(n,(ast.FunctionDef,ast.ClassDef)) and n.name==name)

def check_baseline():
    old=load_v6()
    assert (V.SC,V.FOC,V.EV,V.caps,V.CLICK,V.DUR,V.FPS)==(old.SC,old.FOC,old.EV,old.caps,old.CLICK,old.DUR,old.FPS)
    for name in ('frame','laptop','sub_btn2'):
        assert ast.dump(ast_member(ROOT/'render8.py',name))==ast.dump(ast_member(ROOT/'render6.py',name)),name
    for name in ('view','render'):
        a=next(n for n in ast_member(ROOT/'render8.py','VP').body if isinstance(n,ast.FunctionDef) and n.name==name)
        b=next(n for n in ast_member(ROOT/'render6.py','VP').body if isinstance(n,ast.FunctionDef) and n.name==name)
        assert ast.dump(a)==ast.dump(b),name
    for filename in ('helpers6.py','render6.py','out/varve-email-short-v6.mp4'):
        expected=subprocess.check_output(['git','show',f'fba9f89:marketing/email-short-v6/{filename}'],cwd=ROOT)
        assert hashlib.sha256(expected).digest()==hashlib.sha256((ROOT/filename).read_bytes()).digest(),filename
    assert V.AS.keys()==old.AS.keys()
    for key,asset in V.AS.items():
        assert asset['img'].size==old.AS[key]['img'].size,key
        if 'vp' in asset:
            assert [k[0] for k in asset['vp'].keys]==[k[0] for k in old.AS[key]['vp'].keys],key
            assert [k[3] for k in asset['vp'].keys]==[k[3] for k in old.AS[key]['vp'].keys],key
    print('PASS: v6 shot, caption, focus, sound-effect, transition and zoom schedules; unchanged camera/effect code and helpers; unchanged card sizes',flush=True)
    return old

CAPTION=V.caption
CAPTION_BOUNDS=[None]
def capture_caption(cv,t):
    overlay=Image.new('RGBA',cv.size)
    CAPTION(overlay,t)
    CAPTION_BOUNDS[0]=overlay.getbbox()
    cv.alpha_composite(overlay)

def rect(points):
    return (min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points))

def intersect(a,b,gap=0):
    return a[0]<b[2]+gap and a[2]>b[0]-gap and a[1]<b[3]+gap and a[3]>b[1]-gap

# Record the actual content alpha bounds at each production place() call.
PLACE=V.place
CONTENT=[]
def capture_place(cv,img,shp,cx,cy,yaw,pitch,z,scale,op,blur=False):
    if op>0.01:
        quad=V.project(cx,cy,img.width,img.height,yaw,pitch,z,scale)
        H=V.homog([(0,0),(img.width,0),(img.width,img.height),(0,img.height)],quad)
        asset=next(a for a in V.AS.values() if a['img'].size==img.size)
        vp=asset.get('vp')
        bounds=(V.PAD,V.PAD,V.PAD+vp.W,V.PAD+vp.H) if vp else asset['img'].getbbox()
        # Canvas rulers/margins are context; protect the entire email itself.
        # Focus boxes and their label chips are checked separately below.
        for asset in V.AS.values():
            vp=asset.get('vp')
            if vp and vp.shot=='02-canvas-crop.png' and img.size==asset['img'].size:
                vx,vy,w,h=vp.view(CURRENT_T[0]); sc=vp.W/w
                a,b,c,d=V.getbox(vp.shot,'blocks.Email')
                bounds=(max(V.PAD,(a-vx)*sc+V.PAD),max(V.PAD,(b-vy)*sc+V.PAD),
                        min(V.PAD+vp.W,(c-vx)*sc+V.PAD),min(V.PAD+vp.H,(d-vy)*sc+V.PAD))
                break
        a,b,c,d=bounds
        projected=[]
        for u,y in [(a,b),(c,b),(c,d),(a,d)]:
            p=H@V.np.array([u,y,1.]); projected.append((float(p[0]/p[2]),float(p[1]/p[2])))
        CONTENT.append(rect(projected))
    PLACE(cv,img,shp,cx,cy,yaw,pitch,z,scale,op,blur)

CURRENT_T=[0.]
V.caption=capture_caption
V.place=capture_place

def checked_frame(n):
    t=n/V.FPS; CURRENT_T[0]=t; V.LOG.clear(); CONTENT.clear(); CAPTION_BOUNDS[0]=None
    data=V.frame(n,record=True)
    caption=CAPTION_BOUNDS[0]
    if caption:
        assert caption[0]>=0 and caption[2]<=930 and caption[1]>=290 and caption[3]<=1440,(n,'safe zone',caption)
        assert not any(intersect(caption,b) for b in CONTENT),(n,'important UI overlap',caption,CONTENT)
        for item in V.LOG:
            w,h=V.AS[item['key']]['img'].size
            H=V.homog([(0,0),(w,0),(w,h),(0,h)],item['quad'])
            for active in item['active']:
                assert not intersect(caption,rect(active['screen'])),(n,'selection overlap')
                if active['amt']<=0.01:continue
                label={'email':'Finished email','emailbtn':'Email workspace','logo':'Header logo','hero':'Hero image','heading':'Heading','button':'CTA button','tab':'Email preview','preflight':'Compatibility checks','html':'HTML export','code':'HTML code','plain':'Plain-text export','list':'Content blocks','doc':'Varve document'}[active['box']]
                a,b,c,d=map(int,active['src']); f=V.ImageFont.truetype(V.FONT,20); cw=int(f.getlength(label)+20); ch=32
                x=max(6,min(w-cw-6,a)); y=b-ch-7
                if y<6:y=min(h-ch-6,d+7)
                points=[]
                for u,z in [(x,y),(x+cw,y),(x+cw,y+ch),(x,y+ch)]:
                    p=H@V.np.array([u,z,1.]); points.append((float(p[0]/p[2]),float(p[1]/p[2])))
                assert not intersect(caption,rect(points)),(n,'label-chip overlap',caption,rect(points))
    focuses=[{'key':item['key'],'box':a['box'],'amt':a['amt'],'ft':a['ft'],'screen':a['screen']} for item in V.LOG for a in item['active']]
    return data,{'n':n,'caption':caption,'focuses':focuses}

def check_focus_records(old,records):
    assert [r['n'] for r in records]==list(range(int(V.DUR*V.FPS)))
    for record in records:
        t=record['n']/V.FPS; expected=[]
        for start,end,items in old.SC:
            if not(start-.01<=t<end+.3):continue
            for key,delay,*_ in items:
                if t-start-delay<0:continue
                focuses=old.FOC.get((start,key),[])
                if not focuses:continue
                asset=old.AS[key]
                if 'vp' in asset:_,boxes=asset['vp'].render(t)
                else:boxes=asset['boxes']
                for i,(ft,box) in enumerate(focuses):
                    nxt=focuses[i+1][0] if i+1<len(focuses) else end+.5
                    amount=old.bump(t,ft-.05,.2,max(.05,min(.9,nxt-ft-.45)),.3)
                    if amount>0 and box in boxes:expected.append((key,box,amount,ft))
        actual=[(f['key'],f['box'],f['amt'],f['ft']) for f in record['focuses']]
        assert [f for f in expected if f[2]>.01]==[f for f in actual if f[2]>.01],('visible highlight timing',record['n'])
        for key in V.AS:
            assert max([f[2] for f in expected if f[0]==key]+[0])==max([f[2] for f in actual if f[0]==key]+[0]),('highlight zoom response',record['n'],key)
    print('PASS: all 1038 frames match v6 visible highlight envelopes and zoom response exactly',flush=True)

if __name__=='__main__':
    old=check_baseline()
    if len(sys.argv)==1:sys.exit()
    if sys.argv[1]=='--verify-existing':
        check_focus_records(old,json.loads(Path(sys.argv[2]).read_text()));sys.exit()
    output=Path(sys.argv[1]).resolve(); output.parent.mkdir(parents=True,exist_ok=True)
    ff=subprocess.Popen(['ffmpeg','-y','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s','1080x1920','-r',str(V.FPS),'-i','-',
                         '-i',str(ROOT/'out/varve-email-short-v6.mp4'),'-map','0:v:0','-map','1:a:0',
                         '-c:v','libx264','-preset','slow','-crf','20','-maxrate','16M','-bufsize','32M','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',str(output)],stdin=subprocess.PIPE)
    records=[]
    try:
        with Pool(6) as pool:
            for i,(data,record) in enumerate(pool.imap(checked_frame,range(int(V.DUR*V.FPS)),chunksize=6)):
                ff.stdin.write(data); records.append(record)
                if i%150==0:print('Rendered and checked',i,'/',int(V.DUR*V.FPS),flush=True)
        ff.stdin.close()
        assert ff.wait()==0,'ffmpeg failed'
    except BaseException:
        ff.kill(); ff.wait(); raise
    check_focus_records(old,records)
    output.with_suffix('.frames.json').write_text(json.dumps(records,indent=2))
    print('PASS: every frame has safe captions and no caption overlap with important UI, selection boxes or label chips',flush=True)
