---
name: Computer
description: Native computer access — run shell commands, manage files, monitor processes, interact with system
category: system
keywords:
  [
    shell,
    terminal,
    command,
    file,
    script,
    code,
    run,
    execute,
    install,
    process,
    system,
    disk,
    memory,
    cpu,
    read,
    write,
    list,
    directory,
    folder,
    kill,
    pip,
    npm,
    brew,
    git,
    python,
    node,
    clipboard,
    screenshot,
    notification,
    open,
    port,
  ]
status: active
tools: 15
---

# Computer

## Overview

Execute shell commands, manage files, monitor processes, and interact with the host system. Supports persistent shell sessions for multi-step workflows. Cross-platform: macOS, Linux, Windows.

## Available Tools

### Shell & Execution

- **shell_exec** — Run a one-shot shell command
- **shell_session_start** — Start a persistent shell session (retains cwd, env vars, aliases)
- **shell_session_exec** — Run a command in a persistent session
- **shell_session_end** — Close a persistent session

### File System

- **file_read** — Read file contents (with optional line range)
- **file_write** — Write, append, or insert content into a file
- **file_list** — List directory contents with optional glob filtering

### System

- **process_list** — List running processes with CPU/memory usage
- **process_kill** — Kill a process by PID
- **system_info** — Get OS, CPU, memory, disk, and network info

### Desktop

- **clipboard** — Read/write system clipboard
- **notify** — Send native OS notification
- **open_app** — Open files, URLs, or applications
- **screenshot** — Capture desktop screenshot
- **port_info** — Check what's using a specific port
