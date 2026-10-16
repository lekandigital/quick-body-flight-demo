"""Verify runtime texture orientation against the downloaded GLB, before use.
Usage: python3 tools/rendering/verify-galaxy.py EXTERNAL_ORIGINALS_DIR
Pillow comparisons use 8-bit thumbnails to check alignment, not 16-bit precision.
"""
import hashlib,io,json,struct,sys
from pathlib import Path
from PIL import Image,ImageChops,ImageOps,ImageStat
root=Path(sys.argv[1])/'3dbackgrounds'
data=(root/'inside_galaxy_skybox_hdri_360_panorama.glb').read_bytes()
length=struct.unpack_from('<I',data,12)[0];document=json.loads(data[20:20+length])
view=document['bufferViews'][document['images'][0]['bufferView']]
offset=28+length+view.get('byteOffset',0)
reference=Image.open(io.BytesIO(data[offset:offset+view['byteLength']])).convert('RGB').resize((512,256))
source_path=root/'inside-galaxy-skybox-hdri-360-panorama/source/Inside-galaxy-emissive.png'
source=Image.open(source_path).convert('RGB').resize((512,256))
raw=Image.open(root/'inside-galaxy-skybox-hdri-360-panorama/textures/Inside Galaxy 4k HDRI_0.png').convert('RGB').resize((512,256))
def error(a,b):return sum(ImageStat.Stat(ImageChops.difference(a,b)).mean)/3
report={'scene':'galaxy','comparisonSize':[512,256],'source':'source/Inside galaxy HDRI.glb → embedded emissive PNG bytes','sourcePngSha256':hashlib.sha256(source_path.read_bytes()).hexdigest(),'embeddedVsDownloadedGlbMeanError255':error(reference,source),'rawStandaloneUnflippedMeanError255':error(reference,raw),'rawStandaloneFlippedMeanError255':error(reference,ImageOps.flip(raw)),'decision':'Use embedded PNG at native orientation; earlier standalone unflipped captures were incorrect and superseded.'}
Path('docs/rendering/galaxy-texture-validation.json').write_text(json.dumps(report,indent=2))
assert report['embeddedVsDownloadedGlbMeanError255']<1,'Source texture orientation/content no longer matches'
print(json.dumps(report,indent=2))
