import { appendFile, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { redact } from '@northside/agent-runtime';
import { runProcess } from './process';
export async function saveJson(path:string,value:unknown) {await mkdir(dirname(path),{recursive:true,mode:0o700});const tmp=`${path}.tmp`;await writeFile(tmp,JSON.stringify(value,null,2),{mode:0o600});await rename(tmp,path);}
export async function diskBytes(path:string):Promise<number> {let total=0;for(const e of await readdir(path,{withFileTypes:true})){const p=join(path,e.name);if(e.isSymbolicLink())continue;if(e.isDirectory())total+=await diskBytes(p);else total+=(await stat(p)).size;}return total;}
export class WorkerLog {
  private pending:Promise<void>=Promise.resolve();
  constructor(private path:string,private maxBytes=5*1024*1024){}
  write(message:string):Promise<void> {this.pending=this.pending.then(async()=>{await mkdir(dirname(this.path),{recursive:true,mode:0o700});const size=await stat(this.path).then(x=>x.size).catch(()=>0);if(size>=this.maxBytes){await rm(`${this.path}.3`,{force:true});for(let i=2;i>=1;i--)await rename(`${this.path}.${i}`,`${this.path}.${i+1}`).catch(()=>{});await rename(this.path,`${this.path}.1`).catch(()=>{});}await appendFile(this.path,`${new Date().toISOString()} ${redact(message).slice(0,2000)}\n`,{mode:0o600});}).catch(()=>{});return this.pending;}
}
/** Explicit cleanup only. Never remove worktrees, branches, reports, or checkpoints. */
export async function cleanupRotatedLogs(root:string,olderThanMs=7*86400000):Promise<number> {let removed=0;const logs=join(root,'logs');for(const e of await readdir(logs,{withFileTypes:true}).catch(()=>[])){if(!e.isFile()||!/^worker\.log\.[1-3]$/.test(e.name))continue;const p=join(logs,e.name);const s=await lstat(p);if(Date.now()-s.mtimeMs>olderThanMs){await rm(p);removed++;}}return removed;}
export async function readJson<T>(path:string):Promise<T|null> {try{return JSON.parse(await readFile(path,'utf8')) as T;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}}
export async function git(repo:string,args:string[],signal?:AbortSignal):Promise<string> {const r=await runProcess('git',args,{cwd:repo,signal});if(r.code)throw new Error(`Git operation failed: ${r.output.slice(-500)}`);return r.output.trim();}
export async function createWorktree(repo:string,root:string,taskId:string,attempt:number,signal?:AbortSignal) {if(!/^[a-f0-9-]{36}$/.test(taskId)||!Number.isInteger(attempt))throw new Error('Invalid worktree identity');const branch=`agent/${taskId}/attempt-${attempt}`;const directory=resolve(root,'worktrees',`${taskId}-${attempt}`);await mkdir(dirname(directory),{recursive:true,mode:0o700});const baseCommit=await git(repo,['rev-parse','HEAD'],signal);await git(repo,['worktree','add','-b',branch,directory,baseCommit],signal);return {branch,directory,baseCommit};}
/** Snapshot installed, trusted dependencies into the isolated checkout; never verify against main-branch workspace links. */
export async function snapshotDependencies(repo:string,work:string):Promise<void> {
  const {cp,readlink}=await import('node:fs/promises');const {constants}=await import('node:fs');
  if(await stat(join(work,'node_modules')).then(()=>true).catch(()=>false))return;
  const paths=['node_modules'];
  for(const group of ['apps','packages'])for(const entry of await readdir(join(repo,group),{withFileTypes:true}).catch(()=>[]))if(entry.isDirectory())paths.push(`${group}/${entry.name}/node_modules`);
  for(const path of paths){const source=join(repo,path);if(!(await stat(source).catch(()=>null))?.isDirectory())continue;await mkdir(dirname(join(work,path)),{recursive:true});await cp(await realpath(source),join(work,path),{recursive:true,verbatimSymlinks:true,mode:constants.COPYFILE_FICLONE});}
  const inspect=async(path:string):Promise<void>=>{for(const entry of await readdir(path,{withFileTypes:true})){const file=join(path,entry.name);if(entry.isSymbolicLink()){const target=resolve(dirname(file),await readlink(file));if(target!==work&&!target.startsWith(`${work}/`))throw new Error('Dependency snapshot contains an external link; operator provisioning required');}else if(entry.isDirectory())await inspect(file);}};
  for(const path of paths)if((await stat(join(work,path)).catch(()=>null))?.isDirectory())await inspect(join(work,path));
}
