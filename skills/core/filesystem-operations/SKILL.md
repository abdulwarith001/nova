---
name: Filesystem Operations
description: Read and write files on the local filesystem
category: filesystem
keywords: [file, read, write, create, save, open, contents]
---

# Filesystem Operations

## Overview

Read and write files on the local filesystem. Essential for saving data, reading configurations, creating logs, and managing file-based workflows.

## When to Use

- User wants to create a new file
- Need to read file contents
- Save data to disk
- Update existing files
- Create configuration files

## Available Tools

- **read** - Read contents from a file
- **write** - Write or create a file with content

## Examples

### Create a New File

**User**: "Create a file called notes.txt with 'Meeting at 3pm'"

**Nova**: Uses `write` tool:

```json
{
  "path": "notes.txt",
  "content": "Meeting at 3pm"
}
```

### Read a File

**User**: "What's in config.json?"

**Nova**: Uses `read` tool:

```json
{
  "path": "config.json"
}
```

### Update a File

**User**: "Add 'New line' to notes.txt"

**Nova**:

1. Uses `read` to get current contents
2. Uses `write` with updated contents

## Best Practices

1. **Use relative paths** when possible
2. **Ask before overwriting** existing files
3. **Validate paths** - avoid writing to system directories
4. **Handle errors gracefully** - file might not exist or be unreadable
5. **Consider file size** - large files may take time to read

## Limitations

- Cannot read binary files (images, PDFs, etc.)
- No directory creation (use bash for `mkdir`)
- No file deletion (use bash for `rm`)
- No file permissions management
