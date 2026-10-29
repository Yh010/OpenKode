import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenKodeAgent } from "../src/agent/OpenKodeAgent.js";
import type { LLMProvider } from "../src/llm/interface/LLMProvider.js";
import type { TelemetryInterface } from "../src/telemetry/TelemetryInterface.js";
import { createPlannerMessages, createCoderMessages } from "../src/llm/prompts/workerMessages.js";
import type { Delegate } from "../src/agent/interface/OrchestratorResponsetypes.js";
import { OllamaProvider } from "../src/llm/providers/OllamaProvider.js";

async function inProject(action:(root:string)=>Promise<void>) {
    const previous=process.cwd(),root=await mkdtemp(path.join(os.tmpdir(),"openkode-mutation-"));
    try {process.chdir(root);await action(root);}
    finally {
        process.chdir(previous);
        assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith("openkode-mutation-"));
        await rm(root,{recursive:true,force:true});
    }
}
function recordingTelemetry() {
    const facts:Record<string,unknown>[]=[];
    const telemetry:TelemetryInterface={
        async withRun(_name,operation){return operation();},
        async withSpan(_type,_name,operation,details){const result=await operation();const runtime=details?.(result)?.metadata?.runtime;if(runtime)facts.push(runtime as Record<string,unknown>);return result;},
        async shutdown(){},
    };
    return {telemetry,facts};
}
const plan=(description:string,file="yash.ts")=>({type:"plan",summary:description,steps:[{id:"change",description,files:[file],acceptanceCriteria:[description]}],verification:[],risks:[]});
const completed={type:"completed",summary:"Done",verification:[],risks:[]};
const discover={type:"tool_call",toolName:"GlobTool",pattern:"**/yash.ts"};
const read={type:"tool_call",toolName:"ReadFileTool",fileToRead:"yash.ts"};

test("create then edit in the same chat rejects the stale orchestrator write and preserves unrelated contents", async()=>{
    await inProject(async root=>{
        const {telemetry,facts}=recordingTelemetry();
        let phase="create";
        const createPlan=[discover,plan("Create yash.ts containing yash")];
        const editPlan=[discover,read,plan("Replace yash with ananya in yash.ts; preserve all other text")];
        const createCode=[{type:"tool_call",toolName:"WriteFileTool",path:"yash.ts",content:"yash"},completed];
        const editCode=[{type:"tool_call",toolName:"WriteFileTool",path:"yash.ts",content:"yash"},
            {type:"tool_call",toolName:"EditFileTool",path:"yash.ts",oldText:'"yash"',newText:'"ananya"'},completed];
        const llm={
            generateForOrchestrator:async({messages}:any)=>{
                const latest=JSON.parse(messages.at(-1).content);
                assert.match(latest.request,phase==="create"?/create a new file/:/edit the name/);
                assert.equal(latest.conversation,undefined);
                // Reproduce exactly the old, stale proposal from the user's trace.
                return {type:"tool_call",toolName:"WriteFileTool",fileToWrite:"yash.ts",content:"yash"};
            },
            generateForPlanner:async(request:Delegate)=>{
                if(phase==="edit") {
                    assert.deepEqual(request.context?.requestedNewFiles,[],"An existing edit target must not be authorized for whole-file creation");
                    assert.deepEqual(request.context?.conversation,[],"Unrelated old tasks must not compete with an explicit current task");
                }
                return (phase==="create"?createPlan:editPlan).shift();
            },
            generateForCoder:async(request:Delegate)=>{
                if(phase==="edit") assert.ok(request.context?.sourceFiles?.["yash.ts"]?.includes("// preserve this"));
                return (phase==="create"?createCode:editCode).shift();
            },
        } as unknown as LLMProvider;
        const agent=new OpenKodeAgent(llm,telemetry);
        const question='create a new file yash.ts in the root and write "yash" in it';
        const created=await agent.run({prompt:question,chatId:"same-chat"},()=>{});
        assert.equal(await readFile(path.join(root,"yash.ts"),"utf8"),"yash");
        assert.ok(facts.some(f=>f.reasonCode==="new_file_absence_confirmed"));
        await writeFile(path.join(root,"yash.ts"),'// preserve this\nconst name = "yash";\n');
        phase="edit";
        const edited=await agent.run({prompt:"edit the name yash in yash.ts and write ananya in it",chatId:"same-chat",history:[
            {id:"1",role:"user",content:question,createdAt:new Date().toISOString()},
            {id:"2",role:"assistant",content:created.response,createdAt:new Date().toISOString()},
        ]},()=>{});
        assert.equal(await readFile(path.join(root,"yash.ts"),"utf8"),'// preserve this\nconst name = "ananya";\n');
        assert.match(edited.response,/Completed: Replace yash with ananya/);
        assert.ok(facts.some(f=>f.toolName==="WriteFileTool" && f.toolInvoked===false));
        assert.equal(facts.filter(f=>f.kind==="tool_result" && f.toolName==="WriteFileTool" && f.toolInvoked===true).length,1,"Only the initial creation may invoke WriteFileTool");
    });
});

