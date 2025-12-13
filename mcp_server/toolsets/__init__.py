"""
Toolsets Module

This module provides the toolset registry and imports all available toolsets.
"""

from typing import Dict, List, TYPE_CHECKING
from .base import ToolDefinition, get_all_tools

if TYPE_CHECKING:
    from .base import RegisteredTool

# Import toolsets to register their tools
from . import system

# Will be populated by toolset imports
_toolsets: Dict[str, List["RegisteredTool"]] = {}


def register_toolset(name: str, tools: List["RegisteredTool"]) -> None:
    """Register a toolset with its tools."""
    _toolsets[name] = tools


def get_toolset(name: str) -> List["RegisteredTool"]:
    """Get tools from a specific toolset."""
    return _toolsets.get(name, [])


def get_enabled_toolsets(enabled_names: List[str]) -> List["RegisteredTool"]:
    """Get all tools from enabled toolsets."""
    tools = []
    for name in enabled_names:
        tools.extend(_toolsets.get(name, []))
    return tools


def get_all_toolset_names() -> List[str]:
    """Get names of all registered toolsets."""
    return list(_toolsets.keys())


# Register toolsets
register_toolset("system", system.TOOLS)

