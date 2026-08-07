import type { TelemetryEventInterface } from "./TelemetryEventInterface.js";

export class TelemetryApiClient{
    constructor(private readonly collectorUrl: string){}

    async sendBatch(telemetryEvents: TelemetryEventInterface[]){
        const response = await fetch(this.collectorUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                events:telemetryEvents
            }),
        });

        if (!response.ok) {
            throw new Error(`Export Request failed: ${response.status}`);
        }

    }   
}