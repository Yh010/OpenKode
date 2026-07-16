// // Headless AI Agent Core
// export async function askAI(prompt: string) {

import type { LLMProvider } from "../interface/LLMProvider.js";
import type { LLMRequest } from "../interface/LLMRequest.js";
import type { LLMResponse } from "../interface/LLMResponse.js";

//     const response = await fetch(
//         "http://localhost:11434/api/generate",
//         {
//             method: "POST",
//             headers: {
//                 "Content-Type": "application/json"
//             },
//             body: JSON.stringify({
//                 model: "qwen2.5-coder:3b",
//                 prompt,
//                 stream: false
//             })
//         }
//     );


//     const data = await response.json();

//     return data.response;
// }

// export async function streamAIResponse(prompt: string, onChunk: (text: string) => void) {
//     const response = await fetch(
//         "http://localhost:11434/api/generate",
//         {
//             method: "POST",
//             headers: {
//                 "Content-Type": "application/json"
//             },
//             body: JSON.stringify({
//                 model: "qwen2.5-coder:3b",
//                 prompt,
//                 stream: true
//             })
//         }
//     );

//     const reader = response.body?.getReader();

//     if (!reader) {
//         throw new Error("No response stream");
//     }

//     const decoder = new TextDecoder();

//     while (true) {
//         const { done, value } = await reader.read();

//         if (done) break;

//         const chunk = decoder.decode(value);
//         const lines = chunk.split("\n");

//         for (const line of lines) {
//             if (!line.trim()) continue;

//             const data = JSON.parse(line);


//             if (data.response) {
//                 onChunk(data.response);
//             }
//         }
//     }
// }


export class OllamaProvider implements LLMProvider {
    async generate(request: LLMRequest): Promise<LLMResponse> {
        const response = await fetch(
            "http://localhost:11434/api/generate",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "qwen2.5-coder:3b",
                    prompt: request.prompt,
                    stream: false
                })
            }
        );

        const data = await response.json();

        return {
            response: data.response
        };
    }
}