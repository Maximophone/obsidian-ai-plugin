# MCP Server

A FastAPI-based Model Context Protocol (MCP) server that provides tools for the Obsidian AI Plugin.

## Features

- **Virtual MCP Servers**: Single process, multiple toolsets at different URL paths
- **Modular Toolsets**: System, Gmail, Discord, Notion (each accessible independently)
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

The server starts and exposes each toolset as a virtual MCP server:

```
http://127.0.0.1:8765/mcp/system   → Filesystem/shell tools
http://127.0.0.1:8765/mcp/gmail    → Email tools
http://127.0.0.1:8765/mcp/discord  → Discord tools
http://127.0.0.1:8765/mcp/notion   → Notion database tools
```

API Docs: http://127.0.0.1:8765/docs

### 4. Configure in Obsidian

In Obsidian Settings → Obsidian AI → MCP Servers, add **separate entries** for each toolset:

| Name | URL |
|------|-----|
| `system` | `http://127.0.0.1:8765/mcp/system` |
| `gmail` | `http://127.0.0.1:8765/mcp/gmail` |
| `discord` | `http://127.0.0.1:8765/mcp/discord` |
| `notion` | `http://127.0.0.1:8765/mcp/notion` |

Now you can use them independently:

```markdown
<ai!>
<tools!mcp:system>   <!-- Only filesystem tools -->
List files in my Documents folder
<reply!>
</ai!>
```

```markdown
<ai!>
<tools!mcp:gmail>    <!-- Only email tools -->
Search for unread emails from today
<reply!>
</ai!>
```

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

### List Available Toolsets
```
GET /mcp/toolsets
```

### Per-Toolset Endpoints

Each toolset has its own endpoints:

```
GET  /mcp/{toolset}/health  - Health check
GET  /mcp/{toolset}/tools   - List tools
POST /mcp/{toolset}/execute - Execute a tool
```

Example - list system tools:
```
GET /mcp/system/tools
```

Example - execute a tool:
```
POST /mcp/system/execute
Content-Type: application/json

{
  "name": "list_directory",
  "arguments": {
    "path": "/Users/me/Documents"
  }
}
```

### Legacy Endpoints (All Tools)

For backward compatibility, these endpoints serve all enabled tools:

```
GET  /health  - Health check (all toolsets)
GET  /tools   - List all tools
POST /execute - Execute any tool
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

### Discord Toolset (`discord`)

Requires a Discord bot token. See [Discord Setup](#discord-setup) below.

| Tool | Safe | Description |
|------|------|-------------|
| `list_discord_channels` | ✅ | List accessible channels |
| `read_discord_messages` | ✅ | Read channel messages |
| `send_discord_dm` | ❌ | Send a direct message |
| `read_discord_dm_history` | ✅ | Read DM history |
| `send_discord_message` | ❌ | Send message to channel |
| `get_discord_user` | ✅ | Get user information |

#### Discord Setup

1. **Create Discord Application**
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Click "New Application" and name it

2. **Create Bot**
   - Go to "Bot" section in your application
   - Click "Add Bot"
   - Under "Privileged Gateway Intents", enable:
     - Message Content Intent
     - Server Members Intent

3. **Get Bot Token**
   - In the Bot section, click "Reset Token" to get your token
   - Copy the token (you can only see it once!)

4. **Invite Bot to Server**
   - Go to "OAuth2" → "URL Generator"
   - Select scopes: `bot`
   - Select permissions: `Read Messages/View Channels`, `Send Messages`, `Read Message History`
   - Copy the generated URL and open it in browser
   - Select your server and authorize

5. **Configure MCP Server**
   ```bash
   # Add to .env
   DISCORD_BOT_TOKEN=your-bot-token-here
   MCP_ENABLED_TOOLSETS=system,discord
   ```

### Notion Toolset (`notion`)

Tools for interacting with Notion databases - read schemas, query rows, create/update entries.

| Tool | Safe | Description |
|------|------|-------------|
| `list_databases` | ✅ | List all databases shared with integration |
| `get_database_schema` | ✅ | Get database structure and properties |
| `query_database` | ✅ | Query rows from a database |
| `query_database_filtered` | ✅ | Query with Notion filter syntax |
| `get_database_row` | ✅ | Get a specific row by ID |
| `create_database_row` | ❌ | Create a new row in database |
| `update_database_row` | ❌ | Update row properties |
| `archive_database_row` | ❌ | Archive (soft-delete) a row |
| `unarchive_database_row` | ❌ | Restore an archived row |
| `search_notion` | ✅ | Search databases and pages |

#### Notion Setup

1. **Create a Notion Integration**
   - Go to [My Integrations](https://www.notion.so/my-integrations)
   - Click "New integration"
   - Name it (e.g., "MCP Server")
   - Select the workspace to connect
   - Click "Submit"

2. **Get the Integration Token**
   - On the integration page, find "Internal Integration Token"
   - Click "Show" and copy the token (starts with `secret_`)

3. **Share Databases with the Integration**
   - Open each Notion database you want to access
   - Click "..." → "Add connections"
   - Select your integration
   - This grants the integration access to that database

4. **Configure MCP Server**
   ```bash
   # Add to .env
   NOTION_API_KEY=secret_xxxxxxxxxxxxxxxxxxxxxxx
   MCP_ENABLED_TOOLSETS=system,notion
   ```

5. **Using the Tools**
   ```markdown
   <ai!>
   <tools!mcp:notion>
   List all my Notion databases
   <reply!>
   </ai!>
   ```

   The AI can now:
   - List and discover your databases
   - Read the schema (property types, options)
   - Query rows with filters
   - Create and update entries
   - Archive/restore rows

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
│   ├── discord.py      # Discord tools
│   └── notion.py       # Notion database tools
└── integrations/
    ├── __init__.py
    ├── gmail_client.py    # Gmail API client
    ├── discord_client.py  # Discord bot client
    └── notion_client.py   # Notion API client
```

## Integration with Obsidian AI Plugin

1. Start the MCP server
2. In Obsidian, go to Settings → Obsidian AI → MCP Servers
3. Add a server with URL `http://127.0.0.1:8765` and your API key
4. Use `<tools!mcp:servername>` in your AI blocks