for(const mode of ["premature_completion","unchanged_edit"] as const) {
    test(`${mode} cannot be reported as a completed edit`,async()=>{
        await inProject(async root=>{
            await writeFile(path.join(root,"yash.ts"),"yash");
            const {telemetry,facts}=recordingTelemetry();
            const planning=[discover,read,plan("Replace yash with ananya")];
            let coderCalls=0;
            const llm={generateForOrchestrator:async()=>({type:"final",answer:"Old task completed"}),
                generateForPlanner:async()=>planning.shift(),
                generateForCoder:async()=>{
                    coderCalls++;
                    return mode==="unchanged_edit" && coderCalls===1
                        ? {type:"tool_call",toolName:"EditFileTool",path:"yash.ts",oldText:"yash",newText:"yash"} : completed;
                },
            } as unknown as LLMProvider;
            const result=await new OpenKodeAgent(llm,telemetry).run({prompt:"Edit yash.ts and replace yash with ananya"},()=>{});
            assert.match(result.response,/coder did not verify completion/);
            assert.equal(await readFile(path.join(root,"yash.ts"),"utf8"),"yash");
            assert.ok(!facts.some(f=>f.reasonCode==="coding_step_completed"));
            if(mode==="unchanged_edit") assert.ok(facts.some(f=>f.reasonCode==="unchanged_file"));
        });
    });
}

test("new nested paths are preserved and can be planned without requiring an existing file",async()=>{
    await inProject(async root=>{
        const {telemetry}=recordingTelemetry();
        const coding=[{type:"tool_call",toolName:"WriteFileTool",path:"notes/new.ts",content:"hello"},completed];
        const llm={generateForOrchestrator:async()=>({type:"delegate",agent:"planner",task:"Create notes/new.ts"}),
            generateForPlanner:async(request:Delegate)=>{
                assert.deepEqual(request.context?.requestedNewFiles,["notes/new.ts"]);
                return plan("Create notes/new.ts containing hello","notes/new.ts");
            },generateForCoder:async()=>coding.shift(),
        } as unknown as LLMProvider;
        await new OpenKodeAgent(llm,telemetry).run({prompt:"Create notes/new.ts containing hello"},()=>{});
        assert.equal(await readFile(path.join(root,"notes","new.ts"),"utf8"),"hello");
    });
});

test("an empty plan cannot claim a successful coding task",async()=>{
    await inProject(async()=>{
        const {telemetry}=recordingTelemetry();
        const llm={generateForOrchestrator:async()=>({type:"final",answer:"Done"}),
            generateForPlanner:async()=>({...plan("Create yash.ts"),steps:[]}),
            generateForCoder:async()=>assert.fail("Empty plans must never reach coder"),
        } as unknown as LLMProvider;
        const result=await new OpenKodeAgent(llm,telemetry).run({prompt:"Create a new file yash.ts"},()=>{});
        assert.match(result.response,/planner did not produce a plan/);
    });
});

test("worker model messages separate old conversation from the latest task and source contents",()=>{
    const request:Delegate={type:"delegate",agent:"planner",task:"Replace yash with ananya",context:{originalRequest:"Edit yash.ts",sourceFiles:{"yash.ts":"yash"},conversation:[{id:"1",role:"user",content:"Create yash.ts containing yash",createdAt:new Date().toISOString()}]}};
    for(const make of [createPlannerMessages,createCoderMessages]) {
        const messages=make(request);
        assert.ok(JSON.parse(messages[1]!.content).backgroundConversation);
        const latest=JSON.parse(messages.at(-1)!.content);
        assert.equal(latest.task,"Replace yash with ananya");
        assert.equal(latest.context.conversation,undefined);
        assert.equal(latest.context.sourceFiles["yash.ts"],"yash");
    }
});

test("a request explicitly referring to previous work retains that conversation for workers",async()=>{
    await inProject(async()=>{
        const {telemetry}=recordingTelemetry();
        const history=[{id:"1",role:"user" as const,content:"Replace the display name with ananya",createdAt:new Date().toISOString()}];
        const llm={generateForOrchestrator:async()=>({type:"delegate",agent:"planner",task:"Apply the same change to yash.ts"}),
            generateForPlanner:async(request:Delegate)=>{
                assert.deepEqual(request.context?.conversation,history);
                return {type:"needs_context",questions:["Which source version should be changed?"]};
            },
        } as unknown as LLMProvider;
        await new OpenKodeAgent(llm,telemetry).run({prompt:"Apply the same change to yash.ts",history},()=>{});
    });
});

test("Ollama coder generation requests the accepted response protocol instead of arbitrary JSON",async()=>{
    const previous=globalThis.fetch;
    let body:Record<string,any>|undefined;
    globalThis.fetch=async(_url,options)=>{
        body=JSON.parse(String(options?.body));
        return new Response(JSON.stringify({message:{content:JSON.stringify(completed)}}),{status:200});
    };
    try {
        const result=await new OllamaProvider().generateForCoder({type:"delegate",agent:"coder",task:"Replace yash with ananya"});
        assert.equal(result.type,"completed");
        assert.equal(typeof body?.format,"object");
        const variants=body!.format.anyOf;
        assert.ok(variants.some((variant:any)=>variant.properties.type.enum.includes("completed") && variant.required.includes("verification")));
        assert.ok(variants.some((variant:any)=>variant.properties.toolName?.enum.includes("EditFileTool") && variant.required.includes("newText")));
        assert.ok(variants.every((variant:any)=>variant.additionalProperties===false));
    } finally {globalThis.fetch=previous;}
});
