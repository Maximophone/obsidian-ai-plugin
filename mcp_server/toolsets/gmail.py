"""
Gmail Toolset

Tools for reading, searching, and sending emails via Gmail.
Requires OAuth credentials to be set up.
"""

import json
import os
from typing import Optional

from .base import tool, RegisteredTool
from integrations.gmail_client import (
    get_gmail_client,
    process_gmail_message,
    filter_email_data
)


def _get_client():
    """Get Gmail client or raise error."""
    client, error = get_gmail_client()
    if error:
        raise RuntimeError(error)
    return client


@tool(
    description="Send an email through Gmail. Supports HTML content, CC recipients, and custom sender name.",
    to="Recipient email address(es), comma-separated for multiple",
    subject="Email subject line",
    body="HTML content of the email (use <br> for line breaks)",
    cc="Optional CC recipients, comma-separated",
    from_name="Optional display name for the sender",
    from_email="Optional sender email (must have permission to send as)",
    safe=False
)
def send_email(
    to: str,
    subject: str,
    body: str,
    cc: str = "",
    from_name: str = "",
    from_email: str = ""
) -> str:
    """Send an email via Gmail."""
    client = _get_client()
    
    to_list = [e.strip() for e in to.split(',') if e.strip()]
    cc_list = [e.strip() for e in cc.split(',')] if cc else None
    
    result = client.send_email(
        to=to_list,
        subject=subject,
        body=body,
        cc=cc_list,
        from_name=from_name if from_name else None,
        from_email=from_email if from_email else None
    )
    
    return f"Email sent successfully!\nMessage ID: {result.get('id')}\nThread ID: {result.get('threadId')}"


@tool(
    description="Reply to an existing email, keeping the conversation in the same thread. "
                "You MUST specify the recipient - check the original email's 'From' field.",
    message_id="ID of the message to reply to (from search results or get_email_content)",
    to="Recipient email address(es) to reply to - typically the original sender",
    body="HTML content of the reply (use <br> for line breaks)",
    cc="Optional CC recipients, comma-separated",
    from_name="Optional display name for the sender",
    from_email="Optional sender email (must have permission)",
    safe=False
)
def reply_to_email(
    message_id: str,
    to: str,
    body: str,
    cc: str = "",
    from_name: str = "",
    from_email: str = ""
) -> str:
    """Reply to an email in the same thread."""
    client = _get_client()
    
    to_list = [e.strip() for e in to.split(',') if e.strip()]
    cc_list = [e.strip() for e in cc.split(',')] if cc else None
    
    result = client.reply_to_email(
        message_id=message_id,
        to=to_list,
        body=body,
        cc=cc_list,
        from_name=from_name if from_name else None,
        from_email=from_email if from_email else None
    )
    
    return f"Reply sent successfully!\nMessage ID: {result.get('id')}\nThread ID: {result.get('threadId')}"


@tool(
    description="Search for emails using various filters. Returns matching emails with basic info.",
    sender="Filter by sender email address",
    subject="Filter by subject keyword/phrase",
    is_unread="Only show unread messages",
    has_attachment="Only show messages with attachments",
    from_date="Show messages after this date (YYYY/MM/DD)",
    to_date="Show messages before this date (YYYY/MM/DD)",
    max_results="Maximum results to return (default: 10)",
    safe=True
)
def search_emails(
    sender: str = "",
    subject: str = "",
    is_unread: bool = False,
    has_attachment: bool = False,
    from_date: str = "",
    to_date: str = "",
    max_results: int = 10
) -> str:
    """Search emails with filters."""
    client = _get_client()
    
    results = client.search_emails(
        sender=sender if sender else None,
        subject=subject if subject else None,
        is_unread=is_unread,
        has_attachment=has_attachment,
        from_date=from_date if from_date else None,
        to_date=to_date if to_date else None,
        max_results=max_results
    )
    
    if not results:
        return "No emails found matching the search criteria."
    
    output = [f"Found {len(results)} email(s):\n"]
    
    for i, email in enumerate(results, 1):
        output.append(f"--- Email {i} ---")
        output.append(f"ID: {email.get('id')}")
        output.append(f"From: {email.get('from', 'Unknown')}")
        output.append(f"Subject: {email.get('subject', '(no subject)')}")
        output.append(f"Date: {email.get('date', 'Unknown')}")
        if email.get('to'):
            output.append(f"To: {email.get('to')}")
        output.append("")
    
    return "\n".join(output)


