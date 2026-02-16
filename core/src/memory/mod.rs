use anyhow::Result;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Unified memory store with vector search capabilities
#[derive(Debug)]
pub struct MemoryStore {
    conn: Connection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Memory {
    pub id: String,
    pub content: String,
    pub embedding: Option<Vec<f32>>,
    pub timestamp: i64,
    pub importance: f32,
    pub decay_rate: f32,
    pub tags: Vec<String>,
    pub source: String,
    pub session_id: Option<String>,
    pub metadata: serde_json::Value,
}

impl MemoryStore {
    /// Create a new memory store
    pub async fn new(path: &str) -> Result<Self> {
        let conn = if path == ":memory:" {
            Connection::open_in_memory()?
        } else {
            Connection::open(Path::new(path))?
        };

        let store = Self { conn };
        store.initialize_schema()?;
        Ok(store)
    }

    fn initialize_schema(&self) -> Result<()> {
        self.conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                embedding BLOB,
                timestamp INTEGER NOT NULL,
                importance REAL DEFAULT 0.5,
                decay_rate REAL DEFAULT 0.1,
                tags TEXT,
                source TEXT,
                session_id TEXT,
                metadata TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_timestamp ON memories(timestamp);
            CREATE INDEX IF NOT EXISTS idx_importance ON memories(importance);
            CREATE INDEX IF NOT EXISTS idx_session ON memories(session_id);

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
            "#,
        )?;

        Ok(())
    }

    /// Store a new memory
    pub async fn store(&self, memory: &Memory) -> Result<()> {
        let tags_json = serde_json::to_string(&memory.tags)?;
        let metadata_json = serde_json::to_string(&memory.metadata)?;

        self.conn.execute(
            r#"
            INSERT INTO memories (
                id, content, timestamp, importance, decay_rate,
                tags, source, session_id, metadata
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            "#,
            params![
                memory.id,
                memory.content,
                memory.timestamp,
                memory.importance,
                memory.decay_rate,
                tags_json,
                memory.source,
                memory.session_id,
                metadata_json,
            ],
        )?;

        Ok(())
    }

    /// Retrieve memories using hybrid search
    pub async fn search(&self, query: &str, limit: usize) -> Result<Vec<Memory>> {
        // TODO: Implement hybrid search (vector + keyword + temporal)
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, content, timestamp, importance, decay_rate,
                   tags, source, session_id, metadata
            FROM memories
            WHERE content LIKE ?1
            ORDER BY importance DESC, timestamp DESC
            LIMIT ?2
            "#,
        )?;

        let memories = stmt
            .query_map(params![format!("%{}%", query), limit], |row| {
                let tags_json: String = row.get(5)?;
                let metadata_json: String = row.get(8)?;

                Ok(Memory {
                    id: row.get(0)?,
                    content: row.get(1)?,
                    embedding: None,
                    timestamp: row.get(2)?,
                    importance: row.get(3)?,
                    decay_rate: row.get(4)?,
                    tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                    source: row.get(6)?,
                    session_id: row.get(7)?,
                    metadata: serde_json::from_str(&metadata_json).unwrap_or(serde_json::json!({})),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(memories)
    }

    /// Store task execution in memory
    pub async fn store_execution(
        &self,
        task: &crate::Task,
        result: &crate::TaskResult,
    ) -> Result<()> {
        let memory = Memory {
            id: uuid::Uuid::new_v4().to_string(),
            content: format!("Executed task: {}", task.description),
            embedding: None,
            timestamp: chrono::Utc::now().timestamp(),
            importance: 0.7,
            decay_rate: 0.1,
            tags: vec!["execution".to_string(), "task".to_string()],
            source: "runtime".to_string(),
            session_id: None,
            metadata: serde_json::json!({
                "task_id": task.id,
                "success": result.success,
                "duration_ms": result.duration_ms,
            }),
        };

        self.store(&memory).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_memory_store() {
        let store = MemoryStore::new(":memory:").await.unwrap();

        let memory = Memory {
            id: "test-1".to_string(),
            content: "Test memory".to_string(),
            embedding: None,
            timestamp: chrono::Utc::now().timestamp(),
            importance: 0.8,
            decay_rate: 0.1,
            tags: vec!["test".to_string()],
            source: "test".to_string(),
            session_id: None,
            metadata: serde_json::json!({}),
        };

        store.store(&memory).await.unwrap();

        let results = store.search("Test", 10).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].content, "Test memory");
    }
}
