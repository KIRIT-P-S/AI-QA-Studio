import { chromium, Browser, Page, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs';

export class BrowserController {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private currentMode: 'AI' | 'MANUAL' = 'MANUAL';

    async launchBrowser(url: string): Promise<Page> {
        console.log(`Launching Playwright (Visible Mode) for URL: ${url}`);

        // Ensure evidence directories exist
        const videoDir = path.join(process.cwd(), 'evidence', 'videos');
        if (!fs.existsSync(videoDir)) {
            fs.mkdirSync(videoDir, { recursive: true });
        }

        this.browser = await chromium.launch({
            headless: false, // Core MVP requirement: visible browser for manual handoff
            slowMo: 50 // Slow down slightly so humans can observe AI actions
        });

        this.context = await this.browser.newContext({
            recordVideo: { dir: videoDir },
            viewport: { width: 1280, height: 720 }
        });

        this.page = await this.context.newPage();
        await this.page.goto(url);

        return this.page;
    }

    /**
     * Pauses the AI execution to allow human intervention (e.g., for login, CAPTCHA).
     */
    async giveControlToHuman(): Promise<void> {
        if (!this.page) throw new Error('Browser is not initialized.');

        this.currentMode = 'MANUAL';
        console.log('\n======================================================');
        console.log('⏸️ AI PAUSED. HUMAN HAS CONTROL.');
        console.log('Please complete necessary actions (like login) in the browser window.');
        console.log('The Playwright Inspector has opened. Click "Resume" (▶) in the inspector when you want to give control back to AI.');
        console.log('======================================================\n');

        // This opens the Playwright Inspector and pauses execution until the user clicks Resume
        await this.page.pause();

        this.currentMode = 'AI';
        console.log('▶️ HUMAN FINISHED. AI RESUMING CONTROL.\n');
    }

    async getPage(): Promise<Page> {
        if (!this.page) throw new Error('Browser is not initialized.');
        return this.page;
    }

    async captureScreenshot(name: string): Promise<string> {
        if (!this.page) throw new Error('Browser is not initialized.');
        const screenshotDir = path.join(process.cwd(), 'evidence', 'screenshots');
        if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

        const filePath = path.join(screenshotDir, `${name}.png`);
        await this.page.screenshot({ path: filePath, fullPage: true });
        return filePath;
    }

    async close(): Promise<void> {
        if (this.context) await this.context.close(); // Ensure video saves properly
        if (this.browser) await this.browser.close();
    }
}
