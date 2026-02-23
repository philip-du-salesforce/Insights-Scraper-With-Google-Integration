#!/usr/bin/env python3
"""
Google Sheets Report Uploader for Insights Scraper.

Workflow:
1. Authenticate with Google OAuth 2.0 (Drive + Sheets scopes).
2. Copy the template spreadsheet (Drive API).
3. Rename the copy to "[Customer Name] Security and Storage Report - [Month] [Year]".
4. Share the new file with the configured email as Editor (Drive API).
5. Parse scraper output and map data into template sheets (Overview, 2. Profiles,
   Health Check 2, 7. Storage Usage, 8. Sandboxes) via batchUpdate. Optionally
   format written cells as Arial size 9 without altering colors or lines.

Usage:
  python google_sheets_uploader.py ~/Desktop/NEOS_Life_2026-02-18
  python google_sheets_uploader.py ~/Desktop/CustomerName_YYYY-MM-DD [--customer-name "Override Name"]

Requires: credentials.json (see GOOGLE_OAUTH_SETUP.md) and token.json (created on first run).
"""

import argparse
import csv
import json
import re
import sys
import warnings
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Suppress Python 3.9 EOL and urllib3/OpenSSL warnings from google-auth and dependencies
warnings.filterwarnings("ignore", category=FutureWarning, module="google.auth")
warnings.filterwarnings("ignore", category=FutureWarning, module="google.oauth2")
warnings.filterwarnings("ignore", category=FutureWarning, module="google.api_core")
warnings.filterwarnings("ignore", category=UserWarning, module="urllib3")
try:
    from urllib3.exceptions import NotOpenSSLWarning
    warnings.filterwarnings("ignore", category=NotOpenSSLWarning)
except Exception:
    warnings.filterwarnings("ignore", message=".*OpenSSL.*LibreSSL.*")

# Add parent so we can import config and scraper_parser
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

import config
from scraper_parser import parse_scraper_folder, get_template_mapping

DEBUG_LOG_PATH = Path(__file__).resolve().parent.parent / ".cursor" / "debug-99ad26.log"


def _debug_log(location: str, message: str, data: dict, hypothesis_id: str) -> None:
    try:
        DEBUG_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(DEBUG_LOG_PATH, "a") as f:
            f.write(
                json.dumps(
                    {
                        "sessionId": "99ad26",
                        "location": location,
                        "message": message,
                        "data": data,
                        "timestamp": int(__import__("time").time() * 1000),
                        "hypothesisId": hypothesis_id,
                    }
                )
                + "\n"
            )
    except Exception:
        pass


def load_emails_to_share() -> Tuple[Optional[str], List[str], Optional[str], List[str]]:
    """
    Load primary/extra share emails and display names from config.EMAILS_TO_SHARE_PATH if the file exists.
    Returns (primary_email or None, list of extra emails, primary_name or None, list of extra names).
    JSON format: { "primary": "...", "primaryName": "...", "extra": [...], "extraNames": [...] }
    """
    path = getattr(config, "EMAILS_TO_SHARE_PATH", None)
    if not path or not Path(path).is_file():
        return None, [], None, []
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        primary = None
        if isinstance(data.get("primary"), str) and data["primary"].strip():
            primary = data["primary"].strip()
        extra = []
        if isinstance(data.get("extra"), list):
            extra = [e.strip() for e in data["extra"] if isinstance(e, str) and e.strip()]
        primary_name = None
        if isinstance(data.get("primaryName"), str) and data["primaryName"].strip():
            primary_name = data["primaryName"].strip()
        extra_names = []
        if isinstance(data.get("extraNames"), list):
            extra_names = [str(n).strip() for n in data["extraNames"] if str(n).strip()][: len(extra)]
        while len(extra_names) < len(extra):
            extra_names.append("")
        return primary, extra, primary_name, extra_names
    except Exception:
        return None, [], None, []


def get_credentials():
    """Obtain OAuth 2.0 credentials, using stored token if valid."""
    creds = None
    token_path = Path(config.GOOGLE_TOKEN_PATH)
    creds_path = Path(config.GOOGLE_CREDENTIALS_PATH)

    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), config.SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not creds_path.exists():
                raise FileNotFoundError(
                    f"Credentials file not found: {creds_path}. "
                    "Download OAuth client credentials from Google Cloud Console and save as credentials.json. "
                    "See GOOGLE_OAUTH_SETUP.md."
                )
            flow = InstalledAppFlow.from_client_secrets_file(str(creds_path), config.SCOPES)
            creds = flow.run_local_server(port=0)
        with open(token_path, "w") as f:
            f.write(creds.to_json())
    return creds


def copy_template(drive_service, template_id: str, new_name: str) -> str:
    """Copy the template spreadsheet. Returns the new file ID."""
    body = {"name": new_name}
    result = drive_service.files().copy(fileId=template_id, body=body).execute()
    return result["id"]


def share_with_email(drive_service, file_id: str, email: str, role: str = "writer"):
    """Share the file with the given email as writer (Editor)."""
    body = {
        "type": "user",
        "role": role,
        "emailAddress": email,
    }
    drive_service.permissions().create(fileId=file_id, body=body).execute()


