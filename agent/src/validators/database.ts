import { Client } from 'pg';

export class DatabaseValidator {
    private client: Client;

    constructor(connectionString: string) {
        // Enforce Read-Only by connecting with a user that only has SELECT privileges
        // For MVP, we mock the connection string
        this.client = new Client({
            connectionString: connectionString || process.env.DATABASE_URL
        });
    }

    async connect() {
        await this.client.connect();
    }

    async disconnect() {
        await this.client.end();
    }

    /**
     * Executes a read-only query.
     * Prevents INSERT, UPDATE, DELETE, ALTER, DROP.
     */
    async query(sql: string, params: any[] = []): Promise<any[]> {
        const upperSql = sql.toUpperCase();
        if (
            upperSql.includes('INSERT ') ||
            upperSql.includes('UPDATE ') ||
            upperSql.includes('DELETE ') ||
            upperSql.includes('DROP ') ||
            upperSql.includes('ALTER ')
        ) {
            throw new Error('SECURITY VIOLATION: AI Test Agent is restricted to READ-ONLY queries.');
        }

        try {
            const res = await this.client.query(sql, params);
            return res.rows;
        } catch (error) {
            console.error('Database Validation Error:', error);
            throw error;
        }
    }
}
