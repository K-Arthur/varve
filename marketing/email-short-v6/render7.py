from pathlib import Path
import json, math, subprocess, sys

ROOT=Path(__file__).resolve().parent
STORE=ROOT/'shots-store'
sys.path.insert(0,str(ROOT))
from helpers6 import *
import helpers6 as H

OW,OH,FPS,DUR,CX=1080,1920,30,34.6,540
PAD=40
STORE_BB=json.loads((STORE/'bboxes.json').read_text())['shots']
TOK=json.loads((ROOT/'audio/align.json').read_text())['words']
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
assert sum(c[1] for c in CH)==len(TOK)

def word_time(prefix,after=0):
    for w in TOK:
        if w[1]>=after and w[0].strip('.,?-').lower().startswith(prefix.lower()): return w[1]
    raise KeyError(prefix)

caps=[]; k=0; lag=0.02
for phrase,n,keys in CH:
    words=phrase.split(' '); toks=TOK[k:k+n]; k+=n
    if len(words)==n: starts=[t[1]+lag for t in toks]
    else: starts=[toks[0][1]+lag]+[toks[n-len(words)+i][1]+lag for i in range(1,len(words))]
    caps.append(dict(words=words,keys=keys,ws=starts,s=starts[0],last=toks[-1][2]))
capfix=json.loads((ROOT/'audio/capfix.json').read_text())
for c in caps:
    c['ws']=[max(t,capfix.get('%.3f'%t,t)) for t in c['ws']]; c['s']=c['ws'][0]
for i,c in enumerate(caps):
    nxt=caps[i+1]['s'] if i+1<len(caps) else 33.4
    c['e']=min(nxt,c['last']+0.45) if nxt-c['last']>0.7 else nxt

def source_box(shot,path):
    d=STORE_BB[shot]
    for key in path.split('.'): d=d[key]
    return (d['x'],d['y'],d['x']+d['w'],d['y']+d['h'])

# The list target is the union of the measured layer rows, so the box tracks the
# complete stack of Hollowpine email blocks without including the unrelated panel chrome.
_rows=STORE_BB['04-layers-panel.png']['layerList']
LAYER_ROWS=(min(r['box']['x'] for r in _rows),min(r['box']['y'] for r in _rows),
            max(r['box']['x']+r['box']['w'] for r in _rows),max(r['box']['y']+r['box']['h'] for r in _rows))

class Viewport:
    def __init__(self,image,bounds,W,H,keys,boxes):
        self.src=Image.open(image).convert('RGB'); self.bounds=bounds
        self.W,self.H=W,H; self.keys=keys; self.boxes=boxes
    def view(self,t):
        k=self.keys
        if t<=k[0][0]: c=k[0][1:]
        elif t>=k[-1][0]: c=k[-1][1:]
        else:
            for a,b in zip(k,k[1:]):
                if t<=b[0]:
                    e=eio((t-a[0])/(b[0]-a[0])) if b[0]>a[0] else 1
                    c=[a[i]+(b[i]-a[i])*e for i in (1,2,3)]; break
        cx,cy,w=c; x0,y0,x1,y1=self.bounds
        w=min(w,x1-x0,(y1-y0)*self.W/self.H); h=w*self.H/self.W
        vx=min(max(cx-w/2,x0),x1-w); vy=min(max(cy-h/2,y0),y1-h)
        return vx,vy,w,h
    def render(self,t):
        vx,vy,w,h=self.view(t)
        im=self.src.resize((self.W,self.H),Image.LANCZOS,box=(vx,vy,vx+w,vy+h))
        card=card_from(im,20); out=Image.new('RGBA',(self.W+2*PAD,self.H+2*PAD),(0,0,0,0)); out.alpha_composite(card,(PAD,PAD))
        sc=self.W/w; visible={}
        for name,(a,b,c,d) in self.boxes.items():
            raw=((a-vx)*sc+PAD,(b-vy)*sc+PAD,(c-vx)*sc+PAD,(d-vy)*sc+PAD)
            cl=(max(raw[0],PAD+2),max(raw[1],PAD+2),min(raw[2],PAD+self.W-2),min(raw[3],PAD+self.H-2))
            area=max(0,cl[2]-cl[0])*max(0,cl[3]-cl[1]); total=max(1,(raw[2]-raw[0])*(raw[3]-raw[1]))
            if area/total>=0.50: visible[name]=tuple(map(float,cl))
        return out,visible

