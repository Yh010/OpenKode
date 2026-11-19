import type { TelemetryEventInterface } from "./TelemetryEventInterface.js";

export class TelemetryApiClient{
    constructor(private readonly collectorUrl: string, private readonly accessToken?: () => Promise<string>) {
        const url = new URL(collectorUrl);
        if (accessToken && (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))))) {
            throw new Error("Authenticated telemetry requires HTTPS or a loopback HTTP collector.");
        }
    }

    async sendBatch(telemetryEvents: TelemetryEventInterface[]){
        const token = await this.accessToken?.();
        // Free hosted collectors can take about a minute to wake up. Event IDs
        // stay unchanged so the hosted collector can safely deduplicate retries.
        const body = JSON.stringify({ events: telemetryEvents });
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const response = await fetch(this.collectorUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body,
                signal: AbortSignal.timeout(new URL(this.collectorUrl).protocol === "https:" ? 90_000 : 4_000),
                redirect: "error",
            });

            if (!response.ok) {
                if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
                    await response.body?.cancel();
                    await new Promise(resolve => setTimeout(resolve, 1_000));
                    continue;
                }
                throw new ExportRejectedError(`Export Request failed: ${response.status}`);
            }
            return;
          } catch (error) {
            if (error instanceof ExportRejectedError || attempt > 0) throw error;
            await new Promise(resolve => setTimeout(resolve, 1_000));
          }
        }
    }   
}

class ExportRejectedError extends Error {}