@tool(
    description="Get the full content of a specific email by ID. Use after searching to read an email.",
    message_id="The email ID (from search results)",
    simplified="Return simplified/decoded content (default: true)",
    safe=True
)
def get_email_content(message_id: str, simplified: bool = True) -> str:
    """Get full email content by ID."""
    client = _get_client()
    
    message = client.get_email(message_id)
    
    if simplified:
        message = process_gmail_message(message)
        message = filter_email_data(message)
    
    # Format output
    output = []
    
    if 'headers' in message:
        headers = message['headers']
        if 'From' in headers:
            output.append(f"From: {headers['From']}")
        if 'To' in headers:
            output.append(f"To: {headers['To']}")
        if 'Subject' in headers:
            output.append(f"Subject: {headers['Subject']}")
        if 'Date' in headers:
            output.append(f"Date: {headers['Date']}")
        output.append("")
    
    if 'simplified_content' in message:
        output.append("--- Content ---")
        output.append(message['simplified_content'])
    elif 'snippet' in message:
        output.append("--- Snippet ---")
        output.append(message['snippet'])
    
    output.append("")
    output.append(f"Message ID: {message.get('id')}")
    output.append(f"Thread ID: {message.get('threadId')}")
    
    return "\n".join(output)


@tool(
    description="List recent emails with optional search query.",
    query="Gmail search query (e.g., 'is:unread', 'from:example@gmail.com')",
    max_results="Maximum results (default: 10)",
    safe=True
)
def list_recent_emails(query: str = "", max_results: int = 10) -> str:
    """List recent emails."""
    client = _get_client()
    
    messages = client.list_emails(
        query=query,
        max_results=max_results
    )
    
    if not messages:
        return "No emails found."
    
    output = [f"Found {len(messages)} email(s):\n"]
    
    for i, email in enumerate(messages, 1):
        output.append(f"{i}. {email.get('subject', '(no subject)')}")
        output.append(f"   From: {email.get('from', 'Unknown')}")
        output.append(f"   ID: {email.get('id')}")
        output.append("")
    
    return "\n".join(output)


@tool(
    description="List all attachments in an email without downloading them.",
    message_id="The email ID",
    safe=True
)
def list_email_attachments(message_id: str) -> str:
    """List attachments in an email."""
    client = _get_client()
    
    attachments = client.list_attachments(message_id)
    
    if not attachments:
        return f"No attachments found in email {message_id}"
    
    output = [f"Found {len(attachments)} attachment(s):\n"]
    
    for att in attachments:
        size_kb = att['size'] / 1024
        output.append(f"- {att['filename']}")
        output.append(f"  Type: {att['mimeType']}")
        output.append(f"  Size: {size_kb:.1f} KB")
        output.append("")
    
    return "\n".join(output)


@tool(
    description="Download specific attachments from an email to a folder.",
    message_id="The email ID",
    download_path="Folder path to save attachments",
    filenames="JSON array of filenames to download, e.g. '[\"report.pdf\", \"data.xlsx\"]'",
    safe=False
)
def download_email_attachments(
    message_id: str,
    download_path: str,
    filenames: str
) -> str:
    """Download attachments from an email."""
    client = _get_client()
    
    # Parse filenames JSON
    try:
        filenames_list = json.loads(filenames)
        if not isinstance(filenames_list, list):
            return "Error: filenames must be a JSON array of strings"
    except json.JSONDecodeError as e:
        return f"Error: Invalid JSON for filenames: {e}"
    
    # Expand user path
    download_path = os.path.expanduser(download_path)
    
    results = client.download_attachments(message_id, download_path, filenames_list)
    
    successful = sum(1 for r in results if r['success'])
    failed = len(results) - successful
    
    output = [f"Download complete: {successful} succeeded, {failed} failed\n"]
    
    for r in results:
        if r['success']:
            output.append(f"✓ {r['filename']}")
            output.append(f"  Saved to: {r['path']}")
        else:
            output.append(f"✗ {r['filename']}")
            output.append(f"  Error: {r.get('error', 'Unknown error')}")
        output.append("")
    
    return "\n".join(output)


# Export tools
TOOLS = [
    send_email,
    reply_to_email,
    search_emails,
    get_email_content,
    list_recent_emails,
    list_email_attachments,
    download_email_attachments,
]

