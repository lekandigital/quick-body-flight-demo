"""Compare controlled local captures; historical Sketchfab is context, not a pixel target."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import numpy as np

parser=argparse.ArgumentParser()
parser.add_argument('--before',default='probe-before')
parser.add_argument('--after',default='probe-final')
args=parser.parse_args()
root=Path('docs/rendering')
names=[f'{label}-hangar-960x600' for label in (args.before,args.after)]
metadata=[json.loads((root/'captures'/f'{name}.json').read_text()) for name in names]
for key in ('camera','viewport','renderResolution','animationTime'):
    if metadata[0].get(key)!=metadata[1].get(key):
        raise ValueError(f'Local comparison must match {key}')
before,after=[Image.open(root/'captures'/f'{name}.png').convert('RGB') for name in names]
reference=Image.open(root/'references/sfembed-api-hangar.png').convert('RGB')
a,b=[np.asarray(image,dtype=np.float32) for image in (before,after)]
d=np.abs(a-b)
heat=np.clip(d*3,0,255).astype(np.uint8)
canvas=Image.new('RGB',(1440,1004),'#10141b')
draw=ImageDraw.Draw(canvas)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)
small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',15)
panels=[(reference,'Sketchfab historical reference (different composition)'),
        (before,'Previous Three.js renderer - matching local camera'),
        (after,'Three.js local reflection probe'),
        (Image.fromarray(heat),'Absolute local change x3 - not a Sketchfab error score')]
for i,(image,title) in enumerate(panels):
    x=(i%2)*720;y=(i//2)*482
    draw.text((x+12,y+12),title,font=font,fill='white')
    canvas.paste(image.resize((720,450),Image.Resampling.LANCZOS),(x,y+32))
device='Software GPU: SwiftShader.' if 'SwiftShader' in metadata[1]['gpu'] else 'Hardware GPU capture.'
draw.text((12,974),device+' Probe approximates room geometry; reference framing differs.',font=small,fill='#b8c5da')
out=root/'comparisons/hangar-local-probe.jpg';canvas.save(out,quality=93)
metrics={'before':names[0],'after':names[1],'localMeanAbsoluteChange255':float(d.mean()),
         'localP99AbsoluteChange255':float(np.percentile(d,99)),
         'matchingLocalCamera':True,'matchedSketchfabReference':False,
         'renderResolution':metadata[1]['renderResolution'],
         'effectiveProbes':[m['localReflectionProbe'] for m in metadata[1]['materials'] if m.get('localReflectionProbe')],
         'gpu':metadata[1]['gpu'],'configuration':metadata[1]['configuration'],
         'loadAndFirstFrameMs':metadata[1].get('loadAndFirstFrameMs'),
         'frameMs':metadata[1]['frameMs'],'backgroundRedrawn':metadata[1].get('backgroundRedrawn')}
(root/'comparisons/hangar-local-probe.json').write_text(json.dumps(metrics,indent=2)+'\n')
print(out)

sky_paths=[root/'captures'/f'{args.after}-{id}-960x600.png' for id in ('galaxy','nebula')]
if all(path.exists() for path in sky_paths):
    sky=Image.new('RGB',(1440,510),'#10141b');sky_draw=ImageDraw.Draw(sky)
    labels=['Galaxy - verified original 16-bit texture','Nebula - existing GLB; original absent from ZIP']
    for i,(path,label) in enumerate(zip(sky_paths,labels)):
        sky.paste(Image.open(path).convert('RGB').resize((720,450),Image.Resampling.LANCZOS),(i*720,32))
        sky_draw.text((i*720+12,8),label,font=font,fill='white')
    sky_draw.text((12,486),'Three.js Maximum / 2x captures / '+device,font=font,fill='#b8c5da')
    sky.save(root/'comparisons/skyboxes-current.jpg',quality=93)
