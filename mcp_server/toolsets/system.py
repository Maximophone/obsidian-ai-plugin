"""
System Toolset

Provides filesystem, shell, and Python execution tools.
Ported from the original obsidian_ai project.
"""

import os
import subprocess
import shutil
import threading
import time
import uuid
from typing import Dict, Any
from pathlib import Path

import httpx
from markdownify import markdownify
from bs4 import BeautifulSoup

from .base import tool, RegisteredTool
from config import config


# ============ Persistent Shell State ============

_shell_sessions: Dict[str, subprocess.Popen] = {}
_session_last_activity: Dict[str, float] = {}
_shell_lock = threading.Lock()


def _format_size(size: int) -> str:
    """Format byte size to human readable."""
    if size < 1024:
        return f"{size}B"
    elif size < 1024 * 1024:
        return f"{size / 1024:.1f}KB"
    else:
        return f"{size / (1024 * 1024):.1f}MB"


def _cleanup_old_sessions():
    """Clean up shell sessions idle for more than 1 hour."""
    current_time = time.time()
    idle_limit = 3600  # 1 hour
    
    for session_id in list(_session_last_activity.keys()):
        if current_time - _session_last_activity[session_id] > idle_limit:
            if session_id in _shell_sessions:
                try:
                    _shell_sessions[session_id].terminate()
                except:
                    pass
                del _shell_sessions[session_id]
            del _session_last_activity[session_id]


# ============ Tools ============

@tool(
    description="List files and directories at the specified path. Returns file names, types, and sizes.",
    path="Absolute path to the directory to list",
    include_hidden="Include hidden files (starting with dot). Default: false",
    safe=True
)
def list_directory(path: str, include_hidden: bool = False) -> str:
    """List contents of a directory with sizes."""
    resolved = config.validate_path(path)
    
    if not resolved.is_dir():
        return f"Error: Not a directory: {path}"
    
    items = []
    try:
        for entry in sorted(resolved.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            if not include_hidden and entry.name.startswith("."):
                continue
            
            try:
                if entry.is_dir():
                    items.append(f"📁 {entry.name}/")
                else:
                    size = _format_size(entry.stat().st_size)
                    items.append(f"📄 {entry.name} ({size})")
            except (PermissionError, OSError):
                items.append(f"⚠️ {entry.name} (access denied)")
    except PermissionError:
        return f"Error: Permission denied: {path}"
    
    if not items:
        return f"Directory {path} is empty."
    
    return f"Contents of {path}:\n" + "\n".join(items)


@tool(
    description="Read the contents of a file with line numbers. Limited to first 20,000 characters.",
    path="Absolute path to the file to read",
    max_lines="Maximum number of lines to read. Default: 500",
    safe=True
)
def read_file(path: str, max_lines: int = 500) -> str:
    """Read file contents with line numbers."""
    resolved = config.validate_path(path)
    
    if not resolved.is_file():
        return f"Error: Not a file: {path}"
    
    try:
        with open(resolved, "r", encoding="utf-8") as f:
            lines = []
            for i, line in enumerate(f, 1):
                if i > max_lines:
                    lines.append(f"\n... (truncated at {max_lines} lines)")
                    break
                lines.append(f"{i:6}| {line.rstrip()}")
        
        return "\n".join(lines)
    except UnicodeDecodeError:
        return f"Error: Cannot read file (binary or non-UTF8): {path}"
    except PermissionError:
        return f"Error: Permission denied: {path}"


@tool(
    description="Save content to a file. Creates parent directories if needed. Can optionally overwrite existing files.",
    path="Absolute path for the file",
    content="Content to write to the file",
    overwrite="Allow overwriting existing files. Default: false. Use with extreme caution!",
    safe=False
)
def save_file(path: str, content: str, overwrite: bool = False) -> str:
    """Save content to a file."""
    resolved = config.validate_path(path)
    
    if resolved.exists() and not overwrite:
        return f"Error: File {path} already exists. Set overwrite=true to replace."
    
    # Create parent directories
    resolved.parent.mkdir(parents=True, exist_ok=True)
    
    with open(resolved, "w", encoding="utf-8") as f:
        f.write(content)
    
    size = _format_size(resolved.stat().st_size)
    action = "Overwrote" if resolved.exists() else "Created"
    return f"{action} file: {path} ({size})"


@tool(
    description="Copy or move a file. Can optionally overwrite destination.",
    source="Absolute path to source file",
    destination="Absolute path to destination",
    move="Move instead of copy (delete original). Default: false",
    overwrite="Allow overwriting destination. Default: false",
    safe=False
)
def copy_file(source: str, destination: str, move: bool = False, overwrite: bool = False) -> str:
    """Copy or move a file."""
    src = config.validate_path(source)
    dst = config.validate_path(destination)
    
    if not src.exists():
        return f"Error: Source not found: {source}"
    
    if dst.exists() and not overwrite:
        return f"Error: Destination exists: {destination}. Set overwrite=true to replace."
    
    # Create parent directories
    dst.parent.mkdir(parents=True, exist_ok=True)
    
    if move:
        shutil.move(str(src), str(dst))
        return f"Moved: {source} → {destination}"
    else:
        shutil.copy2(str(src), str(dst))
        return f"Copied: {source} → {destination}"


@tool(
    description="Run a shell command and return the output. Use with caution.",
    command="The shell command to execute",
    timeout="Timeout in seconds. Default: 30",
    safe=False
)
def run_command(command: str, timeout: int = 30) -> str:
    """Run a shell command."""
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(config.BASE_DIR)
        )
        
        output = result.stdout
        if result.stderr:
            output += f"\n[stderr]\n{result.stderr}"
        
        if result.returncode != 0:
            output += f"\n[exit code: {result.returncode}]"
        
        return output.strip() if output.strip() else "Command completed with no output"
        
    except subprocess.TimeoutExpired:
        return f"Error: Command timed out after {timeout} seconds"
    except Exception as e:
        return f"Error executing command: {str(e)}"


