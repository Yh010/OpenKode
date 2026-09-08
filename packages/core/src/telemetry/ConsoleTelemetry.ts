import { AsyncLocalStorage } from "async_hooks";
import type { TelemetryInterface, TelemetrySpanDetails } from "./TelemetryInterface.js";
import { randomUUID } from 'crypto';
import type { TraceContext } from "./TraceContext.js";
import type { SpanType, TelemetryEventInterface, TelemetryEventType } from "./TelemetryEventInterface.js";
import type { TelemetryExporterInterface } from "./TelemetryExporterInterface.js";

export class ConsoleTelemetry implements TelemetryInterface{

    constructor(private readonly exporter?: TelemetryExporterInterface){}
    
    private readonly contextStorage = new AsyncLocalStorage<TraceContext>() ;

    private emitEventSafely(event: TelemetryEventInterface): void {
        try {
            this.exporter?.emit(event);
        } catch (error) {
            console.error(
                "[OpenKode][telemetry] Failed to queue telemetry event.",
                error,
            );
        }
    }

    private createMetadataSafely<T>(
        metadataFactory: ((result: T) => TelemetrySpanDetails | undefined) | undefined,
        result: T,
    ): TelemetrySpanDetails | undefined {
        if (!metadataFactory) {
            return undefined;
        }

        try {
            return metadataFactory(result);
        } catch (error) {
            console.error("[OpenKode][telemetry] Failed to create telemetry metadata.", error);
            return undefined;
        }
    }

    async withRun<T>(
        name: string,
        operation: () => Promise<T>,
        metadataFactory?: (result: T) => TelemetrySpanDetails | undefined,
    ): Promise<T> {
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
        const startTime = new Date() ;

        try{
            const resp = await this.contextStorage.run(rootContext,operation) ;
            const endTime = new Date() ;
            const details = this.createMetadataSafely(metadataFactory, resp);
            //const timeTaken = endTime-startTime ;
            const obj:TelemetryEventInterface = {
                type: "run",
                name: name,
                eventId: `event-${randomUUID()}`,
                runId: runId,
                spanId:rootSpanId,
                startedAt: startTime.toISOString(),
                endedAt:endTime.toISOString(),
                //msg: `${name} Span ended with rootId: ${runId} and rootSpanId: ${rootSpanId} time taken: ${timeTaken}`,
                status: "ok",
                ...(details?.metadata ? { metadata: details.metadata } : {}),
                ...(details?.llm ? { llm: details.llm } : {}),
            }
            console.log(obj);
            this.emitEventSafely(obj) ;
            return resp ;

        }catch(err){
            const endTime = new Date() ;
            const obj : TelemetryEventInterface = {
                type:"run",
                eventId: `event-${randomUUID()}`,
                name,
                runId,
                spanId: rootSpanId,
                startedAt: startTime.toISOString(),
                endedAt: endTime.toISOString(),
                status: "error",
                metadata:{
                    error: err instanceof Error ? err.message : String(err),
                },
            }
            this.emitEventSafely(obj)
            console.log(obj);
            throw err ;
        }

    }

    async withSpan<T>(
        type:TelemetryEventType,
        name: SpanType,
        operation: () => Promise<T>,
        metadataFactory?: (result: T) => TelemetrySpanDetails | undefined,
    ): Promise<T> {
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
        const startTime = new Date() ;

         try{
            const resp = await this.contextStorage.run(childContext,operation) ;
            const endTime = new Date() ;
            const details = this.createMetadataSafely(metadataFactory, resp);
            //const timeTaken = endTime-startTime ;
            const obj:TelemetryEventInterface = {
                type,
                name: name,
                eventId: `event-${randomUUID()}`,
                runId: childContext.runId,
                spanId:childContext.spanId,
                ...(childContext.parentSpanId? {parentSpanId: childContext.parentSpanId}:{}),
                startedAt: startTime.toISOString(),
                endedAt:endTime.toISOString(),
                status: "ok",
                ...(details?.metadata ? { metadata: details.metadata } : {}),
                ...(details?.llm ? { llm: details.llm } : {}),
            }
            console.log(obj);
            this.emitEventSafely(obj)
            return resp ;

        }catch(err){
            const endTime = new Date() ;
            const obj : TelemetryEventInterface = {
                type,
                eventId: `event-${randomUUID()}`,
                name,
                runId:childContext.runId,
                spanId: childContext.spanId,
                ...(childContext.parentSpanId? {parentSpanId: childContext.parentSpanId}:{}),
                startedAt: startTime.toISOString(),
                endedAt: endTime.toISOString(),
                status: "error",
                metadata:{
                    error: err instanceof Error ? err.message : String(err),
                },
            }
            this.emitEventSafely(obj)
            console.log(obj);
            throw err ;
        }
    }

    async shutdown():Promise<void> {
        await this.exporter?.shutdown() ;
    }
}
