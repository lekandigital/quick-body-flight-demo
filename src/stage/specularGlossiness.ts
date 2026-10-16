// Legacy glTF specular/glossiness workflow, adapted to Three r184's physical
// shader structure. Reference: Three.js r146 GLTFMeshStandardSGMaterial (MIT).
// Modern glTF materials continue through GLTFLoader without this adapter.
import * as THREE from 'three';
import type { GLTFLoaderPlugin, GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';

const EXTENSION='KHR_materials_pbrSpecularGlossiness';

export class SpecularGlossinessMaterial extends THREE.MeshPhysicalMaterial {
  readonly isSpecularGlossinessMaterial=true;
  constructor(parameters:THREE.MeshPhysicalMaterialParameters={}) {
    super(parameters);
    this.onBeforeCompile=(shader)=>{
      shader.uniforms.sourceSpecularF0={value:this.specularColor};
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform vec3 sourceSpecularF0;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <lights_physical_fragment>',`#include <lights_physical_fragment>
        // Specular/glossiness stores F0 directly. Converting it to an extreme
        // dielectric IOR loses the workflow's diffuse energy accounting.
        material.diffuseContribution=diffuseColor.rgb*(1.0-max(sourceSpecularF0.r,max(sourceSpecularF0.g,sourceSpecularF0.b)));
        material.specularColor=sourceSpecularF0;
        material.specularColorBlended=sourceSpecularF0;
        material.specularF90=1.0;
        material.metalness=0.0;
      `);
    };
  }
  customProgramCacheKey():string {return 'bodyarcade-specular-glossiness-r184-v1';}
}

export function specularGlossinessPlugin(parser:GLTFParser):GLTFLoaderPlugin {
  return {
    name:EXTENSION,
    getMaterialType(index:number) {
      return parser.json.materials[index].extensions?.[EXTENSION]?SpecularGlossinessMaterial:null;
    },
    async extendMaterialParams(index:number,params:Record<string,unknown>) {
      const ext=parser.json.materials[index].extensions?.[EXTENSION];
      if(!ext) return;
      if(ext.specularGlossinessTexture) throw new Error('Textured legacy specular/glossiness requires a dedicated channel adapter; refusing to discard its data');
      const diffuse=ext.diffuseFactor??[1,1,1,1];
      params.color=new THREE.Color().setRGB(diffuse[0],diffuse[1],diffuse[2]);
      params.opacity=diffuse[3];params.metalness=0;params.roughness=1-(ext.glossinessFactor??1);
      params.specularColor=new THREE.Color().fromArray(ext.specularFactor??[1,1,1]);
      params.specularIntensity=1;
      if(ext.diffuseTexture) await parser.assignTexture(params,'map',ext.diffuseTexture,THREE.SRGBColorSpace);
    },
  };
}
