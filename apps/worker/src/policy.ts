import { lstat, mkdir, realpath, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { BuilderRole } from '@northside/agent-runtime';
export interface FileChange {path:string;content:string|null}
const owned:Record<BuilderRole,string[]>={shopify_engineer:['packages/domain/src/','packages/shopify/src/','apps/shopify-extension/src/','tests/commerce'],experience_engineer:['apps/customer/app/','apps/customer/components/','apps/customer/public/','tests/commerce']};
export function validateChanges(input:unknown,role:BuilderRole):FileChange[] {
  if(!Array.isArray(input)||input.length>20)throw new Error('At most 20 file changes are allowed');let bytes=0;
  return input.map(value=>{
    if(!value||typeof value!=='object')throw new Error('Invalid file proposal');const {path,content}=value as FileChange;
    if(typeof path!=='string'||path.length>240||isAbsolute(path)||path.includes('\\')||path.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.'))||!owned[role].some(p=>path.startsWith(p))||/(?:^|\/)(?:api|auth|credentials?|security|middleware|proxy)(?:[/.]|$)/i.test(path)||/(?:AGENTS\.md|SKILL\.md|package\.json|lock|\.rules$|\.config\.|\.env)/i.test(path)||! /\.(?:tsx?|jsx?|css|md|json|svg)$/.test(path))throw new Error(`Protected or unowned file proposal: ${typeof path==='string'?path:'invalid path'}`);
    if(content!==null&&(typeof content!=='string'||Buffer.byteLength(content)>65536))throw new Error('File proposal too large');bytes+=content===null?0:Buffer.byteLength(content);if(bytes>512000)throw new Error('Change set too large');return {path,content};
  });
}
/** Read-only model output is never executed. Only policy-validated text is applied here. */
export async function applyChanges(directory:string,changes:FileChange[]):Promise<void> {
  const root=await realpath(directory);
  for(const change of changes){const path=resolve(root,change.path);if(relative(root,path).startsWith(`..${sep}`))throw new Error('Path escape');let cursor=root;for(const part of change.path.split('/')){cursor=resolve(cursor,part);const s=await lstat(cursor).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(s?.isSymbolicLink())throw new Error('Symlinks cannot be edited');}if(change.content===null)await unlink(path);else{await mkdir(dirname(path),{recursive:true});await writeFile(path,change.content,{mode:0o644});}}
}
