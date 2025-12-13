"""
Base Tool Infrastructure

Provides the @tool decorator and base types for defining MCP tools.
This is inspired by the ai_core.tools pattern from the original project.
"""

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, TypedDict
from functools import wraps
import inspect
import traceback


class ParameterDef(TypedDict, total=False):
    """Tool parameter definition."""
    type: str
    description: str
    required: bool
    default: Any
    enum: List[str]


@dataclass
class ToolDefinition:
    """Definition of a tool that can be exposed via MCP."""
    name: str
    description: str
    parameters: Dict[str, ParameterDef]
    safe: bool  # True = read-only, False = write/dangerous


@dataclass
class RegisteredTool:
    """A tool with its definition and executor function."""
    definition: ToolDefinition
    execute: Callable[..., str]


# Global registry of all tools
_all_tools: Dict[str, RegisteredTool] = {}


def tool(
    description: str,
    safe: bool = True,
    **param_descriptions: str
) -> Callable:
    """
    Decorator to define an MCP tool.
    
    Usage:
        @tool(
            description="Read a file from disk",
            path="The file path to read",
            safe=True
        )
        def read_file(path: str) -> str:
            ...
    
    The decorator extracts parameter types from function annotations
    and creates a ToolDefinition.
    """
    def decorator(func: Callable) -> RegisteredTool:
        # Get function signature
        sig = inspect.signature(func)
        
        # Build parameter definitions
        parameters: Dict[str, ParameterDef] = {}
        
        for param_name, param in sig.parameters.items():
            # Skip 'self' and similar
            if param_name in ('self', 'cls'):
                continue
            
            # Get type from annotation
            param_type = "string"  # default
            if param.annotation != inspect.Parameter.empty:
                type_map = {
                    str: "string",
                    int: "number",
                    float: "number",
                    bool: "boolean",
                    list: "array",
                    dict: "object",
                }
                param_type = type_map.get(param.annotation, "string")
            
            # Check if required (no default value)
            required = param.default == inspect.Parameter.empty
            
            # Get description from decorator kwargs
            param_desc = param_descriptions.get(param_name, f"Parameter: {param_name}")
            
            param_def: ParameterDef = {
                "type": param_type,
                "description": param_desc,
                "required": required,
            }
            
            # Add default if present
            if not required:
                param_def["default"] = param.default
            
            parameters[param_name] = param_def
        
        # Create tool definition
        tool_def = ToolDefinition(
            name=func.__name__,
            description=description,
            parameters=parameters,
            safe=safe,
        )
        
        # Wrap the function to handle errors gracefully
        @wraps(func)
        def executor(**kwargs) -> str:
            try:
                result = func(**kwargs)
                if not isinstance(result, str):
                    result = str(result)
                return result
            except Exception as e:
                return f"Error: {str(e)}\n{traceback.format_exc()}"
        
        # Create registered tool
        registered = RegisteredTool(
            definition=tool_def,
            execute=executor,
        )
        
        # Register globally
        _all_tools[func.__name__] = registered
        
        return registered
    
    return decorator


def get_tool(name: str) -> Optional[RegisteredTool]:
    """Get a registered tool by name."""
    return _all_tools.get(name)


def get_all_tools() -> Dict[str, RegisteredTool]:
    """Get all registered tools."""
    return _all_tools.copy()


def tools_to_mcp_format(tools: List[RegisteredTool]) -> List[Dict[str, Any]]:
    """Convert tools to MCP API format."""
    result = []
    for tool in tools:
        result.append({
            "name": tool.definition.name,
            "description": tool.definition.description,
            "parameters": tool.definition.parameters,
            "safe": tool.definition.safe,
        })
    return result

