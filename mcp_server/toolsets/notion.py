"""
Notion Databases Toolset

Tools for interacting with Notion databases - read schemas, query rows,
create/update pages, and more.

Requires a Notion integration token to be configured.
"""

import json
from typing import Optional, List, Dict, Any

from .base import tool, RegisteredTool
from integrations.notion_client import get_notion_client, NotionClient


def _get_client() -> NotionClient:
    """Get Notion client or raise error."""
    client, error = get_notion_client()
    if error:
        raise RuntimeError(error)
    return client


def _format_database_schema(db: Dict[str, Any]) -> str:
    """Format database schema for display."""
    output = []
    
    title = ""
    if db.get("title"):
        title = "".join(t.get("plain_text", "") for t in db["title"])
    
    output.append(f"Database: {title or '(untitled)'}")
    output.append(f"ID: {db.get('id', 'unknown')}")
    output.append("")
    output.append("Properties (columns):")
    
    props = db.get("properties", {})
    for name, prop in props.items():
        prop_type = prop.get("type", "unknown")
        
        # Add extra info for select/multi_select
        extra = ""
        if prop_type == "select":
            options = prop.get("select", {}).get("options", [])
            if options:
                option_names = [o.get("name") for o in options[:5]]
                extra = f" (options: {', '.join(option_names)}{'...' if len(options) > 5 else ''})"
        elif prop_type == "multi_select":
            options = prop.get("multi_select", {}).get("options", [])
            if options:
                option_names = [o.get("name") for o in options[:5]]
                extra = f" (options: {', '.join(option_names)}{'...' if len(options) > 5 else ''})"
        elif prop_type == "status":
            options = prop.get("status", {}).get("options", [])
            if options:
                option_names = [o.get("name") for o in options[:5]]
                extra = f" (options: {', '.join(option_names)})"
        elif prop_type == "relation":
            rel_db = prop.get("relation", {}).get("database_id", "")
            extra = f" (→ {rel_db[:8]}...)" if rel_db else ""
        
        output.append(f"  • {name} ({prop_type}){extra}")
    
    return "\n".join(output)


def _format_page_row(page: Dict[str, Any], db_props: Dict[str, Any]) -> str:
    """Format a page/row for display."""
    output = []
    page_id = page.get("id", "unknown")
    
    props = page.get("properties", {})
    
    # Find title property
    title_value = ""
    for name, prop in props.items():
        if prop.get("type") == "title":
            title_value = NotionClient.extract_property_value(prop)
            break
    
    output.append(f"Row: {title_value or '(untitled)'}")
    output.append(f"ID: {page_id}")
    
    # Show other properties
    for name, prop in props.items():
        if prop.get("type") == "title":
            continue  # Already shown
        
        value = NotionClient.extract_property_value(prop)
        
        # Format value for display
        if isinstance(value, list):
            value = ", ".join(str(v) for v in value)
        elif value is None:
            value = "(empty)"
        
        output.append(f"  {name}: {value}")
    
    return "\n".join(output)


# ============ Tools ============

@tool(
    description="Get the schema (structure) of a Notion database. Shows all properties/columns and their types.",
    database_id="The database ID or URL. You can paste the full Notion URL.",
    safe=True
)
def get_database_schema(database_id: str) -> str:
    """Get database schema."""
    client = _get_client()
    
    db = client.get_database(database_id)
    return _format_database_schema(db)


@tool(
    description="Query rows from a Notion database. Returns pages with their property values.",
    database_id="The database ID or URL",
    limit="Maximum number of rows to return (default: 20, max: 100)",
    safe=True
)
def query_database(database_id: str, limit: int = 20) -> str:
    """Query database rows."""
    client = _get_client()
    
    # First get schema to understand properties
    db = client.get_database(database_id)
    db_props = db.get("properties", {})
    
    # Query the database
    result = client.query_database(database_id, page_size=min(limit, 100))
    
    pages = result.get("results", [])
    
    if not pages:
        return "No rows found in database."
    
    output = [f"Found {len(pages)} row(s):\n"]
    
    for i, page in enumerate(pages, 1):
        output.append(f"--- Row {i} ---")
        output.append(_format_page_row(page, db_props))
        output.append("")
    
    if result.get("has_more"):
        output.append(f"(More rows available - use start_cursor: {result.get('next_cursor')})")
    
    return "\n".join(output)


