use nova_core::{Runtime, RuntimeConfig, Task, ToolCall};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt::init();

    // Create runtime configuration
    let config = RuntimeConfig {
        memory_path: ":memory:".to_string(),
        security: nova_core::security::SecurityConfig::default(),
        executor: nova_core::executor::ExecutorConfig::default(),
    };

    // Create runtime
    let runtime = Runtime::new(config).await?;

    // Create a simple task
    let task = Task {
        id: "task-1".to_string(),
        description: "Read a file and display its contents".to_string(),
        tool_calls: vec![
            ToolCall {
                tool_name: "read".to_string(),
                parameters: serde_json::json!({
                    "path": "/tmp/test.txt"
                }),
            },
        ],
    };

    // Execute the task
    println!("Executing task: {}", task.description);
    let result = runtime.execute(task).await?;

    println!("Task completed successfully!");
    println!("Success: {}", result.success);
    println!("Duration: {}ms", result.duration_ms);

    Ok(())
}
