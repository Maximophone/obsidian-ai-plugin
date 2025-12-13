"""
Discord Client

Discord bot client for reading and sending messages.
Runs in a background thread with its own event loop.
"""

import asyncio
import logging
import threading
import time
from typing import List, Dict, Any, Optional, Callable

import discord
from discord import Message, DMChannel, TextChannel

logger = logging.getLogger(__name__)


class DiscordClient:
    """
    Discord bot client that runs in a background thread.
    Provides synchronous methods to interact with Discord.
    """

    def __init__(self, token: str):
        """
        Initialize Discord client.
        
        Args:
            token: Discord bot token
        """
        self.token = token
        self.client: Optional[discord.Client] = None
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.thread: Optional[threading.Thread] = None
        self._ready = threading.Event()
        self._started = False

    def start(self, timeout: float = 30.0) -> bool:
        """
        Start the Discord bot in a background thread.
        
        Args:
            timeout: Maximum seconds to wait for connection
            
        Returns:
            True if connected successfully
        """
        if self._started:
            return self.is_ready
        
        self._started = True
        
        def run_bot():
            self.loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self.loop)
            
            # Set up intents
            intents = discord.Intents.default()
            intents.message_content = True
            intents.members = True
            
            self.client = discord.Client(intents=intents)
            
            @self.client.event
            async def on_ready():
                logger.info(f"Discord bot connected as {self.client.user.name}")
                self._ready.set()
            
            try:
                self.loop.run_until_complete(self.client.start(self.token))
            except Exception as e:
                logger.error(f"Discord bot error: {e}")
            finally:
                self.loop.close()
        
        self.thread = threading.Thread(target=run_bot, daemon=True)
        self.thread.start()
        
        # Wait for ready
        if self._ready.wait(timeout=timeout):
            logger.info("Discord bot ready")
            return True
        else:
            logger.error("Discord bot connection timed out")
            return False

    @property
    def is_ready(self) -> bool:
        """Check if bot is connected and ready."""
        return (
            self._ready.is_set() and 
            self.client is not None and 
            self.client.is_ready()
        )

    def _run_async(self, coro, timeout: float = 30.0) -> Any:
        """Run an async coroutine from sync code."""
        if not self.is_ready or self.loop is None:
            raise RuntimeError("Discord client is not ready")
        
        future = asyncio.run_coroutine_threadsafe(coro, self.loop)
        try:
            return future.result(timeout=timeout)
        except asyncio.TimeoutError:
            raise TimeoutError("Discord operation timed out")

    def list_channels(self) -> List[Dict[str, Any]]:
        """List all accessible text channels."""
        if not self.is_ready:
            raise RuntimeError("Discord client not ready")
        
        channels = []
        for guild in self.client.guilds:
            for channel in guild.text_channels:
                channels.append({
                    "id": str(channel.id),
                    "name": channel.name,
                    "guild": guild.name,
                    "guild_id": str(guild.id),
                })
        return channels

    def read_messages(self, channel_id: int, limit: int = 50) -> List[Dict[str, Any]]:
        """Read recent messages from a channel."""
        async def _read():
            channel = await self.client.fetch_channel(channel_id)
            if not isinstance(channel, (TextChannel, DMChannel)):
                raise ValueError(f"Channel {channel_id} is not a text channel")
            
            messages = []
            async for msg in channel.history(limit=min(limit, 100)):
                messages.append({
                    "id": str(msg.id),
                    "content": msg.content,
                    "author": msg.author.name,
                    "author_id": str(msg.author.id),
                    "timestamp": msg.created_at.isoformat(),
                })
            return messages
        
        return self._run_async(_read())

    def send_dm(self, user_id: int, message: str) -> bool:
        """Send a direct message to a user."""
        async def _send():
            user = await self.client.fetch_user(user_id)
            await user.send(message)
            return True
        
        return self._run_async(_send())

    def send_message(self, channel_id: int, message: str) -> bool:
        """Send a message to a channel."""
        async def _send():
            channel = await self.client.fetch_channel(channel_id)
            if not isinstance(channel, (TextChannel, DMChannel)):
                raise ValueError(f"Channel {channel_id} is not a text channel")
            await channel.send(message)
            return True
        
        return self._run_async(_send())

    def read_dm_history(self, user_id: int, limit: int = 50) -> List[Dict[str, Any]]:
        """Read DM history with a user."""
        async def _read():
            user = await self.client.fetch_user(user_id)
            dm_channel = user.dm_channel
            
            if dm_channel is None:
                dm_channel = await user.create_dm()
            
            messages = []
            async for msg in dm_channel.history(limit=min(limit, 100)):
                messages.append({
                    "id": str(msg.id),
                    "content": msg.content,
                    "author": msg.author.name,
                    "author_id": str(msg.author.id),
                    "timestamp": msg.created_at.isoformat(),
                    "is_from_bot": msg.author.id == self.client.user.id,
                })
            return messages
        
        return self._run_async(_read())

    def get_user(self, user_id: int) -> Dict[str, Any]:
        """Get information about a user."""
        async def _get():
            user = await self.client.fetch_user(user_id)
            return {
                "id": str(user.id),
                "name": user.name,
                "display_name": user.display_name,
                "bot": user.bot,
            }
        
        return self._run_async(_get())

    def stop(self):
        """Stop the Discord bot."""
        if self.client and self.loop:
            asyncio.run_coroutine_threadsafe(self.client.close(), self.loop)
            self._ready.clear()
            self._started = False


# Singleton instance
_discord_client: Optional[DiscordClient] = None
_discord_error: Optional[str] = None


def get_discord_client(token: Optional[str] = None) -> tuple[Optional[DiscordClient], Optional[str]]:
    """
    Get or create the Discord client singleton.
    Returns (client, error_message).
    """
    global _discord_client, _discord_error
    
    if _discord_client is not None and _discord_client.is_ready:
        return _discord_client, None
    
    if _discord_error is not None:
        return None, _discord_error
    
    # Get token from parameter or environment
    if token is None:
        import os
        token = os.getenv("DISCORD_BOT_TOKEN")
    
    if not token:
        _discord_error = (
            "Discord integration not configured.\n\n"
            "To set up Discord:\n"
            "1. Go to https://discord.com/developers/applications\n"
            "2. Create a new application\n"
            "3. Go to 'Bot' section and create a bot\n"
            "4. Copy the bot token\n"
            "5. Add DISCORD_BOT_TOKEN to your .env file\n"
            "6. Invite bot to your server with proper permissions"
        )
        return None, _discord_error
    
    try:
        _discord_client = DiscordClient(token)
        if not _discord_client.start():
            _discord_error = "Discord bot failed to connect. Check your bot token."
            _discord_client = None
            return None, _discord_error
        
        return _discord_client, None
    except Exception as e:
        _discord_error = f"Failed to initialize Discord client: {str(e)}"
        return None, _discord_error

