---
name: System Commands
description: Execute shell commands on the local system
category: system
keywords: [bash, shell, command, terminal, execute, run, script]
---

# System Commands

## Overview

Execute shell commands directly on the system. Powerful for file operations, system info, running scripts, and system administration tasks.

## When to Use

- List files in a directory
- Check system information
- Run scripts or programs
- File operations (cp, mv, rm, mkdir)
- Process management
- Network operations

## Available Tools

- **bash** - Execute any shell command

## Examples

### List Files

**User**: "What files are in the current directory?"

**Nova**: Uses `bash`:

```json
{
  "command": "ls -la"
}
```

### Check Disk Usage

**User**: "How much disk space is used?"

**Nova**: Uses `bash`:

```json
{
  "command": "df -h"
}
```

### Create Directory

**User**: "Make a folder called 'projects'"

**Nova**: Uses `bash`:

```json
{
  "command": "mkdir projects"
}
```

### Move Files

**User**: "Move all .txt files to the docs folder"

**Nova**: Uses `bash`:

```json
{
  "command": "mv *.txt docs/"
}
```

### Run Script

**User**: "Run the deploy script"

**Nova**: Uses `bash`:

```json
{
  "command": "./deploy.sh"
}
```

## Best Practices

1. **Be explicit** - avoid wildcards unless necessary
2. **Check first** - use `ls` before deleting files
3. **Use absolute paths** for important operations
4. **Escape special characters** properly
5. **Avoid destructive commands** without user confirmation
6. **Handle errors** - commands may fail

## Common Commands Reference

**Files:**

- `ls -la` - List files with details
- `cat file.txt` - View file contents
- `mkdir dirname` - Create directory
- `rm file.txt` - Delete file
- `cp src dest` - Copy file
- `mv src dest` - Move/rename

**System:**

- `df -h` - Disk usage
- `top` - Running processes
- `ps aux` - List processes
- `whoami` - Current user
- `pwd` - Current directory

**Network:**

- `ping google.com` - Test connectivity
- `curl url` - Fetch URL
- `wget url` - Download file

## Security Warnings

⚠️ **DANGER ZONE** - These commands are destructive:

- `rm -rf /` - **NEVER** run this
- `dd` - Can overwrite disks
- `mkfs` - Formats drives
- `>(file)` - Overwrites files

Always ask user for confirmation before:

- Deleting files
- Modifying system files
- Running scripts
- Network operations

## Limitations

- Cannot run interactive commands (like vim, nano)
- No sudo/root access (for security)
- Command timeout after 30 seconds
- Output limited to prevent overflow
