import type { Plugin } from 'vite';
import { createReadStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Serve only selected originals from an explicit, external development tree.
 * No original archive, sources, or directory listing enters a runtime build.
 */
export function originalAssets(): Plugin {
  return { name:'original-rendering-assets', apply:'serve', configureServer(server) {
    const root = process.env.BODYARCADE_ORIGINALS_DIR;
    if (!root) return;
    const files: Record<string,string> = {
      'galaxy-emissive.png':'3dbackgrounds/inside-galaxy-skybox-hdri-360-panorama/source/Inside-galaxy-emissive.png',
      'earth-agullo.glb':'3dbackgrounds/earth.glb',
      'earth-airstudios.glb':'3dbackgrounds/earth (1).glb',
      'corridor.glb':'3dbackgrounds/spaceship_corridor.glb',
      'gallery.glb':'3dbackgrounds/vr_exhibition_gallery_baked.glb',
      'space.glb':'3dbackgrounds/need_some_space.glb',
      'hangar.glb':'3dbackgrounds/sci-fi_hanger.glb',
      'env-studio-soft.bin':'3dbackgrounds/environments/studio-soft-logluv.bin',
      'hangar-floor-bump.png':'3dbackgrounds/sci-fi-hanger/textures/FloorNormal.png',
      'earth-day-16k.jpg':'3dbackgrounds/earth/textures/2_no_clouds_16k.jpeg',
      'earth-night-16k.jpg':'3dbackgrounds/earth/textures/NIGHT.jpg',
      'earth-day-left.png':'3dbackgrounds/earth/tiles/day-0.png',
      'earth-day-right.png':'3dbackgrounds/earth/tiles/day-1.png',
      'earth-night-left.png':'3dbackgrounds/earth/tiles/night-0.png',
      'earth-night-right.png':'3dbackgrounds/earth/tiles/night-1.png',
      'gallery-back.png':'3dbackgrounds/vr-exhibition-gallery-baked/textures/wall_back2.png',
      'gallery-left.png':'3dbackgrounds/vr-exhibition-gallery-baked/textures/wall_l2.png',
      'gallery-right.png':'3dbackgrounds/vr-exhibition-gallery-baked/textures/wall_r2.png',
    };
    const manifest: Record<string,object> = Object.fromEntries(Object.entries(files).filter(([id,path])=>!id.startsWith('earth-day-') && !id.startsWith('earth-night-') && !id.startsWith('gallery-') && !id.startsWith('env-') && !id.startsWith('hangar-floor-') && existsSync(resolve(root,path))).map(([id])=>[id,id==='galaxy-emissive.png'
      ? {file:'galaxy.glb',emissiveTextureUrl:`/__original-assets/${id}`}
      : {file:id,sourceUrl:`/__original-assets/${id}`} ]));
    if(existsSync(resolve(root,files['earth-day-16k.jpg'])) && existsSync(resolve(root,files['earth-night-16k.jpg']))) {
      manifest['earth-agullo.glb']={file:'earth-agullo.glb',sourceUrl:'/__original-assets/earth-agullo.glb',textureOverrides:[
        {material:'TERRE',slot:'map',url:'/__original-assets/earth-day-16k.jpg',flipY:true,maxDimension:16200,
          tiles:{leftUrl:'/__original-assets/earth-day-left.png',rightUrl:'/__original-assets/earth-day-right.png',innerWidth:8100,gutter:4}},
        {material:'TERRE',slot:'emissiveMap',url:'/__original-assets/earth-night-16k.jpg',flipY:true,maxDimension:16200,
          tiles:{leftUrl:'/__original-assets/earth-night-left.png',rightUrl:'/__original-assets/earth-night-right.png',innerWidth:8100,gutter:4}},
      ]};
    }
    if(['gallery-back.png','gallery-left.png','gallery-right.png'].every((id)=>existsSync(resolve(root,files[id])))) {
      manifest['gallery.glb']={file:'gallery.glb',sourceUrl:'/__original-assets/gallery.glb',textureOverrides:[
        {material:'Material.006',slot:'map',url:'/__original-assets/gallery-back.png',flipY:true},
        {material:'Material.004',slot:'map',url:'/__original-assets/gallery-left.png',flipY:true},
        {material:'Material.003',slot:'map',url:'/__original-assets/gallery-right.png',flipY:true},
      ]};
    }
    if(existsSync(resolve(root,files['hangar.glb'])) && existsSync(resolve(root,files['hangar-floor-bump.png']))) {
      manifest['hangar.glb']={file:'hangar.glb',sourceUrl:'/__original-assets/hangar.glb',textureOverrides:[
        {material:'Floor',slot:'bumpMap',url:'/__original-assets/hangar-floor-bump.png',flipY:true,scale:1.7},
      ],...(process.env.BODYARCADE_REFERENCE_HDR==='1' && existsSync(resolve(root,files['env-studio-soft.bin']))
        ?{environmentCube:{url:'/__original-assets/env-studio-soft.bin',size:512}}:{})};
    }
    server.middlewares.use('/__original-assets', (req,res,next) => {
      const key=(req.url??'').split('?')[0].slice(1);
      if(key==='manifest.json') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(manifest));return;}
      if(!Object.hasOwn(files,key)) return next();
      const file=resolve(root,files[key]);
      if(!existsSync(file)) {res.statusCode=404;res.end('Original asset missing');return;}
      res.setHeader('Content-Type',key.endsWith('.bin')?'application/octet-stream':key.endsWith('.png')?'image/png':key.endsWith('.jpg')?'image/jpeg':'model/gltf-binary');
      createReadStream(file).pipe(res);
    });
  }};
}
