"""Reproducible silent portrait edit. Requires Pillow and FFmpeg."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import subprocess

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
OUT = HERE / 'out'
OUT.mkdir(exist_ok=True)
W, H, FPS = 1080, 1920, 30
# Delivery graphics tokens, independent of app UI styling.
LIGHT, DARK, BLUE = '#F4F1E9', '#101820', '#1683FF'
INK, WHITE, MUTED = '#122330', '#FFFFFF', '#A7B8C5'
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
REG = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'

def font(size, regular=False):
    return ImageFont.truetype(REG if regular else FONT, size)

def load(path):
    return Image.open(ROOT / path).convert('RGB')

comic = load('marketing/sample-comic/halloween-cookies.png')
speech = load('docs/screenshots/comic-lettering/01-speech-balloon-canvas.png')
fit = load('docs/screenshots/comic-lettering/02-localization-recovered.png')
controls = load('docs/screenshots/comic-lettering/05-dark-inspector.png')

# Six deliberate cuts. Caption bounds always x=76..900, y=290..1440.
SCENES = [
    (0, 3, LIGHT, 'COMIC LETTERING / VARVE', ['GIVE YOUR', 'COMIC A VOICE.']),
    (3, 9, DARK, '01 / EDITABLE DIALOGUE', ['THE WORDS', 'STAY EDITABLE.']),
    (9, 15, LIGHT, '02 / ROOM FOR THE LINE', ['LONGER LINE?', 'FIT THE BALLOON.']),
    (15, 22, DARK, '03 / BALLOON CONTROLS', ['KEEP THE TEXT.', 'SHAPE THE BALLOON.']),
    (22, 29, LIGHT, '04 / ON THE PAGE', ['FROM DIALOGUE', 'TO FINISHED PAGE.']),
    (29, 32, DARK, 'YOUR NEXT PANEL', ['WHAT WOULD', 'YOUR COMIC SAY?']),
]

def txt(d, xy, text, size, color, regular=False):
    f = font(size)
    box = d.textbbox(xy, text, font=f)
    assert box[0] >= 70 and box[2] <= 930 and box[1] >= 290 and box[3] <= 1440, (text, box)
    d.text(xy, text, font=f, fill=color)

def paste_ui(canvas, source, crop, box, selection=None):
    region = source.crop(crop)
    region = region.resize((box[2]-box[0], box[3]-box[1]), Image.Resampling.LANCZOS)
    canvas.paste(region, box[:2])
    d = ImageDraw.Draw(canvas)
    if selection:
        sx = (box[2]-box[0])/(crop[2]-crop[0]); sy = (box[3]-box[1])/(crop[3]-crop[1])
        rect = (round(box[0]+(selection[0]-crop[0])*sx), round(box[1]+(selection[1]-crop[1])*sy), round(box[0]+(selection[2]-crop[0])*sx), round(box[1]+(selection[3]-crop[1])*sy))
        d.rectangle(rect, outline=BLUE, width=3)

def frame(t):
    i = next(i for i,s in enumerate(SCENES) if s[0] <= t < s[1])
    start, end, bg, label, lines = SCENES[i]
    p = (t-start)/(end-start)
    im = Image.new('RGB', (W,H), bg); d = ImageDraw.Draw(im)
    fg = INK if bg == LIGHT else WHITE
    txt(d,(76,300),label,25,BLUE)
    size = 57 if i == 3 else 64
    for j,line in enumerate(lines): txt(d,(76,370+j*78),line,size,fg)
    if i == 0:
        # Start on the waking cookies, then gently reveal their panel.
        y = round(847-16*p)
        paste_ui(im,comic,(20,y,910,y+410),(76,650,1004,1078))
        d=ImageDraw.Draw(im)
        txt(d,(76,1180),'Speech. Thought. Shout.',38,INK)
        txt(d,(76,1242),'Lettered in Varve.',30,INK,True)
    elif i == 1:
        paste_ui(im,speech,(160,130,560,325),(76,650,1004,1102),(240,170,505,320))
        d=ImageDraw.Draw(im)
        txt(d,(76,1230),'Real text inside the balloon.',32,WHITE,True)
    elif i == 2:
        paste_ui(im,fit,(175,90,435,450),(270,625,790,1345),(220,149,388,426))
        d=ImageDraw.Draw(im)
        txt(d,(76,1392),'Give the words room to fit.',30,INK,True)
    elif i == 3:
        paste_ui(im,controls,(450,250,790,445),(76,620,1004,1152),(510,292,752,404))
        # Readable, genuine inspector detail, with a separate solid blue outline.
        paste_ui(im,controls,(1025,350,1276,485),(480,1180,920,1417),(1027,354,1273,478))
        d=ImageDraw.Draw(im)
        txt(d,(76,1210),'Speech balloon',27,WHITE)
        txt(d,(76,1260),'Position & size',25,MUTED,True)
        txt(d,(76,1305),'in the Inspector',25,MUTED,True)
    elif i == 4:
        # Complete authored page, no cropped dialogue or caption overlay.
        h=800;w=round(h*comic.width/comic.height)
        x=(W-w)//2
        paste_ui(im,comic,(0,0,comic.width,comic.height),(x,600,x+w,1400))
    else:
        d.line((76,630,235,630),fill=BLUE,width=8)
        txt(d,(76,750),'Follow for Varve drops',49,WHITE)
        txt(d,(76,850),'Comic lettering in Varve',30,MUTED,True)
    # Nonverbal progress marker lives below the reserved caption region.
    d=ImageDraw.Draw(im)
    d.rectangle((76,1520,1004,1523),fill='#CAD1D5' if bg==LIGHT else '#34424E')
    d.rectangle((76,1520,76+round(928*t/32),1523),fill=BLUE)
    return im

if __name__ == '__main__':
    for i,t in enumerate((1.5,6,12,18.5,25.5,30.5),1):
        frame(t).save(OUT/f'frame-{i:02}.png')
    cmd=['ffmpeg','-y','-hide_banner','-loglevel','error','-f','rawvideo','-pix_fmt','rgb24','-s','1080x1920','-r','30','-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(OUT/'comic-lettering-short-v1.mp4')]
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE)
    for n in range(32*FPS): proc.stdin.write(frame(n/FPS).tobytes())
    proc.stdin.close()
    if proc.wait(): raise SystemExit('FFmpeg failed')
