use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Tool registry for managing available tools
#[derive(Debug, Clone)]
pub struct ToolRegistry {
    tools: HashMap<String, ToolDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters_schema: serde_json::Value,
    pub permissions: Vec<String>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        let mut registry = Self {
            tools: HashMap::new(),
        };

        // Register built-in tools
        registry.register_builtin_tools();
        registry
    }

    fn register_builtin_tools(&mut self) {
        // Bash tool
        self.tools.insert(
            "bash".to_string(),
            ToolDefinition {
                name: "bash".to_string(),
                description: "Execute shell commands".to_string(),
                parameters_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "Shell command to execute"
                        }
                    },
                    "required": ["command"]
                }),
                permissions: vec!["process".to_string()],
            },
        );

        // Read file tool
        self.tools.insert(
            "read".to_string(),
            ToolDefinition {
                name: "read".to_string(),
                description: "Read file contents".to_string(),
                parameters_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "File path to read"
                        }
                    },
                    "required": ["path"]
                }),
                permissions: vec!["filesystem:read".to_string()],
            },
        );
    }

    pub fn get(&self, name: &str) -> Option<&ToolDefinition> {
        self.tools.get(name)
    }

    pub fn register(&mut self, tool: ToolDefinition) {
        self.tools.insert(tool.name.clone(), tool);
    }
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}
