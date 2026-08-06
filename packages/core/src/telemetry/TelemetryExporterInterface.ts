import type { TelemetryEventInterface } from "./TelemetryEventInterface.js";

export interface TelemetryExporterInterface{
    emit : (event: TelemetryEventInterface) => void ;
    forceFlush: () => Promise<void> ;
    shutdown: () => Promise<void> ;
}