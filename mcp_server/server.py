#!/usr/bin/env python3
"""
MCP Server - Model Context Protocol Server for Obsidian AI Plugin

A FastAPI-based server that exposes tools via HTTP for the Obsidian AI plugin.
Supports multiple toolsets (system, gmail, discord) with modular architecture.

Usage:
    python server.py
    
    Or with uvicorn directly:
    uvicorn server:app --host 127.0.0.1 --port 8765 --reload
"""

import logging
from typing import Any, Dict, List, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import config
from toolsets import get_enabled_toolsets, get_all_toolset_names
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
    toolsets: List[str]


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    version: str
    toolsets: List[str]
    tools_count: int


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
    
    tools = get_enabled_toolsets(config.ENABLED_TOOLSETS)
    logger.info(f"Loaded {len(tools)} tools:")
    for tool in tools:
        safe_marker = "✓" if tool.definition.safe else "⚠"
        logger.info(f"  {safe_marker} {tool.definition.name}")
    
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


# ============ Endpoints ============

@app.get("/health", response_model=HealthResponse)
async def health_check(authorized: bool = Depends(verify_api_key)):
    """Health check endpoint."""
    tools = get_enabled_toolsets(config.ENABLED_TOOLSETS)
    return HealthResponse(
        status="ok",
        version="1.0.0",
        toolsets=config.ENABLED_TOOLSETS,
        tools_count=len(tools),
    )


@app.get("/tools", response_model=ToolsListResponse)
async def list_tools(authorized: bool = Depends(verify_api_key)):
    """List all available tools."""
    tools = get_enabled_toolsets(config.ENABLED_TOOLSETS)
    tool_defs = tools_to_mcp_format(tools)
    
    return ToolsListResponse(
        tools=[ToolDefinitionResponse(**t) for t in tool_defs],
        toolsets=config.ENABLED_TOOLSETS,
    )


@app.post("/execute", response_model=ToolExecuteResponse)
async def execute_tool(
    request: ToolExecuteRequest,
    authorized: bool = Depends(verify_api_key)
):
    """Execute a tool and return the result."""
    logger.info(f"Executing tool: {request.name}")
    logger.debug(f"Arguments: {request.arguments}")
    
    # Find the tool
    tool = get_tool(request.name)
    
    if not tool:
        logger.warning(f"Tool not found: {request.name}")
        raise HTTPException(status_code=404, detail=f"Tool not found: {request.name}")
    
    # Check if tool is in an enabled toolset
    enabled_tools = get_enabled_toolsets(config.ENABLED_TOOLSETS)
    if tool not in enabled_tools:
        logger.warning(f"Tool not enabled: {request.name}")
        raise HTTPException(status_code=403, detail=f"Tool not enabled: {request.name}")
    
    try:
        result = tool.execute(**request.arguments)
        logger.info(f"Tool {request.name} completed successfully")
        logger.debug(f"Result: {result[:200]}..." if len(result) > 200 else f"Result: {result}")
        
        return ToolExecuteResponse(result=result)
        
    except TypeError as e:
        # Usually means wrong arguments
        logger.error(f"Tool {request.name} argument error: {e}")
        return ToolExecuteResponse(error=f"Invalid arguments: {str(e)}")
        
    except Exception as e:
        logger.error(f"Tool {request.name} execution error: {e}", exc_info=True)
        return ToolExecuteResponse(error=str(e))


@app.get("/")
async def root():
    """Root endpoint - shows server info (no auth required)."""
    return {
        "name": "MCP Server",
        "version": "1.0.0",
        "description": "Model Context Protocol Server for Obsidian AI Plugin",
        "docs": "/docs",
        "endpoints": {
            "GET /health": "Health check (requires auth)",
            "GET /tools": "List available tools (requires auth)",
            "POST /execute": "Execute a tool (requires auth)",
        }
    }


# ============ Main Entry Point ============

def main():
    """Run the server."""
    import uvicorn
    
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║                       MCP Server                             ║
╠══════════════════════════════════════════════════════════════╣
║  Host:       {config.HOST}:{config.PORT:<43} ║
║  Base Dir:   {str(config.BASE_DIR)[:45]:<45} ║
║  Toolsets:   {', '.join(config.ENABLED_TOOLSETS)[:45]:<45} ║
╠══════════════════════════════════════════════════════════════╣
║  API Docs:   http://{config.HOST}:{config.PORT}/docs{' ' * 30} ║
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
