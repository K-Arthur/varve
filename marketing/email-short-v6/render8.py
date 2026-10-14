from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
from helpers6 import *
import helpers6 as helpers
OW,OH,FPS=1080,1920,30; DUR=34.6; CX=540
R=str(ROOT/'shots-store')+'/'
BB=json.load(open(R+'bboxes.json'))['shots']
A=json.load(open(ROOT/'audio/align.json')); TOK=A['words']
CH=[("What if",2,[]),("designing an email",3,[2]),("cost you",2,[]),("nothing?",1,[0]),
("Varve has",2,[0]),("a whole workspace",3,[2]),("just for email.",3,[2]),
("Build it",2,[]),("from real blocks:",3,[2]),("logo,",1,[0]),("hero,",1,[0]),("heading,",1,[0]),("button.",1,[0]),
("Preview",1,[0]),("the finished email,",3,[2]),("right in",2,[]),("the app.",2,[1]),
("Run",1,[]),("compatibility checks,",2,[0,1]),("before you export.",3,[2]),
("Then get",2,[]),("the HTML,",2,[1]),("and a plain-text",4,[2]),("version too.",2,[]),
("Every block",2,[1]),("stays in",2,[]),("the same",2,[]),("Varve document.",2,[0]),
("And core editing",3,[]),("stays local,",2,[1]),("on your machine.",3,[2]),
("It's free.",2,[1]),("And your work",3,[2]),("stays yours.",2,[1]),
("Subscribe,",1,[0]),("and try it",3,[]),("at varve.studio",3,[1])]
assert sum(c[1] for c in CH)==len(TOK),(sum(c[1] for c in CH),len(TOK))
LAG=0.02; caps=[]; k=0
for text,n,keys in CH:
    toks=TOK[k:k+n]; k+=n; words=text.split(' ')
    if len(words)==n: ws=[t[1]+LAG for t in toks]
    else: ws=[toks[0][1]+LAG]+[toks[n-len(words)+i][1]+LAG for i in range(1,len(words))]
    caps.append(dict(words=words,keys=keys,ws=ws,s=toks[0][1]+LAG,last=toks[-1][2]))
for i,c in enumerate(caps):
    nxt=caps[i+1]['s'] if i+1<len(caps) else 33.4
    c['e']=min(nxt,c['last']+0.45) if nxt-c['last']>0.7 else nxt
def tw(word,after=0):
    for w in TOK:
        if w[1]>=after and w[0].strip('.,?-').lower().startswith(word): return w[1]
    raise KeyError(word)
PAD=40
def bbox(shot,path):
    d=BB[shot]
    for p in path.split('.'): d=d[p]
    return (d['x'],d['y'],d['x']+d['w'],d['y']+d['h'])
MEASURED={'emailWorkspaceButton':(3506,18,3663,73)}  # not in bboxes.json; measured from pixels of 01
AS={}

def onset_fix(t): return t
SHIFTS=[]
for c in caps:
    nw=[onset_fix(w) for w in c['ws']]
    for o,n_ in zip(c['ws'],nw):
        if n_-o>0.005: SHIFTS.append((round(o,2),round(n_,2)))
    _fx=json.load(open(ROOT/'audio/capfix.json')); nw=[max(w,_fx.get('%.3f'%w,w)) for w in nw]  # second aligner (small.en) says later -> reveal no more than 0.1s before it
    c['ws']=nw; c['s']=nw[0]
for i,c in enumerate(caps):
    nxt=caps[i+1]['s'] if i+1<len(caps) else 33.4
    c['e']=min(nxt,c['last']+0.45) if nxt-c['last']>0.7 else nxt
# Remap v6's same focus targets to the supplied store-email geometry.
_rows=BB['01-workspace-full.png']['layerList']
MEASURED={'emailWorkspaceButton':bbox('01-workspace-full.png','emailWorkspaceButton'),
          'layersList':(min(r['box']['x'] for r in _rows),min(r['box']['y'] for r in _rows),
                        max(r['box']['x']+r['box']['w'] for r in _rows),max(r['box']['y']+r['box']['h'] for r in _rows)),
          'docOverview':bbox('01-workspace-full.png','documentOverview')}
