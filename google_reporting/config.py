"""
Configuration for Google OAuth and reporting.
Store credentials in credentials.json (see credentials.example.json).
Do not commit credentials.json or token.json to version control.
"""

import os
from pathlib import Path

# Directory containing this config (project root for google_reporting)
BASE_DIR = Path(__file__).resolve().parent

# --- OAuth & Google APIs ---
# Use credentials from file or environment variables
GOOGLE_CREDENTIALS_PATH = os.environ.get("GOOGLE_CREDENTIALS_PATH") or str(BASE_DIR / "credentials.json")
GOOGLE_TOKEN_PATH = os.environ.get("GOOGLE_TOKEN_PATH") or str(BASE_DIR / "token.json")

# Your OAuth 2.0 Client ID (from Google Cloud Console)
CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID") or "471139027383-bqbgf5iekrimm76roloeubap7u1qq45s.apps.googleusercontent.com"

# Template Spreadsheet ID (from the template URL)
TEMPLATE_SPREADSHEET_ID = os.environ.get("GOOGLE_TEMPLATE_SPREADSHEET_ID") or "1u17hAmhV87-EfBK5IvXaAZzGGK6PNLwaL42kKQk8Djk"

# Email to share the new report with (as Editor)
SHARE_EMAIL = os.environ.get("GOOGLE_REPORT_SHARE_EMAIL") or "philip.du@salesforce.com"

# OAuth scopes
SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
]
