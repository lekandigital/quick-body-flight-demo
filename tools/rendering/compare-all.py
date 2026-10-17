"""A factual eight-scene sheet from screenshots, never generated scene imagery."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw, ImageFont

parser=argparse.ArgumentParser()
parser.add_argument('--preview',default='overview-preview')
parser.add_argument('--originals',default='overview-originals')
parser.add_argument('--png')
args=parser.parse_args()
root=Path('docs/rendering');refs=root/'references';caps=root/'captures';out=root/'comparisons';out.mkdir(exist_ok=True)
scenes=[
 ('galaxy','Inside Galaxy','refimages-refs.png',(1284,1640,1917,1990),'Verified 16-bit original restores texture precision/detail; reference framing varies.'),
 ('nebula','Alien Space Nebula 2','sf1-pairs.png',(590,9,1205,353),'Original is absent from the ZIP. Both local columns use the existing GLB.'),
 ('earth','EARTH - Stephane Agullo','sfembed-api-pair.png',(728,0,1448,450),'Full-globe framing and 16K day/night maps; atmosphere, lighting and effects remain incomplete.'),
 ('orbit','Earth - AirStudios','sketchfab-thumbs-originals.png',(1500,18,2000,281),'Original 8K maps load. Illumination orientation and sun glare remain unresolved.'),
 ('hangar','Sci-Fi Hanger','sfembed-api-hangar.png',None,'Native material handling and floor/local reflections; source bump, DOF and exposure need calibration.'),
 ('corridor','Spaceship Corridor','sfembed-api-pair2.png',(728,0,1448,450),'Original 4K maps preserved. Cyan lighting, contrast and reflections remain unresolved.'),
 ('gallery','VR exhibition gallery baked','sf1-pairs.png',(590,1110,1208,1458),'Original 3K baked wall maps retained. Ceiling and floor still differ from the reference.'),
 ('space','Need some space?','sf1-pairs.png',(590,744,1205,1088),'Correct point-size units and authored bloom restore haze; bright-star variation remains incomplete.'),
]
W=1920;CELL=640;PICTURE=400;ROW=474;TOP=156;BOTTOM=74
image=Image.new('RGB',(W,TOP+ROW*len(scenes)+BOTTOM),'#0e131c');draw=ImageDraw.Draw(image)
def font(size):
    for path in ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','/System/Library/Fonts/Supplemental/Arial.ttf']:
        try:return ImageFont.truetype(path,size)
        except OSError:pass
    return ImageFont.load_default()
large=font(31);medium=font(22);small=font(18)
draw.text((20,16),'BodyArcade / Three.js - all eight backgrounds',font=large,fill='white')
draw.text((20,60),'Actual renders at Maximum, 1920 x 1200. Historical Sketchfab views are not camera-matched.',font=small,fill='#aebdd0')
draw.text((20,89),'The originals profile uses external source assets; those large files are not bundled into the deployed preview.',font=small,fill='#aebdd0')
for i,title in enumerate(['Original Sketchfab reference','Committed preview asset set','Local full-resolution originals']):
    draw.text((i*CELL+18,123),title,font=medium,fill='#7ed8ef')
records=[]
for row,(id,title,reference,box,note) in enumerate(scenes):
    y=TOP+row*ROW
    draw.rectangle((0,y,W,y+36),fill='#202c3c');draw.text((18,y+5),f'{row+1:02d}  {title}',font=medium,fill='white')
    ref=Image.open(refs/reference).convert('RGB')
    if box:ref=ref.crop(box)
    captures=[];metadata=[]
    for label in [args.preview,args.originals]:
        name=f'{label}-{id}-960x600'
        captures.append(Image.open(caps/f'{name}.png').convert('RGB'))
        metadata.append(json.loads((caps/f'{name}.json').read_text()))
    for column,picture in enumerate([ref,*captures]):
        fitted=ImageOps.contain(picture,(CELL-8,PICTURE-4),Image.Resampling.LANCZOS)
        image.paste(fitted,(column*CELL+(CELL-fitted.width)//2,y+36+(PICTURE-fitted.height)//2))
    draw.text((18,y+441),note,font=small,fill='#b6c5d8')
    records.append({'id':id,'reference':{'file':reference,'crop':box,'historical':True},
        'preview':{'label':args.preview,'camera':metadata[0]['camera'],'resolution':metadata[0]['renderResolution'],'configuration':metadata[0]['configuration']},
        'originals':{'label':args.originals,'camera':metadata[1]['camera'],'resolution':metadata[1]['renderResolution'],'configuration':metadata[1]['configuration']},
        'gpu':metadata[1]['gpu'],'shaderErrors':[metadata[0]['shaderErrors'],metadata[1]['shaderErrors']],'status':note})
y=TOP+ROW*len(scenes)
draw.text((18,y+12),'Software GPU: SwiftShader. No visual-parity or desktop-FPS claim. macOS Chrome/Safari verification remains necessary.',font=small,fill='#aebdd0')
draw.text((18,y+39),'Artist names and CC BY 4.0 source links: ASSETS.md and the application credit badge. Reference provenance is recorded separately.',font=small,fill='#aebdd0')
image.save(out/'all-eight-sketchfab-comparison.jpg',quality=95,subsampling=0)
if args.png:
    path=Path(args.png);path.parent.mkdir(parents=True,exist_ok=True);image.save(path)
(out/'all-eight-sketchfab-comparison.json').write_text(json.dumps({'matchedSketchfabReferences':False,'scenes':records},indent=2)+'\n')
print('Saved',out/'all-eight-sketchfab-comparison.jpg')
if args.png:print('Saved',args.png)
