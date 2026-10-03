import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexAdapter } from '../apps/worker/src/runtime';
import { git } from '../apps/worker/src/storage';
import { runProcess } from '../apps/worker/src/process';
import type { Task } from '../packages/agent-runtime/src/types';
async function main(){
  const repo=resolve(process.argv[2]??'.');const root=await mkdtemp(join(tmpdir(),'northside-verifier-'));const directory=join(root,'checkout');const results=[];
  try{const clone=await runProcess('git',['clone','--no-hardlinks','--quiet',repo,directory],{cwd:root,timeoutMs:120000});if(clone.code)throw new Error(clone.output);await mkdir(join(root,'codex-home'));
    const commit=await git(directory,['rev-parse','HEAD']);const adapter=new CodexAdapter({root,repo,codexHome:join(root,'codex-home'),codexBinary:process.env.CODEX_BINARY??'codex',pnpmBinary:process.env.PNPM_BINARY??'pnpm',mode:'codex',credential:'unused',url:'https://invalid.example',concurrency:1,pollMs:5000,maxDiskBytes:10*1024**3,maxLogBytes:5*1024**2,isolatedAccount:true});
    for await(const evidence of adapter.verify({} as Task,directory,new AbortController().signal,commit)){results.push(evidence);console.log(`${evidence.command}: ${evidence.passed?'PASS':'FAIL'}\n${evidence.output.slice(-4000)}`);}
    const evidenceFile=resolve('docs/worker-verifier-evidence.json');await writeFile(evidenceFile,JSON.stringify({at:new Date().toISOString(),commit,node:process.version,results},null,2));if(results.length!==3||results.some(e=>!e.passed))process.exitCode=1;
  }finally{await rm(root,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
