pub mod executor;
pub mod memory;
pub mod planner;
pub mod security;
pub mod tools;

use anyhow::Result;
use serde::{Deserialize, Serialize};

/// Core runtime for Nova agent execution
#[derive(Debug)]
pub struct Runtime {
    executor: executor::Executor,
    memory: memory::MemoryStore,
    security: security::SecurityManager,
    tools: tools::ToolRegistry,
    planner: planner::Planner,
}

impl Runtime {
    /// Create a new runtime instance
    pub async fn new(config: RuntimeConfig) -> Result<Self> {
        let memory = memory::MemoryStore::new(&config.memory_path).await?;
        let security = security::SecurityManager::new(config.security);
        let tools = tools::ToolRegistry::new();
        let executor = executor::Executor::new(config.executor);
        let planner = planner::Planner::new();

        Ok(Self {
            executor,
            memory,
            security,
            tools,
            planner,
        })
    }

    /// Execute a task with the given context
    pub async fn execute(&self, task: Task) -> Result<TaskResult> {
        // 1. Plan the execution
        let plan = self.planner.plan(&task).await?;

        // 2. Check security permissions
        self.security.authorize(&plan)?;

        // 3. Execute the plan
        let result = self.executor.execute(plan, &self.tools).await?;

        // 4. Store in memory
        self.memory.store_execution(&task, &result).await?;

        Ok(result)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeConfig {
    pub memory_path: String,
    pub security: security::SecurityConfig,
    pub executor: executor::ExecutorConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub description: String,
    pub tool_calls: Vec<ToolCall>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub tool_name: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResult {
    pub task_id: String,
    pub success: bool,
    pub outputs: Vec<serde_json::Value>,
    pub duration_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_runtime_creation() {
        let config = RuntimeConfig {
            memory_path: ":memory:".to_string(),
            security: security::SecurityConfig::default(),
            executor: executor::ExecutorConfig::default(),
        };

        let runtime = Runtime::new(config).await;
        assert!(runtime.is_ok());
    }
}
