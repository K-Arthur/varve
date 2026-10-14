import render5 as R, json, numpy as np, subprocess, os
from PIL import Image, ImageDraw
OUT='/workspace/varve/content/media/short-email-styled-test-v5-stills'; os.makedirs(OUT,exist_ok=True)
V='/workspace/varve/content/media/short-email-styled-test-v5.mp4'
rep=[]
for (s,key),lst in R.FOC.items():
    for ft,b in lst:
        t=round((ft+0.3)*30)/30; n=int(round(t*30))
        R.LOG.clear(); R.frame(n,True)
        ent=[a for L in R.LOG if L['key']==key for a in L['active'] if a['box']==b][0]
        q=np.array(ent['screen']); ex=(q[:,0].min(),q[:,1].min(),q[:,0].max(),q[:,1].max())
        # frame from the actual output mp4
        raw=subprocess.run(['ffmpeg','-v','error','-i',V,'-vf',f'select=eq(n\\,{n})','-vframes','1','-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True).stdout
        im=Image.frombytes('RGB',(1080,1920),raw); a=np.array(im).astype(int)
        R.NOGLOW[0]=True; ng=np.frombuffer(R.frame(n),np.uint8).reshape(1920,1080,3).astype(int); R.NOGLOW[0]=False
        diff=np.abs(a-ng).sum(2); m=(diff>60)&(a[...,2]>a[...,0]+40); m[:560]=False  # pixels changed by the highlight (glow on vs off), blue-shifted, below caption band
        from scipy import ndimage
        lab,nl=ndimage.label(ndimage.binary_closing(m,iterations=3)); sz=ndimage.sum(m,lab,range(1,nl+1)); m=m&(lab==(1+int(np.argmax(sz))))
        ys,xs=np.nonzero(m)
        det=(xs.min(),ys.min(),xs.max(),ys.max())
        core=(det[0]+18,det[1]+18,det[2]-18,det[3]-18)  # strip the outer glow rings (~18px at this scale)
        # glow ring = box edge stroke (9px) -> compare detected stroke bbox to expected box grown by stroke
        def iou(A,B):
            ix=max(0,min(A[2],B[2])-max(A[0],B[0]));iy=max(0,min(A[3],B[3])-max(A[1],B[1]));I=ix*iy
            return I/((A[2]-A[0])*(A[3]-A[1])+(B[2]-B[0])*(B[3]-B[1])-I)
        # inside test: fraction of strong-blue pixels lying within expected box +/-12px
        inside=((xs>=ex[0]-28)&(xs<=ex[2]+28)&(ys>=ex[1]-28)&(ys<=ex[3]+28)).mean()
        d=ImageDraw.Draw(im); d.polygon([tuple(p) for p in q],outline=(255,0,0),width=2)
        fn=f'{OUT}/hl_{t:05.2f}_{key}_{b}.png'; im.save(fn)
        rep.append(dict(t=round(t,2),scene=key,element=b,src_box_in_card=[round(v) for v in ent['src']],expected_screen=[round(v) for v in ex],
            detected_glow=[round(v) for v in det],iou=round(iou(ex,core),3),centre_offset_px=[round((ex[0]+ex[2]-det[0]-det[2])/2,1),round((ex[1]+ex[3]-det[1]-det[3])/2,1)],glow_px_inside=round(float(inside),3),amt=round(ent['amt'],2),still=os.path.basename(fn)))
        print(rep[-1],flush=True)
json.dump(rep,open(OUT+'/highlight-report.json','w'),indent=1)
