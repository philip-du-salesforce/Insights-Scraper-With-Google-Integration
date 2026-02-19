#!/usr/bin/env python3
"""
Upload trigger server for Insights Scraper.

Run this script once (e.g. in a terminal or at login). When the Chrome extension
finishes extraction, it sends a request here; this server runs the Google Sheets
uploader so the user doesn't have to open a terminal manually.

Usage:
  python upload_trigger_server.py [--port 8765]

Then use the extension as usual. When extraction completes, the extension will
call http://localhost:8765/upload?folder=CustomerName_YYYY-MM-DD and this server
will run the uploader for that folder.

The folder is looked up in:
  1. ~/Desktop/<folder>
  2. ~/Downloads/<folder>
"""

import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Optional, Tuple
from urllib.parse import parse_qs, urlparse

SCRIPT_DIR = Path(__file__).resolve().parent
UPLOADER_SCRIPT = SCRIPT_DIR / "google_sheets_uploader.py"
DEFAULT_PORT = 8765


def resolve_folder_path(folder_name: str) -> Optional[Path]:
    """Resolve folder name to full path. Check Desktop, then Downloads."""
    folder_name = (folder_name or "").strip()
    if not folder_name:
        return None
    home = Path.home()
    for base in (home / "Desktop", home / "Downloads"):
        candidate = base / folder_name
        if candidate.is_dir():
            return candidate
    return None


def run_uploader(folder_path: Path, share_emails: Optional[list] = None) -> Tuple[bool, str, Optional[str]]:
    """Run google_sheets_uploader.py for the given folder. Optionally share with extra emails. Returns (success, message, spreadsheet_url)."""
    if not UPLOADER_SCRIPT.exists():
        return False, "Uploader script not found", None
    cmd = [sys.executable, str(UPLOADER_SCRIPT), str(folder_path)]
    if share_emails:
        cmd.extend(["--share-with", ",".join(str(e).strip() for e in share_emails if e)])
    try:
        result = subprocess.run(
            cmd,
            cwd=str(SCRIPT_DIR),
            capture_output=True,
            text=True,
            timeout=300,
        )
        out = (result.stdout or "").strip()
        err = (result.stderr or "").strip()
        if result.returncode != 0:
            return False, err or out or "Upload failed", None
        # Try to extract spreadsheet URL from last line (e.g. "Done. Open: https://...")
        url = None
        for line in (out + "\n" + err).splitlines():
            if "docs.google.com/spreadsheets" in line:
                for part in line.split():
                    if part.startswith("https://"):
                        url = part.rstrip(".,")
                        break
        return True, out or "Upload completed", url
    except subprocess.TimeoutExpired:
        return False, "Upload timed out", None
    except Exception as e:
        return False, str(e), None


class UploadHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != "/upload":
            self._send(404, {"success": False, "message": "Not found"})
            return
        qs = parse_qs(parsed.query)
        folder_name = (qs.get("folder") or [""])[0]
        self._handle_upload(folder_name)

    def do_POST(self):
        if self.path != "/upload" and not self.path.startswith("/upload?"):
            self._send(404, {"success": False, "message": "Not found"})
            return
        folder_name = None
        share_with = []
        if "content-length" in self.headers:
            length = int(self.headers["content-length"])
            if length:
                body = self.rfile.read(length).decode("utf-8", errors="replace")
                try:
                    data = json.loads(body)
                    folder_name = data.get("folder") or data.get("folderName")
                    share_with = data.get("shareWith") or []
                    if not isinstance(share_with, list):
                        share_with = [share_with] if share_with else []
                except Exception:
                    pass
        if not folder_name and self.path.startswith("/upload?"):
            qs = parse_qs(urlparse(self.path).query)
            folder_name = (qs.get("folder") or [""])[0]
        self._handle_upload(folder_name or "", share_emails=share_with)

    def _handle_upload(self, folder_name: str, share_emails: Optional[list] = None):
        folder_path = resolve_folder_path(folder_name)
        if not folder_path:
            self._send(400, {
                "success": False,
                "message": f"Folder not found: {folder_name!r}. Check Desktop and Downloads.",
            })
            return
        success, message, url = run_uploader(folder_path, share_emails=share_emails)
        self._send(200, {
            "success": success,
            "message": message,
            "spreadsheetUrl": url,
            "folder": folder_name,
        })

    def _send(self, code: int, data: dict):
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print("[TriggerServer]", args[0] if args else format)


def main():
    port = DEFAULT_PORT
    if "--port" in sys.argv:
        i = sys.argv.index("--port")
        if i + 1 < len(sys.argv):
            port = int(sys.argv[i + 1])
    server = HTTPServer(("127.0.0.1", port), UploadHandler)
    print(f"Insights Scraper upload trigger server running at http://127.0.0.1:{port}")
    print("When the extension finishes extraction, it will trigger the Google Sheets upload here.")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        server.shutdown()


if __name__ == "__main__":
    main()
