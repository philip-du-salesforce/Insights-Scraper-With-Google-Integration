#!/usr/bin/env python3
"""
Upload trigger server for Insights Scraper.

Run this script once (e.g. in a terminal or at login). When the Chrome extension
finishes extraction, it sends a request here; this server runs the Google Sheets
uploader and optionally the login history analysis.

Usage:
  python upload_trigger_server.py [--port 8765]

Endpoints:
  POST /upload  - Run Google Sheets uploader for the given folder.
  POST /run-login-analysis - Run login_analysis.py after a delay (finds
    *LoginHistory*.csv in ~/Downloads or ~/Desktop). Optional body: {"delaySeconds": 60}.

The folder for uploads is looked up in:
  1. ~/Desktop/<folder>
  2. ~/Downloads/<folder>
"""

import glob
import json
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Optional, Tuple
from urllib.parse import parse_qs, urlparse

DEBUG_LOG_PATH = Path(__file__).resolve().parent.parent / ".cursor" / "debug-99ad26.log"

def _debug_log(location: str, message: str, data: dict, hypothesis_id: str) -> None:
    try:
        DEBUG_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(DEBUG_LOG_PATH, "a") as f:
            f.write(json.dumps({"sessionId": "99ad26", "location": location, "message": message, "data": data, "timestamp": int(time.time() * 1000), "hypothesisId": hypothesis_id}) + "\n")
    except Exception:
        pass

SCRIPT_DIR = Path(__file__).resolve().parent
UPLOADER_SCRIPT = SCRIPT_DIR / "google_sheets_uploader.py"
LOGIN_ANALYSIS_SCRIPT = SCRIPT_DIR / "login_analysis.py"
DEFAULT_PORT = 8765
DEFAULT_LOGIN_ANALYSIS_DELAY_SECONDS = 15


