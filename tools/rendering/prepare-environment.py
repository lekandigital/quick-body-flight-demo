"""Fetch one public reference HDR cube outside Git and validate its LogLuv data.
This is local reference research. Environment redistribution rights are separate
from the downloaded model's CC BY license; no environment binary is committed.
Usage: python3 tools/rendering/prepare-environment.py EXTERNAL_ORIGINALS_DIR
"""
import gzip,hashlib,json,math
from pathlib import Path
import sys,urllib.request
import numpy as np

uid='08468d6fcf9846039cc3e51accddd9f9'
root=Path(sys.argv[1]).resolve()
if root.is_relative_to(Path.cwd().resolve()):raise ValueError('Keep reference environments outside the repository')
out=root/'3dbackgrounds/environments';out.mkdir(parents=True,exist_ok=True)
metadata_url=f'https://sketchfab.com/i/environments/{uid}'
metadata=json.load(urllib.request.urlopen(metadata_url,timeout=30))
candidates=[image for texture in metadata['textures'] if texture['type']=='background' and texture['format']=='cubemap' and texture['encoding']=='luv' for image in texture['images'] if image.get('blur')==0]
image=max(candidates,key=lambda image:image['width']);size=image['width']
compressed=urllib.request.urlopen(image['file'],timeout=30).read()
raw=gzip.decompress(compressed) if compressed[:2]==b'\x1f\x8b' else compressed
assert len(raw)==6*size*size*4
path=out/'studio-soft-logluv.bin'
if path.exists() and path.read_bytes()!=raw:raise ValueError('Existing reference differs; preserve it and investigate')
path.write_bytes(raw)
(out/'studio-soft-metadata.json').write_text(json.dumps(metadata,indent=2))
# Independent float64 validation before Three's cube-image handedness conversion.
d=np.frombuffer(raw,dtype=np.uint8).reshape(6,4,size,size).transpose(0,2,3,1).astype(float)/255
y=np.exp2((d[...,2]*255+d[...,3]-127)/2);z=y/np.maximum(d[...,1],1e-12);x=d[...,0]*z
rgb=np.maximum(np.stack([x,y,z],-1)@np.array([[6.0013,-2.7,-1.7995],[-1.332,3.1029,-5.772],[.3007,-1.088,5.6268]]),0)
u,v=np.meshgrid(2*(np.arange(size)+.5)/size-1,2*(np.arange(size)+.5)/size-1);one=np.ones_like(u)
directions=np.array([np.stack(a,-1) for a in [(one,-v,-u),(-one,-v,u),(u,one,v),(u,-one,-v),(u,-v,one),(-u,-v,-one)]])
length=np.linalg.norm(directions,axis=-1);weight=1/length**3;directions/=length[...,None];norm=4*np.pi/weight.sum()
x,y,z=directions[...,0],directions[...,1],directions[...,2]
basis=[one/(2*np.sqrt(np.pi)),-np.sqrt(3/(4*np.pi))*y,np.sqrt(3/(4*np.pi))*z,-np.sqrt(3/(4*np.pi))*x]
# Diffuse coefficients include the normalized cosine convolution: L0=1,L1=2/3.
coefficients=np.array([norm*(rgb*weight[...,None]*np.asarray(b)[...,None]).sum((0,1,2))*(1 if i==0 else 2/3) for i,b in enumerate(basis)])
expected=np.array(metadata['diffuseSPH']).reshape(-1,3)[:4]
relative=np.abs((coefficients.mean(1)-expected.mean(1))/expected.mean(1))
report={'uid':uid,'name':metadata['name'],'metadataUrl':metadata_url,'resourceUrl':image['file'],'sourceEncoding':'planar RGBA LogLuv','cubeFaceSize':size,'sha256':hashlib.sha256(raw).hexdigest(),'linearRadianceRange':[float(rgb.min()),float(rgb.max())],'measuredDiffuseCoefficients':coefficients.mean(1).tolist(),'expectedDiffuseCoefficients':expected.mean(1).tolist(),'relativeCoefficientErrors':relative.tolist(),'licenseStatus':'Reference evaluation only; redistribution terms unverified'}
(out/'studio-soft-provenance.json').write_text(json.dumps(report,indent=2))
Path('docs/rendering/environment-validation.json').write_text(json.dumps(report,indent=2))
assert max(relative)<.01,'HDR encoding/orientation validation failed'
print(json.dumps(report,indent=2))
