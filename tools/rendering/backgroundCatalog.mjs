import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** One build policy for both the picker and the packaged assets. */
export function selectBackgroundCatalog({deployment='',target='',branch='',requested='',projectUrl=''}={}) {
  const isolatedPreview=projectUrl==='bodyarcade-sketchfab-fidelity.vercel.app';
  // Production wins over every opt-in and query parameter.
  // Vercel's separate fidelity project may label its own deployment Production.
  if(branch==='bodyarcade-flight-fable'||((deployment==='production'||target==='production')&&!isolatedPreview)) return 'live';
  if(requested && !['all','live'].includes(requested)) throw new Error('BODYARCADE_BACKGROUND_CATALOG must be all or live');
  if(requested) return requested;
  return isolatedPreview||deployment==='preview'||['feature/sketchfab-fidelity','main'].includes(branch)?'all':'live';
}

export function buildBackgroundCatalog(env=process.env) {
  let branch=env.VERCEL_GIT_COMMIT_REF??'';
  if(!branch) {
    try {branch=execFileSync('git',['branch','--show-current'],{cwd:fileURLToPath(new URL('../..',import.meta.url)),encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}
    catch { /* Unknown checkouts fail closed to the live catalog. */ }
  }
  return selectBackgroundCatalog({deployment:env.VERCEL_ENV,target:env.VERCEL_TARGET_ENV,branch,requested:env.BODYARCADE_BACKGROUND_CATALOG,projectUrl:env.VERCEL_PROJECT_PRODUCTION_URL});
}
