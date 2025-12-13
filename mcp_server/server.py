#!/usr/bin/env python3
"""
MCP Test Server - Provides filesystem tools for the Obsidian AI Plugin

This is a simple HTTP server that exposes tools via a JSON API.
The plugin connects to this server to execute tools that need
access to the local filesystem.

Protocol:
- GET  /tools   - List available tools
- POST /execute - Execute a tool
- Headers: Authorization: Bearer <api_key>
"""

import json
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Any
from pathlib import Path

# Configuration
API_KEY = os.environ.get("MCP_API_KEY", "dev-key-12345")
PORT = int(os.environ.get("MCP_PORT", "8765"))
# Base directory for filesystem operations (security: restrict to this path)
BASE_DIR = os.environ.get("MCP_BASE_DIR", os.path.expanduser("~"))


# ============ Tool Definitions ============

TOOLS = [
    {
        "name": "list_directory",
        "description": "List files and directories at the specified path. Returns file names, types, and sizes.",
        "parameters": {
            "path": {
                "type": "string",
                "description": f"Absolute path to the directory to list. Must be under {BASE_DIR}",
                "required": True,
            },
            "include_hidden": {
                "type": "boolean",
                "description": "Include hidden files (starting with dot). Default: false",
                "required": False,
                "default": False,
            },
        },
        "safe": True,
    },
    {
        "name": "read_file",
        "description": "Read the contents of a file. Returns the file content as text.",
        "parameters": {
            "path": {
                "type": "string",
                "description": f"Absolute path to the file to read. Must be under {BASE_DIR}",
                "required": True,
            },
            "max_lines": {
                "type": "number",
                "description": "Maximum number of lines to read. Default: 500",
                "required": False,
                "default": 500,
            },
        },
        "safe": True,
    },
    {
        "name": "create_file",
        "description": "Create a new file with the specified content. Will fail if file already exists.",
        "parameters": {
            "path": {
                "type": "string",
                "description": f"Absolute path for the new file. Must be under {BASE_DIR}",
                "required": True,
            },
            "content": {
                "type": "string",
                "description": "Content to write to the file",
                "required": True,
            },
        },
        "safe": False,  # Write operation - requires confirmation
    },
    {
        "name": "write_file",
        "description": "Write content to a file, overwriting if it exists. Use with caution.",
        "parameters": {
            "path": {
                "type": "string",
                "description": f"Absolute path to the file. Must be under {BASE_DIR}",
                "required": True,
            },
            "content": {
                "type": "string",
                "description": "Content to write to the file",
                "required": True,
            },
        },
        "safe": False,  # Write operation - requires confirmation
    },
    {
        "name": "append_to_file",
        "description": "Append content to the end of an existing file.",
        "parameters": {
            "path": {
                "type": "string",
                "description": f"Absolute path to the file. Must be under {BASE_DIR}",
                "required": True,
            },
            "content": {
                "type": "string",
                "description": "Content to append to the file",
                "required": True,
            },
        },
        "safe": False,  # Write operation - requires confirmation
    },
    {
        "name": "create_directory",
        "description": "Create a new directory (and parent directories if needed).",
        "parameters": {
            "path": {
                "type": "string",
                "description": f"Absolute path for the new directory. Must be under {BASE_DIR}",
                "required": True,
            },
        },
        "safe": False,  # Write operation - requires confirmation
    },
]


# ============ Tool Implementations ============

def validate_path(path: str) -> str:
    """Validate that path is under BASE_DIR. Returns resolved path or raises ValueError."""
    resolved = os.path.realpath(os.path.expanduser(path))
    base_resolved = os.path.realpath(BASE_DIR)
    
    if not resolved.startswith(base_resolved):
        raise ValueError(f"Path must be under {BASE_DIR}")
    
    return resolved


def format_size(size: int) -> str:
    """Format byte size to human readable."""
    if size < 1024:
        return f"{size}B"
    elif size < 1024 * 1024:
        return f"{size / 1024:.1f}KB"
    else:
        return f"{size / (1024 * 1024):.1f}MB"


