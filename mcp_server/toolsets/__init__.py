"""
Toolsets Module

This module provides the toolset registry and imports all available toolsets.
"""

from typing import Dict, List, TYPE_CHECKING
import logging

from .base import ToolDefinition, get_all_tools

if TYPE_CHECKING:
    from .base import RegisteredTool

logger = logging.getLogger(__name__)

# Will be populated by toolset imports
_toolsets: Dict[str, List["RegisteredTool"]] = {}


def register_toolset(name: str, tools: List["RegisteredTool"]) -> None:
    """Register a toolset with its tools."""
    _toolsets[name] = tools
    logger.debug(f"Registered toolset '{name}' with {len(tools)} tools")


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


# ============ Register Toolsets ============

# System toolset (always available)
from . import system
register_toolset("system", system.TOOLS)

# Gmail toolset (requires credentials)
try:
    from . import gmail
    register_toolset("gmail", gmail.TOOLS)
except ImportError as e:
    logger.warning(f"Gmail toolset not available: {e}")

# Discord toolset (requires bot token)
try:
    from . import discord
    register_toolset("discord", discord.TOOLS)
except ImportError as e:
    logger.warning(f"Discord toolset not available: {e}")

# Notion toolset (requires API key)
try:
    from . import notion
    register_toolset("notion", notion.TOOLS)
except ImportError as e:
    logger.warning(f"Notion toolset not available: {e}")

