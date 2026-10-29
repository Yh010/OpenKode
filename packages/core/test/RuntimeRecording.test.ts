import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { OpenKodeAgent } from "../src/agent/OpenKodeAgent.js";
import type { LLMProvider } from "../src/llm/interface/LLMProvider.js";
import type { TelemetryInterface, TelemetrySpanDetails } from "../src/telemetry/TelemetryInterface.js";
import { RuntimeRecorder } from "../src/telemetry/RuntimeRecorder.js";
import { ReadFileTool } from "../src/tools/read/ReadFileTool.js";
import { ConsoleTelemetry } from "../src/telemetry/ConsoleTelemetry.js";
import { SpanType } from "../src/telemetry/TelemetryEventInterface.js";
import type { TelemetryEventInterface } from "../src/telemetry/TelemetryEventInterface.js";

function recordingTelemetry() {
    const events: Array<{name: string; type: string; metadata?: Record<string, unknown>}> = [];
    const telemetry: TelemetryInterface = {
        async withRun(name, operation, metadataFactory) { const result = await operation(); events.push({name,type:"run",...metadataFactory?.(result)}); return result; },
        async withSpan(type,name,operation,metadataFactory) { const result = await operation(); events.push({name,type,...metadataFactory?.(result)}); return result; },
        async shutdown() {},
    };
    return {telemetry,events};
}
async function inProject(action: (root: string) => Promise<void>) {
    const previous = process.cwd();
    const root = await mkdtemp(path.join(os.tmpdir(), "openkode-runtime-"));
    try { await writeFile(path.join(root,"example.ts"),'export const answer = 42;'); process.chdir(root); await action(root); }
    finally {
        process.chdir(previous);
        assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith("openkode-runtime-"));
        await rm(root,{recursive:true,force:true});
    }
}
const runtimeOf = (event: {metadata?:Record<string,unknown>}) => event.metadata?.runtime as Record<string,unknown>;

test("records a research failure chain: route override, unsupported answer, blocked read, retry and clarification", async () => {
    await inProject(async root => {
        const {telemetry,events} = recordingTelemetry();
        const prompt = "Investigate example.ts";
        const responses = [
            {type:"research_result",answer:"An unsupported answer",sources:["example.ts"]},
            {type:"tool_call",toolName:"ReadFileTool",fileToRead:path.join(root,"example.ts")},
            {type:"needs_context",questions:["Which part?"]},
        ];
        const llm = { generateForOrchestrator: async () => ({type:"tool_call",toolName:"ReadFileTool",fileToRead:path.join(root,"example.ts")}), generateForPlanner: async () => responses.shift() } as unknown as LLMProvider;
        const execute = ReadFileTool.prototype.execute;
        let toolInvocations = 0;
        ReadFileTool.prototype.execute = async function(input) {toolInvocations++;return execute.call(this,input);};
        try {
            const result = await new OpenKodeAgent(llm,telemetry).run({prompt},()=>{});
            assert.ok(result.response.includes("Which part?"));
            assert.equal(toolInvocations,0,"The blocked request must not invoke the file tool");
        } finally { ReadFileTool.prototype.execute=execute; }
        const facts = events.filter(e=>e.metadata?.runtime).map(runtimeOf);
        const route=facts.find(f=>f.reasonCode==="planner_route_override")!;
        assert.equal(route.overridden,true);
        assert.equal((route.modelDecision as Record<string,unknown>).toolName,"ReadFileTool");
        assert.equal((route.effectiveDecision as Record<string,unknown>).agent,"planner");
        assert.ok(facts.some(f=>f.reasonCode==="answer_without_evidence"));
        const blocked=facts.find(f=>f.kind==="tool_result")!;
        assert.equal(blocked.toolInvoked,false);assert.equal(blocked.outcome,"blocked");assert.equal(blocked.errorCode,"UNAPPROVED_FILE");
        assert.equal(blocked.validationRule,"file_not_discovered");
        const calls=facts.filter(f=>f.kind==="agent_call");assert.equal(calls.length,4);
        assert.equal(calls[2]!.fromStepId,calls[1]!.stepId);assert.equal(calls[3]!.fromStepId,calls[2]!.stepId);
        assert.equal(blocked.ownerStepId,calls[2]!.stepId);
        assert.equal((calls[2]!.inputSummary as Record<string,unknown>).sourceFiles,0);
        assert.ok(facts.some(f=>f.reasonCode==="clarification_returned"));
    });
});

