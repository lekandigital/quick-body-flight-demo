import * as THREE from 'three';

export interface LocalProbeSpec {
  materials:string[];
  boundsMaterials:string[];
  resolution?:number;
  position?:[number,number,number];
  iterations?:number;
  captureFloor?:boolean;
  /** Explicit radiance calibration, separate from the source material's F0. */
  intensity?:number;
}

/** Box projection intersects an actual world-space box, independent of origin.
 * Reference: Three's box-projected environment example (MIT). The native
 * material BRDF and PMREM roughness filtering remain unchanged.
 */
const boxProjection=/* glsl */`
uniform vec3 localProbePosition,localProbeMin,localProbeMax;
uniform float localProbeActive;
varying vec3 localProbeWorld;
vec3 localProbeDirection(vec3 direction) {
  if(localProbeActive<.5) return direction;
  if(any(lessThan(localProbeWorld,localProbeMin-vec3(.001))) || any(greaterThan(localProbeWorld,localProbeMax+vec3(.001)))) return direction;
  vec3 safeDirection=mix(vec3(-1.0),vec3(1.0),step(vec3(0.0),direction))*max(abs(direction),vec3(1e-6));
  vec3 nearHit=(localProbeMin-localProbeWorld)/safeDirection;
  vec3 farHit=(localProbeMax-localProbeWorld)/safeDirection;
  vec3 exitHit=max(nearHit,farHit);
  float distance=min(exitHit.x,min(exitHit.y,exitHit.z));
  if(distance<=0.0) return direction;
  return normalize(localProbeWorld+direction*distance-localProbePosition);
}
`;

export class LocalReflectionProbe {
  readonly bounds=new THREE.Box3();
  readonly position=new THREE.Vector3();
  private cube:THREE.WebGLCubeRenderTarget;
  private camera:THREE.CubeCamera;
  private filtered:THREE.WebGLRenderTarget|null=null;
  private materials:Array<{material:THREE.MeshStandardMaterial;map:THREE.Texture|null;intensity:number;rotation:THREE.Euler}>=[];
  private active={value:0};
  readonly iterations:number;
  readonly captureFloor:boolean;
  readonly intensity:number;

  constructor(root:THREE.Object3D,renderer:THREE.WebGLRenderer,spec:LocalProbeSpec,resolution:number) {
    root.updateWorldMatrix(true,true);
    const materials=new Set<THREE.MeshStandardMaterial>();
    root.traverse((object)=>{
      const mesh=object as THREE.Mesh;if(!mesh.isMesh) return;
      const list=Array.isArray(mesh.material)?mesh.material:[mesh.material];
      if(list.some((material)=>spec.boundsMaterials.includes(material.name))) this.bounds.union(new THREE.Box3().setFromObject(mesh));
      for(const material of list) if(spec.materials.includes(material.name) && (material as THREE.MeshStandardMaterial).isMeshStandardMaterial) materials.add(material as THREE.MeshStandardMaterial);
    });
    if(this.bounds.isEmpty() || !materials.size) throw new Error('Local reflection probe requires matching PBR materials and room bounds');
    this.position.copy(spec.position?new THREE.Vector3(...spec.position):this.bounds.getCenter(new THREE.Vector3()));
    if(!this.bounds.containsPoint(this.position)) throw new Error('The local reflection probe must be inside its projection volume');
    this.iterations=Math.max(1,Math.min(8,Math.round(spec.iterations??1)));
    this.captureFloor=spec.captureFloor??false;
    this.intensity=spec.intensity??1;
    if(!Number.isFinite(this.intensity) || this.intensity<0) throw new Error('Probe intensity must be finite and nonnegative');
    // A private generator keeps its LOD/filter state independent of differently
    // sized source environments, including after WebGL context restoration.
    this.generator=new THREE.PMREMGenerator(renderer);
    const span=this.bounds.getSize(new THREE.Vector3()).length();
    this.cube=new THREE.WebGLCubeRenderTarget(resolution,{type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,generateMipmaps:false});
    this.camera=new THREE.CubeCamera(Math.max(.001,span*.0001),span*10,this.cube);
    this.camera.position.copy(this.position);
    for(const material of materials) {
      this.materials.push({material,map:material.envMap,intensity:material.envMapIntensity,rotation:material.envMapRotation.clone()});
      const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
      material.onBeforeCompile=(shader,renderer)=>{
        previous.call(material,shader,renderer);
        shader.uniforms.localProbePosition={value:this.position};
        shader.uniforms.localProbeActive=this.active;
        shader.uniforms.localProbeMin={value:this.bounds.min};shader.uniforms.localProbeMax={value:this.bounds.max};
        shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 localProbeWorld;')
          .replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nlocalProbeWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
        shader.fragmentShader=shader.fragmentShader.replace('#include <envmap_physical_pars_fragment>',boxProjection+THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
          'reflectVec = inverseTransformDirection( reflectVec, viewMatrix );',
          'reflectVec = localProbeDirection(inverseTransformDirection( reflectVec, viewMatrix ));'));
      };
      material.customProgramCacheKey=()=>`${key}:local-box-probe-v1`;
      material.userData.localReflectionProbe={position:this.position.toArray(),min:this.bounds.min.toArray(),max:this.bounds.max.toArray(),resolution,intensity:this.intensity,iterations:this.iterations,captureFloor:this.captureFloor};
      material.needsUpdate=true;
    }
  }
  private generator:THREE.PMREMGenerator;

  setResolution(resolution:number):void {
    if(this.cube.width===resolution) return;
    this.cube.setSize(resolution,resolution);
    this.filtered?.dispose();this.filtered=null;this.invalidate();
    for(const {material} of this.materials) {
      material.userData.localReflectionProbe.resolution=resolution;
    }
  }

  /** A fixed bounce count is recomputed from source lighting each frame.
   * This avoids lighting that brightens as a function of elapsed frame count.
   * Later bounces read the preceding filtered probe while writing a separate
   * cube target: there is no same-texture read/write feedback. One bounce is
   * appropriate for matching a nonrecursive SSR presentation.
   */
  render(renderer:THREE.WebGLRenderer,scene:THREE.Scene):void {
    this.invalidate();
    for(let i=0;i<this.iterations;i++) {
      this.camera.update(renderer,scene);
      this.filtered=this.generator.fromCubemap(this.cube.texture,this.filtered??undefined);
      for(const {material} of this.materials) if(material.envMap!==this.filtered.texture) {
        material.envMap=this.filtered.texture;material.envMapIntensity=this.intensity;material.envMapRotation.set(0,0,0);material.needsUpdate=true;
      }
      this.active.value=1;
    }
  }

  invalidate():void {
    this.active.value=0;
    for(const {material,map,intensity,rotation} of this.materials) {
      material.envMap=map;material.envMapIntensity=intensity;material.envMapRotation.copy(rotation);material.needsUpdate=true;
    }
  }
  dispose():void {this.filtered?.dispose();this.cube.dispose();this.generator.dispose();}
}