@tool(
    description="Query a Notion database with filters. Use Notion filter syntax in JSON format.",
    database_id="The database ID or URL",
    filter_json="Filter in Notion JSON format, e.g. '{\"property\": \"Status\", \"select\": {\"equals\": \"Done\"}}'",
    limit="Maximum rows to return (default: 20)",
    safe=True
)
def query_database_filtered(database_id: str, filter_json: str, limit: int = 20) -> str:
    """Query database with filter."""
    client = _get_client()
    
    # Parse filter JSON
    try:
        filter_obj = json.loads(filter_json)
    except json.JSONDecodeError as e:
        return f"Error: Invalid JSON filter: {e}"
    
    # Get schema
    db = client.get_database(database_id)
    db_props = db.get("properties", {})
    
    # Query with filter
    result = client.query_database(
        database_id, 
        filter_obj=filter_obj,
        page_size=min(limit, 100)
    )
    
    pages = result.get("results", [])
    
    if not pages:
        return "No rows match the filter."
    
    output = [f"Found {len(pages)} matching row(s):\n"]
    
    for i, page in enumerate(pages, 1):
        output.append(f"--- Row {i} ---")
        output.append(_format_page_row(page, db_props))
        output.append("")
    
    return "\n".join(output)


@tool(
    description="Get a specific row (page) from a database by its ID.",
    page_id="The page/row ID or URL",
    safe=True
)
def get_database_row(page_id: str) -> str:
    """Get a specific row."""
    client = _get_client()
    
    page = client.get_page(page_id)
    return _format_page_row(page, {})


@tool(
    description="Create a new row in a Notion database. Properties should be a JSON object mapping property names to values.",
    database_id="The database ID or URL",
    properties_json="JSON object with property values. Use property names as keys. Example: '{\"Name\": \"New Item\", \"Status\": \"In Progress\", \"Priority\": 1}'",
    safe=False
)
def create_database_row(database_id: str, properties_json: str) -> str:
    """Create a new row in database."""
    client = _get_client()
    
    # Parse properties JSON
    try:
        simple_props = json.loads(properties_json)
    except json.JSONDecodeError as e:
        return f"Error: Invalid JSON properties: {e}"
    
    # Get database schema to know property types
    db = client.get_database(database_id)
    db_props = db.get("properties", {})
    
    # Convert simple values to Notion format
    notion_props = {}
    errors = []
    
    for prop_name, value in simple_props.items():
        if prop_name not in db_props:
            errors.append(f"Unknown property: {prop_name}")
            continue
        
        prop_type = db_props[prop_name].get("type")
        
        try:
            notion_props[prop_name] = NotionClient.format_property_value(prop_type, value)
        except Exception as e:
            errors.append(f"Error formatting {prop_name}: {e}")
    
    if errors:
        return "Errors:\n" + "\n".join(errors)
    
    # Create the page
    page = client.create_page(database_id, notion_props)
    
    page_id = page.get("id", "unknown")
    return f"Row created successfully!\nPage ID: {page_id}\nURL: {page.get('url', 'N/A')}"


@tool(
    description="Update properties of an existing row in a Notion database.",
    page_id="The page/row ID or URL to update",
    properties_json="JSON object with property values to update. Example: '{\"Status\": \"Done\", \"Priority\": 2}'",
    safe=False
)
def update_database_row(page_id: str, properties_json: str) -> str:
    """Update a row's properties."""
    client = _get_client()
    
    # Parse properties JSON
    try:
        simple_props = json.loads(properties_json)
    except json.JSONDecodeError as e:
        return f"Error: Invalid JSON properties: {e}"
    
    # Get current page to understand its database schema
    page = client.get_page(page_id)
    
    # Get database ID from parent
    parent = page.get("parent", {})
    database_id = parent.get("database_id")
    
    if not database_id:
        return "Error: This page is not in a database."
    
    # Get database schema
    db = client.get_database(database_id)
    db_props = db.get("properties", {})
    
    # Convert simple values to Notion format
    notion_props = {}
    errors = []
    
    for prop_name, value in simple_props.items():
        if prop_name not in db_props:
            errors.append(f"Unknown property: {prop_name}")
            continue
        
        prop_type = db_props[prop_name].get("type")
        
        try:
            notion_props[prop_name] = NotionClient.format_property_value(prop_type, value)
        except Exception as e:
            errors.append(f"Error formatting {prop_name}: {e}")
    
    if errors:
        return "Errors:\n" + "\n".join(errors)
    
    # Update the page
    updated_page = client.update_page(page_id, notion_props)
    
    return f"Row updated successfully!\nPage ID: {updated_page.get('id', 'unknown')}"