AS={}
def add_view(key,filename,bounds,W,H,keys,boxes):
    v=Viewport(filename,bounds,W,H,keys,boxes)
    im,_=v.render(keys[0][0]); AS[key]={'vp':v,'img':im,'shadow':shadow(im),'boxes':boxes}

# Full email, editor canvas, layers, desktop workspace controls, and the export
# control all come from shots-store. The preview result/output images carrying the
# documented duplication, alignment, or export defects are intentionally unused.
email_boxes={
 'email':source_box('02-canvas-crop.png','blocks.Email'),
 'logo':source_box('02-canvas-crop.png','blocks.Header logo'),
 'hero':source_box('02-canvas-crop.png','blocks.Hero image'),
 'heading':source_box('02-canvas-crop.png','blocks.Heading'),
 'body':source_box('02-canvas-crop.png','blocks.Body'),
 'button':source_box('02-canvas-crop.png','blocks.CTA button'),
 'cta_label':source_box('02-canvas-crop.png','blocks.CTA label'),
 'shelf':source_box('02-canvas-crop.png','blocks.Shelf heading'),
 'ember':source_box('02-canvas-crop.png','blocks.Product Ember Ridge'),
 'hearth':source_box('02-canvas-crop.png','blocks.Product Hearth'),
 'frostline':source_box('02-canvas-crop.png','blocks.Product Frostline'),
 'footer':source_box('02-canvas-crop.png','blocks.Footer'),
}
workspace_email=source_box('01-workspace-full.png','blocks.Email')
add_view('email_full',STORE/'02-canvas-crop.png',(0,0,692,1252),620,1190,
         [(0,346,626,652),(DUR,346,626,652)],email_boxes)
add_view('email_focus',STORE/'02-canvas-crop.png',(0,0,692,1252),760,470,
         [(7.75,346,220,540),(8.06,346,220,540),(8.64,346,370,692),(9.14,346,680,692),(9.56,200,790,450),(10.35,346,626,692)],email_boxes)
add_view('workspace',STORE/'01-workspace-full.png',(845,295,2912,1717),760,780,
         [(3.15,1878,1006,1387),(4.9,1878,1006,1387)],
         {'email':workspace_email})
add_view('workspace_local',STORE/'01-workspace-full.png',(845,295,2912,1717),760,780,
         [(23.55,1878,1006,1387),(26.7,1878,1006,1387)],
         {'email':workspace_email})
add_view('email_button',STORE/'03-email-workspace-button.png',(0,0,702,104),760,132,
         [(4.9,351,52,600),(6.4,351,52,600)],
         {'emailbtn':source_box('03-email-workspace-button.png','emailWorkspaceButton')})
add_view('layers',STORE/'04-layers-panel.png',(0,0,844,1976),600,1000,
         [(6.4,422,1320,844),(7.75,422,1320,844)],{'layer_rows':LAYER_ROWS})
add_view('layers_end',STORE/'04-layers-panel.png',(0,0,844,1976),600,1000,
         [(20.4,422,1320,844),(22.0,422,1320,844)],{'layer_rows':LAYER_ROWS})
add_view('doc',STORE/'04-layers-panel.png',(0,0,844,550),700,455,
         [(22.0,422,275,844),(23.55,422,275,844)],
         {'document':source_box('04-layers-panel.png','documentOverview')})
add_view('preview_tab',STORE/'01-workspace-full.png',(800,1680,1125,1810),760,320,
         [(10.35,962,1745,325),(11.05,962,1745,325)],
         {'preview_tab':source_box('01-workspace-full.png','emailPreviewTab')})

# Crop only the Compatibility heading, inside bboxes.json's measured preflightPanel.
# This leaves its known warning noise and mismatched status counts outside the frame.
preflight=source_box('20-preflight-results.png','preflightPanel')
compat_crop=(preflight[0],preflight[1]+85,preflight[0]+280,preflight[1]+118)
compat_path=Path('/tmp/v7-compatibility-heading.png')
Image.open(STORE/'20-preflight-results.png').crop(compat_crop).save(compat_path)
add_view('compat',compat_path,(0,0,compat_crop[2]-compat_crop[0],compat_crop[3]-compat_crop[1]),760,90,
         [(13.4,(compat_crop[2]-compat_crop[0])/2,(compat_crop[3]-compat_crop[1])/2,compat_crop[2]-compat_crop[0]),
          (15.2,(compat_crop[2]-compat_crop[0])/2,(compat_crop[3]-compat_crop[1])/2,compat_crop[2]-compat_crop[0])],
         {'compatibility':(0,0,compat_crop[2]-compat_crop[0],compat_crop[3]-compat_crop[1])})
