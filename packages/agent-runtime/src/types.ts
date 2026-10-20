export type TaskState = 'queued'|'running'|'awaiting_review'|'verifying'|'blocked'|'ready_for_approval'|'failed'|'cancelled'|'complete';
export type BuilderRole = 'shopify_engineer'|'experience_engineer';
export interface Finding { id:string; severity:'info'|'warning'|'error'; message:string; file?:string; resolved?:boolean }
export interface Evidence { id:string; command:string; commit:string; passed:boolean; startedAt:number; finishedAt:number; output:string; simulated:boolean }
export interface Usage { inputTokens:number|null; outputTokens:number|null; costUsd:number|null; source:'reported'|'unknown'|'simulated' }
export interface Task {
  id:string; projectId:string; title:string; description:string; acceptanceCriteria:string; role:BuilderRole;
  state:TaskState; priority:number; dependencies:string[]; mode:'simulated'|'codex'; createdAt:number; updatedAt:number;
  attempt:number; maxAttempts:number; maxRuntimeSeconds:number; maxModelRuns:number; maxTokens:number; modelRuns:number;
  executionId?:string; workerId?:string; leaseUntil?:number; heartbeatAt?:number; fence:number;
  branch?:string; baseCommit?:string; commit?:string; pullRequestUrl?:string;
  findings:Finding[]; evidence:Evidence[]; usage:Usage; error?:string; fixCycles:number;
  cancelRequestedAt?:number; approval?:{issuer:string;commit:string;evidenceIds:string[];at:number;simulated:boolean};
  executions:ExecutionRecord[];
}
export interface ExecutionRecord {id:string;role:'builder'|'reviewer'|'verifier';startedAt:number;finishedAt?:number;simulated:boolean;commit?:string}
export interface Project {id:string;name:string;paused:boolean}
export interface PublicWorker {id:string;name:string;registeredAt:number;lastHeartbeatAt?:number;revokedAt?:number;online:boolean;mode?:'simulated'|'codex';activeTaskIds:string[]}
export interface ControlEvent {id:string;at:number;type:string;message:string;taskId?:string;issuer?:string;simulated?:boolean}
export interface CommandRecord {id:string;type:string;issuer:string;requestedAt:number;acknowledgedAt?:number;completedAt?:number;taskId?:string;projectId?:string;status:'pending'|'acknowledged'|'complete';result?:string}
export interface ControlSnapshot { projects:Project[];tasks:Task[];workers:PublicWorker[];events:ControlEvent[];commands:CommandRecord[];paused:boolean;mergeEnabled:false;deploymentEnabled:false;serverTime:number }
export interface CreateTaskInput {projectId?:string;title:string;description:string;acceptanceCriteria:string;role?:BuilderRole;priority?:number;dependencies?:string[];mode?:'simulated'|'codex';maxAttempts?:number;maxRuntimeSeconds?:number;maxModelRuns?:number;maxTokens?:number}
export type ControlCommand =
 |{type:'pause_all'|'resume_all'}
 |{type:'pause_project'|'resume_project';projectId:string}
 |{type:'cancel'|'retry';taskId:string}
 |{type:'reprioritize';taskId:string;priority:number}
 |{type:'approve';taskId:string;commit:string;evidenceIds:string[]};
export interface Lease {taskId:string;executionId:string;fence:number}
export interface WorkerPoll {paused:boolean;cancelTaskIds:string[];serverTime:number}
export interface Claim {task:Task;lease:Lease;leaseMs:number}
export interface WorkerReport extends Lease {
  kind:'progress'|'ready'|'failed'|'blocked'|'cancelled';
  state?:'running'|'awaiting_review'|'verifying';branch?:string;baseCommit?:string;commit?:string;
  execution?:ExecutionRecord;finding?:Finding;evidence?:Evidence;usage?:Usage;modelRuns?:number;fixCycles?:number;error?:string;
}
