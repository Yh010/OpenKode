import { AsyncLocalStorage } from "async_hooks";
import type { TelemetryInterface } from "./TelemetryInterface.js";
import { randomUUID } from 'crypto';
import type { TraceContext } from "./TraceContext.js";

export class ConsoleTelemetry implements TelemetryInterface{
    
    private readonly contextStorage = new AsyncLocalStorage<TraceContext>() ;

    async withRun<T>(name: string, operation: () => Promise<T>): Promise<T> {
        const runId: string = "run"+randomUUID();
        const rootSpanId: string = "rootSpan" + randomUUID() ;

        const rootContext: TraceContext = {
            runId,
            spanId: rootSpanId
        };
        console.log({
            event: "span_started",
            name,
            runId,
            spanId: rootSpanId,
        });
        const startTime = Date.now() ;

        try{
            const resp = await this.contextStorage.run(rootContext,operation) ;
            const endTime = Date.now() ;
            const timeTaken = endTime-startTime ;
            const obj = {
                event: "span_finished",
                name: name,
                runId: runId,
                spanId:rootSpanId,
                durationMs: timeTaken,
                msg: `${name} Span ended with rootId: ${runId} and rootSpanId: ${rootSpanId} time taken: ${timeTaken}`,
                status: "ok"
            }
            console.log(obj);
            return resp ;

        }catch(err){
            console.log({
                event: "span_finished",
                name,
                runId,
                spanId: rootSpanId,
                durationMs: Date.now() - startTime,
                status: "error",
                error: err instanceof Error ? err.message : String(err),
            });
            throw err ;
        }

    }

    async withSpan<T>(name: string, operation: () => Promise<T>): Promise<T> {
        const parentContext = this.contextStorage.getStore();

        if (!parentContext) {
            throw new Error("Cannot create a span without an active run context");
        }

        const spanId = "span" + randomUUID() ;

        const childContext: TraceContext = {
            runId: parentContext.runId,
            spanId,
            parentSpanId: parentContext.spanId,
        }

        console.log({
            event: "span_started",
            name,
            runId: childContext.runId,
            spanId: childContext.spanId,
            parentSpanId: childContext.parentSpanId
        });
        const startTime = Date.now() ;

         try{
            const resp = await this.contextStorage.run(childContext,operation) ;
            const endTime = Date.now() ;
            const timeTaken = endTime-startTime ;
            const obj = {
                event: "span_finished",
                name: name,
                runId: childContext.runId,
                spanId:childContext.spanId,
                parentSpanId: childContext.parentSpanId,
                durationMs: timeTaken,
                msg: `${name} Span ended with rootId: ${childContext.runId} and spanId: ${childContext.spanId}, parentSpanId: ${childContext.parentSpanId}, time taken: ${timeTaken}`,
                status: "ok"
            }
            console.log(obj);
            return resp ;

        }catch(err){
            console.log({
                event: "span_finished",
                name,
                runId: childContext.runId,
                spanId: childContext.spanId,
                parentSpanId: childContext.parentSpanId,
                durationMs: Date.now() - startTime,
                status: "error",
                error: err instanceof Error ? err.message : String(err),
            });
            throw err ;
        }
    }
}