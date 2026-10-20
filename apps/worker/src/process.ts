import { spawn } from 'node:child_process';
import { redact } from '@northside/agent-runtime';
export interface ProcessResult {code:number;output:string;elapsedMs:number}
/** Only explicit local policy calls this function. Never accept executable/arguments from a task. */
export function runProcess(executable:string,args:string[],options:{cwd:string;env?:NodeJS.ProcessEnv;signal?:AbortSignal;input?:string;timeoutMs?:number;maxBytes?:number;captureBytes?:number;onLine?:(line:string)=>void}):Promise<ProcessResult> {
  return new Promise((resolve,reject)=>{
    const start=Date.now();let output='';let line='';let bytes=0;let forced:string|undefined;
    const child=spawn(executable,args,{cwd:options.cwd,env:options.env??safeEnvironment(),stdio:['pipe','pipe','pipe'],shell:false,detached:process.platform!=='win32'});
    const kill=()=>{try{if(child.pid&&process.platform!=='win32')process.kill(-child.pid,'SIGTERM');else child.kill('SIGTERM');}catch{}const hard=setTimeout(()=>{try{if(child.pid&&process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}},2000);hard.unref();};
    const abort=()=>{forced='Cancelled';kill();};options.signal?.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(()=>{forced='Process timeout';kill();},options.timeoutMs??120000);timeout.unref();
    const receive=(data:Buffer)=>{bytes+=data.length;if(bytes>(options.maxBytes??2_000_000)){forced='Process output limit';kill();return;}const text=data.toString('utf8');output+=text;if(options.onLine){line+=text;let index;while((index=line.indexOf('\n'))>=0){options.onLine(line.slice(0,index));line=line.slice(index+1);}}};
    child.stdout.on('data',receive);child.stderr.on('data',receive);
    child.once('error',e=>{clearTimeout(timeout);options.signal?.removeEventListener('abort',abort);reject(e);});
    child.once('close',code=>{clearTimeout(timeout);options.signal?.removeEventListener('abort',abort);if(forced)reject(new Error(forced));else resolve({code:code??1,output:redact(output).slice(-(options.captureBytes??24000)),elapsedMs:Date.now()-start});});
    child.stdin.end(options.input??'');if(options.signal?.aborted)abort();
  });
}
export function safeEnvironment():NodeJS.ProcessEnv {return {NODE_ENV:'production',PATH:process.env.PATH??'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',HOME:process.env.HOME,TMPDIR:process.env.TMPDIR??'/tmp',LANG:'en_US.UTF-8',CI:'1',NEXT_TELEMETRY_DISABLED:'1',GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.hooksPath',GIT_CONFIG_VALUE_0:'/dev/null'};}
