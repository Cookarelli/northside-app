import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { WorkerLog } from '../apps/worker/src/storage';
import { safeEnvironment } from '../apps/worker/src/process';
const root=resolve(process.env.WORKER_STATE_DIR??'.runtime/worker');const log=new WorkerLog(join(root,'logs','worker.log'));
const configKeys=['CONTROL_PLANE_URL','CODEX_BINARY','PNPM_BINARY'];
const env={...safeEnvironment(),...Object.fromEntries(Object.entries(process.env).filter(([k])=>k.startsWith('WORKER_')||configKeys.includes(k)))};
const child=spawn(process.execPath,['--import','tsx','apps/worker/src/main.ts'],{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});
for(const stream of [child.stdout,child.stderr]){let pending='';stream.on('data',chunk=>{pending+=chunk.toString();let i;while((i=pending.indexOf('\n'))>=0){void log.write(pending.slice(0,i));pending=pending.slice(i+1);}if(pending.length>4000){void log.write(pending);pending='';}});stream.on('end',()=>{if(pending)void log.write(pending);});}
process.once('SIGTERM',()=>child.kill('SIGTERM'));process.once('SIGINT',()=>child.kill('SIGINT'));
child.once('error',e=>{void log.write(`Worker process failed: ${e.message}`);process.exitCode=1;});child.once('exit',code=>{process.exitCode=code??1;});