def run_login_analysis(delay_seconds: int = DEFAULT_LOGIN_ANALYSIS_DELAY_SECONDS, output_dir: Optional[Path] = None) -> None:
    """
    Run login_analysis.py after a delay (so the Login History CSV has time to land).
    Looks for *LoginHistory*.csv in ~/Downloads and ~/Desktop; uses the most recent.
    If output_dir is set, writes all outputs into that directory (e.g. the customer folder).
    Runs in background; no return value.
    """
    # #region agent log
    _debug_log("upload_trigger_server.py:run_login_analysis:entry", "run_login_analysis started", {"script_exists": LOGIN_ANALYSIS_SCRIPT.exists(), "script_path": str(LOGIN_ANALYSIS_SCRIPT), "delay_seconds": delay_seconds, "output_dir": str(output_dir) if output_dir else None}, "H3")
    # #endregion
    if not LOGIN_ANALYSIS_SCRIPT.exists():
        print("[TriggerServer] Login analysis script not found, skipping.")
        return
    home = Path.home()
    search_dirs = [home / "Downloads", home / "Desktop"]
    if delay_seconds > 0:
        time.sleep(delay_seconds)
    # #region agent log
    _debug_log("upload_trigger_server.py:run_login_analysis:after_delay", "Delay done, searching for CSV", {"search_dirs": [str(d) for d in search_dirs], "dirs_exist": [d.is_dir() for d in search_dirs]}, "H4")
    # #endregion
    files_found = []
    for directory in search_dirs:
        if directory.is_dir():
            files_found.extend(glob.glob(str(directory / "*LoginHistory*.csv")))
    # #region agent log
    _debug_log("upload_trigger_server.py:run_login_analysis:after_search", "CSV search result", {"files_found_count": len(files_found), "files_found": files_found}, "H4")
    # #endregion
    if not files_found:
        print("[TriggerServer] No LoginHistory CSV found in Downloads or Desktop, skipping analysis.")
        return
    # Use the most recently modified file
    csv_path = max(files_found, key=os.path.getmtime)
    csv_path = Path(csv_path)
    search_dir = csv_path.parent
    cmd = [sys.executable, str(LOGIN_ANALYSIS_SCRIPT), "--directory", str(search_dir), "--no-browser", "--delay", "0"]
    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)
        cmd.extend(["--output-dir", str(output_dir)])
    # #region agent log
    _debug_log("upload_trigger_server.py:run_login_analysis:before_subprocess", "About to run login_analysis.py", {"search_dir": str(search_dir), "csv_path": str(csv_path), "output_dir": str(output_dir) if output_dir else None}, "H5")
    # #endregion
    try:
        result = subprocess.run(
            cmd,
            cwd=str(SCRIPT_DIR),
            capture_output=True,
            text=True,
            timeout=300,
        )
        # #region agent log
        _debug_log("upload_trigger_server.py:run_login_analysis:after_subprocess", "Subprocess finished", {"returncode": result.returncode, "stderr_preview": (result.stderr or "")[:500], "stdout_preview": (result.stdout or "")[:300]}, "H5")
        # #endregion
        if result.returncode == 0:
            print("[TriggerServer] Login analysis completed successfully.")
            sid_exists = output_dir is not None and (output_dir / ".spreadsheet_id").is_file()
            # #region agent log
            _debug_log("upload_trigger_server.py:run_login_analysis:before_update_login", "Before --update-login-only", {"output_dir": str(output_dir) if output_dir else None, "sid_exists": sid_exists}, "H5")
            # #endregion
            if output_dir is not None and sid_exists:
                try:
                    update_result = subprocess.run(
                        [sys.executable, str(UPLOADER_SCRIPT), "--update-login-only", str(output_dir)],
                        cwd=str(SCRIPT_DIR),
                        capture_output=True,
                        text=True,
                        timeout=120,
                    )
                    # #region agent log
                    _debug_log("upload_trigger_server.py:run_login_analysis:after_update_login", "After --update-login-only", {"returncode": update_result.returncode, "stderr_preview": (update_result.stderr or "")[:400], "stdout_preview": (update_result.stdout or "")[:200]}, "H5")
                    # #endregion
                    if update_result.returncode == 0:
                        print("[TriggerServer] Login data pushed to Google Sheet.")
                    else:
                        print("[TriggerServer] Login sheet update failed:", update_result.stderr or update_result.stdout)
                except Exception as e:
                    print("[TriggerServer] Login sheet update failed:", e)
        else:
            print("[TriggerServer] Login analysis failed:", result.stderr or result.stdout)
    except subprocess.TimeoutExpired:
        # #region agent log
        _debug_log("upload_trigger_server.py:run_login_analysis:timeout", "Subprocess timed out", {}, "H5")
        # #endregion
        print("[TriggerServer] Login analysis timed out.")
    except Exception as e:
        # #region agent log
        _debug_log("upload_trigger_server.py:run_login_analysis:exception", "Subprocess exception", {"error": str(e)}, "H5")
        # #endregion
        print("[TriggerServer] Login analysis error:", e)


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
        if parsed.path == "/upload":
            qs = parse_qs(parsed.query)
            folder_name = (qs.get("folder") or [""])[0]
            self._handle_upload(folder_name)
        elif parsed.path == "/run-login-analysis":
            qs = parse_qs(parsed.query)
            delay = int((qs.get("delaySeconds") or [str(DEFAULT_LOGIN_ANALYSIS_DELAY_SECONDS)])[0])
            folder_name = (qs.get("folder") or [""])[0] or None
            output_dir = resolve_folder_path(folder_name) if folder_name else None
            self._handle_run_login_analysis(delay, output_dir=output_dir)
        else:
            self._send(404, {"success": False, "message": "Not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/run-login-analysis" or path.startswith("/run-login-analysis?"):
            delay = DEFAULT_LOGIN_ANALYSIS_DELAY_SECONDS
            folder_name = None
            if "content-length" in self.headers:
                length = int(self.headers["content-length"])
                if length:
                    body = self.rfile.read(length).decode("utf-8", errors="replace")
                    try:
                        data = json.loads(body)
                        delay = int(data.get("delaySeconds", delay))
                        folder_name = data.get("folder") or data.get("folderName")
                    except Exception:
                        pass
            if path.startswith("/run-login-analysis?"):
                qs = parse_qs(parsed.query)
                if qs.get("delaySeconds"):
                    delay = int(qs["delaySeconds"][0])
                if qs.get("folder"):
                    folder_name = qs["folder"][0]
            output_dir = resolve_folder_path(folder_name) if folder_name else None
            self._handle_run_login_analysis(delay, output_dir=output_dir)
            return
        if path != "/upload" and not path.startswith("/upload?"):
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
        if not folder_name and path.startswith("/upload?"):
            qs = parse_qs(parsed.query)
            folder_name = (qs.get("folder") or [""])[0]
        self._handle_upload(folder_name or "", share_emails=share_with)

    def _handle_run_login_analysis(self, delay_seconds: int, output_dir: Optional[Path] = None):
        """Start login analysis in a background thread and return 202 immediately. If output_dir is set, writes into that folder (e.g. customer folder)."""
        # #region agent log
        _debug_log("upload_trigger_server.py:_handle_run_login_analysis", "Endpoint received", {"delay_seconds": delay_seconds, "script_exists": LOGIN_ANALYSIS_SCRIPT.exists(), "output_dir": str(output_dir) if output_dir else None}, "H3")
        # #endregion
        if not LOGIN_ANALYSIS_SCRIPT.exists():
            self._send(404, {"success": False, "message": "Login analysis script not found"})
            return
        def run():
            run_login_analysis(delay_seconds=delay_seconds, output_dir=output_dir)
        t = threading.Thread(target=run, daemon=True)
        t.start()
        self._send(202, {
            "success": True,
            "message": f"Login analysis started in background (will run after {delay_seconds}s delay).",
        })

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