test("records successful discovery/read executions and verified answer acceptance", async () => {
    await inProject(async () => {
        const {telemetry,events}=recordingTelemetry();
        const responses=[{type:"tool_call",toolName:"GlobTool",pattern:"**/example.ts"},{type:"tool_call",toolName:"ReadFileTool",fileToRead:"example.ts"},{type:"research_result",answer:"Exports answer = 42",sources:["example.ts"]}];
        const llm={generateForOrchestrator:async()=>({type:"delegate",agent:"planner",task:"Explain example.ts"}),generateForPlanner:async()=>responses.shift()} as unknown as LLMProvider;
        const result=await new OpenKodeAgent(llm,telemetry).run({prompt:"Investigate example.ts"},()=>{});
        assert.equal(result.response,"Exports answer = 42");
        const facts=events.filter(e=>e.metadata?.runtime).map(runtimeOf);
        const tools=facts.filter(f=>f.kind==="tool_result");assert.equal(tools.length,2);
        assert.ok(tools.every(f=>f.toolInvoked===true && f.outcome==="ok"));
        assert.ok(facts.some(f=>f.reasonCode==="research_answer_accepted"));
    });
});

test("automatic overview discovery and reads are recorded as runtime-initiated tools", async () => {
    await inProject(async root => {
        await writeFile(path.join(root,"README.md"),"# Example project");
        const {telemetry,events}=recordingTelemetry();
        const llm={generateForOrchestrator:async()=>({type:"delegate",agent:"planner",task:"Explain this project"}),
            generateForPlanner:async()=>({type:"research_result",answer:"An example project",sources:["README.md"]})} as unknown as LLMProvider;
        const result=await new OpenKodeAgent(llm,telemetry).run({prompt:"Explain this project"},()=>{});
        assert.equal(result.response,"An example project");
        const tools=events.filter(event=>event.metadata?.runtime).map(runtimeOf).filter(facts=>facts.kind==="tool_result");
        assert.ok(tools.some(facts=>facts.toolName==="GlobTool"));
        assert.ok(tools.some(facts=>facts.toolName==="ReadFileTool"));
        assert.ok(tools.every(facts=>facts.requestedBy==="runtime" && facts.toolInvoked===true));
    });
});

