import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
export interface WorkerConfig {url:string;credential:string;mode:'simulated'|'codex';concurrency:number;root:string;repo:string;codexBinary:string;codexHome:string;pollMs:number;maxDiskBytes:number;maxLogBytes:number;pnpmBinary:string;isolatedAccount:boolean}
export function controlUrl(value:string,allowLocal=false):string {
  const u=new URL(value);if(u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('Control plane URL must be an origin');
  if(u.protocol!=='https:'&&!(allowLocal&&u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw new Error('Worker requires HTTPS (explicit localhost development exception only)');
  return u.origin;
}
function integer(s:string|undefined,fallback:number,min:number,max:number):number {const n=s===undefined?fallback:Number(s);if(!Number.isInteger(n)||n<min||n>max)throw new Error('Invalid worker numeric configuration');return n;}
export async function loadConfig():Promise<WorkerConfig> {
  if(process.getuid?.()===0)throw new Error('Do not run coding workers as root');
  const secretPath=process.env.WORKER_CREDENTIAL_FILE;if(!secretPath)throw new Error('WORKER_CREDENTIAL_FILE is required; register a worker from Mission Control');
  const info=await lstat(secretPath);if(info.isSymbolicLink()||!info.isFile()||(info.mode&0o077)!==0||(process.getuid&&info.uid!==process.getuid()))throw new Error('Worker credential must be a regular file with mode 600');
  const credential=(await readFile(secretPath,'utf8')).trim();if(!/^nsw_[A-Za-z0-9_-]{43}$/.test(credential))throw new Error('Invalid worker credential file');
  const mode=process.env.WORKER_ADAPTER??'simulated';if(!['simulated','codex'].includes(mode))throw new Error('Unknown worker adapter');
  const root=resolve(process.env.WORKER_STATE_DIR??'.runtime/worker');await mkdir(root,{recursive:true,mode:0o700});
  const repo=await realpath(resolve(process.env.WORKER_REPO??'.'));if(root===repo)throw new Error('Worker state and repository must be separate directories');
  return {url:controlUrl(process.env.CONTROL_PLANE_URL??'http://localhost:3101',process.env.WORKER_ALLOW_LOCALHOST==='1'),credential,mode:mode as WorkerConfig['mode'],concurrency:integer(process.env.WORKER_CONCURRENCY,1,1,2),root,repo,codexBinary:process.env.CODEX_BINARY??'codex',codexHome:resolve(process.env.WORKER_CODEX_HOME??'.runtime/codex-home'),pnpmBinary:process.env.PNPM_BINARY??'pnpm',pollMs:integer(process.env.WORKER_POLL_MS,5000,1000,60000),maxDiskBytes:integer(process.env.WORKER_MAX_DISK_MB,10240,100,102400)*1024*1024,maxLogBytes:integer(process.env.WORKER_MAX_LOG_MB,5,1,100)*1024*1024,isolatedAccount:process.env.WORKER_ISOLATED_ACCOUNT==='1'};
}