add_view('export',STORE/'22-export-buttons-crop.png',(0,0,794,158),760,160,
         [(15.2,397,79,794),(20.4,397,79,794)],
         {'export_button':source_box('22-export-buttons-crop.png','exportHtmlButton')})

SC=[
 (0.00,1.60,'email_full',540,1040,0.64),
 (1.60,3.15,'email_full',540,1040,0.64),
 (3.15,4.90,'workspace',540,980,0.90),
 (4.90,6.40,'email_button',540,980,1.00),
 (6.40,7.75,'layers',540,1030,0.80),
 (7.75,10.35,'email_focus',540,980,0.96),
 (10.35,11.05,'preview_tab',540,980,1.00),
 (11.05,11.90,'email_full',540,1030,0.62),
 (11.90,13.40,'workspace',540,980,0.88),
 (13.40,15.20,'compat',540,980,1.00),
 (15.20,16.65,'export',540,990,0.96),
 (16.65,20.40,'export',540,990,0.96),
 (20.40,22.00,'layers_end',540,1030,0.80),
 (22.00,23.55,'doc',540,980,0.96),
 (23.55,26.70,'workspace_local',540,980,0.90),
 (26.70,29.45,'email_full',540,1040,0.64),
 (29.45,DUR,'email_full',540,1040,0.64),
]
FOCUS={
 'workspace':[(word_time('workspace'),'email')],
 'email_button':[(word_time('email',4.9),'emailbtn')],
 'layers':[(word_time('blocks'),'layer_rows')],
 'email_focus':[(word_time('logo'),'logo'),(word_time('hero'),'hero'),(word_time('heading'),'heading'),(word_time('button'),'button')],
 'preview_tab':[(word_time('preview'),'preview_tab')],
 'email_full':[(word_time('email',11.0),'email')],
 'workspace_local':[(word_time('local'),'email')],
 'compat':[(word_time('compatibility'),'compatibility')],
 'export':[(word_time('export'),'export_button'),(word_time('HTML'),'export_button'),(word_time('plain'),'export_button')],
 'layers_end':[(word_time('block',20.0),'layer_rows')],
 'doc':[(word_time('document'),'document')],
}
LABELS={'email':'Email blocks','emailbtn':'Email workspace','layer_rows':'Email content blocks',
        'logo':'Hollowpine logo','hero':'Ember Ridge hero image','heading':'Email heading',
        'button':'CTA button','preview_tab':'Email Preview','compatibility':'Compatibility checks',
        'export_button':'Export HTML, text, and manifest','document':'Varve document'}

def overlap(a,b):
    return max(a[0],b[0])<min(a[2],b[2]) and max(a[1],b[1])<min(a[3],b[3])

def caption_lines(c,font,maxw):
    sp=font.getlength(' '); lines=[]; cur=[]; width=0
    for i,word in enumerate(c['words']):
        ww=font.getlength(word); nxt=width+(sp if cur else 0)+ww
        if cur and nxt>maxw: lines.append(cur); cur=[]; width=0
        width+= (sp if cur else 0)+ww; cur.append((i,word))
    if cur: lines.append(cur)
    return lines

