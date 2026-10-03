import { mkdir, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Claim } from '@northside/agent-runtime';
import { loadConfig } from './config';
import { CodexAdapter, SimulatedAdapter } from './runtime';
import { executeClaim, HttpTransport } from './runner';
import { cleanupRotatedLogs, diskBytes, WorkerLog } from './storage';
async function main() {
  const config=await loadConfig();const log=new WorkerLog(join(config.root,'logs','worker.log'),config.maxLogBytes);
  if(process.argv.includes('--cleanup')){console.log(`Removed ${await cleanupRotatedLogs(config.root)} old rotated log files. All worktrees and checkpoints preserved.`);return;}
  const lock=join(config.root,'coordinator.lock');try{await mkdir(lock);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;const pid=Number(await readFile(join(lock,'pid'),'utf8').catch(()=>0));if(!pid)throw new Error('Worker lock has no owner; inspect state before removing the lock');try{process.kill(pid,0);throw new Error('Another worker process owns this state directory');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}await rm(lock,{recursive:true});await mkdir(lock);}
  await writeFile(join(lock,'pid'),String(process.pid),{mode:0o600});
  const stop=new AbortController();const quit=()=>stop.abort();process.once('SIGINT',quit);process.once('SIGTERM',quit);
  const jobs=new Set<Promise<void>>();const transport=new HttpTransport(config);const adapter=config.mode==='simulated'?new SimulatedAdapter():new CodexAdapter(config);
  try {
    if(adapter instanceof CodexAdapter)await adapter.preflight();
    await log.write(`${config.mode==='simulated'?'SIMULATED fixture worker':'Codex worker'} starting; concurrency ${config.concurrency}`);
    while(!stop.signal.aborted){try{
      await transport.call('poll',{mode:config.mode});
      const bytes=await diskBytes(config.root);const disk=await statfs(config.root);if(bytes>config.maxDiskBytes||disk.bavail*disk.bsize<1024**3){await log.write('Disk budget or 1 GiB free-space reserve reached. Stopping active jobs and new claims; all worktrees preserved.');stop.abort();}
      else while(jobs.size<config.concurrency&&!stop.signal.aborted){const claim=await transport.call<Claim|null>('claim',{mode:config.mode});if(!claim)break;const job=executeClaim(claim,adapter,transport,config,stop.signal,log);jobs.add(job);void job.finally(()=>jobs.delete(job));}
    }catch(error){await log.write(`Worker connection unavailable: ${(error as Error).message}`);}
      if(process.argv.includes('--once')){await Promise.allSettled(jobs);break;}
      await sleep(config.pollMs,undefined,{signal:stop.signal}).catch(()=>{});
    }
    stop.abort();await Promise.allSettled(jobs);
  }finally{await log.write('Worker stopped');await rm(lock,{recursive:true,force:true});process.removeListener('SIGINT',quit);process.removeListener('SIGTERM',quit);}
}
main().catch(error=>{console.error(`Northside worker stopped: ${(error as Error).message}`);process.exitCode=1;});
