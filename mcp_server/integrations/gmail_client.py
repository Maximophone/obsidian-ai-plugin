"""
Gmail Client

OAuth-based Gmail API client for sending, searching, and reading emails.
Ported from the original obsidian_ai project.
"""

import os
import pickle
import base64
import logging
from pathlib import Path
from email.mime.text import MIMEText
from typing import List, Dict, Any, Optional
import quopri

from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

logger = logging.getLogger(__name__)

# Gmail API scopes
GMAIL_SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
]

# Essential fields to keep when filtering email data
ESSENTIAL_EMAIL_FIELDS = {
    'id',
    'threadId',
    'labelIds',
    'snippet',
    'simplified_content'
}

ESSENTIAL_HEADERS = {
    'From',
    'To',
    'Subject',
    'Date',
    'Reply-To'
}


def process_gmail_message(message: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process a Gmail API message by:
    1. Extracting and decoding the content into simplified_content
    2. Removing base64 data to clean up the structure
    """
    def decode_content(part: Dict[str, Any]) -> str:
        """Helper function to decode message content"""
        if 'data' not in part.get('body', {}):
            return ''
        
        data = part['body']['data']
        decoded_bytes = base64.urlsafe_b64decode(data)
        
        # Handle different content transfer encodings
        if 'headers' in part:
            for header in part['headers']:
                if header['name'].lower() == 'content-transfer-encoding':
                    if header['value'].lower() == 'quoted-printable':
                        decoded_bytes = quopri.decodestring(decoded_bytes)
                    break
        
        try:
            return decoded_bytes.decode('utf-8')
        except UnicodeDecodeError:
            return decoded_bytes.decode('iso-8859-1')

    def extract_plain_text(payload: Dict[str, Any]) -> str:
        """Extract plain text content from payload"""
        if payload.get('mimeType') == 'text/plain':
            return decode_content(payload)
        
        if payload.get('mimeType') == 'multipart/alternative':
            parts = payload.get('parts', [])
            for part in parts:
                if part.get('mimeType') == 'text/plain':
                    return decode_content(part)
            if parts:
                return decode_content(parts[0])
        return ''

    def clean_part(part: Dict[str, Any]) -> Dict[str, Any]:
        """Clean a message part by removing body data"""
        cleaned_part = part.copy()
        if 'body' in cleaned_part:
            body = cleaned_part['body'].copy()
            if 'data' in body:
                del body['data']
            cleaned_part['body'] = body
        return cleaned_part

    # Create a copy of the original message
    processed_message = message.copy()
    
    # Add simplified content
    if 'payload' in message:
        processed_message['simplified_content'] = extract_plain_text(message['payload'])
    
    # Clean the payload
    if 'payload' in processed_message:
        payload = processed_message['payload']
        
        # Clean main body
        if 'body' in payload:
            body = payload['body'].copy()
            if 'data' in body:
                del body['data']
            payload['body'] = body
            
        # Clean parts
        if 'parts' in payload:
            payload['parts'] = [clean_part(part) for part in payload['parts']]
        
        processed_message['payload'] = payload

    return processed_message


def filter_email_data(raw_email: Dict[str, Any]) -> Dict[str, Any]:
    """Filter email to only essential fields."""
    filtered = {}
    
    # First level filtering
    for field in ESSENTIAL_EMAIL_FIELDS:
        if field in raw_email:
            filtered[field] = raw_email[field]
    
    # Handle payload and headers specially
    if 'payload' in raw_email:
        filtered['headers'] = {}
        headers = raw_email['payload'].get('headers', [])
        
        # Filter only essential headers
        filtered['headers'] = {
            header['name']: header['value']
            for header in headers
            if header['name'] in ESSENTIAL_HEADERS
        }
    
    return filtered


class GmailClient:
    """Gmail API client with OAuth authentication."""
    
    def __init__(
        self,
        credentials_path: str = 'credentials.json',
        token_path: str = 'token.pickle',
        scopes: Optional[List[str]] = None
    ):
        """
        Initialize Gmail client.
        
        Args:
            credentials_path: Path to OAuth credentials JSON file
            token_path: Path to store the OAuth token
            scopes: Gmail API scopes to request
        """
        self.scopes = scopes or GMAIL_SCOPES
        self.credentials_path = Path(credentials_path)
        self.token_path = Path(token_path)
        self.service = None
        self._authenticated = False

    def authenticate(self) -> bool:
        """
        Authenticate with Gmail API.
        Returns True if successful, False otherwise.
        """
        creds = None

        # Try loading existing token
        if self.token_path.exists():
            with open(self.token_path, 'rb') as token_file:
                creds = pickle.load(token_file)

        # If no valid credentials, need to authenticate
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                try:
                    creds.refresh(Request())
                except Exception as e:
                    logger.error(f"Failed to refresh token: {e}")
                    creds = None
            
            if not creds:
                if not self.credentials_path.exists():
                    logger.error(f"Credentials file not found: {self.credentials_path}")
                    return False
                
                try:
                    flow = InstalledAppFlow.from_client_secrets_file(
                        str(self.credentials_path), self.scopes
                    )
                    creds = flow.run_local_server(port=0)
                except Exception as e:
                    logger.error(f"OAuth flow failed: {e}")
                    return False

            # Save token for future runs
            with open(self.token_path, 'wb') as token_file:
                pickle.dump(creds, token_file)

        try:
            self.service = build('gmail', 'v1', credentials=creds)
            self._authenticated = True
            return True
        except Exception as e:
            logger.error(f"Failed to build Gmail service: {e}")
            return False

    @property
    def is_authenticated(self) -> bool:
        return self._authenticated and self.service is not None

    def _ensure_authenticated(self):
        """Ensure client is authenticated before making API calls."""
        if not self.is_authenticated:
            if not self.authenticate():
                raise RuntimeError("Gmail authentication failed")

    def send_email(
        self,
        to: List[str],
        subject: str,
        body: str,
        cc: Optional[List[str]] = None,
        from_name: Optional[str] = None,
        from_email: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Send an email.
        
        Args:
            to: List of recipient email addresses
            subject: Email subject
            body: HTML body content
            cc: Optional CC recipients
            from_name: Optional sender display name
            from_email: Optional sender email (must have permission)
        """
        self._ensure_authenticated()
        
        message = MIMEText(body, 'html')
        message['to'] = ', '.join(to)
        
        if cc:
            message['cc'] = ', '.join(cc)
        
        message['subject'] = subject
        
        # Get sender email
        if from_email:
            sender_email = from_email
        else:
            sender_info = self.service.users().getProfile(userId='me').execute()
            sender_email = sender_info['emailAddress']
        
        if from_name:
            message['from'] = f"{from_name} <{sender_email}>"
        else:
            message['from'] = sender_email

        raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode()
        send_body = {'raw': raw_message}

        return self.service.users().messages().send(
            userId='me', 
            body=send_body
        ).execute()

    def reply_to_email(
        self,
        message_id: str,
        to: List[str],
        body: str,
        cc: Optional[List[str]] = None,
        from_name: Optional[str] = None,
        from_email: Optional[str] = None
    ) -> Dict[str, Any]:
        """Reply to an email in the same thread."""
        self._ensure_authenticated()
        
        # Get the original message
        original = self.get_email(message_id)
        thread_id = original.get('threadId')
        
        # Extract headers
        headers = original.get('payload', {}).get('headers', [])
        original_subject = None
        original_message_id = None
        original_references = None
        
        for header in headers:
            name = header['name'].lower()
            if name == 'subject':
                original_subject = header['value']
            elif name == 'message-id':
                original_message_id = header['value']
            elif name == 'references':
                original_references = header['value']
        
        # Build reply subject
        if original_subject:
            if not original_subject.lower().startswith('re:'):
                reply_subject = f"Re: {original_subject}"
            else:
                reply_subject = original_subject
        else:
            reply_subject = "Re: (no subject)"
        
        # Create reply message
        message = MIMEText(body, 'html')
        message['to'] = ', '.join(to)
        
        if cc:
            message['cc'] = ', '.join(cc)
        
        message['subject'] = reply_subject
        
        # Threading headers
        if original_message_id:
            message['In-Reply-To'] = original_message_id
            if original_references:
                message['References'] = f"{original_references} {original_message_id}"
            else:
                message['References'] = original_message_id
        
        # Sender
        if from_email:
            sender_email = from_email
        else:
            sender_info = self.service.users().getProfile(userId='me').execute()
            sender_email = sender_info['emailAddress']
        
        if from_name:
            message['from'] = f"{from_name} <{sender_email}>"
        else:
            message['from'] = sender_email
        
        raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode()
        send_body = {
            'raw': raw_message,
            'threadId': thread_id
        }
        
        return self.service.users().messages().send(
            userId='me',
            body=send_body
        ).execute()

    def list_emails(
        self,
        query: str = '',
        label_ids: Optional[List[str]] = None,
        max_results: int = 10
    ) -> List[Dict[str, Any]]:
        """List emails with optional filtering."""
        self._ensure_authenticated()
        
        if label_ids is None:
            label_ids = []

        response = self.service.users().messages().list(
            userId='me',
            q=query,
            labelIds=label_ids,
            maxResults=max_results,
        ).execute()

        messages = response.get('messages', [])
        results = []

        for msg in messages:
            msg_id = msg['id']
            detail = self.service.users().messages().get(
                userId='me',
                id=msg_id,
                format='metadata',
                metadataHeaders=['Subject', 'From', 'To', 'Cc', 'Date']
            ).execute()

            headers = detail.get('payload', {}).get('headers', [])
            result = {
                'id': msg_id,
                'threadId': msg.get('threadId'),
            }
            
            for h in headers:
                name = h['name'].lower()
                if name == 'subject':
                    result['subject'] = h['value']
                elif name == 'from':
                    result['from'] = h['value']
                elif name == 'to':
                    result['to'] = h['value']
                elif name == 'cc':
                    result['cc'] = h['value']
                elif name == 'date':
                    result['date'] = h['value']

            results.append(result)

        return results

    def get_email(self, message_id: str) -> Dict[str, Any]:
        """Get full email by ID."""
        self._ensure_authenticated()
        
        return self.service.users().messages().get(
            userId='me',
            id=message_id,
            format='full'
        ).execute()
    
    def search_emails(
        self,
        sender: Optional[str] = None,
        subject: Optional[str] = None,
        is_unread: bool = False,
        has_attachment: bool = False,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        max_results: int = 10
    ) -> List[Dict[str, Any]]:
        """Search emails with various filters."""
        conditions = []

        if sender:
            conditions.append(f"from:{sender}")
        if subject:
            conditions.append(f"subject:{subject}")
        if is_unread:
            conditions.append("is:unread")
        if has_attachment:
            conditions.append("has:attachment")
        if from_date:
            conditions.append(f"after:{from_date}")
        if to_date:
            conditions.append(f"before:{to_date}")

        query = " ".join(conditions)
        return self.list_emails(query=query, max_results=max_results)

    def list_attachments(self, message_id: str) -> List[Dict[str, Any]]:
        """List attachments in an email."""
        self._ensure_authenticated()
        
        message = self.get_email(message_id)
        attachments = []
        
        def find_attachments(parts: List[Dict[str, Any]]):
            for part in parts:
                filename = part.get('filename', '')
                if filename:
                    attachments.append({
                        'id': part['body'].get('attachmentId'),
                        'filename': filename,
                        'mimeType': part.get('mimeType', 'application/octet-stream'),
                        'size': part['body'].get('size', 0)
                    })
                if 'parts' in part:
                    find_attachments(part['parts'])
        
        payload = message.get('payload', {})
        if 'parts' in payload:
            find_attachments(payload['parts'])
        
        return attachments

    def download_attachment(
        self,
        message_id: str,
        attachment_id: str,
        filename: str,
        download_path: str
    ) -> str:
        """Download a single attachment."""
        self._ensure_authenticated()
        
        attachment = self.service.users().messages().attachments().get(
            userId='me',
            messageId=message_id,
            id=attachment_id
        ).execute()
        
        data = attachment.get('data', '')
        file_data = base64.urlsafe_b64decode(data)
        
        # Ensure directory exists
        download_dir = Path(download_path)
        download_dir.mkdir(parents=True, exist_ok=True)
        
        # Handle filename conflicts
        file_path = download_dir / filename
        base_name = file_path.stem
        ext = file_path.suffix
        counter = 1
        
        while file_path.exists():
            file_path = download_dir / f"{base_name}_{counter}{ext}"
            counter += 1
        
        with open(file_path, 'wb') as f:
            f.write(file_data)
        
        logger.info(f"Downloaded attachment: {file_path}")
        return str(file_path)

    def download_attachments(
        self,
        message_id: str,
        download_path: str,
        filenames: List[str]
    ) -> List[Dict[str, Any]]:
        """Download specific attachments by filename."""
        attachments = self.list_attachments(message_id)
        attachment_lookup = {att['filename']: att for att in attachments}
        results = []
        
        for filename in filenames:
            if filename not in attachment_lookup:
                results.append({
                    'filename': filename,
                    'path': None,
                    'success': False,
                    'error': 'Attachment not found'
                })
                continue
            
            attachment = attachment_lookup[filename]
            try:
                if attachment['id']:
                    file_path = self.download_attachment(
                        message_id=message_id,
                        attachment_id=attachment['id'],
                        filename=attachment['filename'],
                        download_path=download_path
                    )
                    results.append({
                        'filename': attachment['filename'],
                        'path': file_path,
                        'size': attachment['size'],
                        'success': True
                    })
                else:
                    results.append({
                        'filename': attachment['filename'],
                        'path': None,
                        'success': False,
                        'error': 'Inline attachment cannot be downloaded'
                    })
            except Exception as e:
                logger.error(f"Failed to download {attachment['filename']}: {e}")
                results.append({
                    'filename': attachment['filename'],
                    'path': None,
                    'success': False,
                    'error': str(e)
                })
        
        return results


# Singleton instance
_gmail_client: Optional[GmailClient] = None
_gmail_error: Optional[str] = None


def get_gmail_client(
    credentials_path: Optional[str] = None,
    token_path: Optional[str] = None
) -> tuple[Optional[GmailClient], Optional[str]]:
    """
    Get or create the Gmail client singleton.
    Returns (client, error_message).
    """
    global _gmail_client, _gmail_error
    
    if _gmail_client is not None and _gmail_client.is_authenticated:
        return _gmail_client, None
    
    if _gmail_error is not None:
        return None, _gmail_error
    
    # Default paths relative to mcp_server directory
    if credentials_path is None:
        credentials_path = str(Path(__file__).parent.parent / 'credentials.json')
    if token_path is None:
        token_path = str(Path(__file__).parent.parent / 'token.pickle')
    
    # Check if credentials exist
    if not Path(credentials_path).exists():
        _gmail_error = (
            "Gmail integration not configured.\n\n"
            "To set up Gmail:\n"
            "1. Go to https://console.cloud.google.com/\n"
            "2. Create a project and enable the Gmail API\n"
            "3. Create OAuth 2.0 credentials (Desktop app)\n"
            "4. Download and save as 'credentials.json' in mcp_server/\n"
            "5. Run a Gmail tool - it will open a browser for OAuth"
        )
        return None, _gmail_error
    
    try:
        _gmail_client = GmailClient(
            credentials_path=credentials_path,
            token_path=token_path
        )
        if not _gmail_client.authenticate():
            _gmail_error = "Gmail authentication failed. Check credentials.json and try again."
            _gmail_client = None
            return None, _gmail_error
        
        return _gmail_client, None
    except Exception as e:
        _gmail_error = f"Failed to initialize Gmail client: {str(e)}"
        return None, _gmail_error

