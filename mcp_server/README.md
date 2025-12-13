# MCP Server

A FastAPI-based Model Context Protocol (MCP) server that provides tools for the Obsidian AI Plugin.

## Features

- **Modular Toolset Architecture**: Easy to add new toolsets
- **System Toolset**: Filesystem, shell, and Python execution
- **Security**: API key authentication + path sandboxing
- **FastAPI**: Modern async Python framework with auto-generated docs

## Quick Start

### 1. Install Dependencies

```bash
cd mcp_server
pip install -r requirements.txt
```

### 2. Configure

```bash
# Copy the example config
cp .env.example .env

# Edit .env with your settings
nano .env
```

### 3. Run

```bash
python server.py
```

The server will start at `http://127.0.0.1:8765`.

- API Docs: http://127.0.0.1:8765/docs
- Health Check: http://127.0.0.1:8765/health

## Configuration

Environment variables (via `.env` file):

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_API_KEY` | `dev-key-12345` | API key for authentication |
| `MCP_PORT` | `8765` | Port to listen on |
| `MCP_HOST` | `127.0.0.1` | Host to bind to |
| `MCP_BASE_DIR` | `~` (home) | Base directory for filesystem operations |
| `MCP_ENABLED_TOOLSETS` | `system` | Comma-separated list of enabled toolsets |
| `LOG_LEVEL` | `INFO` | Logging level |

## API

All endpoints require authentication via `Authorization: Bearer <api_key>` header.

### List Tools
```
GET /tools
```

Returns available tools and their definitions.

### Execute Tool
```
POST /execute
Content-Type: application/json

{
  "name": "list_directory",
  "arguments": {
    "path": "/Users/me/Documents"
  }
}
```

### Health Check
```
GET /health
```

## Available Toolsets

### System Toolset (`system`)

| Tool | Safe | Description |
|------|------|-------------|
| `list_directory` | ✅ | List files and directories |
| `read_file` | ✅ | Read file contents with line numbers |
| `save_file` | ❌ | Save content to a file |
| `copy_file` | ❌ | Copy or move a file |
| `run_command` | ❌ | Run a shell command |
| `execute_python` | ❌ | Execute Python code |
| `fetch_webpage` | ✅ | Fetch URL and convert to markdown |
| `persistent_shell` | ❌ | Persistent shell session |

### Gmail Toolset (`gmail`)

Requires OAuth credentials. See [Gmail Setup](#gmail-setup) below.

| Tool | Safe | Description |
|------|------|-------------|
| `send_email` | ❌ | Send an email |
| `reply_to_email` | ❌ | Reply to an email in thread |
| `search_emails` | ✅ | Search emails with filters |
| `get_email_content` | ✅ | Get full email content |
| `list_recent_emails` | ✅ | List recent emails |
| `list_email_attachments` | ✅ | List email attachments |
| `download_email_attachments` | ❌ | Download attachments |

#### Gmail Setup

1. **Create Google Cloud Project**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project (or select existing)

2. **Enable Gmail API**
   - Go to APIs & Services → Library
   - Search for "Gmail API" and enable it

3. **Create OAuth Credentials**
   - Go to APIs & Services → Credentials
   - Click "Create Credentials" → "OAuth client ID"
   - Select "Desktop app" as application type
   - Download the JSON file

4. **Configure MCP Server**
   ```bash
   # Save credentials in mcp_server directory
   mv ~/Downloads/client_secret_xxx.json mcp_server/credentials.json
   
   # Enable gmail toolset in .env
   MCP_ENABLED_TOOLSETS=system,gmail
   ```

5. **First Run - OAuth Flow**
   - Start the server and call any Gmail tool
   - A browser window will open for Google sign-in
   - Grant permissions to your app
   - `token.pickle` will be saved for future use

### Discord Toolset (`discord`) - Coming Soon

| Tool | Safe | Description |
|------|------|-------------|
| `list_discord_channels` | ✅ | List accessible channels |
| `read_discord_messages` | ✅ | Read channel messages |
| `send_discord_dm` | ❌ | Send a direct message |
| `read_discord_dm_history` | ✅ | Read DM history |

## Security

1. **API Key Authentication**: All requests must include valid API key
2. **Path Sandboxing**: All filesystem operations are restricted to `MCP_BASE_DIR`
3. **Safe Flag**: Tools marked `safe=False` require user confirmation in the plugin

## Development

### Adding a New Toolset

1. Create `toolsets/my_toolset.py`:

```python
from .base import tool, RegisteredTool

@tool(
    description="My awesome tool",
    param1="Description of param1",
    safe=True
)
def my_tool(param1: str) -> str:
    return f"Result: {param1}"

TOOLS = [my_tool]
```

2. Register in `toolsets/__init__.py`:

```python
from . import my_toolset
register_toolset("my_toolset", my_toolset.TOOLS)
```

3. Enable in `.env`:

```
MCP_ENABLED_TOOLSETS=system,my_toolset
```

### Running in Development

```bash
uvicorn server:app --reload --host 127.0.0.1 --port 8765
```

## Project Structure

```
mcp_server/
├── server.py           # FastAPI main server
├── config.py           # Configuration loading
├── requirements.txt    # Python dependencies
├── .env.example        # Environment template
├── .env                # Your local config (gitignored)
├── credentials.json    # Gmail OAuth credentials (gitignored)
├── token.pickle        # Gmail OAuth token (gitignored)
├── toolsets/
│   ├── __init__.py     # Toolset registry
│   ├── base.py         # @tool decorator
│   ├── system.py       # Filesystem/shell tools
│   ├── gmail.py        # Gmail tools
│   └── discord.py      # Discord tools (coming soon)
└── integrations/
    ├── __init__.py
    └── gmail_client.py # Gmail API client
```

## Integration with Obsidian AI Plugin

1. Start the MCP server
2. In Obsidian, go to Settings → Obsidian AI → MCP Servers
3. Add a server with URL `http://127.0.0.1:8765` and your API key
4. Use `<tools!mcp:servername>` in your AI blocks
