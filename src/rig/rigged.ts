// demo-video clone change (NOT upstream): load an ORIGINAL rigged humanoid
// (.glb/.gltf or .fbx) straight from the creator's file and drive it through the
// same Avatar interface as the VRMs. No conversion, no auto-rigging: three.js
// loads the file, bones are bound by name (VRoid / Mixamo / generic patterns
// from vrm.ts, or an explicit per-model map), and the Retargeter captures
// whatever rest pose the model ships with, exactly as it does for VRMs.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { BONE_NAME_PATTERNS } from './vrm';
import type { Avatar, BoneName, JointName } from './types';

export interface RiggedOptions {
  /** explicit bone-node names per BoneName (wins over the name patterns) */
  boneMap?: Partial<Record<BoneName, string>>;
  /** extra Y rotation (rad) so the model faces the stage camera (+Z) */
  facing?: number;
  /** scale the model to this standing height (m) */
  height?: number;
  /** FBX: loose texture files to wire by material name, { materialName: url } */
  textures?: Record<string, string>;
}

const JOINT_FROM_BONE: Record<JointName, BoneName> = {
  hipCenter: 'hips',
  shoulderCenter: 'neck',
  head: 'head',
  leftShoulder: 'leftUpperArm',
  leftElbow: 'leftLowerArm',
  leftWrist: 'leftHand',
  rightShoulder: 'rightUpperArm',
  rightElbow: 'rightLowerArm',
  rightWrist: 'rightHand',
  leftHip: 'leftUpperLeg',
  leftKnee: 'leftLowerLeg',
  leftAnkle: 'leftFoot',
  rightHip: 'rightUpperLeg',
  rightKnee: 'rightLowerLeg',
  rightAnkle: 'rightFoot',
};

/** Normalize Sketchfab/Blender-exported names: "mixamorig_LeftArm_011" → "mixamorig:LeftArm". */
function canonical(name: string): string {
  return name.replace(/^mixamorig[_:]?/i, 'mixamorig:').replace(/(_\d+)+$/, '');
}

