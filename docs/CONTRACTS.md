# Builder contracts
Root owns scaffold, packages/data, apps/control, scripts/dev.ts and setup-local.ts.
Commerce builder owns apps/customer, packages/domain commerce exports, packages/shopify, apps/shopify-extension, tests/commerce*, scripts/generate-qr.ts, docs/commerce*.
Worker builder owns apps/worker, packages/agent-runtime, tests/worker*, scripts/launchd*, docs/worker*, docs/roles*.
Persistence import @northside/data: interface Store { read<T>(namespace:string, init:()=>T):Promise<T>; transact<T,R>(namespace:string,init:()=>T,fn:(state:T)=>R):Promise<R> }; getStore():Store, MemoryStore for tests. Mutators are synchronous; never await network inside transactions. Transactions atomically serialize per namespace. Local SQLite WAL, hosted Postgres row lock. Namespace commerce/control.
Auth shared exports: requireRole(request:Request, role:'operator'|'staff'):Promise<{id:string;role:string}>; login(request:Request,role):Promise<Response>; logout(request:Request,role):Promise<Response>; assertSameOrigin(request:Request):void. Request body login {password}. Cookie sessions separate operator/staff. Configure OPERATOR_PASSWORD and STAFF_PASSWORD separately; generated local setup credentials in ignored file.
Errors: throw Error with safe public message, optionally status number. Root API catches unknown errors generically.
