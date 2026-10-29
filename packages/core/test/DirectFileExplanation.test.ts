import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenKodeAgent } from "../src/agent/OpenKodeAgent.js";
import { directFileRequestPaths } from "../src/agent/directFileRequest.js";
import type { LLMProvider } from "../src/llm/interface/LLMProvider.js";
import type { TelemetryInterface } from "../src/telemetry/TelemetryInterface.js";
import type { Message } from "../src/agent/interface/Message.js";

async function inProject(action: (root: string) => Promise<void>) {
    const previous = process.cwd();
    const root = await mkdtemp(path.join(os.tmpdir(), "openkode-explanation-"));
    try {
        await mkdir(path.join(root,"packages","core"),{recursive:true});
        await writeFile(path.join(root,"ChatStore.test.ts"),"Tests chat persistence.");
        await writeFile(path.join(root,"packages","core","resolveProjectPath.ts"),"Rejects paths that escape the project.");
        process.chdir(root);
        await action(root);
    } finally {
        process.chdir(previous);
        assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith("openkode-explanation-"));
        await rm(root,{recursive:true,force:true});
    }
}
function recordingTelemetry() {
    const events: Array<{name:string;metadata?:Record<string,unknown>}> = [];
    const telemetry: TelemetryInterface = {
        async withRun(name, operation, details) {const result=await operation();events.push({name,...details?.(result)});return result;},
        async withSpan(_type,name,operation,details) {const result=await operation();events.push({name,...details?.(result)});return result;},
        async shutdown() {},
    };
    return {telemetry,events};
}

test("switching from file A to B in the same chat reads B before the model sees the latest question", async () => {
    await inProject(async () => {
        const {telemetry,events}=recordingTelemetry();
        const inputs: Message[][]=[];
        const llm={generateForOrchestrator:async ({messages}:{messages:Message[]})=>{
            inputs.push(structuredClone(messages));
            const current=JSON.parse(messages.at(-1)!.content);
            assert.ok(current.context.sourceFiles,"Actual current-file contents must precede generation");
            return {type:"final",answer:Object.values(current.context.sourceFiles).join("\n")};
        },generateForPlanner:async()=>assert.fail("Direct explanations must not delegate") } as unknown as LLMProvider;
        const agent=new OpenKodeAgent(llm,telemetry);
        const first=await agent.run({prompt:"Explain ChatStore.test.ts",chatId:"same-chat"},()=>{});
        const question="i dont understand what is in packages\\core\\resolveProjectPath.ts pls explain";
        const second=await agent.run({prompt:question,chatId:"same-chat",history:[
            {id:"1",role:"user",content:"Explain ChatStore.test.ts",createdAt:new Date().toISOString()},
            {id:"2",role:"assistant",content:first.response,createdAt:new Date().toISOString()},
        ]},()=>{});
        assert.equal(first.response,"Tests chat persistence.");
        assert.equal(second.response,"Rejects paths that escape the project.");
        const current=JSON.parse(inputs[1]!.at(-1)!.content);
        assert.equal(current.request,question);
        assert.deepEqual(Object.keys(current.context.sourceFiles),["packages/core/resolveProjectPath.ts"]);
        assert.equal(current.conversation,undefined);
        assert.ok(inputs[1]![1]!.content.includes("backgroundConversation"));
        const reads=events.map(e=>e.metadata?.runtime as Record<string,unknown>|undefined).filter(f=>f?.kind==="tool_result");
        assert.equal(reads.length,2);
        assert.ok(reads.every(f=>f?.toolInvoked===true && f.requestedBy==="runtime" && f.outcome==="ok"));
    });
});

test("reads again on each run instead of reusing old contents", async () => {
    await inProject(async root => {
        const {telemetry}=recordingTelemetry();
        const llm={generateForOrchestrator:async ({messages}:{messages:Message[]})=>({type:"final",answer:JSON.parse(messages.at(-1)!.content).context.sourceFiles["ChatStore.test.ts"]})} as unknown as LLMProvider;
        const agent=new OpenKodeAgent(llm,telemetry);
        await agent.run({prompt:"Explain ChatStore.test.ts"},()=>{});
        await writeFile(path.join(root,"ChatStore.test.ts"),"Updated file contents.");
        assert.equal((await agent.run({prompt:"Explain ChatStore.test.ts"},()=>{})).response,"Updated file contents.");
    });
});

test("missing files and paths outside the project return the read error without asking the model", async () => {
    await inProject(async root => {
        const {telemetry,events}=recordingTelemetry();
        const llm={generateForOrchestrator:async()=>assert.fail("Must not generate an explanation after a failed read")} as unknown as LLMProvider;
        const agent=new OpenKodeAgent(llm,telemetry);
        assert.match((await agent.run({prompt:"Explain missing.ts"},()=>{})).response,/NOT_FOUND/);
        assert.match((await agent.run({prompt:"Explain ../outside.ts"},()=>{})).response,/INVALID_PATH/);
        assert.match((await agent.run({prompt:`Explain "${path.join(path.dirname(root),"outside.ts")}"`},()=>{})).response,/INVALID_PATH/);
        assert.ok(events.some(e=>(e.metadata?.runtime as Record<string,unknown>)?.reasonCode==="current_file_read_failed"));
    });
});

test("wrong-file tool requests and delegation are rejected rather than executed", async () => {
    await inProject(async () => {
        const {telemetry,events}=recordingTelemetry();
        let calls=0;
        const llm={generateForOrchestrator:async()=>{calls++;return calls===1
            ? {type:"tool_call",toolName:"ReadFileTool",fileToRead:"old.ts"}
            : {type:"delegate",agent:"planner",task:"Explain old.ts"};}} as unknown as LLMProvider;
        const result=await new OpenKodeAgent(llm,telemetry).run({prompt:"Explain ChatStore.test.ts"},()=>{});
        assert.equal(calls,2,"Invalid responses must have a bounded retry");
        assert.match(result.response,/did not return an explanation/);
        assert.equal(events.filter(e=>(e.metadata?.runtime as Record<string,unknown>)?.kind==="tool_result").length,1);
    });
});

test("extracts current full paths, quoted spaces and multiple files without hijacking coding or discovery requests", () => {
    const root=path.resolve("example-root");
    assert.deepEqual(directFileRequestPaths("explain `packages/core/a.ts` and 'notes/my file.md'",root),["packages/core/a.ts","notes/my file.md"]);
    assert.deepEqual(directFileRequestPaths(`Explain "${path.join(root,"packages","core","a.ts")}"`,root),["packages/core/a.ts"]);
    assert.deepEqual(directFileRequestPaths("Explain add.ts",root),["add.ts"]);
    assert.deepEqual(directFileRequestPaths("Fix a.ts and explain the changes",root),[]);
    assert.deepEqual(directFileRequestPaths("Find which files use a.ts",root),[]);
    assert.deepEqual(directFileRequestPaths("What did we decide?",root),[]);
});