def list_available_labels(drivelabels_service) -> List[Dict[str, Any]]:
    """
    Call Drive Labels API labels.list and print all available labels, fields, and choices.
    Returns a list of dicts for logging: [{ "labelName", "labelId", "fields": [{ "fieldName", "fieldId", "choices": [...] }] }].
    """
    collected = []
    try:
        page_token = None
        while True:
            request_kwargs = {
                "publishedOnly": True,
                "view": "LABEL_VIEW_FULL",
                "pageSize": 200,
            }
            if page_token:
                request_kwargs["pageToken"] = page_token
            response = drivelabels_service.labels().list(**request_kwargs).execute()
            labels_list = response.get("labels", [])
            for label in labels_list:
                label_id = label.get("id") or ""
                label_props = label.get("properties") or {}
                label_name = (label_props.get("displayName") or "").strip() or label_id
                label_entry = {"labelName": label_name, "labelId": label_id, "fields": []}
                for field in label.get("fields", []):
                    field_id = field.get("id") or ""
                    field_props = field.get("properties") or {}
                    field_name = (field_props.get("displayName") or "").strip() or field_id
                    choices = []
                    if "selectionOptions" in field:
                        for choice in (field.get("selectionOptions") or {}).get("choices", []):
                            c_props = (choice.get("properties") or {})
                            c_name = (c_props.get("displayName") or "").strip() or (choice.get("id") or "")
                            choices.append(c_name)
                    label_entry["fields"].append({"fieldName": field_name, "fieldId": field_id, "choices": choices})
                collected.append(label_entry)
            page_token = response.get("nextPageToken")
            if not page_token:
                break
        print("[Uploader] Available Drive Labels (from Labels API):")
        for le in collected:
            print(f"  Label: {le['labelName']!r} (id={le['labelId']})")
            for f in le["fields"]:
                print(f"    Field: {f['fieldName']!r} (id={f['fieldId']}) -> choices: {f['choices']}")
        _debug_log("google_sheets_uploader.py:list_available_labels", "Available labels", {"count": len(collected), "labels": collected}, "H1")
    except Exception as e:
        print(f"[Uploader] Could not list Drive Labels: {e}", file=sys.stderr)
        _debug_log("google_sheets_uploader.py:list_available_labels", "List labels error", {"error": str(e)}, "H1")
    return collected


def discover_externals_allowed_label(drivelabels_service) -> Optional[Dict[str, str]]:
    """
    Use Drive Labels API (labels.list with view=LABEL_VIEW_FULL) to find the
    label/field/choice that corresponds to "External Allowed" (or "Externals Allowed").
    Returns dict with labelId, fieldId, choiceId or None if not found.
    """
    target_choice_display_name = "External Allowed"
    # #region agent log
    _debug_log("google_sheets_uploader.py:discover_externals:entry", "Discover Externals Allowed", {"target": target_choice_display_name}, "H2")
    # #endregion
    try:
        page_token = None
        labels_checked = []
        while True:
            request_kwargs = {
                "publishedOnly": True,
                "view": "LABEL_VIEW_FULL",
                "pageSize": 200,
            }
            if page_token:
                request_kwargs["pageToken"] = page_token
            response = drivelabels_service.labels().list(**request_kwargs).execute()
            for label in response.get("labels", []):
                label_id = label.get("id")
                if not label_id:
                    continue
                label_name = ((label.get("properties") or {}).get("displayName") or "").strip()
                for field in label.get("fields", []):
                    if "selectionOptions" not in field:
                        continue
                    field_id = field.get("id")
                    if not field_id:
                        continue
                    field_name = ((field.get("properties") or {}).get("displayName") or "").strip()
                    choices = (field.get("selectionOptions") or {}).get("choices", [])
                    for choice in choices:
                        props = (choice.get("properties") or {})
                        display = (props.get("displayName") or "").strip()
                        labels_checked.append({"label": label_name, "field": field_name, "choice": display})
                        if display == target_choice_display_name or display == "Externals Allowed":
                            choice_id = choice.get("id")
                            if choice_id:
                                # #region agent log
                                _debug_log("google_sheets_uploader.py:discover_externals:found", "Match found", {"labelId": label_id, "fieldId": field_id, "choiceId": choice_id, "display": display}, "H2")
                                # #endregion
                                return {
                                    "labelId": label_id,
                                    "fieldId": field_id,
                                    "choiceId": choice_id,
                                }
            # #region agent log
            _debug_log("google_sheets_uploader.py:discover_externals:page", "Page scanned", {"labels_checked_count": len(labels_checked), "sample": labels_checked[:10]}, "H2")
            # #endregion
            page_token = response.get("nextPageToken")
            if not page_token:
                break
        # #region agent log
        _debug_log("google_sheets_uploader.py:discover_externals:not_found", "No match", {"labels_checked": labels_checked}, "H2")
        # #endregion
        return None
    except Exception as e:
        print(f"Note: Could not discover External Allowed label: {e}", file=sys.stderr)
        # #region agent log
        _debug_log("google_sheets_uploader.py:discover_externals:error", "Discovery error", {"error": str(e)}, "H2")
        # #endregion
        return None


def set_file_label_to_externals_allowed(
    drive_service, file_id: str, label_ids: Dict[str, str]
) -> bool:
    """
    Use Drive API files.modifyLabels to set the file's classification to
    External Allowed. label_ids must contain labelId, fieldId, choiceId from
    discover_externals_allowed_label.
    """
    body = {
        "labelModifications": [
            {
                "labelId": label_ids["labelId"],
                "fieldModifications": [
                    {
                        "fieldId": label_ids["fieldId"],
                        "setSelectionValues": [label_ids["choiceId"]],
                    }
                ],
            }
        ],
    }
    # #region agent log
    _debug_log("google_sheets_uploader.py:set_file_label:before", "modifyLabels request", {"fileId": file_id, "body": body}, "H3")
    # #endregion
    try:
        drive_service.files().modifyLabels(fileId=file_id, body=body).execute()
        # #region agent log
        _debug_log("google_sheets_uploader.py:set_file_label:success", "modifyLabels succeeded", {}, "H3")
        # #endregion
        return True
    except Exception as e:
        print(f"Note: Could not set file label to External Allowed: {e}", file=sys.stderr)
        # #region agent log
        _debug_log("google_sheets_uploader.py:set_file_label:error", "modifyLabels failed", {"error": str(e)}, "H3")
        # #endregion
        return False


