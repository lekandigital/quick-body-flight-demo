import * as THREE from 'three';

export interface ViewerChannel {
  factor?: number;
  color?: [number, number, number];
  type?: string;
  hasTexture?: boolean;
  enable?: boolean;
}
export type ViewerChannels = Record<string, ViewerChannel>;

/** Exporters sanitize names. Only accept an unambiguous normalized match. */
export function findViewerChannels(name: string, materials: Record<string, ViewerChannels>): ViewerChannels | null {
  if (materials[name]) return materials[name];
  const key = (s: string) => s.normalize('NFKC').replace(/[\s_.#-]+/g, '').toLowerCase();
  const candidates = Object.entries(materials).filter(([n]) => key(n) === key(name));
  return candidates.length === 1 ? candidates[0][1] : null;
}

/** Keep GLTFLoader's class, extensions, texture transforms, channels and factors.
 * The viewer overlay restores only information absent from the exported glTF:
 * HDR emission, additive blending and clearcoat. Viewer colors here are linear
 * (verified against the factors embedded in these eight exports).
 */
export function backgroundMaterial(src: THREE.Material, channels: ViewerChannels | null, shadeless: boolean, sky: boolean): THREE.Material {
  let material = src.clone();
  const pbr = material as THREE.MeshPhysicalMaterial;
  if ((pbr as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    const emission = channels?.EmitColor;
    if (emission && emission.enable !== false) {
      if (emission.hasTexture && pbr.emissiveMap) {
        pbr.emissive.setRGB(1, 1, 1);
        pbr.emissiveIntensity = emission.factor ?? pbr.emissiveIntensity;
      } else if (!emission.hasTexture && emission.color) {
        pbr.emissive.setRGB(...emission.color);
        pbr.emissiveIntensity = emission.factor ?? 1;
      }
    }
    if (pbr.isMeshPhysicalMaterial && channels?.ClearCoat?.enable !== false) {
      pbr.clearcoat = channels?.ClearCoat?.factor ?? pbr.clearcoat;
      pbr.clearcoatRoughness = channels?.ClearCoatRoughness?.factor ?? pbr.clearcoatRoughness;
    }
    // Only an explicit baked/shadeless presentation uses an unlit material.
    // Native KHR_materials_unlit already arrives as MeshBasicMaterial above.
    if (shadeless) {
      const basic = new THREE.MeshBasicMaterial({
        name: src.name, color: pbr.color.clone(), map: pbr.map,
        alphaMap: pbr.alphaMap, alphaTest: pbr.alphaTest, transparent: pbr.transparent,
        opacity: pbr.opacity, side: pbr.side, vertexColors: pbr.vertexColors,
        aoMap: pbr.aoMap, aoMapIntensity: pbr.aoMapIntensity,
        depthTest: pbr.depthTest, depthWrite: pbr.depthWrite, blending: pbr.blending,
        wireframe: pbr.wireframe, fog: false, toneMapped: false,
      });
      // Baked surfaces use base color; purely emissive surfaces retain emission.
      if (!pbr.map && Math.max(pbr.emissive.r, pbr.emissive.g, pbr.emissive.b) > 0) basic.color.copy(pbr.emissive).multiplyScalar(pbr.emissiveIntensity);
      material.dispose(); material = basic;
    }
  }
  if (channels?.Opacity?.type === 'additive') {
    material.blending = THREE.AdditiveBlending;
    material.transparent = true;
    material.depthWrite = false;
  }
  // Preserve authored winding/double-sidedness. Forcing BackSide breaks
  // inward-facing sky meshes; camera is already inside the actual geometry.
  if (sky) material.depthWrite = false;
  return material;
}
