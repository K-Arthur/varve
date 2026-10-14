import json, math, sys, subprocess, numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from multiprocessing import Pool
OW,OH,FPS,DUR=1080,1920,30,35.0
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
MONO='/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'
def font(sz,w=700):
    f=ImageFont.truetype(FONT,sz)
    try: f.set_variation_by_axes([min(max(sz,14),32),w])
    except Exception: pass
    return f
BLUE=(59,130,246); TEAL=(57,208,198)
# ---------- helpers
def rr_mask(w,h,r):
    m=Image.new('L',(w,h),0);ImageDraw.Draw(m).rounded_rectangle((0,0,w-1,h-1),r,fill=255);return m
def card_from(im,r=26,border=(255,255,255,40)):
    im=im.convert('RGBA'); w,h=im.size
    a=np.array(im.getchannel('A'))*(np.array(rr_mask(w,h,r))/255.); im.putalpha(Image.fromarray(a.astype(np.uint8)))
    ImageDraw.Draw(im).rounded_rectangle((0,0,w-1,h-1),r,outline=border,width=3); return im
def shot(path,box=None,width=None,scale=None,r=26,paste=None):
    im=Image.open(path).convert('RGB')
    if paste: paste(im)
    if box: im=im.crop(box)
    s=width/im.width if width else scale
    im=im.resize((int(im.width*s),int(im.height*s)),Image.LANCZOS)
    return card_from(im,r),s