@tool(
    description="Execute Python code and return the output. WARNING: This executes arbitrary code. Use with extreme caution.",
    code="Python code to execute",
    safe=False
)
def execute_python(code: str) -> str:
    """Execute Python code and return output."""
    import io
    import sys
    from contextlib import redirect_stdout, redirect_stderr
    
    stdout_buffer = io.StringIO()
    stderr_buffer = io.StringIO()
    
    # Create isolated namespace
    local_vars = {}
    
    try:
        with redirect_stdout(stdout_buffer), redirect_stderr(stderr_buffer):
            exec(code, {"__builtins__": __builtins__}, local_vars)
        
        output = stdout_buffer.getvalue()
        errors = stderr_buffer.getvalue()
        
        if errors:
            output += f"\n[stderr]\n{errors}"
        
        return output.strip() if output.strip() else "Code executed successfully with no output"
        
    except Exception as e:
        import traceback
        return f"Error executing Python code:\n{traceback.format_exc()}"


@tool(
    description="Fetch content from a URL and convert to markdown (or return raw HTML).",
    url="URL to fetch",
    raw_html="Return raw HTML instead of markdown. Default: false",
    safe=True
)
def fetch_webpage(url: str, raw_html: bool = False) -> str:
    """Fetch webpage and convert to markdown."""
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        }
        
        with httpx.Client(follow_redirects=True, timeout=30) as client:
            response = client.get(url, headers=headers)
            response.raise_for_status()
        
        html = response.text
        
        if raw_html:
            return html
        
        # Parse and convert to markdown
        soup = BeautifulSoup(html, "html.parser")
        
        # Remove script/style elements
        for element in soup(["script", "style", "nav", "footer", "header"]):
            element.decompose()
        
        # Get main content if available
        main = soup.find("main") or soup.find("article") or soup.find("body")
        
        if main:
            markdown = markdownify(str(main), heading_style="ATX", strip=["a"])
        else:
            markdown = markdownify(html, heading_style="ATX", strip=["a"])
        
        # Clean up excessive whitespace
        lines = [line.strip() for line in markdown.split("\n")]
        cleaned = "\n".join(line for line in lines if line)
        
        return cleaned[:20000]  # Limit output size
        
    except httpx.HTTPError as e:
        return f"Error fetching URL: {str(e)}"
    except Exception as e:
        return f"Error processing webpage: {str(e)}"