def _col_to_letter(n: int) -> str:
    """1 -> A, 26 -> Z, 27 -> AA."""
    s = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s or "A"


def _quote_sheet(sheet_name: str) -> str:
    """Quote sheet name for A1 notation if it contains space or dot."""
    if " " in sheet_name or "." in sheet_name or "'" in sheet_name:
        return "'" + sheet_name.replace("'", "''") + "'"
    return sheet_name


def load_login_csvs_from_folder(folder_path: Path) -> Dict[str, List[List[str]]]:
    """
    Load application_logins.csv, internal_country_logins.csv, failure_analysis.csv
    from folder (produced by login_analysis.py). Returns data rows only (no header).
    Keys: application_logins, internal_country_logins, failure_analysis.
    """
    out: Dict[str, List[List[str]]] = {}
    files = [
        ("application_logins.csv", "application_logins", 4),      # M:P
        ("internal_country_logins.csv", "internal_country_logins", 4),  # M:P
        ("failure_analysis.csv", "failure_analysis", 2),           # M:N
    ]
    for filename, key, num_cols in files:
        path = folder_path / filename
        if not path.is_file():
            continue
        rows: List[List[str]] = []
        try:
            with open(path, newline="", encoding="utf-8", errors="replace") as f:
                reader = csv.reader(f)
                first = True
                for row in reader:
                    if first:
                        first = False
                        continue
                    cells = [str(c).strip() for c in row[:num_cols]]
                    while len(cells) < num_cols:
                        cells.append("")
                    rows.append(cells[:num_cols])
        except Exception:
            continue
        if rows:
            out[key] = rows
    return out


# Chart PNG -> (sheet name for range/merge, sheet name for display)
LOGIN_CHART_SHEETS = [
    ("application_logins_chart.png", "1. Application Logins"),
    ("internal_country_logins_barchart.png", "1. Internal User Logins"),
    ("failure_analysis_chart.png", "1. Login Failures"),
]


def _upload_png_to_drive(drive_service, png_path: Path, parent_id: str, name: str) -> Optional[str]:
    """
    Upload PNG to Drive. Use root (My Drive) so we can try public link; share with anyone-with-link
    first, else share with SHARE_EMAIL so IMAGE() works for viewers.
    """
    try:
        meta = {"name": name, "parents": [parent_id]}
        media = MediaFileUpload(str(png_path), mimetype="image/png", resumable=False)
        f = drive_service.files().create(body=meta, media_body=media, fields="id").execute()
        file_id = f.get("id")
        if not file_id:
            return None
        try:
            drive_service.permissions().create(
                fileId=file_id,
                body={"type": "anyone", "role": "reader"},
            ).execute()
        except Exception:
            if getattr(config, "SHARE_EMAIL", None):
                try:
                    drive_service.permissions().create(
                        fileId=file_id,
                        body={"type": "user", "role": "reader", "emailAddress": config.SHARE_EMAIL},
                    ).execute()
                except Exception:
                    pass
        return file_id
    except Exception:
        return None


def _image_formula_from_png(png_path: Path, drive_service, parent_id: str, name: str) -> Optional[str]:
    """Upload PNG to Drive and return =IMAGE(url) formula. Uses parent_id for upload."""
    file_id = _upload_png_to_drive(drive_service, png_path, parent_id, name)
    if file_id:
        return f'=IMAGE("https://drive.google.com/uc?id={file_id}")'
    return None


def insert_chart_images(sheets_service, drive_service, spreadsheet_id: str, folder_path: Path) -> None:
    """
    Upload login chart PNGs to Drive and set B4:K29 =IMAGE(url) on each login sheet.
    Upload to user's My Drive (root) so 'anyone with link' can be set; fall back to
    spreadsheet folder + SHARE_EMAIL if org blocks public sharing.
    """
    meta = sheets_service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    sheets = {s["properties"]["title"]: s["properties"]["sheetId"] for s in meta.get("sheets", [])}
    parent_id = "root"
    merge_requests = []
    value_updates = []
    format_requests = []
    for png_name, sheet_name in LOGIN_CHART_SHEETS:
        sid = sheets.get(sheet_name)
        if sid is None:
            continue
        png_path = folder_path / png_name
        if not png_path.is_file():
            continue
        formula = _image_formula_from_png(png_path, drive_service, parent_id, png_name)
        if not formula:
            continue
        merge_requests.append({
            "mergeCells": {
                "range": {
                    "sheetId": sid,
                    "startRowIndex": 3,
                    "endRowIndex": 29,
                    "startColumnIndex": 1,
                    "endColumnIndex": 11,
                },
                "mergeType": "MERGE_ALL",
            },
        })
        value_updates.append({
            "range": "{}!B4".format(_quote_sheet(sheet_name)),
            "values": [[formula]],
        })
        format_requests.append({
            "repeatCell": {
                "range": {
                    "sheetId": sid,
                    "startRowIndex": 3,
                    "endRowIndex": 29,
                    "startColumnIndex": 1,
                    "endColumnIndex": 11,
                },
                "cell": {
                    "userEnteredFormat": {
                        "numberFormat": {"type": "NUMBER", "pattern": "0"},
                    },
                },
                "fields": "userEnteredFormat.numberFormat",
            },
        })
    if merge_requests:
        try:
            sheets_service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"requests": merge_requests},
            ).execute()
        except Exception:
            pass
    if value_updates:
        sheets_service.spreadsheets().values().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"valueInputOption": "USER_ENTERED", "data": value_updates},
        ).execute()
    if format_requests:
        try:
            sheets_service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"requests": format_requests},
            ).execute()
        except Exception:
            pass


