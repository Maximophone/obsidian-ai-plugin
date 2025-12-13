"""
MCP Server Configuration

Loads settings from environment variables and .env file.
"""

import os
from pathlib import Path
from typing import List, Optional
from dotenv import load_dotenv

# Load .env file from the mcp_server directory
_env_path = Path(__file__).parent / ".env"
load_dotenv(_env_path)


class Config:
    """Server configuration loaded from environment."""
    
    # Server settings
    API_KEY: str = os.getenv("MCP_API_KEY", "dev-key-12345")
    PORT: int = int(os.getenv("MCP_PORT", "8765"))
    HOST: str = os.getenv("MCP_HOST", "127.0.0.1")
    
    # Filesystem security
    BASE_DIR: Path = Path(os.path.expanduser(os.getenv("MCP_BASE_DIR", "~"))).resolve()
    
    # Enabled toolsets
    ENABLED_TOOLSETS: List[str] = [
        t.strip() 
        for t in os.getenv("MCP_ENABLED_TOOLSETS", "system").split(",")
        if t.strip()
    ]
    
    # Logging
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    
    # Gmail OAuth paths
    GMAIL_CREDENTIALS_PATH: Path = Path(__file__).parent / "credentials.json"
    GMAIL_TOKEN_PATH: Path = Path(__file__).parent / "token.pickle"
    
    # Discord
    DISCORD_BOT_TOKEN: Optional[str] = os.getenv("DISCORD_BOT_TOKEN")
    
    # Notion
    NOTION_API_KEY: Optional[str] = os.getenv("NOTION_API_KEY")
    
    @classmethod
    def validate_path(cls, path: str) -> Path:
        """
        Validate that a path is within BASE_DIR.
        Returns the resolved absolute path.
        Raises ValueError if path is outside BASE_DIR.
        """
        # Expand user home and resolve to absolute path
        resolved = Path(os.path.expanduser(path)).resolve()
        
        # Check if path is under BASE_DIR
        try:
            resolved.relative_to(cls.BASE_DIR)
        except ValueError:
            raise ValueError(f"Path must be under {cls.BASE_DIR}")
        
        return resolved
    
    @classmethod
    def is_toolset_enabled(cls, name: str) -> bool:
        """Check if a toolset is enabled."""
        return name in cls.ENABLED_TOOLSETS


# Singleton instance
config = Config()

