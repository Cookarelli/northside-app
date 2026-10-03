import { execFileSync } from 'node:child_process';
import { chmod, lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { renderLaunchAgent, validateLaunchEnvironment, workerLabel as label } from './launchd-config';
import { readHealth } from '../apps/worker/src/service';
async function main(){
  if(process.platform!=='darwin'||process.getuid?.()===0)throw new Error('Use a non-root macOS account. This installs a user LaunchAgent.');
  const uid=process.getuid!();const domain=`gui/${uid}`;const target=`${domain}/${label}`;const dir=join(homedir(),'Library','LaunchAgents');const plist=join(dir,`${label}.plist`);const action=process.argv[2];
  const launch=(args:string[])=>execFileSync('/bin/launchctl',args,{stdio:'inherit'});
  if(action==='health'){const report=await readHealth(resolve(process.argv[3]??process.env.WORKER_STATE_DIR??'.runtime/worker'));console.log(JSON.stringify(report,null,2));if(!report.healthy)process.exitCode=1;return;}
  if(action==='install'||action==='prepare'){
    const {repo,envFile}=await validateLaunchEnvironment(process.cwd(),process.argv[3]??'.runtime/worker.env');
    const destination=action==='prepare'?resolve(process.argv[4]??'.runtime/prepared-worker.plist'):plist;
    await mkdir(dirname(destination),{recursive:true,mode:0o700});if(await lstat(destination).catch(()=>null))throw new Error('Destination already exists; inspect and explicitly remove it before replacing configuration');
    await writeFile(destination,renderLaunchAgent(repo,envFile,process.execPath),{mode:0o600,flag:'wx'});await chmod(destination,0o600);execFileSync('/usr/bin/plutil',['-lint',destination],{stdio:'inherit'});
    console.log(action==='prepare'?`Prepared ${destination}. No service installed or started.`:`Installed ${destination}. Start with: node --import tsx scripts/launchd.ts start`);return;
  }
  if(action==='start'){try{launch(['bootstrap',domain,plist]);}catch{launch(['print',target]);}launch(['kickstart',target]);return;}
  if(action==='stop'){launch(['bootout',target]);return;}
  if(action==='status'){launch(['print',target]);return;}
  if(action==='uninstall'){try{launch(['bootout',target]);}catch{}await rm(plist,{force:true});console.log('LaunchAgent uninstalled. Credentials, logs, worktrees, and checkpoints preserved.');return;}
  throw new Error('Usage: node --import tsx scripts/launchd.ts prepare [private-env-file] [output.plist] | install [private-env-file] | start | stop | status | health [state-dir] | uninstall');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