def _resolve_sheet_names(sheets_service, spreadsheet_id: str) -> Dict[str, str]:
    """
    Fetch actual sheet titles from the spreadsheet and return a map from logical name to actual title.
    Enables templates that use "Profiles" instead of "2. Profiles", "Health Check" instead of "3. Health Check", etc.
    """
    meta = sheets_service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    titles = [s.get("properties", {}).get("title", "") for s in meta.get("sheets", [])]
    logical_to_actual = {}
    for t in titles:
        t_strip = t.strip()
        t_lower = t_strip.lower()
        if t_lower == "overview":
            logical_to_actual["Overview"] = t
        elif t_strip == "2. Profiles":
            logical_to_actual["2. Profiles"] = t
        elif "profiles" in t_lower and "2. Profiles" not in logical_to_actual:
            logical_to_actual["2. Profiles"] = t
        elif t_strip == "3. Health Check":
            logical_to_actual["3. Health Check"] = t
        elif "health check" in t_lower and "2" not in t_strip and logical_to_actual.get("3. Health Check") is None:
            logical_to_actual["3. Health Check"] = t
        elif t_strip == "Health Check 2":
            logical_to_actual["Health Check 2"] = t
        elif "health check" in t_lower and "2" in t_strip and logical_to_actual.get("Health Check 2") is None:
            logical_to_actual["Health Check 2"] = t
        elif "storage" in t_lower:
            logical_to_actual["7. Storage Usage"] = t
        elif "sandbox" in t_lower:
            logical_to_actual["8. Sandboxes"] = t
        elif "sharing" in t_lower:
            logical_to_actual["4. Sharing Settings"] = t
        elif "application" in t_lower and "login" in t_lower:
            logical_to_actual["1. Application Logins"] = t
        elif "internal" in t_lower and "login" in t_lower:
            logical_to_actual["1. Internal User Logins"] = t
        elif "failure" in t_lower or "login failure" in t_lower:
            logical_to_actual["1. Login Failures"] = t
    for t in titles:
        if t and t not in logical_to_actual.values():
            logical_to_actual[t] = t
    return logical_to_actual


