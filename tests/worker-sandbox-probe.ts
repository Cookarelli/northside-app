import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { probeSandbox } from '../apps/worker/src/sandbox';
async function main(){const root=await mkdtemp(join(tmpdir(),'northside-policy-probe-'));
try {await probeSandbox({root,repo:process.cwd(),codexHome:join(root,'codex-home'),codexBinary:process.env.CODEX_BINARY??'codex'});console.log('Worker filesystem and verifier sandbox probes passed.');} finally {await rm(root,{recursive:true,force:true});}

}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
