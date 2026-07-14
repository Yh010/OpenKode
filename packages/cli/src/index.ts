// cli client
import { askAI } from "@openkode/core";


async function main() {

    const prompt =
        process.argv.slice(2).join(" ");


    if (!prompt) {
        console.log(
            "Usage: openkode <question>"
        );
        return;
    }


    const response = await askAI(prompt);


    console.log("\n🤖 OpenKode:");
    console.log(response);

}


main();