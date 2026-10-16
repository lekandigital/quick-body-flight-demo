"""Lossless, guarded tiles for the original 16200px Earth maps on 8K GPUs.
Derived files stay beside the immutable originals, outside the repository.
"""
from pathlib import Path
import hashlib
import json
import sys
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
root=Path(sys.argv[1])/'3dbackgrounds/earth'
out=root/'tiles';out.mkdir(parents=True,exist_ok=True)
records=[]
for name,source in [('day','textures/2_no_clouds_16k.jpeg'),('night','textures/NIGHT.jpg')]:
    path=root/source
    with Image.open(path) as image:
        assert image.width==16200 and image.height==8100
        image=image.convert('RGB')
        width=image.width//2;gutter=4
        for index in range(2):
            target=out/f'{name}-{index}.png'
            if not target.exists():
                tile=Image.new('RGB',(width+2*gutter,image.height))
                tile.paste(image.crop((index*width,0,(index+1)*width,image.height)),(gutter,0))
                left=(index*width-gutter)%image.width
                right=((index+1)*width)%image.width
                tile.paste(image.crop((left,0,left+gutter,image.height)),(0,0))
                tile.paste(image.crop((right,0,right+gutter,image.height)),(width+gutter,0))
                tile.save(target,compress_level=2)
                tile.close()
            records.append({'file':target.name,'source':source,'sourceSha256':hashlib.file_digest(path.open('rb'),'sha256').hexdigest(),
                'sourceRect':[index*width,0,width,image.height],'gutter':gutter,'losslessDecodedPixels':True})
        image.close()
(out/'provenance.json').write_text(json.dumps(records,indent=2))
print('Prepared full-resolution, lossless Earth tiles:',out)