def glass(w,h,r=36,fill=(255,255,255,30),border=(255,255,255,80)):
    im=Image.new('RGBA',(w,h),(0,0,0,0)); d=ImageDraw.Draw(im)
    d.rounded_rectangle((0,0,w-1,h-1),r,fill=fill,outline=border,width=3)
    g=np.zeros((h,w),np.float32); g[:h//2]=np.linspace(26,0,h//2)[:,None]
    sheen=Image.new('RGBA',(w,h),(255,255,255,0)); sheen.putalpha(Image.fromarray((g*np.array(rr_mask(w,h,r))/255).astype(np.uint8)))
    return Image.alpha_composite(im,sheen)
def check_icon(d,x,cy,s,col=(34,197,94)):
    d.ellipse((x,cy-s//2,x+s,cy+s//2),fill=col); d.line((x+s*.25,cy,x+s*.45,cy+s*.2,x+s*.75,cy-s*.2),fill='white',width=max(4,s//9),joint='curve')
def chip(text,sz=64,color=(255,255,255),pad=(44,26),fill=(255,255,255,30),icon=None):
    f=font(sz,750); b=f.getbbox(text); w0,th=b[2]-b[0],b[3]-b[1]
    w=w0+2*pad[0]+(sz+16 if icon else 0); h=th+2*pad[1]
    im=glass(w,h,min(h//2,44),fill=fill); d=ImageDraw.Draw(im); x=pad[0]
    if icon: icon(d,x,h//2,sz); x+=sz+16
    d.text((x-b[0],pad[1]-b[1]),text,font=f,fill=color); return im
def sub_btn(done,w=760,h=170):
    im=Image.new('RGBA',(w,h),(0,0,0,0)); d=ImageDraw.Draw(im)
    d.rounded_rectangle((0,0,w-1,h-1),h//2,fill=(60,64,72,255) if done else (230,33,23,255))
    f=font(74,800); t='SUBSCRIBED' if done else 'SUBSCRIBE'; b=f.getbbox(t); tw_=b[2]-b[0]; x=(w-(tw_+92))//2+92 if done else (w-tw_)//2
    d.text((x-b[0],(h-(b[3]-b[1]))//2-b[1]),t,font=f,fill='white')
    if done: bx=x-92; d.chord((bx,45,bx+62,112),180,360,fill='white'); d.rectangle((bx,78,bx+62,108),fill='white'); d.ellipse((bx+22,108,bx+40,126),fill='white')
    return im
def shadow(im):
    pad=90; s=Image.new('L',(im.width+2*pad,im.height+2*pad),0); s.paste(im.getchannel('A'),(pad,pad))
    s=s.filter(ImageFilter.GaussianBlur(38)); sh=Image.new('RGBA',s.size,(0,0,0,0)); sh.putalpha(s.point(lambda v:int(v*0.8))); return sh,pad
# ---------- easing
def spring(t,w=13.0,z=0.52):
    if t<=0: return 0.0
    wd=w*math.sqrt(1-z*z); return 1-math.exp(-z*w*t)*(math.cos(wd*t)+z*w/wd*math.sin(wd*t))
def eio(x): x=min(max(x,0),1); return 4*x**3 if x<.5 else 1-(-2*x+2)**3/2
def bump(t,t0,up=0.25,hold=0.9,down=0.4):  # smooth 0..1..0 envelope around a narrated moment
    if t<t0: return 0
    if t<t0+up: return eio((t-t0)/up)
    if t<t0+up+hold: return 1
    return 1-eio((t-t0-up-hold)/down)
# ---------- 3D
def coeffs(dst,src):
    M=[];B=[]
    for (x,y),(u,v) in zip(dst,src): M+=[[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]]; B+=[u,v]
    return np.linalg.solve(np.array(M,float),np.array(B,float))
def project(cx,cy,w,h,yaw,pitch,z,scale,f=2000):
    pts=[]; cyw,syw,cp,sp=math.cos(yaw),math.sin(yaw),math.cos(pitch),math.sin(pitch)
    for X,Y in [(-w/2,-h/2),(w/2,-h/2),(w/2,h/2),(-w/2,h/2)]:
        X*=scale;Y*=scale; x1=X*cyw; z1=X*syw; y2=Y*cp-z1*sp; z2=Y*sp+z1*cp+z; k=f/(f+z2); pts.append((cx+x1*k,cy+y2*k))
    return pts
def warp(img,q):
    xs=[p[0] for p in q]; ys=[p[1] for p in q]; x0,y0,x1,y1=int(min(xs))-2,int(min(ys))-2,int(max(xs))+2,int(max(ys))+2
    w,h=img.size; c=coeffs([(x-x0,y-y0) for x,y in q],[(0,0),(w,0),(w,h),(0,h)])
    return img.transform((x1-x0,y1-y0),Image.PERSPECTIVE,tuple(c),Image.BICUBIC),x0,y0
def comp(cv,t,x,y):
    l,tp=max(0,-x),max(0,-y); r,b=min(t.width,OW-x),min(t.height,OH-y)
    if r<=l or b<=tp: return
    cv.alpha_composite(t.crop((l,tp,r,b)),(max(0,x),max(0,y)))
def place(cv,img,shp,cx,cy,yaw,pitch,z,scale,op,blur=False):
    if op<=0.01: return
    sh,pad=shp; w,h=img.size
    q=project(cx+14,cy+46,sh.width,sh.height,yaw,pitch,z,scale); t,x0,y0=warp(sh,q)
    if op<1: t.putalpha(t.getchannel('A').point(lambda v:int(v*op)))
    comp(cv,t,x0,y0)
    q=project(cx,cy,w,h,yaw,pitch,z,scale); t,x0,y0=warp(img,q)
    if blur:  # real Gaussian blur of whatever is behind the glass card
        bx0,by0,bx1,by1=max(0,x0),max(0,y0),min(OW,x0+t.width),min(OH,y0+t.height)
        if bx1>bx0 and by1>by0:
            back=cv.crop((bx0,by0,bx1,by1)).filter(ImageFilter.GaussianBlur(22))
            m=t.getchannel('A').crop((bx0-x0,by0-y0,bx1-x0,by1-y0)).point(lambda v:255 if v>8 else 0)
            if op<1: m=m.point(lambda v:int(v*op))
            cv.paste(back,(bx0,by0),m)
    if op<1: t.putalpha(t.getchannel('A').point(lambda v:int(v*op)))
    comp(cv,t,x0,y0)
def spotlight(img,box,amt=1.0,label=''):
    if amt<=0.01: return img
    img=img.convert('RGBA'); x0,y0,x1,y1=map(int,box); w,h=img.size
    # Dim the screenshot outside the exact measured target, preserving its pixels inside.
    shade=Image.new('RGBA',(w,h),(5,8,16,int(132*amt)))
    mask=Image.new('L',(w,h),0); ImageDraw.Draw(mask).rounded_rectangle((x0,y0,x1,y1),radius=8,fill=int(255*amt))
    shade.putalpha(Image.eval(mask,lambda v: int(132*amt*(255-v)/255)))
    out=Image.alpha_composite(img,shade); d=ImageDraw.Draw(out)
    # Thin selection outline sits directly on the bbox; no blur or glow.
    d.rounded_rectangle((x0,y0,x1,y1),radius=8,outline=(73,153,255,int(255*amt)),width=4)
    if label:
        f=ImageFont.truetype(FONT,20); tw=f.getlength(label); th=25; pad=10
        cw=int(tw+2*pad); ch=th+8
        tx=max(6,min(w-cw-6,x0)); ty=y0-ch-7
        if ty<6: ty=min(h-ch-6,y1+7)
        alpha=int(245*amt)
        d.rounded_rectangle((tx,ty,tx+cw,ty+ch),radius=9,fill=(16,35,62,alpha),outline=(73,153,255,alpha),width=2)
        d.text((tx+pad,ty+4),label,font=f,fill=(240,247,255,alpha))
    return out

def glow(img,box,amt,col=BLUE,r=18):
    if amt<=0.01: return img
    img=img.copy(); x0,y0,x1,y1=box; ov=Image.new('RGBA',img.size,(0,0,0,0)); d=ImageDraw.Draw(ov)
    for i,a in [(26,40),(18,80),(11,140),(5,210)]:
        d.rounded_rectangle((x0-i,y0-i,x1+i,y1+i),r+i,outline=col+(int(a*amt),),width=9)
    d.rounded_rectangle((x0,y0,x1,y1),r,outline=col+(int(255*amt),),width=9,fill=col+(int(40*amt),))
    return Image.alpha_composite(img,ov)
# ---------- background
def mkbg():
    y,x=np.mgrid[0:OH,0:OW].astype(np.float32)
    base=np.zeros((OH,OW,3),np.float32)+np.array([7,8,11],np.float32)
    g1=np.exp(-(((x-300)/700)**2+((y-700)/800)**2))[...,None]*np.array([12,22,52])
    g2=np.exp(-(((x-850)/600)**2+((y-1500)/700)**2))[...,None]*np.array([6,26,30])
    return base+g1+g2
BGF=None; NOISE=None
def bg(t):
    global BGF,NOISE
    if BGF is None:
        BGF=mkbg(); r=np.random.default_rng(3); NOISE=[r.normal(0,7,(OH,OW,1)).astype(np.float32) for _ in range(4)]
    return Image.fromarray(np.clip(BGF+NOISE[int(t*12)%4],0,255).astype(np.uint8)).convert('RGBA')
def cursor(cv,t,path):  # path: list of (time,x,y); click ring at times flagged
    pts=[p for p in path]
    if t<pts[0][0] or t>pts[-1][0]+0.6: return
    for (t0,x0,y0,_),(t1,x1,y1,c) in zip(pts,pts[1:]):
        if t<=t1: e=eio((t-t0)/(t1-t0)); x=x0+(x1-x0)*e; y=y0+(y1-y0)*e; break
    else: x,y=pts[-1][1],pts[-1][2]
    op=1-max(0,(t-pts[-1][0]-0.3)/0.3)
    ov=Image.new('RGBA',cv.size,(0,0,0,0)); d=ImageDraw.Draw(ov)
    for tc,_,_,c in pts:
        if c and 0<=t-tc<0.45:
            r=int(26+110*eio((t-tc)/0.45)); d.ellipse((x-r,y-r,x+r,y+r),outline=(255,255,255,int(220*(1-(t-tc)/0.45))),width=6)
    s=0.85 if any(c and 0<=t-tc<0.12 for tc,_,_,c in pts) else 1.0
    P_=[(0,0),(0,52),(13,40),(23,62),(32,58),(22,37),(40,37)]; P_=[(x+a*s*1.5,y+b*s*1.5) for a,b in P_]
    d.polygon(P_,fill=(255,255,255,int(255*op)),outline=(0,0,0,int(255*op)),width=3); cv.alpha_composite(ov)
