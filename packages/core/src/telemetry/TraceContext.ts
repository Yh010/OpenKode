export interface TraceContext{
    runId: string;
    spanId: string ;
    parentSpanId?: string; 
}