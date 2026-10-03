import { statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Claim } from '@northside/agent-runtime';
import { loadConfig } from './config';
import { CodexAdapter, SimulatedAdapter } from './runtime';
import { executeClaim, HttpTransport } from './runner';
import { cleanupRotatedLogs, diskBytes, WorkerLog } from './storage';
import { acquireCoordinatorLock, reconnectDelayMs, writeHealth, type WorkerHealth } from './service';
async function main() {
  const config=await loadConfig();const log=new WorkerLog(join(config.root,'logs','worker.log'),config.maxLogBytes);
  if(process.argv.includes('--cleanup')){console.log(`Removed ${await cleanupRotatedLogs(config.root)} old rotated log files. All worktrees and checkpoints preserved.`);return;}
  const lock=await acquireCoordinatorLock(config.root);
  const stop=new AbortController();const quit=()=>stop.abort();process.once('SIGINT',quit);process.once('SIGTERM',quit);
  lock.signal.addEventListener('abort',quit,{once:true});if(lock.signal.aborted)quit();
  const jobs=new Set<Promise<void>>();const transport=new HttpTransport(config);const adapter=config.mode==='simulated'?new SimulatedAdapter():new CodexAdapter(config);
  const health:WorkerHealth={version:1,pid:process.pid,mode:config.mode,status:'starting',startedAt:Date.now(),updatedAt:Date.now(),lastPollAt:null,activeJobs:0,consecutiveFailures:0,pollMs:config.pollMs};
  const update=async(status:WorkerHealth['status'],reason?:string)=>{Object.assign(health,{status,updatedAt:Date.now(),activeJobs:jobs.size,effectivePollMs:reconnectDelayMs(config.pollMs,health.consecutiveFailures),reason});await writeHealth(config.root,health);};
  try {
    await update('starting');
    if(adapter instanceof CodexAdapter)await adapter.preflight();
    await log.write(`${config.mode==='simulated'?'SIMULATED fixture worker':'Codex worker'} starting; concurrency ${config.concurrency}`);
    while(!stop.signal.aborted){try{
      await transport.call('poll',{mode:config.mode});
      health.lastPollAt=Date.now();
      const bytes=await diskBytes(config.root);const disk=await statfs(config.root);if(bytes>config.maxDiskBytes||disk.bavail*disk.bsize<1024**3){await log.write('Disk budget or 1 GiB free-space reserve reached. Stopping active jobs and new claims; all worktrees preserved.');stop.abort();}
      else while(jobs.size<config.concurrency&&!stop.signal.aborted){const claim=await transport.call<Claim|null>('claim',{mode:config.mode});if(!claim)break;const job=executeClaim(claim,adapter,transport,config,stop.signal,log);jobs.add(job);void job.then(()=>jobs.delete(job),()=>jobs.delete(job));}
      health.consecutiveFailures=0;await update(stop.signal.aborted?'stopping':'online');
    }catch(error){health.consecutiveFailures++;await log.write(`Worker connection unavailable: ${(error as Error).message}`);await update('degraded','Control plane unavailable; retrying');}
      if(process.argv.includes('--once')){await Promise.allSettled(jobs);break;}
      await sleep(health.effectivePollMs??config.pollMs,undefined,{signal:stop.signal}).catch(()=>{});
    }
    stop.abort();await Promise.allSettled(jobs);
  }catch(error){await update('blocked','Startup or service verification failed; inspect private worker logs');throw error;}
  finally{stop.abort();try{await Promise.allSettled(jobs);await log.write('Worker stopped');if(health.status!=='blocked')await update('stopped');}finally{await lock.release();lock.signal.removeEventListener('abort',quit);process.removeListener('SIGINT',quit);process.removeListener('SIGTERM',quit);}}
}
main().catch(error=>{console.error(`Northside worker stopped: ${(error as Error).message}`);process.exitCode=1;});