def build_template_batch_updates(spreadsheet_id: str, mapping: dict, sheet_name_map: Optional[Dict[str, str]] = None) -> list:
    """
    Build list of value update dicts for spreadsheets.values.batchUpdate.
    Each entry: {"range": "Sheet!A1:B2", "values": [[...], [...]]}.
    If sheet_name_map is provided, use it to resolve logical sheet names to actual titles.
    """
    def _sheet(name: str) -> str:
        if sheet_name_map and name in sheet_name_map:
            return sheet_name_map[name]
        return name

    updates = []

    # 1. Overview: C4=Account Name, C5=Org ID, C6=Location, C7=Edition; F4=Primary share, F5=Extra share
    overview = mapping.get("overview") or []
    if overview:
        vals = [[v] for v in overview[:4]]
        while len(vals) < 4:
            vals.append([""])
        updates.append({
            "range": "{}!C4:C7".format(_quote_sheet(_sheet("Overview"))),
            "values": vals,
        })
    overview_primary = (mapping.get("overview_primary_share") or "").strip()
    overview_extra = mapping.get("overview_extra_share")
    if isinstance(overview_extra, list):
        overview_extra = ", ".join(str(e).strip() for e in overview_extra if str(e).strip())
    else:
        overview_extra = (overview_extra or "").strip()
    updates.append({
        "range": "{}!F4:F5".format(_quote_sheet(_sheet("Overview"))),
        "values": [[overview_primary], [overview_extra]],
    })

    # 2. 2. Profiles: C4:C5 SAML (if present); B16:G* = profile rows (B=Profile, C=User License, D=Number Of Users, E=Modify All Data, F=Run Reports, G=Export Reports)
    saml_enabled = mapping.get("saml_enabled")
    saml_setting_names = mapping.get("saml_setting_names")
    if saml_enabled is not None or saml_setting_names is not None:
        c4 = str(saml_enabled) if saml_enabled is not None else ""
        c5 = str(saml_setting_names) if saml_setting_names is not None else ""
        updates.append({
            "range": "{}!C4:C5".format(_quote_sheet(_sheet("2. Profiles"))),
            "values": [[c4], [c5]],
        })
    profiles = mapping.get("profiles") or []
    if profiles:
        # Coerce every cell to string; truncate to Sheets cell limit (50k chars) to avoid 500
        max_cell = 50000
        profiles_safe = []
        for row in profiles:
            profiles_safe.append([(str(c) if c is not None else "")[:max_cell] for c in row])
        updates.append({
            "range": "{}!B16:G{}".format(_quote_sheet(_sheet("2. Profiles")), 15 + len(profiles_safe)),
            "values": profiles_safe,
        })

    # 3. 3. Health Check: score as number in C4 (e.g. "54%" -> 54)
    health_check_score = mapping.get("health_check_score")
    if health_check_score is not None and health_check_score != "":
        score_str = str(health_check_score).strip()
        score_num = None
        if score_str:
            m = re.search(r"\d+", score_str)
            if m:
                try:
                    score_num = int(m.group(0))
                except ValueError:
                    score_num = None
        if score_num is not None:
            updates.append({
                "range": "{}!C4".format(_quote_sheet(_sheet("3. Health Check"))),
                "values": [[score_num]],
            })
        else:
            updates.append({
                "range": "{}!C4".format(_quote_sheet(_sheet("3. Health Check"))),
                "values": [[score_str]],
            })

    # 4. Health Check 2: data rows B4:F* (Status, Setting, Group, Your Value, Standard Value); first row at B4:F4
    health = mapping.get("health_check_2") or []
    if health:
        if health and len(health) > 0 and (health[0][0] or "").strip().upper() == "STATUS":
            health = health[1:]
        if health:
            end_row = 3 + len(health)
            updates.append({
                "range": "{}!B4:F{}".format(_quote_sheet(_sheet("Health Check 2")), end_row),
                "values": health,
            })

    # 4a. 7. Storage Usage – Overview: B25:E27 (Storage Type, Limit, Used, Percent Used)
    storage_overview = mapping.get("storage_overview") or []
    if storage_overview:
        updates.append({
            "range": "{}!B25:E27".format(_quote_sheet(_sheet("7. Storage Usage"))),
            "values": storage_overview[:3],
        })

    # 4b. 7. Storage Usage – Current Data Storage Usage (Top Users): B30:E* (Record Type, Record Count, Storage, Percent)
    storage = mapping.get("storage_usage") or []
    if storage:
        end_row = 29 + len(storage)
        updates.append({
            "range": "{}!B30:E{}".format(_quote_sheet(_sheet("7. Storage Usage")), end_row),
            "values": storage,
        })

    # 5a. 8. Sandboxes – Available Sandbox Licenses: B5:D8 (Type in B, Used in C, Allowance in D)
    sandbox_licenses = mapping.get("sandbox_licenses") or []
    if sandbox_licenses:
        updates.append({
            "range": "{}!B5:D8".format(_quote_sheet(_sheet("8. Sandboxes"))),
            "values": sandbox_licenses[:4],
        })

    # 5b. 8. Sandboxes – Sandbox table: B11:J* (Name, Type, Status, Location, Release Type, Current Org Id, Completed On, Description, Copied From)
    sandboxes = mapping.get("sandboxes") or []
    if sandboxes:
        end_row = 10 + len(sandboxes)
        updates.append({
            "range": "{}!B11:J{}".format(_quote_sheet(_sheet("8. Sandboxes")), end_row),
            "values": sandboxes,
        })

    # 6. 4. Sharing Settings – start at row 30; column C=Object, D=defaultInternalAccess, E=defaultExternalAccess
    sharing_settings = mapping.get("sharing_settings") or []
    if sharing_settings:
        end_row = 29 + len(sharing_settings)  # first data row = 30
        updates.append({
            "range": "{}!C30:E{}".format(_quote_sheet(_sheet("4. Sharing Settings")), end_row),
            "values": sharing_settings,
        })

    # 7. Login analysis CSVs (no header) – data only at M5
    app_logins = mapping.get("application_logins") or []
    if app_logins:
        end_row = 4 + len(app_logins)
        updates.append({
            "range": "{}!M5:P{}".format(_quote_sheet(_sheet("1. Application Logins")), end_row),
            "values": app_logins,
        })
    internal_logins = mapping.get("internal_country_logins") or []
    if internal_logins:
        end_row = 4 + len(internal_logins)
        updates.append({
            "range": "{}!M5:P{}".format(_quote_sheet(_sheet("1. Internal User Logins")), end_row),
            "values": internal_logins,
        })
    failure_analysis = mapping.get("failure_analysis") or []
    if failure_analysis:
        end_row = 4 + len(failure_analysis)
        updates.append({
            "range": "{}!M5:N{}".format(_quote_sheet(_sheet("1. Login Failures")), end_row),
            "values": failure_analysis,
        })

    return updates


def apply_template_updates(sheets_service, spreadsheet_id: str, mapping: dict) -> None:
    """
    Write all template-mapped data using spreadsheets.values.batchUpdate.
    Resolves sheet names from the template so "3. Health Check" / "Health Check" etc. work.
    Applies non-Profiles updates first, then Profiles in a separate batch so a Profiles 500 does not block Health Check, Sharing, etc.
    """
    sheet_name_map = _resolve_sheet_names(sheets_service, spreadsheet_id)
    updates = build_template_batch_updates(spreadsheet_id, mapping, sheet_name_map)
    if not updates:
        return

    # Split: Profiles B16:G* in its own batch so one 500 does not block other sheets
    profile_range_prefix = "!B16:G"
    updates_rest = []
    updates_profiles = []
    for u in updates:
        if profile_range_prefix in u.get("range", "") and "rofile" in u.get("range", "").lower():
            updates_profiles.append(u)
        else:
            updates_rest.append(u)

    def _run_batch(batch: list) -> None:
        if not batch:
            return
        body = {
            "valueInputOption": "USER_ENTERED",
            "data": [{"range": u["range"], "values": u["values"]} for u in batch],
        }
        sheets_service.spreadsheets().values().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body=body,
        ).execute()

    try:
        _run_batch(updates_rest)
    except Exception as e:
        err_msg = str(e)
        try:
            content = getattr(e, "content", None)
            if isinstance(content, bytes):
                err_msg = content.decode("utf-8", errors="replace")
            elif content:
                err_msg = str(content)
        except Exception:
            pass
        print(f"[Uploader] Sheets batchUpdate error (Overview/Health/Storage/Sharing/etc.): {err_msg}", file=sys.stderr)
        raise

    if updates_profiles:
        try:
            _run_batch(updates_profiles)
        except Exception as e:
            err_msg = str(e)
            try:
                content = getattr(e, "content", None)
                if isinstance(content, bytes):
                    err_msg = content.decode("utf-8", errors="replace")
                elif content:
                    err_msg = str(content)
            except Exception:
                pass
            print(f"[Uploader] Profiles sheet update failed (other sheets were updated): {err_msg}", file=sys.stderr)
            # Do not re-raise so format step and completion still run