test("records the named-file search rule that stops a missing existing-file request", async () => {
    await inProject(async () => {
        const {telemetry,events}=recordingTelemetry();
        const llm={generateForOrchestrator:async()=>({type:"delegate",agent:"planner",task:"Create a new file missing.ts"}),
            generateForPlanner:async()=>({type:"tool_call",toolName:"GlobTool",pattern:"**/missing.ts"}),
            generateForCoder:async()=>assert.fail("The recorded failure ends before a coder call"),
        } as unknown as LLMProvider;
        const result=await new OpenKodeAgent(llm,telemetry).run({prompt:"Investigate missing.ts"},()=>{});
        assert.match(result.response,/couldn't find "missing.ts"/);
        const facts=events.filter(event=>event.metadata?.runtime).map(runtimeOf);
        const stop=facts.find(fact=>fact.reasonCode==="named_file_search_stopped_run")!;
        assert.ok(stop);
        assert.equal(stop.errorCode,"NO_MATCHES");
        assert.equal(stop.stopRule,"named_file_search_requires_match");
        assert.equal(stop.nextAgent,"user");
        const tool=facts.find(fact=>fact.kind==="tool_result")!;
        assert.equal(stop.ownerStepId,tool.ownerStepId);
        assert.equal(tool.toolInvoked,true);
        assert.ok(!facts.some(fact=>fact.toolName==="WriteFileTool"));
    });
});

test("runtime content respects capture opt-in, redaction and truncation", () => {
    const oldCapture=process.env.OPENKODE_TELEMETRY_CAPTURE_LLM_CONTENT;
    const oldMax=process.env.OPENKODE_TELEMETRY_LLM_MAX_CONTENT_CHARS;
    try {
        process.env.OPENKODE_TELEMETRY_CAPTURE_LLM_CONTENT="false";
        assert.deepEqual(new RuntimeRecorder(recordingTelemetry().telemetry).content({input:"private task"}),{});
        process.env.OPENKODE_TELEMETRY_CAPTURE_LLM_CONTENT="true";
        process.env.OPENKODE_TELEMETRY_LLM_MAX_CONTENT_CHARS="80";
        const content=new RuntimeRecorder(recordingTelemetry().telemetry).content({input:{password:"never-show-this"},output:"x".repeat(200)}).runtimeContent as Record<string,{value:string;truncated:boolean}>;
        assert.ok(content.input!.value.includes("REDACTED"));assert.ok(!content.input!.value.includes("never-show-this"));
        assert.equal(content.output!.truncated,true);
        const recorder = new RuntimeRecorder(recordingTelemetry().telemetry);
        const details = recorder.agentDetails(recorder.step("planner",1,undefined),{type:"needs_context"},
            {task:"Explain example.ts",conversation:"x".repeat(300),feedback:"Read the discovered file first."});
        const fields = details.metadata!.runtimeContent as Record<string,{value:string;truncated:boolean}>;
        assert.equal(fields.input!.truncated,true);
        assert.equal(fields.task!.truncated,false);
        assert.equal(fields.systemMessage!.truncated,false);
        assert.ok(fields.systemMessage!.value.includes("Read the discovered file first."));
    } finally {
        if(oldCapture===undefined)delete process.env.OPENKODE_TELEMETRY_CAPTURE_LLM_CONTENT;else process.env.OPENKODE_TELEMETRY_CAPTURE_LLM_CONTENT=oldCapture;
        if(oldMax===undefined)delete process.env.OPENKODE_TELEMETRY_LLM_MAX_CONTENT_CHARS;else process.env.OPENKODE_TELEMETRY_LLM_MAX_CONTENT_CHARS=oldMax;
    }
});

test("coder calls keep approved-plan provenance and record actual edit execution", async () => {
    await inProject(async root => {
        const {telemetry,events}=recordingTelemetry();
        const planner=[{type:"tool_call",toolName:"GlobTool",pattern:"**/example.ts"},{type:"tool_call",toolName:"ReadFileTool",fileToRead:"example.ts"},{type:"plan",summary:"Update the answer",steps:[{id:"edit",description:"Change answer to 43",files:["example.ts"],acceptanceCriteria:["answer equals 43"]}],verification:[],risks:[]}];
        const coder=[{type:"tool_call",toolName:"EditFileTool",path:"example.ts",oldText:"answer = 42",newText:"answer = 43"},{type:"completed",summary:"Changed answer",verification:[],risks:[]}];
        const llm={generateForOrchestrator:async()=>({type:"delegate",agent:"planner",task:"Fix example.ts"}),generateForPlanner:async()=>planner.shift(),generateForCoder:async()=>coder.shift()} as unknown as LLMProvider;
        await new OpenKodeAgent(llm,telemetry).run({prompt:"Fix example.ts: change answer to 43"},()=>{});
        assert.match(await readFile(path.join(root,"example.ts"),"utf8"),/answer = 43/);
        const facts=events.filter(e=>e.metadata?.runtime).map(runtimeOf);
        const calls=facts.filter(f=>f.kind==="agent_call" && f.agent==="coder");
        assert.equal(calls.length,2);assert.ok(calls.every(f=>f.taskSource==="approved_plan_step"));
        assert.equal(calls[1]!.fromStepId,calls[0]!.stepId);
        const edit=facts.find(f=>f.kind==="tool_result" && f.toolName==="EditFileTool")!;
        assert.equal(edit.toolInvoked,true);assert.equal(edit.outcome,"ok");assert.equal(edit.ownerStepId,calls[0]!.stepId);
        assert.ok(facts.some(f=>f.reasonCode==="coding_step_completed"));
    });
});

test("failed agent and tool spans retain their runtime ownership and original exception", async () => {
    const events: TelemetryEventInterface[]=[];
    const telemetry=new ConsoleTelemetry({emit:event=>events.push(event),forceFlush:async()=>{},shutdown:async()=>{}});
    const runtime=new RuntimeRecorder(telemetry);
    const step=runtime.step("planner",1,undefined,{originalRequest:"Read example.ts",sourceFiles:{},discoveredFiles:[]});
    const failure=new Error("Tool exploded");
    await assert.rejects(()=>telemetry.withRun("failure-test",()=>runtime.agentCall(step,SpanType.PLANNER_RUN,()=>runtime.tool(step,"ReadFileTool",{},true,async()=>{throw failure;}),{task:"Read example.ts"})),error=>error===failure);
    const agent=events.find(e=>e.name===SpanType.PLANNER_RUN)!;
    const tool=events.find(e=>e.name===SpanType.TOOL_EXECUTION)!;
    assert.equal(agent.status,"error");assert.equal(runtimeOf(agent).stepId,step.stepId);
    assert.equal(tool.status,"error");assert.equal(runtimeOf(tool).ownerStepId,step.stepId);
    assert.equal(runtimeOf(tool).toolInvoked,true);
    assert.ok(events.some(e=>e.metadata?.runtime && runtimeOf(e).reasonCode==="tool_threw"));
});