def caption(cv,t,cards,focus_rects):
    c=next((c for c in caps if c['s']<=t<c['e']),None)
    if c is None: return None,True
    size=90; font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',size)
    lines=caption_lines(c,font,740); sp=font.getlength(' ')
    line_widths=[sum(font.getlength(w) for _,w in line)+sp*(len(line)-1) for line in lines]
    if max(line_widths)>740:
        size=int(size*740/max(line_widths)); font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',size)
        lines=caption_lines(c,font,740); sp=font.getlength(' ')
        line_widths=[sum(font.getlength(w) for _,w in line)+sp*(len(line)-1) for line in lines]
    ascent,descent=font.getmetrics(); line_h=ascent+descent+7; pad_x,pad_y=20,12
    card_w=max(line_widths)+2*pad_x; card_h=len(lines)*line_h+2*pad_y
    x0=CX-card_w/2; x1=CX+card_w/2
    # Place the caption in the first clear vertical slot, preferring top-centre.
    chosen=None
    for y in range(300,1440-int(card_h)+1,12):
        box=(x0,y,x1,y+card_h)
        if all(not overlap(box,(r[0]-12,r[1]-12,r[2]+12,r[3]+12)) for r in cards+focus_rects):
            chosen=box; break
    valid=chosen is not None
    if chosen is None:
        # This branch is also counted as a layout failure in the frame audit.
        chosen=(x0,300,x1,300+card_h)
    x0,y0,x1,y1=chosen
    ov=Image.new('RGBA',cv.size,(0,0,0,0)); d=ImageDraw.Draw(ov)
    d.rounded_rectangle(chosen,radius=22,fill=(7,12,22,238),outline=(126,161,214,230),width=2)
    y=y0+pad_y
    for li,line in enumerate(lines):
        width=line_widths[li]; x=CX-width/2
        for idx,word in line:
            on=t>=c['ws'][idx]; ww=font.getlength(word)
            if idx in c['keys']:
                d.rounded_rectangle((x-8,y-2,x+ww+8,y+ascent+3),radius=9,fill=(37,99,235,255),outline=(195,218,255,255),width=1)
            color=(255,255,255,255) if on else (174,187,205,255)
            d.text((x,y),word,font=font,fill=color,stroke_width=2,stroke_fill=(2,5,12,255))
            x+=ww+sp
        y+=line_h
    cv.alpha_composite(ov)
    return tuple(map(float,chosen)),valid

def transform_rect(H,box):
    pts=[]
    for u,v in ((box[0],box[1]),(box[2],box[1]),(box[2],box[3]),(box[0],box[3])):
        p=H@np.array([u,v,1.0]); pts.append((float(p[0]/p[2]),float(p[1]/p[2])))
    return (min(x for x,y in pts),min(y for x,y in pts),max(x for x,y in pts),max(y for x,y in pts))

def frame(n,measure=False):
    t=n/FPS; cv=bg(t); cards=[]; card_scenes=[]; focus_rects=[]; focus_records=[]; centers=[]
    for s,e,key,cx,cy,base_scale in SC:
        if not (s-0.01<=t<e+0.3): continue
        lt=max(0,t-s); progress=lt/max(0.001,e-s); out=eio((t-e)/0.3) if t>e else 0
        asset=AS[key]; img,BX=asset['vp'].render(t); sh=asset['shadow']; amount=0; selected=[]
        cues=FOCUS.get(key,[])
        for j,(ft,bname) in enumerate(cues):
            nx=cues[j+1][0] if j+1<len(cues) else e+0.45
            hold=max(0.10,min(0.85,nx-ft-0.42))
            amt=bump(t,ft-0.08,0.42,hold,0.32)
            if amt<=0 or bname not in BX: continue
            label=LABELS[bname]; img=spotlight(img,BX[bname],amt,label); amount=max(amount,amt); selected.append((bname,amt,label,ft))
        k=spring(lt,11,0.55); yaw=2*math.sin(lt*0.8+s*0.7); pitch=1.2*math.sin(lt*0.7+s)
        # Exiting cards drift down so the upper safe-zone caption lane stays clear.
        x=cx; y=cy+(1-k)*145-18*progress+out*220; z=(1-k)*420-55*progress+out*260
        scale=base_scale*(1+0.025*progress)*(1+0.035*amount)
        q0=project(x,y,img.width,img.height,math.radians(yaw),math.radians(pitch),z,scale)
        x-=(min(p[0] for p in q0)+max(p[0] for p in q0))/2-x
        q=project(x,y,img.width,img.height,math.radians(yaw),math.radians(pitch),z,scale)
        place(cv,img,sh,x,y,math.radians(yaw),math.radians(pitch),z,scale,min(1,eio(lt/0.24))*(1-out))
        Hm=np.array([[1,0,0],[0,1,0],[0,0,1]],dtype=float)
        coeff=H.coeffs([(0,0),(img.width,0),(img.width,img.height),(0,img.height)],q)
        Hm=np.array([[coeff[0],coeff[1],coeff[2]],[coeff[3],coeff[4],coeff[5]],[coeff[6],coeff[7],1]],dtype=float)
        cardrect=transform_rect(Hm,(PAD,PAD,PAD+asset['vp'].W,PAD+asset['vp'].H))
        cards.append(cardrect); card_scenes.append(key); centers.append((min(p[0] for p in q)+max(p[0] for p in q))/2)
        for bname,amt,label,ft in selected:
            box=BX[bname]; screen=transform_rect(Hm,box); focus_rects.append(screen)
            # Match the helper's label chip geometry so caption collisions include the chip.
            f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20)
            cw=int(f.getlength(label)+20); ch=32; tx=max(6,min(img.width-cw-6,int(box[0]))); ty=int(box[1])-ch-7
            if ty<6: ty=min(img.height-ch-6,int(box[3])+7)
            focus_rects.append(transform_rect(Hm,(tx,ty,tx+cw,ty+ch)))
            focus_records.append({'scene':key,'item':bname,'label':label,'cue':ft,'source_box':box,'screen_box':screen,'amount':amt})
    capbox,capok=caption(cv,t,cards,focus_rects)
    meta={'t':t,'caption':capbox,'caption_ok':capok,'cards':cards,'card_scenes':card_scenes,
          'focus_rects':focus_rects,'focuses':focus_records,'centers':centers}
    raw=np.array(cv.convert('RGB')).tobytes()
    return (raw,meta) if measure else raw

