import { execFileSync } from 'node:child_process';
import { chmod, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
const label='com.northside.supervised-worker';
function xml(s:string){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
async function main(){
  if(process.platform!=='darwin'||process.getuid?.()===0)throw new Error('Use a non-root macOS account. This installs a user LaunchAgent.');
  const uid=process.getuid!();const domain=`gui/${uid}`;const target=`${domain}/${label}`;const dir=join(homedir(),'Library','LaunchAgents');const plist=join(dir,`${label}.plist`);const action=process.argv[2];
  const launch=(args:string[])=>execFileSync('/bin/launchctl',args,{stdio:'inherit'});
  if(action==='install'){
    const repo=resolve(process.cwd());const env=resolve(process.argv[3]??'.runtime/worker.env');const info=await lstat(env);if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077))throw new Error('Worker environment file must be regular, private (chmod 600), and outside Git.');
    await readFile(join(repo,'apps/worker/src/main.ts'));await mkdir(dir,{recursive:true});if(await lstat(plist).catch(()=>null))throw new Error('LaunchAgent already exists; uninstall first to replace its configuration.');
    const args=[process.execPath,`--env-file=${env}`,'--import','tsx',join(repo,'scripts/launchd-run.ts')];
    const text=`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map(a=>`<string>${xml(a)}</string>`).join('')}</array><key>WorkingDirectory</key><string>${xml(repo)}</string><key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(process.env.PATH??'/opt/homebrew/bin:/usr/bin:/bin')}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer><key>ExitTimeOut</key><integer>20</integer><key>ProcessType</key><string>Background</string><key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string></dict></plist>\n`;
    await writeFile(plist,text,{mode:0o600});await chmod(plist,0o600);execFileSync('/usr/bin/plutil',['-lint',plist],{stdio:'inherit'});console.log(`Installed ${plist}. Start with: node --import tsx scripts/launchd.ts start`);return;
  }
  if(action==='start'){try{launch(['bootstrap',domain,plist]);}catch{launch(['print',target]);}launch(['kickstart',target]);return;}
  if(action==='stop'){launch(['bootout',target]);return;}
  if(action==='status'){launch(['print',target]);return;}
  if(action==='uninstall'){try{launch(['bootout',target]);}catch{}await rm(plist,{force:true});console.log('LaunchAgent uninstalled. Credentials, logs, worktrees, and checkpoints preserved.');return;}
  throw new Error('Usage: node --import tsx scripts/launchd.ts install [private-env-file] | start | stop | status | uninstall');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
