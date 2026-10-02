import { Page } from 'playwright';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'mock-key' });
const FREE_MODEL = 'gemini-2.5-flash';

export interface DiscoveredElement {
    selector: string;
    description: string;
    type: 'button' | 'input' | 'link' | 'table' | 'form' | 'unknown';
}

export class AIDiscovery {

    /**
     * Uses Playwright to accurately discover interactive elements (inputs, buttons, links)
     * and their attributes, returning 100% valid CSS selectors for the AI Generator.
     */
    async discoverPageElements(page: Page): Promise<DiscoveredElement[]> {
        console.log('🤖 Scanning DOM for interactive elements using Playwright...');

        try {
            // Wait for network idle to ensure the page is fully loaded
            await page.waitForLoadState('domcontentloaded');

            const elements = await page.evaluate(() => {
                const results: any[] = [];

                // Extract Inputs
                document.querySelectorAll('input:not([type="hidden"]), textarea').forEach((el) => {
                    const id = el.id ? `#${el.id}` : '';
                    const name = (el as HTMLInputElement).name ? `[name="${(el as HTMLInputElement).name}"]` : '';
                    const placeholder = (el as HTMLInputElement).placeholder || '';
                    if (id || name) {
                        results.push({
                            selector: id || `input${name}`,
                            description: `Input field: ${placeholder || (el as HTMLInputElement).name || id}`,
                            type: 'input'
                        });
                    }
                });

                // Extract Buttons
                document.querySelectorAll('button, input[type="submit"], input[type="button"]').forEach((el) => {
                    const id = el.id ? `#${el.id}` : '';
                    const text = (el as HTMLElement).innerText?.trim() || (el as HTMLInputElement).value?.trim() || '';
                    const aria = el.getAttribute('aria-label') || '';
                    if (id) {
                        results.push({
                            selector: id,
                            description: `Button: ${text || aria || id}`,
                            type: 'button'
                        });
                    }
                });

                // Extract Links
                document.querySelectorAll('a[href]').forEach((el) => {
                    const id = el.id ? `#${el.id}` : '';
                    const text = (el as HTMLElement).innerText?.trim() || '';
                    if (id) {
                        results.push({
                            selector: id,
                            description: `Link: ${text}`,
                            type: 'link'
                        });
                    }
                });

                return results;
            });

            // Limit to the first 40 elements to avoid overloading the Gemini context window
            return elements.slice(0, 40);

        } catch (error) {
            console.error("AI Discovery Error:", error);
            return [];
        }
    }
}
