export class AIGenerator {
    private readonly model = 'qwen2.5:3b';
    private readonly apiUrl = 'http://127.0.0.1:11434/api/generate';

    constructor() {}

    /**
     * Sends the DOM elements, PRD requirement, and execution history to Ollama to determine the next single action.
     */
    async generateNextAction(requirement: any, domElements: any[], history: any[]): Promise<any> {
        const prompt = `You are an Autonomous AI QA Agent.
Your goal is to test the following Product Requirement by interacting with the web page one step at a time.

Requirement: ${JSON.stringify(requirement, null, 2)}
Past Actions Taken: ${JSON.stringify(history, null, 2)}
Current DOM Elements: ${JSON.stringify(domElements, null, 2)}

Instructions:
1. Analyze the 'Past Actions Taken' and 'Current DOM Elements'.
2. Determine the single most logical NEXT step to progress towards verifying the requirement.
3. If you have successfully verified the requirement based on the current DOM, output action: "test_passed".
4. If you are stuck or the requirement is impossible to verify, output action: "test_failed".
5. Respond ONLY with a valid JSON object. Do not wrap in markdown backticks.

Format:
{
  "action": "click" | "fill" | "assert" | "test_passed" | "test_failed",
  "target": "selector string (if applicable)",
  "value": "input string (if applicable)"
}`;

        console.log(`🤖 Asking Ollama (${this.model}) for the next action...`);
        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.model,
                    prompt: prompt,
                    format: 'json',
                    stream: false,
                    options: {
                        temperature: 0.1
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`Ollama API failed with status ${response.status}`);
            }

            const data = await response.json();

            if (data.response) {
                let rawResponse = data.response.trim();

                // Strip markdown backticks if present
                if (rawResponse.startsWith('```json')) {
                    rawResponse = rawResponse.replace(/^```json/, '').replace(/```$/, '').trim();
                } else if (rawResponse.startsWith('```')) {
                    rawResponse = rawResponse.replace(/^```/, '').replace(/```$/, '').trim();
                }

                // If there's preamble, extract just the object
                const objStart = rawResponse.indexOf('{');
                const objEnd = rawResponse.lastIndexOf('}');

                if (objStart !== -1 && objEnd !== -1) {
                    rawResponse = rawResponse.substring(objStart, objEnd + 1);
                }

                try {
                    const action = JSON.parse(rawResponse);
                    return action;
                } catch (parseError) {
                    console.error('❌ Failed to parse Ollama JSON output:', rawResponse);
                    return null;
                }
            }
            return null;
        } catch (error: any) {
            console.error('❌ Ollama Generation Error:', error);
            throw new Error('Failed to generate test plan via Ollama.');
        }
    }
}
