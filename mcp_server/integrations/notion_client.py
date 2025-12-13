"""
Notion Client

Client for interacting with Notion databases via the Notion API.
Supports reading database schemas, querying rows, creating/updating pages.
"""

import os
import logging
from typing import List, Dict, Any, Optional
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

# Notion API configuration
NOTION_API_VERSION = "2022-06-28"
NOTION_API_BASE = "https://api.notion.com/v1"


class NotionClient:
    """Client for Notion API database operations."""
    
    def __init__(self, api_key: str):
        """
        Initialize Notion client.
        
        Args:
            api_key: Notion integration token
        """
        self.api_key = api_key
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Notion-Version": NOTION_API_VERSION,
            "Content-Type": "application/json",
        }

    def _request(
        self,
        method: str,
        endpoint: str,
        json_data: Optional[Dict] = None,
        params: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        """Make a request to the Notion API."""
        url = f"{NOTION_API_BASE}{endpoint}"
        
        with httpx.Client(timeout=30) as client:
            response = client.request(
                method=method,
                url=url,
                headers=self.headers,
                json=json_data,
                params=params,
            )
            
            if response.status_code >= 400:
                error_data = response.json() if response.content else {}
                error_msg = error_data.get("message", response.text)
                raise Exception(f"Notion API error ({response.status_code}): {error_msg}")
            
            return response.json()

    # ============ Database Operations ============

    def get_database(self, database_id: str) -> Dict[str, Any]:
        """
        Retrieve database schema/properties.
        
        Args:
            database_id: The database ID (can include dashes or not)
        """
        database_id = self._normalize_id(database_id)
        return self._request("GET", f"/databases/{database_id}")

    def query_database(
        self,
        database_id: str,
        filter_obj: Optional[Dict] = None,
        sorts: Optional[List[Dict]] = None,
        page_size: int = 100,
        start_cursor: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Query a database for pages (rows).
        
        Args:
            database_id: The database ID
            filter_obj: Optional filter object (Notion filter syntax)
            sorts: Optional list of sort objects
            page_size: Number of results per page (max 100)
            start_cursor: Cursor for pagination
        """
        database_id = self._normalize_id(database_id)
        
        body = {"page_size": min(page_size, 100)}
        
        if filter_obj:
            body["filter"] = filter_obj
        if sorts:
            body["sorts"] = sorts
        if start_cursor:
            body["start_cursor"] = start_cursor
        
        return self._request("POST", f"/databases/{database_id}/query", json_data=body)

    # ============ Page (Row) Operations ============

    def get_page(self, page_id: str) -> Dict[str, Any]:
        """
        Get a page by ID.
        
        Args:
            page_id: The page ID
        """
        page_id = self._normalize_id(page_id)
        return self._request("GET", f"/pages/{page_id}")

    def create_page(
        self,
        database_id: str,
        properties: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Create a new page (row) in a database.
        
        Args:
            database_id: The parent database ID
            properties: Property values (must match database schema)
        """
        database_id = self._normalize_id(database_id)
        
        body = {
            "parent": {"database_id": database_id},
            "properties": properties,
        }
        
        return self._request("POST", "/pages", json_data=body)

    def update_page(
        self,
        page_id: str,
        properties: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Update a page's properties.
        
        Args:
            page_id: The page ID to update
            properties: Property values to update
        """
        page_id = self._normalize_id(page_id)
        
        body = {"properties": properties}
        
        return self._request("PATCH", f"/pages/{page_id}", json_data=body)

    def archive_page(self, page_id: str, archived: bool = True) -> Dict[str, Any]:
        """
        Archive (soft-delete) or unarchive a page.
        
        Args:
            page_id: The page ID
            archived: True to archive, False to unarchive
        """
        page_id = self._normalize_id(page_id)
        
        body = {"archived": archived}
        
        return self._request("PATCH", f"/pages/{page_id}", json_data=body)

    # ============ Search ============

    def search(
        self,
        query: str = "",
        filter_type: Optional[str] = None,
        page_size: int = 100,
        start_cursor: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Search for pages and databases.
        
        Args:
            query: Search query string
            filter_type: "page" or "database" to filter results
            page_size: Number of results
            start_cursor: Pagination cursor
        """
        body = {"page_size": min(page_size, 100)}
        
        if query:
            body["query"] = query
        if filter_type:
            body["filter"] = {"property": "object", "value": filter_type}
        if start_cursor:
            body["start_cursor"] = start_cursor
        
        return self._request("POST", "/search", json_data=body)

    # ============ Helpers ============

    def _normalize_id(self, id_str: str) -> str:
        """Remove dashes from ID if present, or extract from URL."""
        # Handle full URLs
        if "notion.so" in id_str or "notion.site" in id_str:
            # Extract ID from URL (last part after final -)
            parts = id_str.rstrip("/").split("-")
            if parts:
                id_str = parts[-1].split("?")[0]
        
        # Remove dashes
        return id_str.replace("-", "")

    @staticmethod
    def format_property_value(prop_type: str, value: Any) -> Dict[str, Any]:
        """
        Format a value for a Notion property.
        
        Args:
            prop_type: The property type (title, rich_text, number, etc.)
            value: The value to format
            
        Returns:
            Properly formatted Notion property value
        """
        if prop_type == "title":
            return {"title": [{"text": {"content": str(value)}}]}
        
        elif prop_type == "rich_text":
            return {"rich_text": [{"text": {"content": str(value)}}]}
        
        elif prop_type == "number":
            return {"number": float(value) if value is not None else None}
        
        elif prop_type == "checkbox":
            return {"checkbox": bool(value)}
        
        elif prop_type == "select":
            return {"select": {"name": str(value)} if value else None}
        
        elif prop_type == "multi_select":
            if isinstance(value, str):
                value = [v.strip() for v in value.split(",")]
            return {"multi_select": [{"name": str(v)} for v in value]}
        
        elif prop_type == "date":
            if isinstance(value, str):
                return {"date": {"start": value}}
            elif isinstance(value, dict):
                return {"date": value}
            return {"date": None}
        
        elif prop_type == "url":
            return {"url": str(value) if value else None}
        
        elif prop_type == "email":
            return {"email": str(value) if value else None}
        
        elif prop_type == "phone_number":
            return {"phone_number": str(value) if value else None}
        
        elif prop_type == "status":
            return {"status": {"name": str(value)} if value else None}
        
        elif prop_type == "relation":
            if isinstance(value, str):
                value = [v.strip() for v in value.split(",")]
            return {"relation": [{"id": v} for v in value]}
        
        else:
            # For unsupported types, try to pass through
            return {prop_type: value}

    @staticmethod
    def extract_property_value(prop: Dict[str, Any]) -> Any:
        """
        Extract the plain value from a Notion property object.
        
        Args:
            prop: The property object from Notion API
            
        Returns:
            The extracted value in a simple format
        """
        prop_type = prop.get("type")
        
        if prop_type == "title":
            texts = prop.get("title", [])
            return "".join(t.get("plain_text", "") for t in texts)
        
        elif prop_type == "rich_text":
            texts = prop.get("rich_text", [])
            return "".join(t.get("plain_text", "") for t in texts)
        
        elif prop_type == "number":
            return prop.get("number")
        
        elif prop_type == "checkbox":
            return prop.get("checkbox", False)
        
        elif prop_type == "select":
            select = prop.get("select")
            return select.get("name") if select else None
        
        elif prop_type == "multi_select":
            return [s.get("name") for s in prop.get("multi_select", [])]
        
        elif prop_type == "date":
            date = prop.get("date")
            if date:
                start = date.get("start", "")
                end = date.get("end")
                if end:
                    return f"{start} → {end}"
                return start
            return None
        
        elif prop_type == "url":
            return prop.get("url")
        
        elif prop_type == "email":
            return prop.get("email")
        
        elif prop_type == "phone_number":
            return prop.get("phone_number")
        
        elif prop_type == "status":
            status = prop.get("status")
            return status.get("name") if status else None
        
        elif prop_type == "formula":
            formula = prop.get("formula", {})
            formula_type = formula.get("type")
            if formula_type:
                return formula.get(formula_type)
            return None
        
        elif prop_type == "relation":
            return [r.get("id") for r in prop.get("relation", [])]
        
        elif prop_type == "rollup":
            rollup = prop.get("rollup", {})
            rollup_type = rollup.get("type")
            if rollup_type == "array":
                return [NotionClient.extract_property_value(r) for r in rollup.get("array", [])]
            elif rollup_type:
                return rollup.get(rollup_type)
            return None
        
        elif prop_type == "people":
            return [p.get("name", p.get("id")) for p in prop.get("people", [])]
        
        elif prop_type == "files":
            files = prop.get("files", [])
            result = []
            for f in files:
                if f.get("type") == "file":
                    result.append(f.get("file", {}).get("url", ""))
                elif f.get("type") == "external":
                    result.append(f.get("external", {}).get("url", ""))
            return result
        
        elif prop_type == "created_time":
            return prop.get("created_time")
        
        elif prop_type == "last_edited_time":
            return prop.get("last_edited_time")
        
        elif prop_type == "created_by":
            created_by = prop.get("created_by", {})
            return created_by.get("name", created_by.get("id"))
        
        elif prop_type == "last_edited_by":
            edited_by = prop.get("last_edited_by", {})
            return edited_by.get("name", edited_by.get("id"))
        
        else:
            return prop.get(prop_type)


# Singleton instance
_notion_client: Optional[NotionClient] = None
_notion_error: Optional[str] = None


def get_notion_client(api_key: Optional[str] = None) -> tuple[Optional[NotionClient], Optional[str]]:
    """
    Get or create the Notion client singleton.
    Returns (client, error_message).
    """
    global _notion_client, _notion_error
    
    if _notion_client is not None:
        return _notion_client, None
    
    if _notion_error is not None:
        return None, _notion_error
    
    # Get API key from parameter or environment
    if api_key is None:
        api_key = os.getenv("NOTION_API_KEY")
    
    if not api_key:
        _notion_error = (
            "Notion integration not configured.\n\n"
            "To set up Notion:\n"
            "1. Go to https://www.notion.so/my-integrations\n"
            "2. Create a new integration for your workspace\n"
            "3. Copy the 'Internal Integration Token'\n"
            "4. Add NOTION_API_KEY to your .env file\n"
            "5. Share your databases with the integration in Notion"
        )
        return None, _notion_error
    
    try:
        _notion_client = NotionClient(api_key)
        # Test connection with a simple search
        _notion_client.search(page_size=1)
        return _notion_client, None
    except Exception as e:
        _notion_error = f"Failed to connect to Notion: {str(e)}"
        return None, _notion_error

