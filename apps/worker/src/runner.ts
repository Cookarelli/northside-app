import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { Claim, Finding, Usage, WorkerReport } from '@northside/agent-runtime';
import type { RuntimeAdapter } from './runtime';
import type { WorkerConfig } from './config';
import { createWorktree, saveJson, WorkerLog } from './storage';
export interface WorkerTransport {call<T>(action:'poll'|'claim'|'heartbeat'|'report',input?:unknown):Promise<T>}
export class HttpTransport implements WorkerTransport {
  constructor(private config:Pick<WorkerConfig,'url'|'credential'|'vercelBypass'>){if(config.vercelBypass&&(new URL(config.url).protocol!=='https:'||new URL(config.url).origin!==config.url))throw new Error('Deployment-protection bypass requires the exact HTTPS control origin');}
  async call<T>(action:'poll'|'claim'|'heartbeat'|'report',input:unknown={}):Promise<T> {const headers:Record<string,string>={'content-type':'application/json',authorization:`Bearer ${this.config.credential}`};if(this.config.vercelBypass)headers['x-vercel-protection-bypass']=this.config.vercelBypass;const response=await fetch(`${this.config.url}/api/worker/${action}`,{method:'POST',headers,body:JSON.stringify(input),redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error(`Control plane rejected ${action} (${response.status})`);return await response.json() as T;}
}
export async function executeClaim(claim:Claim,adapter:RuntimeAdapter,transport:WorkerTransport,config:Pick<WorkerConfig,'root'|'repo'>,stop:AbortSignal,log:WorkerLog):Promise<void> {
  const task=structuredClone(claim.task);const controller=new AbortController();let cancellation=false;let leaseLost=false;let heartbeatBusy=false;let ended=false;let latest:{kind:string;commit?:string;at:number}={kind:'claimed',at:Date.now()};
  const journal=join(config.root,'journals',`${claim.lease.executionId}.json`);
  const report=async(fields:Omit<WorkerReport,keyof Claim['lease']>)=>{controller.signal.throwIfAborted();latest={kind:fields.kind,commit:fields.commit??task.commit,at:Date.now()};await saveJson(journal,{taskId:task.id,lease:claim.lease,...latest});await transport.call('report',{...claim.lease,...fields});};
  const onStop=()=>controller.abort(new Error('Worker is stopping'));stop.addEventListener('abort',onStop,{once:true});if(stop.aborted)onStop();
  const timeout=setTimeout(()=>controller.abort(new Error('Task wall-clock budget exhausted')),task.maxRuntimeSeconds*1000);timeout.unref();
  const timer=setInterval(async()=>{if(heartbeatBusy||ended)return;heartbeatBusy=true;try{const h=await transport.call<{cancel:boolean}>('heartbeat',claim.lease);if(h.cancel){cancellation=true;controller.abort(new Error('Cancellation requested'));}}catch{leaseLost=true;controller.abort(new Error('Lease heartbeat failed; stop until reconciliation'));}finally{heartbeatBusy=false;}},Math.max(250,Math.floor(claim.leaseMs/3)));timer.unref();
  let modelRuns=task.modelRuns;let total:Usage=task.usage;const addUsage=(u:Usage)=>{total={inputTokens:total.inputTokens===null&&modelRuns>1?null:u.inputTokens===null?null:(total.inputTokens??0)+u.inputTokens,outputTokens:total.outputTokens===null&&modelRuns>1?null:u.outputTokens===null?null:(total.outputTokens??0)+u.outputTokens,costUsd:total.costUsd===null||u.costUsd===null?null:total.costUsd+u.costUsd,source:u.source==='simulated'?'simulated':u.source==='reported'&&(modelRuns===1||total.inputTokens!==null)?'reported':'unknown'};};
  const checkBudget=()=>{if(modelRuns>=task.maxModelRuns)throw new Error('Model run budget exhausted');if((total.inputTokens??0)+(total.outputTokens??0)>=task.maxTokens)throw new Error('Reported token budget exhausted');};
  try {
    let directory=join(config.root,'simulated',task.id,`attempt-${task.attempt}`);
    if(adapter.mode==='codex'){const work=await createWorktree(config.repo,config.root,task.id,task.attempt,controller.signal);directory=work.directory;task.baseCommit=work.baseCommit;task.branch=work.branch;await report({kind:'progress',branch:work.branch,baseCommit:work.baseCommit});}else{await mkdir(directory,{recursive:true,mode:0o700});task.branch=`SIMULATED/${task.id}`;await report({kind:'progress',branch:task.branch});}
    let findings:Finding[]=task.findings.filter(f=>!f.resolved);
    for(let cycle=task.fixCycles;cycle<=2;cycle++){
      checkBudget();modelRuns++;const build={id:randomUUID(),role:'builder' as const,startedAt:Date.now(),simulated:adapter.mode==='simulated'};await report({kind:'progress',state:'running',execution:build,modelRuns,fixCycles:cycle});
      const built=await adapter.build(task,directory,controller.signal,cycle,findings);task.commit=built.commit;addUsage(built.usage);await report({kind:'progress',state:'awaiting_review',commit:built.commit,execution:{...build,finishedAt:Date.now(),commit:built.commit},usage:total});
      checkBudget();modelRuns++;const review={id:randomUUID(),role:'reviewer' as const,startedAt:Date.now(),simulated:adapter.mode==='simulated',commit:built.commit};await report({kind:'progress',execution:review,modelRuns});
      const reviewed=await adapter.review(task,directory,controller.signal,built.commit);addUsage(reviewed.usage);await report({kind:'progress',execution:{...review,finishedAt:Date.now()},usage:total});
      for(const prior of findings)if(!reviewed.findings.some(f=>f.message.toLowerCase()===prior.message.toLowerCase()&&f.file===prior.file))await report({kind:'progress',finding:{...prior,resolved:true}});
      findings=reviewed.findings;for(const finding of findings)await report({kind:'progress',finding});
      if(findings.some(f=>f.severity==='error')){if(cycle===2)throw new Error('Two fix/review cycles exhausted; operator escalation required');continue;}
      const verifier={id:randomUUID(),role:'verifier' as const,startedAt:Date.now(),simulated:adapter.mode==='simulated',commit:built.commit};await report({kind:'progress',state:'verifying',execution:verifier});let passed=true;
      for await(const evidence of adapter.verify(task,directory,controller.signal,built.commit)){await report({kind:'progress',evidence});if(!evidence.passed){passed=false;findings.push({id:evidence.id,severity:'error',message:`Verification failed: ${evidence.command}. ${evidence.output.slice(-1500)}`});}}
      await report({kind:'progress',execution:{...verifier,finishedAt:Date.now()}});
      if(!passed){for(const finding of findings)await report({kind:'progress',finding});if(cycle===2)throw new Error('Verification still fails after two fix cycles');continue;}
      await report({kind:'ready'});ended=true;await saveJson(journal,{taskId:task.id,lease:claim.lease,status:'ready_for_approval',commit:built.commit,at:Date.now(),simulated:adapter.mode==='simulated'});await log.write(`${adapter.mode==='simulated'?'SIMULATED ':''}Task ${task.id} ready for approval`);return;
    }
  } catch(error) {
    const message=error instanceof Error?error.message:'Execution failed';const kind=cancellation?'cancelled':controller.signal.aborted||/budget|cycles|escalation/i.test(message)?'blocked':'failed';
    if(!leaseLost)try{await transport.call('report',{...claim.lease,kind,error:message});}catch{leaseLost=true;}
    await saveJson(journal,{taskId:task.id,lease:claim.lease,status:leaseLost?'uncertain':kind,error:message,checkpoint:latest,at:Date.now()});await log.write(`Task ${task.id}: ${leaseLost?'uncertain':kind}; ${message}`);
  } finally {ended=true;clearInterval(timer);clearTimeout(timeout);stop.removeEventListener('abort',onStop);}
}