def render_task(n): return frame(n,True)

def encode(out):
    ff=subprocess.Popen(['ffmpeg','-y','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{OW}x{OH}','-r',str(FPS),'-i','-',
                         '-c:v','libx264','-preset','slow','-crf','20','-maxrate','14M','-bufsize','28M','-pix_fmt','yuv420p',out],stdin=subprocess.PIPE)
    audit={'frames':0,'caption_frames':0,'caption_ui_overlaps':0,'caption_focus_overlaps':0,'safe_zone_failures':0,
           'caption_placement_failures':0,'caption_center_max_error':0.0,'scene_center_max_error':0.0,'focus_frames':{}}
    with Pool(6) as pool:
        for i,(raw,m) in enumerate(pool.imap(render_task,range(round(DUR*FPS)),chunksize=3)):
            ff.stdin.write(raw); audit['frames']+=1
            if m['caption']:
                audit['caption_frames']+=1; b=m['caption']
                if not m['caption_ok']: audit['caption_placement_failures']+=1
                audit['caption_center_max_error']=max(audit['caption_center_max_error'],abs((b[0]+b[2])/2-CX))
                if b[0]<150 or b[2]>930 or b[1]<290 or b[3]>1440: audit['safe_zone_failures']+=1
                if any(overlap(b,r) for r in m['cards']): audit['caption_ui_overlaps']+=1
                if any(overlap(b,r) for r in m['focus_rects']): audit['caption_focus_overlaps']+=1
            if m['centers']:
                audit['scene_center_max_error']=max(audit['scene_center_max_error'],max(abs(v-CX) for v in m['centers']))
            for f in m['focuses']:
                ident=f"{f['scene']}:{f['item']}@{f['cue']:.2f}"
                rec=audit['focus_frames'].setdefault(ident,{'label':f['label'],'frames':0,'max_center_error':0.0,'last_box':None})
                rec['frames']+=1; rec['last_box']=f['screen_box']
                e=abs((f['screen_box'][0]+f['screen_box'][2])/2-CX); rec['max_center_error']=max(rec['max_center_error'],e)
            if i%150==0: print(f'{i}/{round(DUR*FPS)}',flush=True)
    ff.stdin.close(); rc=ff.wait()
    if rc: raise RuntimeError(f'ffmpeg video encode failed: {rc}')
    return audit

if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='--sample':
        for ts in map(float,sys.argv[2:]):
            raw,meta=frame(round(ts*FPS),True)
            Image.frombytes('RGB',(OW,OH),raw).save(f'/tmp/v7-sample-{ts:.2f}.png')
            Path(f'/tmp/v7-sample-{ts:.2f}.json').write_text(json.dumps(meta,indent=2))
    else:
        dest=Path(sys.argv[1]); result=encode(str(dest))
        Path(str(dest)+'.audit.json').write_text(json.dumps(result,indent=2))
        print(json.dumps({k:v for k,v in result.items() if k!='focus_frames'},indent=2))
