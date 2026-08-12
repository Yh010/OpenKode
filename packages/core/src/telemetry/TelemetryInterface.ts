import type { SpanType, TelemetryEventType } from "./TelemetryEventInterface.js";

export interface TelemetryInterface{
    withRun<T>(name: string, operation: ()=> Promise<T>) : Promise<T>; // always creates type: "run"
    withSpan<T>(type:TelemetryEventType, name: SpanType, operation: ()=> Promise<T>) : Promise<T>; 
    shutdown(): Promise<void> ;
}