def apply_arial9_format(sheets_service, spreadsheet_id: str, mapping: dict) -> None:
    """
    Apply Arial font size 9 and center alignment to all uploaded data ranges.
    Uses repeatCell with textFormat and horizontal/vertical alignment; preserves fill and borders.
    """
    # Resolve sheet names to sheetId for GridRange (required for repeatCell)
    meta = sheets_service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    sheet_name_to_id = {}
    for s in meta.get("sheets", []):
        props = s.get("properties", {})
        sheet_name_to_id[props.get("title", "")] = props.get("sheetId")

    # (sheet_name, start_row_1based, start_col_0based, end_row_1based, end_col_0based_excl)
    ranges_from_mapping = []
    overview = mapping.get("overview") or []
    if overview:
        ranges_from_mapping.append(("Overview", 4, 2, 7, 3))   # C4:C7 -> col C=2
    if mapping.get("saml_enabled") is not None or mapping.get("saml_setting_names") is not None:
        ranges_from_mapping.append(("2. Profiles", 4, 2, 6, 3))  # C4:C5
    profiles = mapping.get("profiles") or []
    if profiles:
        ranges_from_mapping.append(("2. Profiles", 16, 1, 15 + len(profiles), 7))  # B16:G*
    if mapping.get("health_check_score"):
        ranges_from_mapping.append(("3. Health Check", 4, 2, 4, 3))  # C4
    health = mapping.get("health_check_2") or []
    if health:
        if health and len(health) > 0 and (health[0][0] or "").strip().upper() == "STATUS":
            health = health[1:]
        if health:
            ranges_from_mapping.append(("Health Check 2", 4, 1, 3 + len(health), 6))  # B4:F*
    storage_overview = mapping.get("storage_overview") or []
    if storage_overview:
        ranges_from_mapping.append(("7. Storage Usage", 25, 1, 28, 5))  # B25:E27
    storage = mapping.get("storage_usage") or []
    if storage:
        ranges_from_mapping.append(("7. Storage Usage", 30, 1, 29 + len(storage), 5))  # B30:E*
    sandbox_licenses = mapping.get("sandbox_licenses") or []
    if sandbox_licenses:
        ranges_from_mapping.append(("8. Sandboxes", 5, 1, 9, 4))  # B5:D8
    sandboxes = mapping.get("sandboxes") or []
    if sandboxes:
        ranges_from_mapping.append(("8. Sandboxes", 11, 1, 10 + len(sandboxes), 10))  # B11:J*
    sharing = mapping.get("sharing_settings") or []
    if sharing:
        ranges_from_mapping.append(("4. Sharing Settings", 30, 2, 29 + len(sharing), 5))  # C30:E*
    app_logins = mapping.get("application_logins") or []
    if app_logins:
        ranges_from_mapping.append(("1. Application Logins", 5, 12, 4 + len(app_logins), 16))  # M5:P*
    internal_logins = mapping.get("internal_country_logins") or []
    if internal_logins:
        ranges_from_mapping.append(("1. Internal User Logins", 5, 12, 4 + len(internal_logins), 16))  # M5:P*
    failure_analysis = mapping.get("failure_analysis") or []
    if failure_analysis:
        ranges_from_mapping.append(("1. Login Failures", 5, 12, 4 + len(failure_analysis), 14))  # M5:N*

    def _resolve_sheet_id(name_to_id: dict, primary: str, *fallbacks: str):
        sid = name_to_id.get(primary)
        if sid is not None:
            return sid
        for name in fallbacks:
            sid = name_to_id.get(name)
            if sid is not None:
                return sid
        return None

    requests = []
    for sheet_name, start_row, start_col, end_row, end_col in ranges_from_mapping:
        if end_row < start_row or end_col < start_col:
            continue
        sid = _resolve_sheet_id(
            sheet_name_to_id,
            sheet_name,
            sheet_name.replace("1. ", "").replace("2. ", "").replace("3. ", "").replace("4. ", "").replace("7. ", "").replace("8. ", "").strip(),
        )
        if sid is None:
            continue
        requests.append({
            "repeatCell": {
                "range": {
                    "sheetId": sid,
                    "startRowIndex": start_row - 1,
                    "endRowIndex": end_row,
                    "startColumnIndex": start_col,
                    "endColumnIndex": end_col,
                },
                "cell": {
                    "userEnteredFormat": {
                        "textFormat": {
                            "fontFamily": "Arial",
                            "fontSize": 9,
                        },
                        "horizontalAlignment": "CENTER",
                        "verticalAlignment": "MIDDLE",
                    },
                },
                "fields": "userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)",
            },
        })

    # 8. Sandboxes: B5:B8 bold white Arial 9 center (header/labels for sandbox licenses)
    sandbox_sid = _resolve_sheet_id(
        sheet_name_to_id,
        "8. Sandboxes",
        "Sandboxes",
    )
    if sandbox_sid is not None:
        requests.append({
            "repeatCell": {
                "range": {
                    "sheetId": sandbox_sid,
                    "startRowIndex": 4,
                    "endRowIndex": 8,
                    "startColumnIndex": 1,
                    "endColumnIndex": 2,
                },
                "cell": {
                    "userEnteredFormat": {
                        "textFormat": {
                            "fontFamily": "Arial",
                            "fontSize": 9,
                            "bold": True,
                            "foregroundColor": {"red": 1, "green": 1, "blue": 1},
                        },
                        "horizontalAlignment": "CENTER",
                        "verticalAlignment": "MIDDLE",
                    },
                },
                "fields": "userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)",
            },
        })

    if requests:
        try:
            sheets_service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"requests": requests},
            ).execute()
        except Exception as e:
            print(f"Note: Arial/alignment format could not be applied: {e}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(
        description="Upload scraper output to template Google Sheet (Overview, Profiles, Health Check, Storage, Sandboxes)."
    )
    parser.add_argument(
        "scraper_folder",
        type=str,
        nargs="?",
        default=None,
        help="Path to the scraper output folder (e.g. ~/Desktop/NEOS_Life_2026-02-18)",
    )
    parser.add_argument(
        "--update-login-only",
        action="store_true",
        help="Only update login tabs (1. Application Logins, 1. Internal User Logins, 1. Login Failures) from CSVs in folder; requires scraper_folder and .spreadsheet_id in folder",
    )
    parser.add_argument(
        "--customer-name",
        type=str,
        default=None,
        help="Override customer name (default: derived from folder name)",
    )
    parser.add_argument(
        "--no-upload",
        action="store_true",
        help="Only parse and print summary; do not copy template or upload",
    )
    parser.add_argument(
        "--no-format",
        action="store_true",
        help="Do not apply Arial size 9 to written cells (only write values)",
    )
    parser.add_argument(
        "--share-report-with",
        dest="share_report_with",
        type=str,
        default=None,
        help="Email to share the new report with as primary Editor (overrides config/default)",
    )
    parser.add_argument(
        "--share-with",
        type=str,
        default=None,
        help="Comma-separated list of extra emails to share the report with (as Editor)",
    )
    args = parser.parse_args()

    print(f"[Uploader] Started. Folder: {getattr(args, 'scraper_folder', None)!r}, share_report_with: {getattr(args, 'share_report_with', None)!r}")

    # #region agent log
    _share_arg = getattr(args, "share_report_with", None)
    import time as _t
    _debug_path = Path(__file__).resolve().parent.parent / ".cursor" / "debug-99ad26.log"
    try:
        _debug_path.parent.mkdir(parents=True, exist_ok=True)
        with open(_debug_path, "a") as _f:
            _f.write(__import__("json").dumps({"sessionId": "99ad26", "location": "google_sheets_uploader.py:after_parse_args", "message": "Args share_report_with", "data": {"share_report_with": _share_arg}, "timestamp": int(_t.time() * 1000), "hypothesisId": "H4"}) + "\n")
    except Exception:
        pass
    # #endregion

    if getattr(args, "update_login_only", False):
        print("[Uploader] Mode: update-login-only")
        if not args.scraper_folder:
            print("[Uploader] Error: --update-login-only requires scraper_folder path.", file=sys.stderr)
            sys.exit(1)
        folder_path = Path(args.scraper_folder).resolve()
        if not folder_path.is_dir():
            print(f"[Uploader] Error: Folder not found: {folder_path}", file=sys.stderr)
            sys.exit(1)
        sid_path = folder_path / ".spreadsheet_id"
        if not sid_path.is_file():
            print(f"[Uploader] Error: .spreadsheet_id not found in {folder_path}. Run full upload first.", file=sys.stderr)
            sys.exit(1)
        spreadsheet_id = sid_path.read_text(encoding="utf-8").strip()
        mapping = load_login_csvs_from_folder(folder_path)
        if not mapping:
            print("[Uploader] No login CSVs found in folder; nothing to update.", file=sys.stderr)
            sys.exit(0)
        try:
            creds = get_credentials()
        except FileNotFoundError as e:
            print(f"[Uploader] Error loading credentials: {e}", file=sys.stderr)
            sys.exit(1)
        sheets_service = build("sheets", "v4", credentials=creds)
        drive_service = build("drive", "v3", credentials=creds)
        try:
            apply_template_updates(sheets_service, spreadsheet_id, mapping)
            if not getattr(args, "no_format", False):
                apply_arial9_format(sheets_service, spreadsheet_id, mapping)
            print("Login data updated.")
            try:
                insert_chart_images(sheets_service, drive_service, spreadsheet_id, folder_path)
                print("Login chart images inserted.")
            except Exception as img_err:
                print(f"Note: Chart images not inserted: {img_err}", file=sys.stderr)
        except Exception as e:
            print(f"Error updating login data: {e}", file=sys.stderr)
            sys.exit(1)
        print(f"Open: https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit")
        return

    if not args.scraper_folder:
        print("[Uploader] Error: scraper_folder path is required.", file=sys.stderr)
        sys.exit(1)

    print("[Uploader] Step 1/6: Parsing scraper folder...")
    try:
        parsed = parse_scraper_folder(args.scraper_folder)
        print(f"[Uploader]   Parsed folder_path={parsed.get('folder_path')!r}, customer_name={parsed.get('customer_name')!r}")
    except Exception as e:
        print(f"[Uploader] Error parsing scraper folder: {e}", file=sys.stderr)
        sys.exit(1)

    customer_name = args.customer_name or parsed["customer_name"]
    mapping = get_template_mapping(parsed)
    folder_path = Path(parsed["folder_path"])
    login_csvs = load_login_csvs_from_folder(folder_path)
    for key, rows in login_csvs.items():
        mapping[key] = rows

    print(f"Customer name: {customer_name}")
    print("Template mapping:")
    for key, val in mapping.items():
        if isinstance(val, list):
            print(f"  {key}: {len(val)} row(s)")
        else:
            print(f"  {key}: {val}")

    if args.no_upload:
        return

    now = datetime.now()
    # Use customer name with spaces for the spreadsheet title (folder name uses underscores)
    display_name = customer_name.replace("_", " ")
    report_title = f"{display_name} Security and Storage Report - {now.strftime('%B')} {now.year}"

    print("[Uploader] Step 2/6: Loading Google credentials...")
    try:
        creds = get_credentials()
        print("[Uploader]   Credentials loaded.")
    except FileNotFoundError as e:
        print(f"[Uploader] Error: credentials not found: {e}", file=sys.stderr)
        sys.exit(1)

    drive_service = build("drive", "v3", credentials=creds)
    sheets_service = build("sheets", "v4", credentials=creds)

    print("[Uploader] Step 3/6: Copying template spreadsheet...")
    print(f"  Title: {report_title}")
    try:
        new_file_id = copy_template(drive_service, config.TEMPLATE_SPREADSHEET_ID, report_title)
        print(f"[Uploader]   Created spreadsheet ID: {new_file_id}")
    except Exception as e:
        print(f"[Uploader] Error copying template: {e}", file=sys.stderr)
        sys.exit(1)
    spreadsheet_id_path = folder_path / ".spreadsheet_id"
    try:
        spreadsheet_id_path.write_text(new_file_id, encoding="utf-8")
    except Exception:
        pass

    # Set Google Workspace data classification label to "External Allowed"
    # #region agent log
    _debug_log("google_sheets_uploader.py:label_block:entry", "Label block started", {"new_file_id": new_file_id}, "H4")
    # #endregion
    try:
        drivelabels_service = build("drivelabels", "v2beta", credentials=creds)
        list_available_labels(drivelabels_service)
        label_ids = discover_externals_allowed_label(drivelabels_service)
        # #region agent log
        _debug_log("google_sheets_uploader.py:label_block:discover_result", "Discovery result", {"label_ids": label_ids}, "H4")
        # #endregion
        if label_ids:
            ok = set_file_label_to_externals_allowed(drive_service, new_file_id, label_ids)
            # #region agent log
            _debug_log("google_sheets_uploader.py:label_block:set_result", "Set label result", {"success": ok}, "H4")
            # #endregion
            if ok:
                print("Set file label to External Allowed.")
            else:
                print("Note: External Allowed label not found in organization; skipping label update.")
    except Exception as label_err:
        print(f"Note: Could not set classification label: {label_err}", file=sys.stderr)
        # #region agent log
        _debug_log("google_sheets_uploader.py:label_block:exception", "Label block exception", {"error": str(label_err)}, "H4")
        # #endregion

    _raw = getattr(args, "share_report_with", None)
    _email = (_raw if isinstance(_raw, str) else "").strip()
    file_primary, file_extra, file_primary_name, file_extra_names = load_emails_to_share()
    if _email:
        primary_share = _email
    elif file_primary:
        primary_share = file_primary
        print(f"[Uploader] Using primary share email from emails_to_share.json: {primary_share}")
    else:
        primary_share = config.SHARE_EMAIL
    # #region agent log
    try:
        _dp = Path(__file__).resolve().parent.parent / ".cursor" / "debug-99ad26.log"
        _dp.parent.mkdir(parents=True, exist_ok=True)
        with open(_dp, "a") as _f:
            _f.write(__import__("json").dumps({"sessionId": "99ad26", "location": "google_sheets_uploader.py:primary_share", "message": "Primary share used", "data": {"share_report_with_raw": _raw, "email_after_strip": _email, "primary_share": primary_share, "config_SHARE_EMAIL": config.SHARE_EMAIL}, "timestamp": int(__import__("time").time() * 1000), "hypothesisId": "H5"}) + "\n")
    except Exception:
        pass
    # #endregion
    print("[Uploader] Step 4/6: Sharing spreadsheet...")
    print(f"  Primary editor: {primary_share}")
    try:
        share_with_email(drive_service, new_file_id, primary_share, role="writer")
    except Exception as e:
        print(f"[Uploader] Error sharing with {primary_share}: {e}", file=sys.stderr)
        sys.exit(1)
    extra_emails = []
    if getattr(args, "share_with", None) and args.share_with.strip():
        extra_emails = [e.strip() for e in args.share_with.split(",") if e.strip()]
    if not extra_emails and file_extra:
        extra_emails = file_extra
        print(f"[Uploader] Using extra share emails from emails_to_share.json: {extra_emails}")
    for email in extra_emails:
        print(f"Sharing with {email} as Editor...")
        share_with_email(drive_service, new_file_id, email, role="writer")
    print("  Sharing done.")

    primary_display = (file_primary_name or "").strip() if file_primary_name else primary_share
    extra_display = ", ".join(n for n in file_extra_names if (n or "").strip()) if file_extra_names else ", ".join(extra_emails)
    mapping["overview_primary_share"] = primary_display
    mapping["overview_extra_share"] = extra_display

    print("[Uploader] Step 5/6: Writing data to sheets (batchUpdate)...")
    try:
        apply_template_updates(sheets_service, new_file_id, mapping)
    except Exception as e:
        print(f"[Uploader] Error writing data to sheets: {e}", file=sys.stderr)
        sys.exit(1)
    if not getattr(args, "no_format", False):
        print("  Applying Arial 9 center alignment...")
        apply_arial9_format(sheets_service, new_file_id, mapping)
    print("  Data written.")
    print("[Uploader] Step 6/6: Inserting chart images...")
    try:
        insert_chart_images(sheets_service, drive_service, new_file_id, folder_path)
        print("  Chart images inserted.")
    except Exception as img_err:
        print(f"  Note: Chart images not inserted: {img_err}", file=sys.stderr)

    print("[Uploader] Done.")
    print(f"Open: https://docs.google.com/spreadsheets/d/{new_file_id}/edit")


if __name__ == "__main__":
    main()
