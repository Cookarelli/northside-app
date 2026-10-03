import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runProcess, safeEnvironment } from './process';
import type { WorkerConfig } from './config';
const key=(s:string)=>JSON.stringify(s);
/** Explicit profile; never combine this with legacy --sandbox/sandbox_mode. */
export function codexPolicyArgs(config:Pick<WorkerConfig,'root'|'codexHome'>,access:'read'|'write'='read'):string[] {
  const filesystem=`{ ":root"="deny", ":minimal"="read", "/opt/homebrew"="read", ":tmpdir"="deny", ":slash_tmp"="deny", ${key(config.root)}="deny", ${key(config.codexHome)}="deny", ":workspace_roots"={ "."=${key(access)}, ".git"="deny", ".codex"="deny", ".agents"="deny", "**/.env*"="deny" } }`;
  return ['-c','default_permissions="northside"','-c',`permissions.northside={ filesystem=${filesystem}, network={ enabled=false } }`,'-c','approval_policy="never"','-c','shell_environment_policy.inherit="none"','-c','allow_login_shell=false','-c','web_search="disabled"',...['apps','browser_use','browser_use_external','computer_use','in_app_browser','hooks','plugins','remote_plugin','multi_agent','workspace_dependencies','skill_search','skill_mcp_dependency_install','daemon_auto_start'].flatMap(f=>['--disable',f])];
}
/** Real runs fail closed unless the installed CLI and OS enforce the actual configured policy. */
export async function probeSandbox(config:Pick<WorkerConfig,'root'|'repo'|'codexHome'|'codexBinary'>):Promise<void> {
  for(const path of [join(config.repo,'.codex','config.toml'),'/etc/codex/config.toml']){const content=await readFile(path,'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;});if(content)throw new Error('Real worker requires a configuration-isolated checkout and host; remove inherited Codex project/system config through separately reviewed operator work.');}
  const probe=join(config.root,'sandbox-probe');const workspace=join(probe,'workspace');await mkdir(workspace,{recursive:true,mode:0o700});await mkdir(config.codexHome,{recursive:true,mode:0o700});
  const secret=join(probe,'credential-canary');const auth=join(config.codexHome,'northside-canary');await writeFile(secret,'PRIVATE-CANARY',{mode:0o600});await writeFile(auth,'AUTH-CANARY',{mode:0o600});await writeFile(join(workspace,'visible'),'VISIBLE',{mode:0o600});
  try {
    const script='const fs=require("node:fs"); const [visible,secret,auth,write]=process.argv.slice(1); if(fs.readFileSync(visible,"utf8")!=="VISIBLE")process.exit(20); for(const file of [secret,auth]) {try {fs.readFileSync(file);process.exit(21)}catch(e){if(!["EACCES","EPERM"].includes(e.code))process.exit(22)}} try{fs.writeFileSync(write,"bad");process.exit(23)}catch(e){if(!["EACCES","EPERM"].includes(e.code))process.exit(24)}; console.log("FILESYSTEM_POLICY_VERIFIED")';
    const check=await runProcess(config.codexBinary,['sandbox','-P','northside','-C',workspace,...codexPolicyArgs(config),process.execPath,'-e',script,join(workspace,'visible'),secret,auth,join(workspace,'forbidden-write')],{cwd:workspace,env:{...safeEnvironment(),CODEX_HOME:config.codexHome}});
    if(check.code||!check.output.includes('FILESYSTEM_POLICY_VERIFIED'))throw new Error(`Codex filesystem sandbox probe failed (${check.code}); real execution blocked. ${check.output.slice(-300)}`);
    const verifierScript='const fs=require("node:fs");try{fs.readFileSync(process.argv[1]);process.exit(30)}catch(e){if(!["EACCES","EPERM"].includes(e.code))process.exit(31)} try{process.kill(Number(process.argv[2]),0);process.exit(32)}catch(e){if(e.code!=="EPERM")process.exit(33)} fs.writeFileSync("allowed-write","allowed"); const s=require("node:net").connect({host:"127.0.0.1",port:9});s.on("connect",()=>process.exit(34));s.on("error",e=>{if(e.code!=="EPERM"&&e.code!=="EACCES")process.exit(35);console.log("VERIFIER_POLICY_VERIFIED")}); setTimeout(()=>process.exit(36),3000).unref();';
    const checkVerifier=await runProcess(config.codexBinary,['sandbox','-P','northside','-C',workspace,...codexPolicyArgs(config,'write'),process.execPath,'-e',verifierScript,secret,String(process.pid)],{cwd:workspace,env:{...safeEnvironment(),CODEX_HOME:config.codexHome}});
    if(checkVerifier.code||!checkVerifier.output.includes('VERIFIER_POLICY_VERIFIED'))throw new Error(`Verifier sandbox probe failed (${checkVerifier.code}); real execution blocked. ${checkVerifier.output.slice(-300)}`);
  }finally{await rm(secret,{force:true});await rm(auth,{force:true});}
}
