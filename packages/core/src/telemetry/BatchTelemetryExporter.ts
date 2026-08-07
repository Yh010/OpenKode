import { TelemetryApiClient } from "./TelemetryApiClient.js";
import type { TelemetryEventInterface } from "./TelemetryEventInterface.js";
import type { TelemetryExporterInterface } from "./TelemetryExporterInterface.js";

export class BatchTelemetryExporter implements TelemetryExporterInterface{
    private readonly eventQueue: TelemetryEventInterface[] = [];
    private activeFlush: Promise<void> | undefined;
    private startShutdown = false;
    private readonly timer: ReturnType<typeof setInterval>;
    constructor(
        private readonly telemetryApiClient : TelemetryApiClient,
        private readonly maxBatchSize=10, 
        private readonly maxQueueSize=1000, 
        private readonly flushIntervalMs=1000,
    ){
        this.timer = setInterval(() => {
            void this.forceFlush();
        }, this.flushIntervalMs);
    }
    emit(event: TelemetryEventInterface){

        let queueSize = this.eventQueue.length ;
        
        if(this.startShutdown){
            return ;
        }else if(queueSize >= this.maxQueueSize){
            console.warn("Max in-memory telemetry event queue size reached") ;
            return ;
        }

        if (!isValidTelemetryEvent(event)) {
            console.warn("Invalid telemetry event dropped");
            return;
        }

        this.eventQueue.push(event);
        queueSize = this.eventQueue.length ;

        if(queueSize >= this.maxBatchSize){
            void this.forceFlush();
        }

    };
    
    forceFlush():Promise<void>{

        if(this.activeFlush){
            return this.activeFlush;
        }

        const flushPromise = this.flushQueuedEvents().finally(()=> this.activeFlush = undefined) ;

        this.activeFlush = flushPromise ;
        return this.activeFlush;
    };

    async shutdown():Promise<void>{
        this.startShutdown = true ;
        clearInterval(this.timer);
        await this.forceFlush();
    };

    private async flushQueuedEvents(){
        while(this.eventQueue.length){
            const batch = this.eventQueue.splice(0, this.maxBatchSize);
            const apiClient = this.telemetryApiClient ;
            try {
                await apiClient.sendBatch(batch) ;
            }catch(err:any){
                console.error(err);
                continue ;
            }
            
        }
    }
}

function isValidTelemetryEvent(
    event: unknown,
): event is TelemetryEventInterface {
    if (typeof event !== "object" || event === null) {
        return false;
    }

    const candidate = event as Record<string, unknown>;

    const requiredStringFields = [
        "eventId",
        "runId",
        "spanId",
        "name",
        "startedAt",
        "endedAt",
    ];

    const hasRequiredStrings = requiredStringFields.every(
        (field) =>
            typeof candidate[field] === "string" &&
            candidate[field].trim().length > 0,
    );

    const hasValidType = [
        "run",
        "agent_step",
        "generation",
        "tool",
        "error",
    ].includes(candidate.type as string);

    const hasValidStatus = ["ok", "error"].includes(
        candidate.status as string,
    );

    return hasRequiredStrings && hasValidType && hasValidStatus;
}