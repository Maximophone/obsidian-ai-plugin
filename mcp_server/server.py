#!/usr/bin/env python3
"""
MCP Server - Model Context Protocol Server for Obsidian AI Plugin

A FastAPI-based server that exposes tools via HTTP for the Obsidian AI plugin.
Each toolset is available at its own URL prefix, acting as a virtual MCP server.

URL Structure:
    /mcp/{toolset}/tools   - List tools for a specific toolset
    /mcp/{toolset}/execute - Execute a tool from that toolset
    /mcp/{toolset}/health  - Health check for that toolset

Examples:
    http://localhost:8765/mcp/system/tools
    http://localhost:8765/mcp/gmail/tools
    http://localhost:8765/mcp/discord/tools

Usage:
    python server.py
    
    Or with uvicorn directly:
    uvicorn server:app --host 127.0.0.1 --port 8765 --reload
"""

import logging
from typing import Any, Dict, List, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends, Header, Path
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import config
from toolsets import get_toolset, get_all_toolset_names, get_enabled_toolsets
from toolsets.base import tools_to_mcp_format, get_tool


# ============ Logging Setup ============

logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("mcp_server")


# ============ Request/Response Models ============

class ToolExecuteRequest(BaseModel):
    """Request to execute a tool."""
    name: str
    arguments: Dict[str, Any] = {}


class ToolExecuteResponse(BaseModel):
    """Response from tool execution."""
    result: Optional[str] = None
    error: Optional[str] = None


class ToolDefinitionResponse(BaseModel):
    """Tool definition for API response."""
    name: str
    description: str
    parameters: Dict[str, Any]
    safe: bool


class ToolsListResponse(BaseModel):
    """Response listing all available tools."""
    tools: List[ToolDefinitionResponse]
    toolset: str


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    version: str
    toolset: str
    tools_count: int


class ToolsetsListResponse(BaseModel):
    """Response listing available toolsets."""
    toolsets: List[str]
    enabled: List[str]


class ServerInfoResponse(BaseModel):
    """Server info response."""
    name: str
    version: str
    description: str
    toolsets: List[str]
    endpoints: Dict[str, str]


# ============ Authentication ============

async def verify_api_key(authorization: str = Header(None)) -> bool:
    """Verify the API key from Authorization header."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid Authorization format. Use: Bearer <api_key>")
    
    token = authorization[7:]  # Remove "Bearer " prefix
    
    if token != config.API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    return True


def validate_toolset(toolset: str) -> List:
    """Validate that a toolset exists and is enabled."""
    if toolset not in get_all_toolset_names():
        raise HTTPException(
            status_code=404, 
            detail=f"Toolset '{toolset}' not found. Available: {get_all_toolset_names()}"
        )
    
    if toolset not in config.ENABLED_TOOLSETS:
        raise HTTPException(
            status_code=403,
            detail=f"Toolset '{toolset}' is not enabled. Enable it in .env"
        )
    
    tools = get_toolset(toolset)
    if not tools:
        raise HTTPException(
            status_code=404,
            detail=f"Toolset '{toolset}' has no tools"
        )
    
    return tools


# ============ Application Lifecycle ============

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown."""
    # Startup
    logger.info("=" * 60)
    logger.info("MCP Server Starting")
    logger.info("=" * 60)
    logger.info(f"Host: {config.HOST}:{config.PORT}")
    logger.info(f"Base Directory: {config.BASE_DIR}")
    logger.info(f"Enabled Toolsets: {config.ENABLED_TOOLSETS}")
    logger.info("")
    logger.info("Virtual MCP Servers:")
    
    for toolset_name in config.ENABLED_TOOLSETS:
        tools = get_toolset(toolset_name)
        if tools:
            logger.info(f"  http://{config.HOST}:{config.PORT}/mcp/{toolset_name}")
            for tool in tools:
                safe_marker = "✓" if tool.definition.safe else "⚠"
                logger.info(f"    {safe_marker} {tool.definition.name}")
    
    logger.info("")
    logger.info("=" * 60)
    
    yield
    
    # Shutdown
    logger.info("MCP Server Shutting Down")


# ============ FastAPI App ============

