import render5 as R, numpy as np, subprocess, json
from PIL import Image, ImageDraw
V='/workspace/varve/content/media/short-email-styled-test-v5.mp4'
raw=subprocess.run(['ffmpeg','-v','error','-i',V,'-vf','fps=2','-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True).stdout
F=np.frombuffer(raw,np.uint8).reshape(-1,1920,1080,3)
U=np.zeros((1920,1080),bool); UT=np.zeros((1920,1080),bool); rows=[]; acc=np.zeros((1920,1080,3),float)
for i,f in enumerate(F):
    t=i/2; bgi=np.array(R.bg(t).convert('RGB')).astype(int)
    from scipy import ndimage; m=ndimage.binary_opening(np.abs(f.astype(int)-bgi).sum(2)>90,iterations=2)
    cap=m.copy(); cap[560:]=False; con=m.copy(); con[:560]=False
    U|=con; UT|=cap; acc=np.maximum(acc,f)
    r=dict(t=t)
    for nm,mm in (('content',con),('caption',cap)):
        ys,xs=np.nonzero(mm)
        if len(xs)>200:
            x0,x1=np.percentile(xs,0.2),np.percentile(xs,99.8); y0,y1=np.percentile(ys,0.2),np.percentile(ys,99.8)
            r[nm]=dict(cx=round((x0+x1)/2,1),x=[int(x0),int(x1)],y=[int(y0),int(y1)])
    rows.append(r)
json.dump(rows,open('/tmp/centring.json','w'),indent=0)
cc=[r['content']['cx']-540 for r in rows if 'content' in r]; ct=[r['caption']['cx']-540 for r in rows if 'caption' in r]
print('content centre offset px: mean %.1f, max abs %.1f, n=%d'%(np.mean(cc),np.max(np.abs(cc)),len(cc)))
print('caption centre offset px: mean %.1f, max abs %.1f, n=%d'%(np.mean(ct),np.max(np.abs(ct)),len(ct)))
for nm in ('content','caption'):
    xs=[r[nm]['x'][1] for r in rows if nm in r]; y0=[r[nm]['y'][0] for r in rows if nm in r]; y1=[r[nm]['y'][1] for r in rows if nm in r]
    print(nm,'max right x',max(xs),'min top y',min(y0),'max bottom y',max(y1))
    worst=sorted([(r[nm]['x'][1],r['t']) for r in rows if nm in r])[-4:]; print('  worst right edges (x,t):',worst)
im=Image.fromarray((acc*0.75).astype(np.uint8)).convert('RGBA'); ov=Image.new('RGBA',im.size,(0,0,0,0)); d=ImageDraw.Draw(ov)
d.rectangle((0,0,1080,290),fill=(255,0,0,70)); d.rectangle((0,1440,1080,1920),fill=(255,0,0,70)); d.rectangle((930,290,1080,1440),fill=(255,140,0,70))
for y,c in ((290,(255,60,60)),(1440,(255,60,60))): d.line((0,y,1080,y),fill=c+(255,),width=4)
d.line((930,0,930,1920),fill=(255,160,0,255),width=4); d.line((540,0,540,1920),fill=(0,255,120,200),width=2)
for M,col in ((U,(0,200,255,255)),(UT,(255,255,0,255))):
    ys,xs=np.nonzero(M); d.rectangle((np.percentile(xs,.05),np.percentile(ys,.05),np.percentile(xs,99.95),np.percentile(ys,99.95)),outline=col,width=4)
d.text((20,300),'text/content safe zone y 290-1440, x<=930 (orange = right 150px UI)',fill='white'); d.text((20,1450),'cyan=union of all card content, yellow=union of captions, green=centre x=540 (2 fps max-composite of all frames)',fill='white')
Image.alpha_composite(im,ov).convert('RGB').save('/workspace/varve/content/media/short-email-styled-test-v5-safezone.png')
