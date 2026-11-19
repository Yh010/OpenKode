import type { TelemetryOwnership } from "./TelemetryInterface.js";
export interface TraceContext{
    ownership?: TelemetryOwnership;
    runId: string;
    spanId: string ;
    parentSpanId?: string; 
}