def execute_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Execute a tool and return the result."""
    try:
        if name == "list_directory":
            return execute_list_directory(arguments)
        elif name == "read_file":
            return execute_read_file(arguments)
        elif name == "create_file":
            return execute_create_file(arguments)
        elif name == "write_file":
            return execute_write_file(arguments)
        elif name == "append_to_file":
            return execute_append_to_file(arguments)
        elif name == "create_directory":
            return execute_create_directory(arguments)
        else:
            return {"error": f"Unknown tool: {name}"}
    except Exception as e:
        return {"error": str(e)}


def execute_list_directory(args: dict[str, Any]) -> dict[str, Any]:
    """List directory contents."""
    path = validate_path(args.get("path", ""))
    include_hidden = args.get("include_hidden", False)
    
    if not os.path.isdir(path):
        return {"error": f"Not a directory: {path}"}
    
    items = []
    for entry in os.scandir(path):
        if not include_hidden and entry.name.startswith("."):
            continue
        
        try:
            stat = entry.stat()
            item = {
                "name": entry.name,
                "type": "directory" if entry.is_dir() else "file",
                "size": format_size(stat.st_size) if entry.is_file() else None,
            }
            items.append(item)
        except (PermissionError, OSError):
            items.append({
                "name": entry.name,
                "type": "unknown",
                "error": "Permission denied",
            })
    
    # Sort: directories first, then files, alphabetically
    items.sort(key=lambda x: (0 if x["type"] == "directory" else 1, x["name"].lower()))
    
    return {
        "result": f"Contents of {path}:\n" + "\n".join(
            f"{'📁' if i['type'] == 'directory' else '📄'} {i['name']}" + 
            (f" ({i['size']})" if i.get('size') else "")
            for i in items
        ) if items else f"Directory {path} is empty."
    }


def execute_read_file(args: dict[str, Any]) -> dict[str, Any]:
    """Read file contents."""
    path = validate_path(args.get("path", ""))
    max_lines = args.get("max_lines", 500)
    
    if not os.path.isfile(path):
        return {"error": f"Not a file: {path}"}
    
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = []
            for i, line in enumerate(f, 1):
                if i > max_lines:
                    lines.append(f"\n... (truncated at {max_lines} lines)")
                    break
                lines.append(f"{i:6}| {line.rstrip()}")
        
        return {"result": "\n".join(lines)}
    except UnicodeDecodeError:
        return {"error": f"Cannot read file (binary or non-UTF8): {path}"}


def execute_create_file(args: dict[str, Any]) -> dict[str, Any]:
    """Create a new file."""
    path = validate_path(args.get("path", ""))
    content = args.get("content", "")
    
    if os.path.exists(path):
        return {"error": f"File already exists: {path}. Use write_file to overwrite."}
    
    # Create parent directories if needed
    parent = os.path.dirname(path)
    if parent and not os.path.exists(parent):
        os.makedirs(parent)
    
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    
    size = os.path.getsize(path)
    return {"result": f"Created file: {path} ({format_size(size)})"}


def execute_write_file(args: dict[str, Any]) -> dict[str, Any]:
    """Write/overwrite a file."""
    path = validate_path(args.get("path", ""))
    content = args.get("content", "")
    
    # Create parent directories if needed
    parent = os.path.dirname(path)
    if parent and not os.path.exists(parent):
        os.makedirs(parent)
    
    existed = os.path.exists(path)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    
    size = os.path.getsize(path)
    action = "Overwrote" if existed else "Created"
    return {"result": f"{action} file: {path} ({format_size(size)})"}


def execute_append_to_file(args: dict[str, Any]) -> dict[str, Any]:
    """Append to a file."""
    path = validate_path(args.get("path", ""))
    content = args.get("content", "")
    
    if not os.path.isfile(path):
        return {"error": f"File not found: {path}. Use create_file to create it."}
    
    with open(path, "a", encoding="utf-8") as f:
        f.write(content)
    
    size = os.path.getsize(path)
    return {"result": f"Appended to file: {path} (now {format_size(size)})"}


def execute_create_directory(args: dict[str, Any]) -> dict[str, Any]:
    """Create a directory."""
    path = validate_path(args.get("path", ""))
    
    if os.path.exists(path):
        if os.path.isdir(path):
            return {"result": f"Directory already exists: {path}"}
        else:
            return {"error": f"Path exists but is not a directory: {path}"}
    
    os.makedirs(path)
    return {"result": f"Created directory: {path}"}


# ============ HTTP Handler ============

class MCPHandler(BaseHTTPRequestHandler):
    """HTTP request handler for MCP protocol."""
    
    def log_message(self, format, *args):
        """Custom logging."""
        print(f"[MCP] {args[0]}")
    
    def send_json(self, data: Any, status: int = 200):
        """Send JSON response."""
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))
    
    def check_auth(self) -> bool:
        """Verify API key authentication."""
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
            return token == API_KEY
        return False
    
    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()
    
    def do_GET(self):
        """Handle GET requests."""
        if not self.check_auth():
            self.send_json({"error": "Unauthorized"}, 401)
            return
        
        if self.path == "/tools":
            # Return tool definitions
            self.send_json({"tools": TOOLS})
        elif self.path == "/health":
            self.send_json({"status": "ok", "version": "1.0.0"})
        else:
            self.send_json({"error": "Not found"}, 404)
    
    def do_POST(self):
        """Handle POST requests."""
        if not self.check_auth():
            self.send_json({"error": "Unauthorized"}, 401)
            return
        
        if self.path == "/execute":
            # Read request body
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self.send_json({"error": "Invalid JSON"}, 400)
                return
            
            name = data.get("name")
            arguments = data.get("arguments", {})
            
            if not name:
                self.send_json({"error": "Missing tool name"}, 400)
                return
            
            # Execute the tool
            result = execute_tool(name, arguments)
            self.send_json(result)
        else:
            self.send_json({"error": "Not found"}, 404)


def main():
    """Start the MCP server."""
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║                    MCP Test Server                           ║
╠══════════════════════════════════════════════════════════════╣
║  Port:     {PORT:<48} ║
║  Base Dir: {BASE_DIR:<48} ║
║  API Key:  {API_KEY[:20] + '...' if len(API_KEY) > 20 else API_KEY:<48} ║
╠══════════════════════════════════════════════════════════════╣
║  Endpoints:                                                  ║
║    GET  /tools   - List available tools                      ║
║    POST /execute - Execute a tool                            ║
║    GET  /health  - Health check                              ║
╠══════════════════════════════════════════════════════════════╣
║  Available Tools:                                            ║
║    • list_directory  - List files in a directory             ║
║    • read_file       - Read file contents                    ║
║    • create_file     - Create a new file                     ║
║    • write_file      - Write/overwrite a file                ║
║    • append_to_file  - Append to existing file               ║
║    • create_directory - Create a directory                   ║
╚══════════════════════════════════════════════════════════════╝
""")
    
    server = HTTPServer(("127.0.0.1", PORT), MCPHandler)
    print(f"Starting server on http://127.0.0.1:{PORT}")
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()