CAPTION_FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
def caption_font(sz): return ImageFont.truetype(CAPTION_FONT,sz)

AS={}
def getbox(shot,src):
    box=MEASURED[src] if src in MEASURED else bbox(shot,src)
    # The store canvas is narrower. Include 65 px of real canvas context on each
    # side, retaining v6's 822x1252 coordinate space and card/zoom sizes.
    if shot=='02-canvas-crop.png': box=(box[0]+65,box[1],box[2]+65,box[3])
    return box
class VP:  # real screenshot card with an animated viewport (slow zoom/pan), boxes follow the viewport
    def __init__(s,shot,bounds,W,H,keys,boxes,fade=False):
        s.src=Image.open(R+shot).convert('RGB')
        if shot=='02-canvas-crop.png':
            s.src=Image.open(R+'01-workspace-full.png').convert('RGB').crop((1467,295,2289,1547))
        s.shot=shot; s.bounds=bounds; s.W,s.H=W,H; s.keys=keys; s.fade=fade
        s.B={k:getbox(shot,v) for k,v in boxes.items()}
    def view(s,t):
        k=s.keys
        if t<=k[0][0]: c=k[0][1:]
        elif t>=k[-1][0]: c=k[-1][1:]
        else:
            for a,b in zip(k,k[1:]):
                if t<=b[0]:
                    e=eio((t-a[0])/(b[0]-a[0])) if b[0]>a[0] else 1; c=[a[i]+(b[i]-a[i])*e for i in (1,2,3)]; break
        cx,cy,w=c; x0,y0,x1,y1=s.bounds; w=min(w,x1-x0,(y1-y0)*s.W/s.H); h=w*s.H/s.W
        vx=min(max(cx-w/2,x0),x1-w); vy=min(max(cy-h/2,y0),y1-h); return (vx,vy,w,h)
    def render(s,t):
        vx,vy,w,h=s.view(t)
        im=s.src.resize((s.W,s.H),Image.LANCZOS,box=(vx,vy,vx+w,vy+h)); c=card_from(im,22)
        if s.fade:
            al=c.getchannel('A'); f=np.clip((s.W-1-np.arange(s.W))/110,0,1)[None,:,None]; rgb=np.array(c.convert('RGB')).astype(float); bgc=rgb[:,-8:].reshape(-1,3).mean(0)
            c=Image.fromarray((rgb*f+bgc*(1-f)).astype(np.uint8)).convert('RGBA'); c.putalpha(al)
        P=Image.new('RGBA',(s.W+2*PAD,s.H+2*PAD),(0,0,0,0)); P.alpha_composite(c,(PAD,PAD))
        sc=s.W/w; B={}
        for k,(a,b_,c_,d) in s.B.items():
            bx=[(a-vx)*sc+PAD,(b_-vy)*sc+PAD,(c_-vx)*sc+PAD,(d-vy)*sc+PAD]
            cl=[max(bx[0],PAD+3),max(bx[1],PAD+3),min(bx[2],PAD+s.W-3),min(bx[3],PAD+s.H-3)]
            vis=max(0,cl[2]-cl[0])*max(0,cl[3]-cl[1])/min((bx[2]-bx[0])*(bx[3]-bx[1]),s.W*s.H)
            if vis>0.5: B[k]=tuple(cl)
        return P,B
def addvp(key,shot,bounds,W,H,keys,boxes={},fade=False):
    v=VP(shot,bounds,W,H,keys,boxes,fade); P,_=v.render(keys[0][0]); AS[key]=dict(vp=v,img=P,sh=shadow(P),boxes={})
def add(k,img,**kw): AS[k]=dict(img=img,sh=shadow(img),boxes={},**kw)
def laptop(w=760):
    s=w/640; im=Image.new('RGBA',(w,int(440*s)),(0,0,0,0)); d=ImageDraw.Draw(im)
    d.rounded_rectangle((40*s,0,600*s,362*s),int(22*s),fill=(30,34,44,255),outline=(255,255,255,90),width=4)
    scr=Image.open(R+'01-workspace-full.png').convert('RGB').resize((int(528*s),int(330*s)),Image.LANCZOS); im.paste(scr,(int(56*s),int(16*s)))
    d.polygon([(0,380*s),(640*s,380*s),(600*s,430*s),(40*s,430*s)],fill=(60,66,80,255)); d.rounded_rectangle((0,366*s,640*s,392*s),10,fill=(90,98,115,255))
    return im
