use anyhow::Result;
use serde::{Deserialize, Serialize};

/// Security manager with capability-based permissions
#[derive(Debug)]
pub struct SecurityManager {
    config: SecurityConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityConfig {
    pub sandbox_mode: SandboxMode,
    pub allowed_tools: Vec<String>,
    pub denied_tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SandboxMode {
    None,
    Process,
    Container,
    VM,
}

impl Default for SecurityConfig {
    fn default() -> Self {
        Self {
            sandbox_mode: SandboxMode::Process,
            allowed_tools: vec![
                "bash".to_string(),
                "read".to_string(),
                "write".to_string(),
            ],
            denied_tools: vec![],
        }
    }
}

impl SecurityManager {
    pub fn new(config: SecurityConfig) -> Self {
        Self { config }
    }

    /// Authorize an execution plan
    pub fn authorize(&self, plan: &crate::planner::ExecutionPlan) -> Result<()> {
        for step in &plan.steps {
            // Check if tool is allowed
            if !self.config.allowed_tools.is_empty()
                && !self.config.allowed_tools.contains(&step.tool_name)
            {
                anyhow::bail!("Tool '{}' is not in allowlist", step.tool_name);
            }

            // Check if tool is denied
            if self.config.denied_tools.contains(&step.tool_name) {
                anyhow::bail!("Tool '{}' is denied", step.tool_name);
            }
        }

        Ok(())
    }
}
