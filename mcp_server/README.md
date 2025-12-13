# MCP Test Server

A simple MCP (Model Context Protocol) server that provides filesystem tools for the Obsidian AI Plugin.

## Quick Start

```bash
# Run with default settings
python server.py

# Or with custom settings
MCP_API_KEY="my-secret-key" MCP_PORT=9000 MCP_BASE_DIR="/path/to/allowed/dir" python server.py
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_API_KEY` | `dev-key-12345` | API key for authentication |
| `MCP_PORT` | `8765` | Port to listen on |
| `MCP_BASE_DIR` | `~` (home dir) | Base directory for filesystem operations |

## Security

- All filesystem operations are restricted to `MCP_BASE_DIR`
- Paths outside this directory will be rejected
- API key authentication is required for all requests

## API

### List Tools
```
GET /tools
Authorization: Bearer <api_key>
```

Returns:
```json
{
  "tools": [
    {
      "name": "list_directory",
      "description": "...",
      "parameters": {...},
      "safe": true
    },
    ...
  ]
}
```

### Execute Tool
```
POST /execute
Authorization: Bearer <api_key>
Content-Type: application/json

{
  "name": "list_directory",
  "arguments": {
    "path": "/Users/me/Documents"
  }
}
```

Returns:
```json
{
  "result": "Contents of /Users/me/Documents:\n📁 Projects\n📄 notes.txt (1.2KB)"
}
```

Or on error:
```json
{
  "error": "Path must be under /Users/me"
}
```

### Health Check
```
GET /health
Authorization: Bearer <api_key>
```

Returns:
```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

## Available Tools

| Tool | Safe | Description |
|------|------|-------------|
| `list_directory` | ✅ | List files and directories |
| `read_file` | ✅ | Read file contents |
| `create_file` | ❌ | Create a new file (fails if exists) |
| `write_file` | ❌ | Write/overwrite a file |
| `append_to_file` | ❌ | Append to existing file |
| `create_directory` | ❌ | Create a directory |

"Safe" tools are read-only and don't require user confirmation in the plugin.