@tool(
    description="Run commands in a persistent shell session that maintains state (directory, env vars). Returns session_id on first call.",
    command="Command to run (empty to just create session)",
    session_id="Session ID for existing shell (empty to create new)",
    timeout="Timeout in seconds. Default: 30",
    safe=False
)
def persistent_shell(command: str = "", session_id: str = "", timeout: int = 30) -> str:
    """Run command in persistent shell session."""
    global _shell_sessions, _session_last_activity
    
    with _shell_lock:
        is_new = not session_id
        
        if is_new:
            session_id = str(uuid.uuid4())
            
            # Create shell process
            shell_cmd = ["bash", "--login"] if os.name != "nt" else ["cmd.exe", "/q"]
            
            process = subprocess.Popen(
                shell_cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=str(config.BASE_DIR)
            )
            
            _shell_sessions[session_id] = process
            _session_last_activity[session_id] = time.time()
            
            if not command.strip():
                return f"Created new shell session: {session_id}\n\nUse this ID for subsequent commands."
        
        else:
            if session_id not in _shell_sessions:
                return f"Error: Session {session_id} not found. Create a new session."
            
            process = _shell_sessions[session_id]
            
            if process.poll() is not None:
                del _shell_sessions[session_id]
                return "Error: Shell process has exited. Create a new session."
        
        try:
            _session_last_activity[session_id] = time.time()
            
            # Use temp files for output (more reliable than pipes)
            import tempfile
            with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as out_f:
                output_file = out_f.name
            
            done_marker = f"__DONE_{session_id}__"
            
            if os.name == "nt":
                full_cmd = f"{command} > \"{output_file}\" 2>&1 & echo {done_marker}\n"
            else:
                full_cmd = f"{command} > \"{output_file}\" 2>&1; echo {done_marker}\n"
            
            process.stdin.write(full_cmd)
            process.stdin.flush()
            
            # Wait for completion
            start_time = time.time()
            output = ""
            
            while time.time() - start_time < timeout:
                if os.path.exists(output_file):
                    try:
                        with open(output_file, "r", encoding="utf-8", errors="replace") as f:
                            content = f.read()
                            if done_marker in content or content != output:
                                output = content
                                if done_marker in content:
                                    break
                    except:
                        pass
                
                if process.poll() is not None:
                    del _shell_sessions[session_id]
                    return "Error: Shell process exited unexpectedly."
                
                time.sleep(0.1)
            
            # Clean up
            try:
                os.remove(output_file)
            except:
                pass
            
            _cleanup_old_sessions()
            
            # Remove done marker from output
            output = output.replace(done_marker, "").strip()
            
            if time.time() - start_time >= timeout:
                output += f"\n[Timed out after {timeout}s]"
            
            prefix = f"Session: {session_id}\n" if is_new else ""
            return f"{prefix}{output}" if output else f"{prefix}Command completed with no output"
            
        except Exception as e:
            if session_id in _shell_sessions:
                try:
                    _shell_sessions[session_id].terminate()
                except:
                    pass
                del _shell_sessions[session_id]
                if session_id in _session_last_activity:
                    del _session_last_activity[session_id]
            
            return f"Error: {str(e)}"


# Export list of tools
TOOLS = [
    list_directory,
    read_file,
    save_file,
    copy_file,
    run_command,
    execute_python,
    fetch_webpage,
    persistent_shell,
]