export async function loadRiggedAvatar(url: string, opts: RiggedOptions = {}): Promise<Avatar> {
  let model: THREE.Object3D;
  if (/\.fbx$/i.test(url)) {
    model = await new FBXLoader().loadAsync(url);
  } else {
    model = (await new GLTFLoader().loadAsync(url)).scene;
  }

  // loose textures by material name (FBX exports that don't embed/resolve them)
  if (opts.textures) {
    const loader = new THREE.TextureLoader();
    const cache = new Map<string, THREE.Texture>();
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats as THREE.MeshStandardMaterial[]) {
        const tex = opts.textures![m.name] ?? opts.textures!['*'];
        if (!tex) continue;
        if (!cache.has(tex)) {
          const t = loader.load(tex);
          t.colorSpace = THREE.SRGBColorSpace;
          t.flipY = !/\.fbx$/i.test(url) ? false : true;
          cache.set(tex, t);
        }
        m.map = cache.get(tex)!;
        if (m.color) m.color.set(0xffffff);
        m.needsUpdate = true;
      }
    });
  }

  // bones: explicit map first, then the shared name patterns (bones only)
  const boneNodes: THREE.Object3D[] = [];
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone || /mixamorig|J_Bip|bip|bone/i.test(o.name)) boneNodes.push(o);
  });
  const bones: Partial<Record<BoneName, THREE.Object3D>> = {};
  for (const [bone, re] of Object.entries(BONE_NAME_PATTERNS) as [BoneName, RegExp][]) {
    const want = opts.boneMap?.[bone];
    const hit = want
      ? boneNodes.find((n) => n.name === want) ?? model.getObjectByName(want)
      : boneNodes.find((n) => re.test(canonical(n.name)));
    if (hit) bones[bone] = hit;
  }
  const found = Object.keys(bones);
  console.info(`[rigged] ${url}: bones ${found.length}/16 — missing ${
    (Object.keys(BONE_NAME_PATTERNS) as BoneName[]).filter((b) => !bones[b]).join(', ') || 'none'}`);
  if (!bones.chest) {
    const spine = boneNodes.find((n) => /spine2|spine1|spine/i.test(canonical(n.name)));
    if (spine) bones.chest = spine;
  }

  const root = new THREE.Group();
  root.name = 'rigged-avatar';
  const holder = new THREE.Group();
  holder.add(model);
  root.add(holder);
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.frustumCulled = false; // skinned bounds don't follow the pose
    }
  });

  // stand it on the floor at the requested height, facing the camera
  holder.rotation.y = opts.facing ?? 0;
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(model);
  const h = Math.max(box.max.y - box.min.y, 1e-3);
  const s = (opts.height ?? 1.7) / h;
  holder.scale.setScalar(s);
  root.updateWorldMatrix(true, true);
  const box2 = new THREE.Box3().setFromObject(model);
  const c = box2.getCenter(new THREE.Vector3());
  holder.position.set(-c.x, -box2.min.y, -c.z);
  root.updateWorldMatrix(true, true);

  const joints: Partial<Record<JointName, THREE.Object3D>> = {};
  for (const [joint, bone] of Object.entries(JOINT_FROM_BONE) as [JointName, BoneName][]) {
    if (bones[bone]) joints[joint] = bones[bone];
  }

  // head collider from skinned geometry dominated by the head bone (as vrm.ts)
  let headGeometry: { centerLocal: THREE.Vector3; radius: number } | undefined;
  const headBone = bones.head;
  if (headBone) {
    const headSet = new Set<THREE.Object3D>();
    headBone.traverse((o) => headSet.add(o));
    const pts: THREE.Vector3[] = [];
    const v = new THREE.Vector3();
    model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      const pos = mesh.geometry.getAttribute('position');
      const idx = mesh.geometry.getAttribute('skinIndex');
      const wgt = mesh.geometry.getAttribute('skinWeight');
      if (!pos || !idx || !wgt) return;
      const headIdx = new Set<number>();
      mesh.skeleton.bones.forEach((b, i) => { if (headSet.has(b)) headIdx.add(i); });
      if (!headIdx.size) return;
      const stride = Math.max(1, Math.floor(pos.count / 4000));
      for (let i = 0; i < pos.count; i += stride) {
        let best = 0;
        let bestW = wgt.getX(i);
        if (wgt.getY(i) > bestW) { best = 1; bestW = wgt.getY(i); }
        if (wgt.getZ(i) > bestW) { best = 2; bestW = wgt.getZ(i); }
        if (wgt.getW(i) > bestW) { best = 3; bestW = wgt.getW(i); }
        const bone = [idx.getX(i), idx.getY(i), idx.getZ(i), idx.getW(i)][best];
        if (!headIdx.has(bone) || bestW < 0.5) continue;
        v.fromBufferAttribute(pos, i);
        mesh.applyBoneTransform(i, v);
        mesh.localToWorld(v);
        pts.push(v.clone());
      }
    });
    if (pts.length > 20) {
      const centroid = new THREE.Vector3();
      for (const p of pts) centroid.add(p);
      centroid.divideScalar(pts.length);
      const dists = pts.map((p) => p.distanceTo(centroid)).sort((a, b) => a - b);
      const radius = THREE.MathUtils.clamp(dists[Math.floor(dists.length * 0.95)], 0.08, 0.4);
      headGeometry = { centerLocal: headBone.worldToLocal(centroid.clone()), radius };
    }
  }

  // Some multi-mesh FBX exports carry one skeleton copy per mesh (same bone
  // names). The retargeter drives the first copy; the others follow it.
  const byName = new Map<string, THREE.Object3D[]>();
  for (const n of boneNodes) {
    const k = canonical(n.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(n);
  }
  const followers: [THREE.Object3D, THREE.Object3D][] = [];
  for (const nodes of byName.values()) for (let i = 1; i < nodes.length; i++) followers.push([nodes[0], nodes[i]]);
  if (followers.length) console.info(`[rigged] ${followers.length} duplicate bones follow their primary`);

  const slug = url.split('/').pop()?.replace(/\.(glb|gltf|fbx)$/i, '').toLowerCase() ?? 'unknown';
  return {
    name: `rigged:${slug}`,
    object: root,
    bones,
    joints,
    headGeometry,
    update() {
      for (const [src, dst] of followers) {
        dst.quaternion.copy(src.quaternion);
        dst.position.copy(src.position);
      }
    },
    dispose() {
      root.removeFromParent();
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => m.dispose());
        }
      });
    },
  };
}
