"""
Discord Toolset

Tools for reading and sending Discord messages.
Requires a Discord bot token to be configured.
"""

import json
from typing import Optional

from .base import tool, RegisteredTool
from integrations.discord_client import get_discord_client


def _get_client():
    """Get Discord client or raise error."""
    client, error = get_discord_client()
    if error:
        raise RuntimeError(error)
    return client


@tool(
    description="List all accessible text channels in servers the bot is in. Returns channel names and IDs.",
    safe=True
)
def list_discord_channels() -> str:
    """List all accessible Discord channels."""
    client = _get_client()
    
    channels = client.list_channels()
    
    if not channels:
        return "No accessible channels found. Make sure the bot is in at least one server."
    
    # Group by guild
    guilds = {}
    for ch in channels:
        guild = ch['guild']
        if guild not in guilds:
            guilds[guild] = []
        guilds[guild].append(ch)
    
    output = [f"Found {len(channels)} channel(s) in {len(guilds)} server(s):\n"]
    
    for guild_name, guild_channels in guilds.items():
        output.append(f"📡 {guild_name}")
        for ch in guild_channels:
            output.append(f"   #{ch['name']} (ID: {ch['id']})")
        output.append("")
    
    return "\n".join(output)


@tool(
    description="Read recent messages from a Discord channel.",
    channel_id="The channel ID to read messages from",
    limit="Maximum messages to retrieve (default: 50, max: 100)",
    safe=True
)
def read_discord_messages(channel_id: str, limit: int = 50) -> str:
    """Read messages from a Discord channel."""
    client = _get_client()
    
    try:
        channel_id_int = int(channel_id)
    except ValueError:
        return f"Error: Invalid channel ID format: {channel_id}"
    
    limit = min(max(1, limit), 100)
    
    messages = client.read_messages(channel_id_int, limit=limit)
    
    if not messages:
        return f"No messages found in channel {channel_id}"
    
    output = [f"Last {len(messages)} message(s) from channel:\n"]
    
    # Messages are in reverse chronological order, reverse for display
    for msg in reversed(messages):
        timestamp = msg['timestamp'][:16].replace('T', ' ')  # Simplified timestamp
        author = msg['author']
        content = msg['content'][:200]  # Truncate long messages
        if len(msg['content']) > 200:
            content += "..."
        
        output.append(f"[{timestamp}] {author}: {content}")
    
    return "\n".join(output)


@tool(
    description="Send a direct message (DM) to a Discord user.",
    user_id="The Discord user ID to message",
    message="The message content to send",
    safe=False
)
def send_discord_dm(user_id: str, message: str) -> str:
    """Send a DM to a Discord user."""
    client = _get_client()
    
    try:
        user_id_int = int(user_id)
    except ValueError:
        return f"Error: Invalid user ID format: {user_id}"
    
    try:
        success = client.send_dm(user_id_int, message)
        if success:
            return f"DM sent successfully to user {user_id}"
        else:
            return f"Failed to send DM to user {user_id}"
    except Exception as e:
        return f"Error sending DM: {str(e)}"


@tool(
    description="Read DM history with a specific Discord user.",
    user_id="The Discord user ID",
    limit="Maximum messages to retrieve (default: 50, max: 100)",
    safe=True
)
def read_discord_dm_history(user_id: str, limit: int = 50) -> str:
    """Read DM history with a user."""
    client = _get_client()
    
    try:
        user_id_int = int(user_id)
    except ValueError:
        return f"Error: Invalid user ID format: {user_id}"
    
    limit = min(max(1, limit), 100)
    
    messages = client.read_dm_history(user_id_int, limit=limit)
    
    if not messages:
        return f"No DM history found with user {user_id}"
    
    output = [f"Last {len(messages)} DM(s) with user:\n"]
    
    # Messages are in reverse chronological order, reverse for display
    for msg in reversed(messages):
        timestamp = msg['timestamp'][:16].replace('T', ' ')
        author = msg['author']
        prefix = "🤖 " if msg.get('is_from_bot') else "👤 "
        content = msg['content'][:200]
        if len(msg['content']) > 200:
            content += "..."
        
        output.append(f"[{timestamp}] {prefix}{author}: {content}")
    
    return "\n".join(output)


@tool(
    description="Send a message to a Discord channel.",
    channel_id="The channel ID to send the message to",
    message="The message content to send",
    safe=False
)
def send_discord_message(channel_id: str, message: str) -> str:
    """Send a message to a Discord channel."""
    client = _get_client()
    
    try:
        channel_id_int = int(channel_id)
    except ValueError:
        return f"Error: Invalid channel ID format: {channel_id}"
    
    try:
        success = client.send_message(channel_id_int, message)
        if success:
            return f"Message sent successfully to channel {channel_id}"
        else:
            return f"Failed to send message to channel {channel_id}"
    except Exception as e:
        return f"Error sending message: {str(e)}"


@tool(
    description="Get information about a Discord user.",
    user_id="The Discord user ID",
    safe=True
)
def get_discord_user(user_id: str) -> str:
    """Get information about a Discord user."""
    client = _get_client()
    
    try:
        user_id_int = int(user_id)
    except ValueError:
        return f"Error: Invalid user ID format: {user_id}"
    
    try:
        user = client.get_user(user_id_int)
        output = [
            f"Discord User:",
            f"  Name: {user['name']}",
            f"  Display Name: {user['display_name']}",
            f"  ID: {user['id']}",
            f"  Is Bot: {'Yes' if user['bot'] else 'No'}",
        ]
        return "\n".join(output)
    except Exception as e:
        return f"Error getting user info: {str(e)}"


# Export tools
TOOLS = [
    list_discord_channels,
    read_discord_messages,
    send_discord_dm,
    read_discord_dm_history,
    send_discord_message,
    get_discord_user,
]

