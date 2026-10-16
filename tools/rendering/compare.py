"""Make labeled evidence sheets. Original images are never modified in place.
Camera-matched capture changes and unmatched historical references are labeled
separately; a difference image alone is not a measure of Sketchfab fidelity.
"""
from pathlib import Path
import json
from PIL import Image, ImageOps, ImageDraw, ImageFont, ImageChops, ImageStat

root=Path('docs/rendering');cap=root/'captures';refs=root/'references';out=root/'comparisons';out.mkdir(exist_ok=True)
try: font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)
except OSError: font=ImageFont.load_default()
def panel(image,label,size=(640,450)):
    image=image.convert('RGB');image.thumbnail((size[0],size[1]-50))
    canvas=Image.new('RGB',size,'#0b0e14');canvas.paste(image,((size[0]-image.width)//2,35+(size[1]-50-image.height)//2))
    ImageDraw.Draw(canvas).text((12,8),label,font=font,fill='white');return canvas
def sheet(name,images):
    canvas=Image.new('RGB',(640*len(images),450))
    for index,(image,label) in enumerate(images):canvas.paste(panel(image,label),(640*index,0))
    canvas.save(out/name,quality=94,subsampling=0)
def load(label,id,size='960x600'):return Image.open(cap/f'{label}-{id}-{size}.png')

galaxy_old=load('optimized-max','galaxy','1920x1080');galaxy_new=load('original-galaxy','galaxy','1920x1080')
sheet('galaxy-sources.jpg',[(galaxy_old,'Optimized 2K WebP — same camera'),(galaxy_new,'Original 3840×2160 / 16-bit source')])
sheet('galaxy-details.jpg',[(galaxy_old.crop((150,40,750,500)),'Optimized — full-HD detail crop'),(galaxy_new.crop((150,40,750,500)),'Original — identical detail crop')])
sf_pair=Image.open(refs/'sf1-pairs.png')
sheet('space.jpg',[(load('baseline','space'),'Baseline: subpixel points'),(load('space-pixels','space'),'Correct pixel-size points + authored bloom'),(sf_pair.crop((590,744,1205,1088)),'Sketchfab reference — historical camera')])
earth=cap/'earth-16k-earth-960x600.png'
sheet('earth.jpg',[(load('baseline','earth'),'Baseline: clipped globe'),(Image.open(earth) if earth.exists() else load('original','earth'),'Full-globe framing / original textures'),(Image.open(refs/'sfembed-api-pair.png').crop((728,0,1448,450)),'Sketchfab — lighting/post still differ')])
sheet('hangar.jpg',[(load('baseline','hangar'),'Baseline: auxiliary transparent mirror'),(load('hangar-lowenv','hangar'),'Actual opaque floor / screen-space reflection'),(Image.open(refs/'sfembed-api-hangar.png'),'Sketchfab — HDR lighting still differs')])
sheet('corridor.jpg',[(load('baseline','corridor'),'Baseline: optimized 1K maps'),(load('original','corridor'),'Original 4K maps / preserved materials'),(Image.open(refs/'sfembed-api-pair2.png').crop((728,0,1448,450)),'Sketchfab — illumination still differs')])
metrics={}
for id in ['galaxy','nebula']:
    a=load('baseline',id).convert('RGB');b=load('foundation',id).convert('RGB')
    metrics[id]={'baselineFoundationMeanAbsoluteDifference':sum(ImageStat.Stat(ImageChops.difference(a,b)).mean)/3,
                 'meaning':'Same camera, same assets, same output size. This checks preservation, not parity with Sketchfab.'}
(out/'metrics.json').write_text(json.dumps(metrics,indent=2))
print('Comparison sheets:',out)
