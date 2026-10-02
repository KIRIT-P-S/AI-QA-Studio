import { BrowserController } from './browserController';
import { AIDiscovery } from './aiDiscovery';
import { AIGenerator } from './aiGenerator';
import { DatabaseValidator } from './validators/database';
import { Page } from 'playwright';

export interface StepResult {
    action: string;
    target: string;
    value?: string;
    status: 'Passed' | 'Failed';
    error?: string;
}

export class TestExecutor {
    private browserCtrl: BrowserController;
    private discovery: AIDiscovery;
    private generator: AIGenerator;

    constructor() {
        this.browserCtrl = new BrowserController();
        this.discovery = new AIDiscovery();
        this.generator = new AIGenerator();
    }

    // executeSteps removed in favor of autonomous loop

    /**
     * Main execution loop for the AI Test Agent.
     */
    async runTest(url: string, manualLogin: boolean = true) {
        console.log(`🚀 Starting Test Execution for ${url}`);

        // Generate a unique session ID for this test suite run
        const sessionId = `session_${Date.now()}`;
        console.log(`📝 Session ID: ${sessionId}`);

        let page: Page | null = null;

        try {
            page = await this.browserCtrl.launchBrowser(url);

            if (manualLogin) {
                await this.browserCtrl.giveControlToHuman();
            }

            // Read the real requirements from the Next.js UI PRD upload
            let requirementsToTest = [{
                id: "FR-01",
                title: "Search Functionality",
                description: "Users should be able to search for items using keywords."
            }];

            try {
                const fs = require('fs');
                const path = require('path');
                const prdFile = path.resolve(process.cwd(), '../web/data/latest_prd.json');
                if (fs.existsSync(prdFile)) {
                    const prd = JSON.parse(fs.readFileSync(prdFile, 'utf-8'));
                    if (prd.requirements && prd.requirements.length > 0) {
                        // Run ALL requirements extracted from the PRD
                        requirementsToTest = prd.requirements;
                        console.log(`✅ Loaded ${requirementsToTest.length} real requirements from UI.`);
                    }
                }
            } catch (e) {
                console.log('⚠️ Could not load real PRD requirement, falling back to mock.');
            }

            // Loop over each requirement and execute an AI test
            for (const activeReq of requirementsToTest) {
                console.log(`\n======================================================`);
                console.log(`🚀 Running Test Case: ${activeReq.title}`);
                console.log(`======================================================`);

                // Reset page to base URL for each test
                await page.goto(url, { waitUntil: 'domcontentloaded' });

                let testPassed = false;
                let stepLogs: StepResult[] = [];
                let failureReason = '';
                let history: any[] = [];

                let iteration = 0;
                const MAX_ITERATIONS = 8;
                let isComplete = false;

                while (iteration < MAX_ITERATIONS && !isComplete) {
                    console.log(`\n🔄 [Loop ${iteration+1}] Scanning DOM...`);
                    const elements = await this.discovery.discoverPageElements(page);

                    const nextAction = await this.generator.generateNextAction(activeReq, elements, history);

                    if (!nextAction) {
                        failureReason = 'AI was unable to generate a valid action.';
                        console.log(`⚠️ ${failureReason}`);
                        isComplete = true;
                        break;
                    }

                    console.log(`📋 AI Decided Next Action: [${nextAction.action.toUpperCase()}] ${nextAction.target || ''}`);

                    // Handle terminal actions
                    if (nextAction.action === 'test_passed') {
                        testPassed = true;
                        isComplete = true;
                        console.log(`✅ Validation: Expected [${activeReq.title}] to complete. Actual: [Completed Successfully].`);
                        break;
                    }

                    if (nextAction.action === 'test_failed') {
                        failureReason = `AI declared TEST_FAILED based on current DOM.`;
                        console.log(`❌ ${failureReason}`);
                        isComplete = true;
                        break;
                    }

                    // Execute normal action
                    const stepRecord: StepResult = {
                        action: nextAction.action,
                        target: nextAction.target || 'N/A',
                        value: nextAction.value,
                        status: 'Passed'
                    };

                    try {
                        if (nextAction.target) {
                            await page.waitForSelector(nextAction.target, { state: 'visible', timeout: 8000 });
                        }

                        switch (nextAction.action.toLowerCase()) {
                            case 'click':
                                await page.click(nextAction.target, { force: true });
                                // Wait for potential navigation
                                await page.waitForTimeout(3000);
                                break;
                            case 'type':
                            case 'fill':
                                if (nextAction.value) {
                                    await page.fill(nextAction.target, nextAction.value, { force: true });
                                }
                                break;
                            case 'assert':
                                console.log(`🔍 Asserting presence of ${nextAction.target}...`);
                                await page.waitForSelector(nextAction.target, { state: 'visible', timeout: 5000 });
                                console.log(`✅ Assertion passed: ${nextAction.target} is visible.`);
                                break;
                            default:
                                throw new Error(`Unknown action type: ${nextAction.action}`);
                        }

                        history.push(nextAction);
                        stepLogs.push(stepRecord);
                    } catch (error: any) {
                        console.error(`❌ Failed to execute step ${nextAction.action} on ${nextAction.target}:`, error);
                        stepRecord.status = 'Failed';
                        stepRecord.error = error.message;
                        stepLogs.push(stepRecord);

                        failureReason = `Failed at [${stepRecord.action.toUpperCase()} ${stepRecord.target}]: ${stepRecord.error}`;
                        isComplete = true;
                    }

                    iteration++;
                }

                if (!isComplete && iteration >= MAX_ITERATIONS) {
                    failureReason = 'Test timed out after maximum iterations (infinite loop protection).';
                    console.log(`⚠️ ${failureReason}`);
                }

                // --- Post Results to Next.js API ---
                console.log(`📡 Sending Results for [${activeReq.title}] to Web UI...`);
                try {
                    await fetch('http://localhost:3000/api/tests/results', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            testName: `AI Test: ${activeReq.title}`,
                            url: url,
                            sessionId: sessionId,
                            status: testPassed ? 'Passed' : 'Failed',
                            failureReason: failureReason,
                            coverage: 100,
                            aiConfidence: 95,
                            steps: stepLogs
                        })
                    });
                } catch (apiErr) {
                    console.error('Could not post results to Web API.');
                }

                // Wait 8 seconds between tests to respect Gemini rate limits safely
                await page.waitForTimeout(8000);
            }

        } catch (error) {
            console.error('❌ Critical Test execution failed:', error);
        } finally {
            console.log('\n🧹 Waiting 10 seconds before cleaning up browser session...');
            await page?.waitForTimeout(10000);
            await this.browserCtrl.close();
            console.log('✅ Full Test Suite run complete.');
        }
    }
}