def sub_btn2(done,w=720,h=160):
    im=Image.new('RGBA',(w,h),(0,0,0,0)); d=ImageDraw.Draw(im)
    if done: d.rounded_rectangle((0,0,w-1,h-1),h//2,fill=(48,52,60,255),outline=(255,255,255,120),width=4)
    else: d.rounded_rectangle((0,0,w-1,h-1),h//2,fill=(255,0,0,255),outline=(255,255,255,255),width=5)
    f=font(72,850); t='SUBSCRIBED' if done else 'SUBSCRIBE'; b=f.getbbox(t); tw_=b[2]-b[0]; x=(w-(tw_+92))//2+92 if done else (w-tw_)//2
    d.text((x-b[0],(h-(b[3]-b[1]))//2-b[1]),t,font=f,fill='white')
    if done: bx=x-92; d.chord((bx,40,bx+62,107),180,360,fill='white'); d.rectangle((bx,73,bx+62,103),fill='white'); d.ellipse((bx+22,103,bx+40,121),fill='white')
    return im
CLICK=30.0
def prep():
    C='02-canvas-crop.png'; W1='01-workspace-full.png'; P11='16-preview-desktop.png'
    addvp('canvas0',C,(0,0,822,1252),525,800,[(0,411,626,822),(3.2,411,626,740)])
    addvp('ws',W1,(845,0,3840,2400),690,900,[(3.15,1878,1200,2070),(3.5,1878,1200,2070),(4.05,1878,940,900),(4.9,1878,960,840)],{'email':'blocks.Email'})
    addvp('canvas',C,(0,0,822,1252),600,1000,[(6.4,411,626,822),(7.2,411,626,822),(7.6,411,626,822),(8.0,241,248,460),(8.4,241,248,460)],{'email':'blocks.Email','logo':'blocks.Header logo'})
    addvp('canvas_z',C,(0,0,822,1252),690,430,[(8.35,411,369.5,822),(8.95,411,369.5,822),(9.4,411,607,700),(9.95,264.5,780.5,380),(10.4,264.5,780.5,380)],{'hero':'blocks.Hero image','heading':'blocks.Heading','button':'blocks.CTA button'})
    addvp('prev',P11,(845,0,3840,2258),690,760,[(10.35,960,760,740),(10.46,960,760,740),(10.9,1880,1129,2050),(11.9,1880,1129,2050)],{'tab':'emailPreviewTab','email':'preview.iframe'})
    addvp('prev_z',P11,(860,700,2900,2236),690,780,[(11.9,1880,1900,1350),(12.35,1880,1900,1300),(12.55,1700,1350,1000),(13.4,1700,1350,940)],{'logo':'preview.headerLogo','heading':'preview.heading'})
    addvp('pre','20-preflight-results.png',(845,1510,2912,2250),780,160,[(13.4,1878,1772,2048),(15.2,1878,1772,2048)],{'preflight':'preflightPanel'})
    addvp('exp','20-preflight-results.png',(860,2185,1590,2283),690,93,[(15.2,1225,2234,730),(16.7,1225,2234,690)],{'html':'exportHtmlButton'})
    addvp('html','18-html-output.png',(845,850,2912,1700),780,280,[(16.65,1878,1274,2067),(18.3,1878,1274,2067)],{'code':'htmlEditor'})
    addvp('plain','19-plain-text-output.png',(0,0,2066,948),780,350,[(18.3,1033,460,2067),(20.4,1033,460,2067)],{'plain':'plainText'})
    addvp('layers',W1,(0,150,900,1750),600,800,[(20.4,420,1290,900),(20.75,420,1360,840),(21.9,420,1350,840),(22.4,420,545,840),(23.6,420,545,840)],{'list':'layersList','doc':'docOverview'})
    im=Image.open(R+W1).convert('RGB').crop((3145,8,3680,84)); sc_=690/im.width; im=im.resize((690,round(im.height*sc_)),Image.LANCZOS); c=card_from(im,22); P=Image.new('RGBA',(c.width+2*PAD,c.height+2*PAD),(0,0,0,0)); P.alpha_composite(c,(PAD,PAD)); x0,y0,x1,y1=MEASURED['emailWorkspaceButton']; AS['pill']=dict(img=P,sh=shadow(P),boxes={'emailbtn':((x0-3145)*sc_+PAD,(y0-8)*sc_+PAD,(x1-3145)*sc_+PAD,(y1-8)*sc_+PAD)})
    add('zero',chip('$0',190,fill=(59,130,246,90),pad=(64,34)),blur=True)
    add('laptop',laptop(760)); add('local',chip('Local-first',80,fill=(59,130,246,90)),blur=True)
    add('mach',chip('Runs on your machine',54,color=(220,226,236)),blur=True)
    logo=Image.open(ROOT/'shots'/'02-canvas-crop.png').convert('RGB').crop((92,108,305,190)); ic=Image.new('RGBA',(430,190),(255,255,255,255)); logo=logo.resize((405,156),Image.LANCZOS); ic.alpha_composite(logo.convert('RGBA'),(12,17)); ic=card_from(ic,28)
    add('icon',ic.resize((380,168),Image.LANCZOS)); add('icon_s',ic.resize((320,141),Image.LANCZOS))
    add('free',chip('Free',110,fill=(59,130,246,90)),blur=True); add('src',chip('Source-available',62),blur=True)
    add('yours',chip('Your files, your disk',62),blur=True)
    add('sub',sub_btn2(False)); add('subd',sub_btn2(True))
    add('url',chip('varve.studio',104,fill=(59,130,246,80),pad=(60,38)),blur=True)
    add('endsub',chip('Linux · macOS · Windows',50,color=(210,218,230)),blur=True)
SC=[(0.0,1.6,[('canvas0',0,CX,1000,-9,6,1,1)]),
(1.6,3.15,[('canvas0',0,CX,1000,7,5,0.8,0.6),('zero',0.45,CX,1000,0,0,1,1.5)]),
(3.15,4.9,[('ws',0,CX,1000,-6,5,1,1)]),
(4.9,6.4,[('pill',0,CX,1000,0,8,1,1)]),
(6.4,8.35,[('canvas',0,CX,1000,7,5,1,1)]),
(8.35,10.35,[('canvas_z',0,CX,1000,-5,4,1,1)]),
(10.35,11.9,[('prev',0,CX,1000,6,5,1,1)]),
(11.9,13.4,[('prev_z',0,CX,1000,-5,4,1,1)]),
(13.4,15.2,[('pre',0,CX,1000,6,5,1,1)]),
(15.2,16.65,[('exp',0,CX,1000,0,8,1,1)]),
(16.65,18.3,[('html',0,CX,1000,-6,6,1,1)]),
(18.3,20.4,[('plain',0,CX,1000,6,5,1,1)]),
(20.4,23.55,[('layers',0,CX,1000,-5,5,1,1)]),
(23.55,25.1,[('laptop',0,CX,960,0,9,1,1),('local',0.5,CX,1290,0,0,1,1.5)]),
(25.1,26.7,[('icon',0,CX,900,-6,6,0.9,1),('mach',0.3,CX,1230,0,0,1,1.5)]),
(26.7,28.0,[('icon',0,CX,920,7,6,1,1),('free',0.6,CX,1240,0,0,1,1.5)]),
(28.0,29.45,[('src',0,CX,1000,0,0,1,1.3),('yours',0.25,CX,1160,0,0,1,1.5)]),
(29.45,30.8,[('sub',0,CX,1000,0,6,1,1)]),
(30.8,DUR,[('icon_s',0,CX,820,0,6,1,1),('url',0.4,CX,1130,0,0,1,1.4),('endsub',0.9,CX,1300,0,0,1,1.5)])]
FOC={}
def F(s,key,lst): FOC[(s,key)]=lst
F(3.15,'ws',[(tw('workspace'),'email')])
F(4.9,'pill',[(tw('email',5.0),'emailbtn')])
F(6.4,'canvas',[(tw('blocks'),'email'),(tw('logo'),'logo')])
F(8.35,'canvas_z',[(tw('hero'),'hero'),(tw('heading'),'heading'),(tw('button'),'button')])
F(10.35,'prev',[(tw('preview'),'tab'),(tw('email',10),'email')])
# The following camera move rides into the workspace as the line finishes; no unrelated item is highlighted.
# FOC intentionally has no entry for this move.
F(13.4,'pre',[(tw('compatibility'),'preflight')])
F(15.2,'exp',[(15.55,'html')])
F(16.65,'html',[(tw('html'),'code')])
F(18.3,'plain',[(tw('plain'),'plain')])
F(20.4,'layers',[(tw('block',20),'list'),(tw('document'),'doc')])
EV=[]
for s_,e,items in SC:
    EV.append(('whoosh',max(0,s_-0.12)))
    for it in items:
        if it[1]>0.05: EV.append(('pop',s_+it[1]))
for v in FOC.values():
    for t,b in v: EV.append(('focus',t))
EV+=[('mclick',CLICK),('chime',31.4)]
for c in caps: EV.append(('tick',c['s']))
# Per-caption text origins fitted across every frame of the unchanged v6 motion.
CAPTION_Y=(400, 400, 391, 400, 391, 356, 296, 400, 340, 312, 400, 400, 400, 400, 400, 339, 400, 357, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 364, 400, 400, 400, 400, 400, 400, 400, 400)
def caption(cv,t):
    for ci,c in enumerate(caps):
        if c['s']<=t<c['e']: break
    else: return
    p=t-c['s']; sc=0.8+0.2*spring(p,16,0.5)
    sz=int((76 if ci==6 else 84)*sc); f=caption_font(sz); sp=f.getlength(' ')
    ws=c['words']; widths=[f.getlength(w) for w in ws]; tot=sum(widths)+sp*(len(ws)-1)+(20*len(c['keys']))
    if tot>708: sz=int(sz*708/tot); f=caption_font(sz); sp=f.getlength(' '); widths=[f.getlength(w) for w in ws]; tot=sum(widths)+sp*(len(ws)-1)+20*len(c['keys'])
    x=CX-tot/2; y=CAPTION_Y[ci]+(1-sc)*60; ov=Image.new('RGBA',cv.size,(0,0,0,0)); d=ImageDraw.Draw(ov); asc=f.getbbox('Hg')
    for i,w in enumerate(ws):
        on=t>=c['ws'][i]
        if i in c['keys']:
            x+=10
            if on:
                g=min(1,spring(t-c['ws'][i],18,0.6)); pw=widths[i]*g
                d.rounded_rectangle((x-14,y+asc[1]-14,x-14+(pw+28),y+asc[3]+12),14,fill=(59,130,246,130),outline=BLUE+(255,),width=4)
        col=(255,255,255,255) if on else (255,255,255,95)
        d.text((x+3,y+4),w,font=f,fill=(0,0,0,140 if on else 40)); d.text((x,y),w,font=f,fill=col)
        x+=widths[i]+sp+(10 if i in c['keys'] else 0)
    cv.alpha_composite(ov)
def homog(src,dst):  # maps src->dst
    c=coeffs(src,dst); return np.array([[c[0],c[1],c[2]],[c[3],c[4],c[5]],[c[6],c[7],1]])
LOG=[]; NOGLOW=[False]
def frame(n,record=False):
    t=n/FPS; cv=bg(t)
    cam=(7*math.sin(t*0.35), 16*math.sin(t*0.3+1))
    for s,e,items in SC:
        if not (s-0.01<=t<e+0.3): continue
        lt=t-s; out=eio((t-e)/0.3) if t>e else 0; pr=lt/(e-s)
        for key,dl,cx,cy,yw,pt,scl,dep in items:
            a=lt-dl
            if a<0: continue
            k=spring(a,11,0.55); op=min(1,eio(a/0.25))*(1-out)
            A_=AS[key]; img=A_['img']; shp=A_['sh']; BX=A_['boxes']
            if 'vp' in A_: img,BX=A_['vp'].render(t)
            if key=='sub' and t>=CLICK+0.06: A_=AS['subd']; img=A_['img']; shp=A_['sh']
            zb=0; active=[]
            fl=FOC.get((s,key),[])
            for j,(ft,b) in enumerate(fl):
                nx=fl[j+1][0] if j+1<len(fl) else e+0.5
                amt=bump(t,ft-0.05,0.2,max(0.05,min(0.9,nx-ft-0.45)),0.3)
                if amt<=0 or b not in BX: continue
                if NOGLOW[0]: active.append((b,amt,ft)); zb=max(zb,amt); continue
                img=spotlight(img,BX[b],amt,{'email':'Email workspace','emailbtn':'Email workspace','logo':'Header logo','hero':'Hero image','heading':'Heading','button':'CTA button','tab':'Email preview','email':'Finished email','preflight':'Compatibility checks','html':'HTML export','code':'HTML code','plain':'Plain-text export','list':'Content blocks','doc':'Varve document'}.get(b,b.replace('_',' ').title())); zb=max(zb,amt); active.append((b,amt,ft))
            ph=s*0.7
            dyaw=yw*(1-0.35*pr)+2.0*math.sin(lt*0.9+ph); dpit=pt+1.4*math.sin(lt*0.7+ph*2)+(1-k)*18
            x=cx+cam[0]*dep; y=cy+cam[1]*dep+(1-k)*170-22*pr*dep-out*140+5*math.sin(lt*0.8+ph)
            z=(1-k)*520-90*pr+out*320
            sc=scl*(1+0.04*pr)*(1+0.035*zb)
            if key=='sub' and CLICK-0.06<=t<CLICK+0.06: sc*=0.94
            if key=='sub' and t>=CLICK+0.06: sc*=1+0.06*math.exp(-(t-CLICK)*6)*math.sin((t-CLICK)*28)
            qq=project(x,y,img.width-2*PAD if key in AS and 'crop' in AS[key] else img.width,img.height,math.radians(dyaw),math.radians(dpit),z,sc)
            x-=(min(p[0] for p in qq)+max(p[0] for p in qq))/2-x  # cancel perspective-induced horizontal shift so the card stays centred
            place(cv,img,shp,x,y,math.radians(dyaw),math.radians(dpit),z,sc,op,A_.get('blur',False))
            if record:
                w,h=img.size; q=project(x,y,w,h,math.radians(dyaw),math.radians(dpit),z,sc)
                H=homog([(0,0),(w,0),(w,h),(0,h)],q)
                def P(u,v): p=H@np.array([u,v,1.]); return (float(p[0]/p[2]),float(p[1]/p[2]))
                LOG.append(dict(t=t,key=key,quad=q,op=op,active=[dict(box=b,amt=am,ft=ft,src=BX[b],
                    screen=[P(BX[b][0],BX[b][1]),P(BX[b][2],BX[b][1]),P(BX[b][2],BX[b][3]),P(BX[b][0],BX[b][3])]) for b,am,ft in active]))
    cursor(cv,t,[(29.55,850,1300,0),(CLICK-0.05,CX+60,1010,0),(CLICK,CX+60,1010,1),(30.7,CX+60,1010,0)])
    caption(cv,t)
    return np.array(cv.convert('RGB')).tobytes()
prep()
if __name__=='__main__':
    out=sys.argv[1]
    if len(sys.argv)>2:
        for v in sys.argv[2:]:
            n=int(round(float(v)*FPS)); LOG.clear(); Image.frombytes('RGB',(OW,OH),frame(n,True)).save(f'{out}_{float(v):.2f}.png')
            json.dump(LOG,open(f'{out}_{float(v):.2f}.json','w'))
        sys.exit()
    ff=subprocess.Popen(['ffmpeg','-y','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{OW}x{OH}','-r',str(FPS),'-i','-','-c:v','libx264','-preset','slow','-crf','20','-maxrate','16M','-bufsize','32M','-pix_fmt','yuv420p',out],stdin=subprocess.PIPE)
    with Pool(6) as pool:
        for i,b in enumerate(pool.imap(frame,range(int(DUR*FPS)),chunksize=6)):
            ff.stdin.write(b)
            if i%150==0: print(i,flush=True)
    ff.stdin.close(); ff.wait()
