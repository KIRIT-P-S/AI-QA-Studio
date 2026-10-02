import fs from 'fs';
import path from 'path';

export class EvidenceCollector {
    private evidenceDir: string;

    constructor() {
        this.evidenceDir = path.join(process.cwd(), 'evidence');
        this.ensureDirectories();
    }

    private ensureDirectories() {
        const dirs = ['screenshots', 'videos', 'network', 'console'];
        dirs.forEach(dir => {
            const fullPath = path.join(this.evidenceDir, dir);
            if (!fs.existsSync(fullPath)) {
                fs.mkdirSync(fullPath, { recursive: true });
            }
        });
    }

    async saveNetworkTrace(testId: string, traceData: any) {
        const filePath = path.join(this.evidenceDir, 'network', `${testId}_trace.json`);
        fs.writeFileSync(filePath, JSON.stringify(traceData, null, 2));
        return filePath;
    }

    async saveConsoleLogs(testId: string, logs: string[]) {
        const filePath = path.join(this.evidenceDir, 'console', `${testId}_console.log`);
        fs.writeFileSync(filePath, logs.join('\n'));
        return filePath;
    }
}
