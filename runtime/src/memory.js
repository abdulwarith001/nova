import Database from "better-sqlite3";
/**
 * Enhanced memory store with contextual awareness
 */
export class MemoryStore {
    db;
    userProfile;
    agentProfile;
    constructor(db) {
        this.db = db;
        this.userProfile = {
            preferences: {},
            goals: [],
            context: [],
        };
        this.agentProfile = {
            capabilities: [
                "bash execution",
                "file operations",
                "browser automation",
                "web scraping",
                "multi-step reasoning",
            ],
            limitations: [
                "cannot access local GUI applications",
                "limited to text-based interactions",
                "requires API keys for LLM access",
            ],
            preferences: {},
            version: "1.0.0",
        };
    }
    /**
     * Create a new memory store
     */
    static async create(path) {
        const db = new Database(path);
        const store = new MemoryStore(db);
        store.initializeSchema();
        store.loadProfiles();
        return store;
    }
    /**
     * Initialize database schema
     */
    initializeSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        importance REAL DEFAULT 0.5,
        decay_rate REAL DEFAULT 0.1,
        tags TEXT,
        source TEXT,
        session_id TEXT,
        category TEXT DEFAULT 'fact',
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_timestamp ON memories(timestamp);
      CREATE INDEX IF NOT EXISTS idx_importance ON memories(importance);
      CREATE INDEX IF NOT EXISTS idx_session ON memories(session_id);
      CREATE INDEX IF NOT EXISTS idx_category ON memories(category);

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        tags,
        content=memories,
        content_rowid=rowid
      );

      CREATE TABLE IF NOT EXISTS memory_relations (
        from_id TEXT,
        to_id TEXT,
        relation_type TEXT,
        strength REAL,
        PRIMARY KEY (from_id, to_id)
      );

      CREATE TABLE IF NOT EXISTS user_profile (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_profile (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    }
    /**
     * Load user and agent profiles
     */
    loadProfiles() {
        // Load user profile
        const userRows = this.db
            .prepare("SELECT key, value FROM user_profile")
            .all();
        for (const row of userRows) {
            try {
                const value = JSON.parse(row.value);
                if (row.key === "preferences")
                    this.userProfile.preferences = value;
                else if (row.key === "goals")
                    this.userProfile.goals = value;
                else if (row.key === "context")
                    this.userProfile.context = value;
                else if (row.key === "name")
                    this.userProfile.name = value;
                else if (row.key === "workStyle")
                    this.userProfile.workStyle = value;
            }
            catch (e) {
                console.error(`Failed to parse user profile key ${row.key}:`, e);
            }
        }
        // Load agent profile
        const agentRows = this.db
            .prepare("SELECT key, value FROM agent_profile")
            .all();
        for (const row of agentRows) {
            try {
                const value = JSON.parse(row.value);
                if (row.key === "capabilities")
                    this.agentProfile.capabilities = value;
                else if (row.key === "limitations")
                    this.agentProfile.limitations = value;
                else if (row.key === "preferences")
                    this.agentProfile.preferences = value;
            }
            catch (e) {
                console.error(`Failed to parse agent profile key ${row.key}:`, e);
            }
        }
    }
    /**
     * Store a new memory
     */
    async store(memory) {
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO memories (
        id, content, timestamp, importance, decay_rate,
        tags, source, session_id, category, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(memory.id, memory.content, memory.timestamp, memory.importance, memory.decayRate, JSON.stringify(memory.tags), memory.source, memory.sessionId, memory.category, JSON.stringify(memory.metadata));
    }
    /**
     * Search memories with category filter
     */
    async search(query, options = {}) {
        const limit = options.limit || 10;
        const minImportance = options.minImportance || 0;
        // Escape FTS5 special characters
        const escapedQuery = query.replace(/[:".\-()]/g, " ").trim();
        if (!escapedQuery) {
            // If query is empty after escaping, just return recent memories
            return this.getRecent(options.category || "fact", limit);
        }
        let sql = `
      SELECT m.* FROM memories m
      JOIN memories_fts fts ON m.rowid = fts.rowid
      WHERE memories_fts MATCH ?
        AND m.importance >= ?
    `;
        const params = [escapedQuery, minImportance];
        if (options.category) {
            sql += " AND m.category = ?";
            params.push(options.category);
        }
        sql += " ORDER BY m.importance DESC, m.timestamp DESC LIMIT ?";
        params.push(limit);
        try {
            const stmt = this.db.prepare(sql);
            const rows = stmt.all(...params);
            return rows.map((row) => ({
                id: row.id,
                content: row.content,
                timestamp: row.timestamp,
                importance: row.importance,
                decayRate: row.decay_rate,
                tags: JSON.parse(row.tags || "[]"),
                source: row.source,
                sessionId: row.session_id,
                category: row.category,
                metadata: JSON.parse(row.metadata || "{}"),
            }));
        }
        catch (error) {
            console.error("Search failed, falling back to recent:", error);
            return this.getRecent(options.category || "fact", limit);
        }
    }
    /**
     * Get recent memories by category
     */
    async getRecent(category, limit = 10) {
        const stmt = this.db.prepare(`
      SELECT * FROM memories
      WHERE category = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
        const rows = stmt.all(category, limit);
        return rows.map((row) => ({
            id: row.id,
            content: row.content,
            timestamp: row.timestamp,
            importance: row.importance,
            decayRate: row.decay_rate,
            tags: JSON.parse(row.tags || "[]"),
            source: row.source,
            sessionId: row.session_id,
            category: row.category,
            metadata: JSON.parse(row.metadata || "{}"),
        }));
    }
    /**
     * Update user profile
     */
    async updateUserProfile(updates) {
        const timestamp = Date.now();
        for (const [key, value] of Object.entries(updates)) {
            if (value !== undefined) {
                this.db
                    .prepare(`INSERT OR REPLACE INTO user_profile (key, value, updated_at) VALUES (?, ?, ?)`)
                    .run(key, JSON.stringify(value), timestamp);
                // Update in-memory profile
                this.userProfile[key] = value;
            }
        }
    }
    /**
     * Update agent profile
     */
    async updateAgentProfile(updates) {
        const timestamp = Date.now();
        for (const [key, value] of Object.entries(updates)) {
            if (value !== undefined) {
                this.db
                    .prepare(`INSERT OR REPLACE INTO agent_profile (key, value, updated_at) VALUES (?, ?, ?)`)
                    .run(key, JSON.stringify(value), timestamp);
                // Update in-memory profile
                this.agentProfile[key] = value;
            }
        }
    }
    /**
     * Get user profile
     */
    getUserProfile() {
        return { ...this.userProfile };
    }
    /**
     * Get agent profile
     */
    getAgentProfile() {
        return { ...this.agentProfile };
    }
    /**
     * Build context for agent
     */
    async buildContext(query) {
        const parts = [];
        // Agent self-knowledge
        parts.push("## About Me (Nova)");
        parts.push(`Version: ${this.agentProfile.version}`);
        parts.push(`\nCapabilities:\n${this.agentProfile.capabilities.map((c) => `- ${c}`).join("\n")}`);
        parts.push(`\nLimitations:\n${this.agentProfile.limitations.map((l) => `- ${l}`).join("\n")}`);
        // User context
        if (this.userProfile.name) {
            parts.push(`\n## About You`);
            parts.push(`Name: ${this.userProfile.name}`);
        }
        if (this.userProfile.workStyle) {
            parts.push(`Work Style: ${this.userProfile.workStyle}`);
        }
        if (this.userProfile.goals.length > 0) {
            parts.push(`\nGoals:\n${this.userProfile.goals.map((g) => `- ${g}`).join("\n")}`);
        }
        // Recent relevant memories
        if (query) {
            const relevantMemories = await this.search(query, {
                limit: 5,
                minImportance: 0.6,
            });
            if (relevantMemories.length > 0) {
                parts.push("\n## Relevant Context");
                for (const memory of relevantMemories) {
                    parts.push(`- ${memory.content}`);
                }
            }
        }
        return parts.join("\n");
    }
    /**
     * Store task execution in memory
     */
    async storeExecution(task, result) {
        const memory = {
            id: `exec-${task.id}-${Date.now()}`,
            content: `Executed task: ${task.description}`,
            timestamp: Date.now(),
            importance: 0.7,
            decayRate: 0.1,
            tags: ["execution", "task"],
            source: "runtime",
            category: "task",
            metadata: {
                taskId: task.id,
                success: result.success,
            },
        };
        await this.store(memory);
    }
    /**
     * Get the underlying database instance
     */
    getDatabase() {
        return this.db;
    }
    /**
     * Close database connection
     */
    close() {
        this.db.close();
    }
}
//# sourceMappingURL=memory.js.map