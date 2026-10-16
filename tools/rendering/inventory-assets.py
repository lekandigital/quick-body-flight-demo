"""Inspect original ZIP/GLBs without changing sources or executing source files.
Usage: python tools/rendering/inventory-assets.py ARCHIVE ORIGINALS_DIR
The ZIP and extracted originals remain outside the Git repository.
"""
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import struct
import sys
import zipfile
from PIL import Image

archive, destination = Path(sys.argv[1]), Path(sys.argv[2])
destination.mkdir(parents=True, exist_ok=True)
Image.MAX_IMAGE_PIXELS = None  # inspect headers only, including authored 16K maps

def image_info(data):
    try:
        with Image.open(io.BytesIO(data)) as image:
            return {"dimensions": list(image.size), "format": image.format, "mode": image.mode}
    except Exception:
        return None

def glb_info(data):
    if data[:4] != b'glTF':
        raise ValueError('Not a GLB')
    json_len, json_type = struct.unpack_from('<II', data, 12)
    assert json_type == 0x4e4f534a
    doc = json.loads(data[20:20+json_len])
    images = []
    for image in doc.get('images', []):
        result = dict(image)
        if 'bufferView' in image:
            view = doc['bufferViews'][image['bufferView']]
            offset = 28 + json_len + view.get('byteOffset', 0)
            result.update(image_info(data[offset:offset+view['byteLength']]) or {})
        images.append(result)
    primitives = [p for m in doc.get('meshes', []) for p in m['primitives']]
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "asset": doc.get('asset'),
            "extensionsUsed": doc.get('extensionsUsed', []), "extensionsRequired": doc.get('extensionsRequired', []),
            "materials": doc.get('materials', []), "images": images, "meshCount": len(doc.get('meshes', [])),
            "primitiveCount": len(primitives), "vertices": sum(doc['accessors'][p['attributes']['POSITION']]['count'] for p in primitives),
            "indexCount": sum(doc['accessors'][p['indices']]['count'] for p in primitives if 'indices' in p),
            "primitiveModes": [p.get('mode', 4) for p in primitives],
            "attributes": [list(p['attributes']) for p in primitives],
            "animations": len(doc.get('animations', []))}

def usable(name):
    parts = PurePosixPath(name).parts
    return not name.endswith('/') and not any(p.startswith('._') or p in ('__MACOSX', '.DS_Store') for p in parts)

def safe_write(name, data):
    target = destination.joinpath(*PurePosixPath(name).parts)
    if not target.resolve().is_relative_to(destination.resolve()):
        raise ValueError('Unsafe archive path')
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        target.write_bytes(data)
    return target

report = {"archive": archive.name, "archiveBytes": archive.stat().st_size,
          "archiveSha256": hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest(),
          "originals": {}, "nested": {}, "optimized": {}}
with zipfile.ZipFile(archive) as outer:
    for item in outer.infolist():
        if not usable(item.filename):
            continue
        if item.filename.lower().endswith('.glb'):
            data = outer.read(item)
            report['originals'][item.filename] = glb_info(data)
            safe_write(item.filename, data)
        elif item.filename.lower().endswith('.zip'):
            # Keep nested archives in memory for inspection; extract only a
            # runtime-ready GLB or license, never redundant FBX/BLEND sources.
            with zipfile.ZipFile(io.BytesIO(outer.read(item))) as nested:
                rows = []
                for entry in nested.infolist():
                    if not usable(entry.filename):
                        continue
                    row = {"path": entry.filename, "bytes": entry.file_size}
                    if entry.filename.lower().endswith(('.png','.jpg','.jpeg','.webp','.tga')):
                        data = nested.read(entry)
                        row.update(image_info(data) or {})
                        if 'inside-galaxy' in item.filename or 'vr-exhibition-gallery-baked' in item.filename or (item.filename=='3dbackgrounds/sci-fi-hanger.zip' and entry.filename=='textures/FloorNormal.png') or (item.filename=='3dbackgrounds/earth.zip' and entry.filename in ('textures/2_no_clouds_16k.jpeg','textures/NIGHT.jpg')):
                            safe_write(str(PurePosixPath(item.filename).with_suffix('')) + '/' + entry.filename, data)
                    if entry.filename.lower().endswith('.zip'):
                        with zipfile.ZipFile(io.BytesIO(nested.read(entry))) as inner:
                            row['nestedEntries'] = [{'path':x.filename,'bytes':x.file_size} for x in inner.infolist() if usable(x.filename)]
                    if entry.filename.lower().endswith('.glb'):
                        data = nested.read(entry)
                        row['glb'] = glb_info(data)
                        # The Galaxy source is the only nested GLB needed now.
                        if 'inside-galaxy' in item.filename:
                            name = str(PurePosixPath(item.filename).with_suffix('')) + '/' + entry.filename
                            safe_write(name, data)
                            # Use the source GLB's runtime-oriented 16-bit PNG.
                            # The separate artist PNG is vertically reversed.
                            length=struct.unpack_from('<I',data,12)[0]
                            document=json.loads(data[20:20+length])
                            texture=document['materials'][0]['emissiveTexture']['index']
                            view=document['bufferViews'][document['images'][document['textures'][texture]['source']]['bufferView']]
                            offset=28+length+view.get('byteOffset',0)
                            safe_write(str(PurePosixPath(item.filename).with_suffix(''))+'/source/Inside-galaxy-emissive.png',data[offset:offset+view['byteLength']])
                    if 'license' in entry.filename.lower() and entry.file_size < 100_000:
                        row['licenseText'] = nested.read(entry).decode('utf8', errors='replace')
                    rows.append(row)
                report['nested'][item.filename] = rows
for path in Path('public/backgrounds').glob('*.glb'):
    report['optimized'][path.name] = glb_info(path.read_bytes())
output = Path('docs/rendering/asset-inventory.json')
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, indent=2))
for name, info in report['originals'].items():
    print(name, info['bytes'], [(x.get('dimensions'), x.get('mimeType')) for x in info['images']])
for name, rows in report['nested'].items():
    print('\nNESTED', name)
    for row in rows:
        if 'dimensions' in row or 'glb' in row or 'licenseText' in row:
            print(row['path'], row['bytes'], row.get('dimensions'), [(x.get('dimensions'),x.get('mimeType')) for x in row.get('glb',{}).get('images',[])])
print('Report:', output)
