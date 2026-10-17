import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

/** A reflection camera for an existing, nearly planar opaque surface.
 * Reflector supplies oblique clipping; its mirror material is never rendered.
 * Reflected scene radiance replaces only the surface's specular IBL sample,
 * so the imported BRDF, F0, normal maps, diffuse and opacity remain in charge.
 */
export class SurfaceReflection {
  private reflector: Reflector;
  private projection = new THREE.Matrix4();
  private inverseProjection = new THREE.Matrix4();
  private reflectedCameraPosition=new THREE.Vector3();
  private maxMip={value:0};
  private active={value:1};
  readonly deviation: number;
  readonly extent: number;
  private mesh: THREE.Mesh;

  constructor(mesh: THREE.Mesh, camera: THREE.Camera, maxDeviationRatio = .005) {
    this.mesh=mesh;
    mesh.updateWorldMatrix(true, false);
    const geometry=mesh.geometry, positions=geometry.getAttribute('position'), index=geometry.index;
    const a=new THREE.Vector3(), b=new THREE.Vector3(), c=new THREE.Vector3();
    const center=new THREE.Vector3(), normal=new THREE.Vector3(), cross=new THREE.Vector3();
    let area=0;
    for(let i=0;i<(index?.count??positions.count);i+=3) {
      a.fromBufferAttribute(positions,index?index.getX(i):i).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(positions,index?index.getX(i+1):i+1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(positions,index?index.getX(i+2):i+2).applyMatrix4(mesh.matrixWorld);
      cross.subVectors(b,a).cross(c.clone().sub(a));
      const weight=cross.length();
      center.addScaledVector(a.clone().add(b).add(c).multiplyScalar(1/3),weight);
      normal.add(cross);area+=weight;
    }
    if(!area || normal.length()<area*.95) throw new Error('Reflection surface is not a consistently oriented plane');
    center.divideScalar(area);normal.normalize();
    if(normal.dot(camera.getWorldPosition(a).sub(center))<0) normal.negate();
    const bounds=new THREE.Box3().setFromObject(mesh);
    this.extent=bounds.getSize(a).length();
    let deviation=0;
    for(let i=0;i<positions.count;i++) {
      a.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);
      deviation=Math.max(deviation,Math.abs(a.sub(center).dot(normal)));
    }
    this.deviation=deviation;
    if(deviation>this.extent*maxDeviationRatio) throw new Error(`Reflection surface deviates ${deviation} from its plane; use SSR or a probe`);
    this.reflector=new Reflector(new THREE.PlaneGeometry(1,1),{textureWidth:1,textureHeight:1,multisample:0,clipBias:.0001});
    this.reflector.position.copy(center);
    this.reflector.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);
    this.reflector.updateMatrixWorld(true);
    const target=this.reflector.getRenderTarget();
    target.texture.generateMipmaps=true;
    target.texture.minFilter=THREE.LinearMipmapLinearFilter;
    target.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
    const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    for(const material of materials) this.bind(material as THREE.MeshStandardMaterial);
  }

  private bind(material:THREE.MeshStandardMaterial):void {
    const previous=material.onBeforeCompile, previousKey=material.customProgramCacheKey();
    material.onBeforeCompile=(shader,renderer)=>{
      previous.call(material,shader,renderer);
      shader.uniforms.surfaceReflection={value:this.reflector.getRenderTarget().texture};
      shader.uniforms.surfaceActive=this.active;
      shader.uniforms.surfaceProjection={value:this.projection};
      shader.uniforms.surfaceInverseProjection={value:this.inverseProjection};
      shader.uniforms.surfaceCameraPosition={value:this.reflectedCameraPosition};
      shader.uniforms.surfaceDepth={value:this.reflector.getRenderTarget().depthTexture};
      shader.uniforms.surfaceExtent={value:this.extent};
      shader.uniforms.surfaceMaxMip=this.maxMip;
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform mat4 surfaceProjection; varying vec4 surfaceCoord; varying vec3 surfaceWorld;')
        .replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nsurfaceWorld=(modelMatrix*vec4(transformed,1.0)).xyz;surfaceCoord=surfaceProjection * vec4(surfaceWorld,1.0);');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
        uniform sampler2D surfaceReflection;
        uniform float surfaceActive;
        uniform float surfaceMaxMip;
        uniform float surfaceExtent;
        uniform sampler2D surfaceDepth;
        uniform mat4 surfaceProjection, surfaceInverseProjection;
        uniform vec3 surfaceCameraPosition;
        varying vec4 surfaceCoord;
        varying vec3 surfaceWorld;
        vec3 reflectionPosition(vec2 uv) {
          vec4 position=surfaceInverseProjection*vec4(uv,texture2D(surfaceDepth,uv).r,1.0);
          return position.xyz/position.w;
        }
        vec3 surfaceRadiance(vec3 fallback, float roughness, vec3 normal, vec3 viewDir) {
          if(surfaceActive<.5) return fallback;
          vec2 uv=surfaceCoord.xy/surfaceCoord.w;
          if(surfaceCoord.w<=0.0 || any(lessThan(uv,vec2(0.0))) || any(greaterThan(uv,vec2(1.0)))) return fallback;
          #if defined(USE_BUMPMAP) || defined(USE_NORMALMAP)
            // Trace the perturbed reflection ray in the reflected camera's
            // depth, which includes geometry outside the main camera's view.
            // This retains the actual source bump rather than warping a mirror
            // by an arbitrary screen-space texture offset.
            vec3 ray=inverseTransformDirection(reflect(-viewDir,normal),viewMatrix);
            vec3 origin=surfaceWorld+inverseTransformDirection(normal,viewMatrix)*surfaceExtent*.00002;
            float previousDistance=0.0;
            float previousGap=-1.0;
            for(int step=1;step<=96;step++) {
              float distance=surfaceExtent*2.0*pow(float(step)/96.0,2.0);
              vec3 point=origin+ray*distance;
              vec4 projected=surfaceProjection*vec4(point,1.0);
              vec2 candidate=projected.xy/projected.w;
              if(projected.w<=0.0 || any(lessThan(candidate,vec2(0.0))) || any(greaterThan(candidate,vec2(1.0)))) break;
              vec3 scenePoint=reflectionPosition(candidate);
              float gap=length(point-surfaceCameraPosition)-length(scenePoint-surfaceCameraPosition);
              if(gap>=0.0 && previousGap<0.0) {
                float low=previousDistance,high=distance;
                for(int refinement=0;refinement<8;refinement++) {
                  float middle=(low+high)*.5;
                  vec3 probe=origin+ray*middle;
                  vec4 p=surfaceProjection*vec4(probe,1.0);
                  candidate=p.xy/p.w;
                  scenePoint=reflectionPosition(candidate);
                  if(length(probe-surfaceCameraPosition)>length(scenePoint-surfaceCameraPosition)) high=middle;else low=middle;
                }
                if(length(origin+ray*((low+high)*.5)-scenePoint)<surfaceExtent*.003) {uv=candidate;break;}
              }
              previousDistance=distance;previousGap=gap;
            }
          #endif
          // Mip filtering is a fallback for rough surfaces, not a GGX convolution.
          // This scene's authored polished floor has roughness zero.
          return textureLod(surfaceReflection,uv,roughness*roughness*surfaceMaxMip).rgb;
        }
      `).replace('#include <lights_fragment_maps>',THREE.ShaderChunk.lights_fragment_maps.replace(
        'radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );',
        'radiance += surfaceRadiance(getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ),material.roughness,geometryNormal,geometryViewDir);'));
    };
    material.customProgramCacheKey=()=>`${previousKey}:surface-reflection-v1`;
    material.userData.surfaceReflection={deviation:this.deviation,extent:this.extent};
    material.needsUpdate=true;
  }

  setSize(width:number,height:number,samples:number):void {
    const target=this.reflector.getRenderTarget();
    if(target.samples!==samples) {target.samples=samples;target.dispose();}
    target.setSize(width,height);
    this.maxMip.value=Math.log2(Math.max(width,height));
  }

  render(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.Camera):void {
    if(!this.enabled) return;
    const target=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),level=renderer.getActiveMipmapLevel();
    const visible=this.mesh.visible;
    this.mesh.visible=false;
    try {
      const material=this.reflector.material as THREE.ShaderMaterial;
      this.reflector.onBeforeRender(renderer,scene,camera,this.reflector.geometry,material,null!);
      // r184's projection uniform predates oblique clipping. Depth decoding
      // needs the final clipped projection, not that color-only matrix.
      const reflectionCamera=(this.reflector as Reflector & {_getReflectionCamera:(camera:THREE.Camera)=>THREE.Camera})._getReflectionCamera(camera);
      this.projection.set(.5,0,0,.5, 0,.5,0,.5, 0,0,.5,.5, 0,0,0,1)
        .multiply(reflectionCamera.projectionMatrix).multiply(reflectionCamera.matrixWorldInverse);
      this.inverseProjection.copy(this.projection).invert();
      this.reflectedCameraPosition.setFromMatrixPosition(reflectionCamera.matrixWorld);
    } finally {renderer.setRenderTarget(target,face,level);this.mesh.visible=visible;}
  }

  get enabled():boolean {return this.active.value===1;}
  set enabled(value:boolean) {this.active.value=value?1:0;}

  dispose():void {this.reflector.geometry.dispose();this.reflector.dispose();}
}
