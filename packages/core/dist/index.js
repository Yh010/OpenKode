// Headless AI Agent Core
export async function askAI(prompt) {
    const response = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "qwen2.5-coder:3b",
            prompt,
            stream: false
        })
    });
    const data = await response.json();
    return data.response;
}
//# sourceMappingURL=index.js.map