@tool(
    description="Archive (soft-delete) a row in a Notion database.",
    page_id="The page/row ID or URL to archive",
    safe=False
)
def archive_database_row(page_id: str) -> str:
    """Archive a row."""
    client = _get_client()
    
    result = client.archive_page(page_id, archived=True)
    return f"Row archived successfully!\nPage ID: {result.get('id', 'unknown')}"


@tool(
    description="Unarchive (restore) a previously archived row.",
    page_id="The page/row ID or URL to restore",
    safe=False
)
def unarchive_database_row(page_id: str) -> str:
    """Unarchive a row."""
    client = _get_client()
    
    result = client.archive_page(page_id, archived=False)
    return f"Row restored successfully!\nPage ID: {result.get('id', 'unknown')}"


@tool(
    description="Search for databases and pages in your Notion workspace.",
    query="Search query text",
    filter_type="Filter by type: 'database' or 'page'. Leave empty for both.",
    limit="Maximum results (default: 10)",
    safe=True
)
def search_notion(query: str = "", filter_type: str = "", limit: int = 10) -> str:
    """Search Notion workspace."""
    client = _get_client()
    
    result = client.search(
        query=query,
        filter_type=filter_type if filter_type in ("database", "page") else None,
        page_size=min(limit, 100)
    )
    
    results = result.get("results", [])
    
    if not results:
        return "No results found."
    
    output = [f"Found {len(results)} result(s):\n"]
    
    for item in results:
        obj_type = item.get("object")
        item_id = item.get("id", "unknown")
        
        # Get title
        title = "(untitled)"
        if obj_type == "database":
            title_arr = item.get("title", [])
            title = "".join(t.get("plain_text", "") for t in title_arr) or "(untitled)"
            output.append(f"📊 Database: {title}")
        elif obj_type == "page":
            props = item.get("properties", {})
            for prop in props.values():
                if prop.get("type") == "title":
                    title = NotionClient.extract_property_value(prop) or "(untitled)"
                    break
            output.append(f"📄 Page: {title}")
        
        output.append(f"   ID: {item_id}")
        if item.get("url"):
            output.append(f"   URL: {item['url']}")
        output.append("")
    
    return "\n".join(output)


@tool(
    description="List all databases shared with the integration. Use this to discover available databases.",
    limit="Maximum databases to list (default: 20)",
    safe=True
)
def list_databases(limit: int = 20) -> str:
    """List all accessible databases."""
    client = _get_client()
    
    result = client.search(filter_type="database", page_size=min(limit, 100))
    
    databases = result.get("results", [])
    
    if not databases:
        return "No databases found. Make sure to share your databases with the integration."
    
    output = [f"Found {len(databases)} database(s):\n"]
    
    for db in databases:
        db_id = db.get("id", "unknown")
        title_arr = db.get("title", [])
        title = "".join(t.get("plain_text", "") for t in title_arr) or "(untitled)"
        
        # Count properties
        prop_count = len(db.get("properties", {}))
        
        output.append(f"📊 {title}")
        output.append(f"   ID: {db_id}")
        output.append(f"   Properties: {prop_count}")
        if db.get("url"):
            output.append(f"   URL: {db['url']}")
        output.append("")
    
    return "\n".join(output)


# Export tools
TOOLS = [
    list_databases,
    get_database_schema,
    query_database,
    query_database_filtered,
    get_database_row,
    create_database_row,
    update_database_row,
    archive_database_row,
    unarchive_database_row,
    search_notion,
]

