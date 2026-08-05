export interface TelemetryInterface{
    withRun<T>(name: string, operation: ()=> Promise<T>) : Promise<T> ; 
    withSpan<T>(name: string, operation: ()=> Promise<T>) : Promise<T> ; 
}