app = FastAPI(
    title="MCP Server",
    description="Model Context Protocol Server for Obsidian AI Plugin",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware for browser-based access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============ Root Endpoints ============

@app.get("/", response_model=ServerInfoResponse)
async def root():
    """Root endpoint - shows server info and available toolsets (no auth required)."""
    return ServerInfoResponse(
        name="MCP Server",
        version="1.0.0",
        description="Model Context Protocol Server for Obsidian AI Plugin",
        toolsets=config.ENABLED_TOOLSETS,
        endpoints={
            "GET /mcp/toolsets": "List available toolsets",
            "GET /mcp/{toolset}/health": "Health check for a toolset",
            "GET /mcp/{toolset}/tools": "List tools in a toolset",
            "POST /mcp/{toolset}/execute": "Execute a tool",
        }
    )


@app.get("/mcp/toolsets", response_model=ToolsetsListResponse)
async def list_toolsets(authorized: bool = Depends(verify_api_key)):
    """List all available toolsets."""
    return ToolsetsListResponse(
        toolsets=get_all_toolset_names(),
        enabled=config.ENABLED_TOOLSETS,
    )


# ============ Per-Toolset Endpoints ============

@app.get("/mcp/{toolset}/health", response_model=HealthResponse)
async def toolset_health(
    toolset: str = Path(..., description="The toolset name"),
    authorized: bool = Depends(verify_api_key)
):
    """Health check for a specific toolset."""
    tools = validate_toolset(toolset)
    
    return HealthResponse(
        status="ok",
        version="1.0.0",
        toolset=toolset,
        tools_count=len(tools),
    )


@app.get("/mcp/{toolset}/tools", response_model=ToolsListResponse)
async def list_toolset_tools(
    toolset: str = Path(..., description="The toolset name"),
    authorized: bool = Depends(verify_api_key)
):
    """List all tools in a specific toolset."""
    tools = validate_toolset(toolset)
    tool_defs = tools_to_mcp_format(tools)
    
    return ToolsListResponse(
        tools=[ToolDefinitionResponse(**t) for t in tool_defs],
        toolset=toolset,
    )


@app.post("/mcp/{toolset}/execute", response_model=ToolExecuteResponse)
async def execute_toolset_tool(
    request: ToolExecuteRequest,
    toolset: str = Path(..., description="The toolset name"),
    authorized: bool = Depends(verify_api_key)
):
    """Execute a tool from a specific toolset."""
    tools = validate_toolset(toolset)
    
    logger.info(f"[{toolset}] Executing tool: {request.name}")
    logger.debug(f"Arguments: {request.arguments}")
    
    # Find the tool in this toolset
    tool = None
    for t in tools:
        if t.definition.name == request.name:
            tool = t
            break
    
    if not tool:
        available = [t.definition.name for t in tools]
        raise HTTPException(
            status_code=404, 
            detail=f"Tool '{request.name}' not found in toolset '{toolset}'. Available: {available}"
        )
    
    try:
        result = tool.execute(**request.arguments)
        logger.info(f"[{toolset}] Tool {request.name} completed successfully")
        logger.debug(f"Result: {result[:200]}..." if len(result) > 200 else f"Result: {result}")
        
        return ToolExecuteResponse(result=result)
        
    except TypeError as e:
        logger.error(f"[{toolset}] Tool {request.name} argument error: {e}")
        return ToolExecuteResponse(error=f"Invalid arguments: {str(e)}")
        
    except Exception as e:
        logger.error(f"[{toolset}] Tool {request.name} execution error: {e}", exc_info=True)
        return ToolExecuteResponse(error=str(e))


# ============ Legacy Endpoints (Backward Compatibility) ============
# These serve ALL enabled tools together (original behavior)

@app.get("/health", response_model=HealthResponse)
async def legacy_health(authorized: bool = Depends(verify_api_key)):
    """Legacy health check - returns info about all enabled toolsets."""
    tools = get_enabled_toolsets(config.ENABLED_TOOLSETS)
    return HealthResponse(
        status="ok",
        version="1.0.0",
        toolset="all",
        tools_count=len(tools),
    )


@app.get("/tools")
async def legacy_list_tools(authorized: bool = Depends(verify_api_key)):
    """Legacy endpoint - lists ALL tools from ALL enabled toolsets."""
    tools = get_enabled_toolsets(config.ENABLED_TOOLSETS)
    tool_defs = tools_to_mcp_format(tools)
    
    return {
        "tools": tool_defs,
        "toolsets": config.ENABLED_TOOLSETS,
        "note": "This legacy endpoint returns all tools. Use /mcp/{toolset}/tools for specific toolsets."
    }


@app.post("/execute", response_model=ToolExecuteResponse)
async def legacy_execute(
    request: ToolExecuteRequest,
    authorized: bool = Depends(verify_api_key)
):
    """Legacy endpoint - executes tools from any enabled toolset."""
    logger.info(f"[legacy] Executing tool: {request.name}")
    
    # Find the tool across all enabled toolsets
    tool = get_tool(request.name)
    
    if not tool:
        raise HTTPException(status_code=404, detail=f"Tool not found: {request.name}")
    
    # Check if tool is in an enabled toolset
    enabled_tools = get_enabled_toolsets(config.ENABLED_TOOLSETS)
    if tool not in enabled_tools:
        raise HTTPException(status_code=403, detail=f"Tool not enabled: {request.name}")
    
    try:
        result = tool.execute(**request.arguments)
        return ToolExecuteResponse(result=result)
    except Exception as e:
        return ToolExecuteResponse(error=str(e))


# ============ Main Entry Point ============

def main():
    """Run the server."""
    import uvicorn
    
    # Build toolset info for display
    toolset_lines = []
    for ts in config.ENABLED_TOOLSETS:
        tools = get_toolset(ts)
        if tools:
            toolset_lines.append(f"║    /mcp/{ts:<12} ({len(tools)} tools)")
    
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║                       MCP Server                             ║
╠══════════════════════════════════════════════════════════════╣
║  Host: {config.HOST}:{config.PORT:<47} ║
║  Base: {str(config.BASE_DIR)[:47]:<47} ║
╠══════════════════════════════════════════════════════════════╣
║  Virtual MCP Servers (configure each as separate server):   ║
{chr(10).join(toolset_lines) if toolset_lines else '║    (none enabled)'}
╠══════════════════════════════════════════════════════════════╣
║  API Docs: http://{config.HOST}:{config.PORT}/docs{' ' * 30} ║
╚══════════════════════════════════════════════════════════════╝
""")
    
    uvicorn.run(
        "server:app",
        host=config.HOST,
        port=config.PORT,
        reload=False,
        log_level=config.LOG_LEVEL.lower(),
    )


if __name__ == "__main__":
    main()
