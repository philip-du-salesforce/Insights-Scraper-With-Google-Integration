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
import re
import sys
import warnings
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

# Suppress Python 3.9 EOL and urllib3/OpenSSL warnings from google-auth and dependencies
warnings.filterwarnings("ignore", category=FutureWarning, module="google.auth")
warnings.filterwarnings("ignore", category=FutureWarning, module="google.oauth2")
warnings.filterwarnings("ignore", category=FutureWarning, module="google.api_core")
warnings.filterwarnings("ignore", category=UserWarning, module="urllib3")

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


def discover_externals_allowed_label(drivelabels_service) -> Optional[Dict[str, str]]:
    """
    Use Drive Labels API (labels.list with view=LABEL_VIEW_FULL) to find the
    label/field/choice that corresponds to "Externals Allowed". Returns dict with
    labelId, fieldId, choiceId or None if not found.
    """
    target_choice_display_name = "Externals Allowed"
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
            for label in response.get("labels", []):
                label_id = label.get("id")
                if not label_id:
                    continue
                for field in label.get("fields", []):
                    if "selectionOptions" not in field:
                        continue
                    field_id = field.get("id")
                    if not field_id:
                        continue
                    choices = (field.get("selectionOptions") or {}).get("choices", [])
                    for choice in choices:
                        props = (choice.get("properties") or {})
                        display = (props.get("displayName") or "").strip()
                        if display == target_choice_display_name:
                            choice_id = choice.get("id")
                            if choice_id:
                                return {
                                    "labelId": label_id,
                                    "fieldId": field_id,
                                    "choiceId": choice_id,
                                }
            page_token = response.get("nextPageToken")
            if not page_token:
                break
        return None
    except Exception as e:
        print(f"Note: Could not discover Externals Allowed label: {e}", file=sys.stderr)
        return None


def set_file_label_to_externals_allowed(
    drive_service, file_id: str, label_ids: Dict[str, str]
) -> bool:
    """
    Use Drive API files.modifyLabels to set the file's classification to
    Externals Allowed. label_ids must contain labelId, fieldId, choiceId from
    discover_externals_allowed_label.
    """
    try:
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
        drive_service.files().modifyLabels(fileId=file_id, body=body).execute()
        return True
    except Exception as e:
        print(f"Note: Could not set file label to Externals Allowed: {e}", file=sys.stderr)
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


def build_template_batch_updates(spreadsheet_id: str, mapping: dict) -> list:
    """
    Build list of value update dicts for spreadsheets.values.batchUpdate.
    Each entry: {"range": "Sheet!A1:B2", "values": [[...], [...]]}.
    Sheet names must match template: Overview, 2. Profiles, Health Check 2, 7. Storage Usage, 8. Sandboxes.
    """
    updates = []

    # 1. Overview: C4=Account Name, C5=Org ID, C6=Location, C7=Edition
    overview = mapping.get("overview") or []
    if overview:
        vals = [[v] for v in overview[:4]]
        while len(vals) < 4:
            vals.append([""])
        updates.append({
            "range": "{}!C4:C7".format(_quote_sheet("Overview")),
            "values": vals,
        })

    # 2. 2. Profiles: C4:C5 SAML (if present); B16:G* = profile rows (B=Profile, C=User License, D=Number Of Users, E=Modify All Data, F=Run Reports, G=Export Reports)
    saml_enabled = mapping.get("saml_enabled")
    saml_setting_names = mapping.get("saml_setting_names")
    if saml_enabled is not None or saml_setting_names is not None:
        c4 = str(saml_enabled) if saml_enabled is not None else ""
        c5 = str(saml_setting_names) if saml_setting_names is not None else ""
        updates.append({
            "range": "{}!C4:C5".format(_quote_sheet("2. Profiles")),
            "values": [[c4], [c5]],
        })
    profiles = mapping.get("profiles") or []
    if profiles:
        updates.append({
            "range": "{}!B16:G{}".format(_quote_sheet("2. Profiles"), 15 + len(profiles)),
            "values": profiles,
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
                "range": "{}!C4".format(_quote_sheet("3. Health Check")),
                "values": [[score_num]],
            })
        else:
            updates.append({
                "range": "{}!C4".format(_quote_sheet("3. Health Check")),
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
                "range": "{}!B4:F{}".format(_quote_sheet("Health Check 2"), end_row),
                "values": health,
            })

    # 4a. 7. Storage Usage – Overview: B25:E27 (Storage Type, Limit, Used, Percent Used)
    storage_overview = mapping.get("storage_overview") or []
    if storage_overview:
        updates.append({
            "range": "{}!B25:E27".format(_quote_sheet("7. Storage Usage")),
            "values": storage_overview[:3],
        })

    # 4b. 7. Storage Usage – Current Data Storage Usage (Top Users): B30:E* (Record Type, Record Count, Storage, Percent)
    storage = mapping.get("storage_usage") or []
    if storage:
        end_row = 29 + len(storage)
        updates.append({
            "range": "{}!B30:E{}".format(_quote_sheet("7. Storage Usage"), end_row),
            "values": storage,
        })

    # 5a. 8. Sandboxes – Available Sandbox Licenses: B5:D8 (Type in B, Used in C, Allowance in D)
    sandbox_licenses = mapping.get("sandbox_licenses") or []
    if sandbox_licenses:
        updates.append({
            "range": "{}!B5:D8".format(_quote_sheet("8. Sandboxes")),
            "values": sandbox_licenses[:4],
        })

    # 5b. 8. Sandboxes – Sandbox table: B11:J* (Name, Type, Status, Location, Release Type, Current Org Id, Completed On, Description, Copied From)
    sandboxes = mapping.get("sandboxes") or []
    if sandboxes:
        end_row = 10 + len(sandboxes)
        updates.append({
            "range": "{}!B11:J{}".format(_quote_sheet("8. Sandboxes"), end_row),
            "values": sandboxes,
        })

    # 6. 4. Sharing Settings – start at row 30; column C=Object, D=defaultInternalAccess, E=defaultExternalAccess
    sharing_settings = mapping.get("sharing_settings") or []
    if sharing_settings:
        end_row = 29 + len(sharing_settings)  # first data row = 30
        updates.append({
            "range": "{}!C30:E{}".format(_quote_sheet("4. Sharing Settings"), end_row),
            "values": sharing_settings,
        })

    # 7. Login analysis CSVs (no header) – data only at M5
    app_logins = mapping.get("application_logins") or []
    if app_logins:
        end_row = 4 + len(app_logins)
        updates.append({
            "range": "{}!M5:P{}".format(_quote_sheet("1. Application Logins"), end_row),
            "values": app_logins,
        })
    internal_logins = mapping.get("internal_country_logins") or []
    if internal_logins:
        end_row = 4 + len(internal_logins)
        updates.append({
            "range": "{}!M5:P{}".format(_quote_sheet("1. Internal User Logins"), end_row),
            "values": internal_logins,
        })
    failure_analysis = mapping.get("failure_analysis") or []
    if failure_analysis:
        end_row = 4 + len(failure_analysis)
        updates.append({
            "range": "{}!M5:N{}".format(_quote_sheet("1. Login Failures"), end_row),
            "values": failure_analysis,
        })

    return updates


def apply_template_updates(sheets_service, spreadsheet_id: str, mapping: dict) -> None:
    """
    Write all template-mapped data using spreadsheets.values.batchUpdate.
    Missing values are left blank or 0 by the parser; no crash on missing data.
    """
    updates = build_template_batch_updates(spreadsheet_id, mapping)
    if not updates:
        return
    data = [
        {"range": u["range"], "values": u["values"]}
        for u in updates
    ]
    body = {
        "valueInputOption": "USER_ENTERED",
        "data": data,
    }
    sheets_service.spreadsheets().values().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body=body,
    ).execute()


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

    requests = []
    for sheet_name, start_row, start_col, end_row, end_col in ranges_from_mapping:
        if end_row <= start_row or end_col <= start_col:
            continue
        sid = sheet_name_to_id.get(sheet_name)
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
                        "verticalAlignment": "CENTER",
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
        "--share-with",
        type=str,
        default=None,
        help="Comma-separated list of extra emails to share the report with (as Editor)",
    )
    args = parser.parse_args()

    if getattr(args, "update_login_only", False):
        if not args.scraper_folder:
            print("Error: --update-login-only requires scraper_folder path.", file=sys.stderr)
            sys.exit(1)
        folder_path = Path(args.scraper_folder).resolve()
        if not folder_path.is_dir():
            print(f"Error: Folder not found: {folder_path}", file=sys.stderr)
            sys.exit(1)
        sid_path = folder_path / ".spreadsheet_id"
        if not sid_path.is_file():
            print(f"Error: .spreadsheet_id not found in {folder_path}. Run full upload first.", file=sys.stderr)
            sys.exit(1)
        spreadsheet_id = sid_path.read_text(encoding="utf-8").strip()
        mapping = load_login_csvs_from_folder(folder_path)
        if not mapping:
            print("No login CSVs found in folder; nothing to update.", file=sys.stderr)
            sys.exit(0)
        try:
            creds = get_credentials()
        except FileNotFoundError as e:
            print(e, file=sys.stderr)
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
        print("Error: scraper_folder path is required.", file=sys.stderr)
        sys.exit(1)

    try:
        parsed = parse_scraper_folder(args.scraper_folder)
    except Exception as e:
        print(f"Error parsing scraper folder: {e}", file=sys.stderr)
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

    try:
        creds = get_credentials()
    except FileNotFoundError as e:
        print(e, file=sys.stderr)
        sys.exit(1)

    drive_service = build("drive", "v3", credentials=creds)
    sheets_service = build("sheets", "v4", credentials=creds)

    print(f"Copying template to: {report_title}")
    new_file_id = copy_template(drive_service, config.TEMPLATE_SPREADSHEET_ID, report_title)
    print(f"Created spreadsheet ID: {new_file_id}")
    spreadsheet_id_path = folder_path / ".spreadsheet_id"
    try:
        spreadsheet_id_path.write_text(new_file_id, encoding="utf-8")
    except Exception:
        pass

    # Set Google Workspace data classification label to "Externals Allowed"
    try:
        drivelabels_service = build("drivelabels", "v2beta", credentials=creds)
        label_ids = discover_externals_allowed_label(drivelabels_service)
        if label_ids:
            if set_file_label_to_externals_allowed(drive_service, new_file_id, label_ids):
                print("Set file label to Externals Allowed.")
        else:
            print("Note: Externals Allowed label not found in organization; skipping label update.")
    except Exception as label_err:
        print(f"Note: Could not set classification label: {label_err}", file=sys.stderr)

    print(f"Sharing with {config.SHARE_EMAIL} as Editor...")
    share_with_email(drive_service, new_file_id, config.SHARE_EMAIL, role="writer")
    extra_emails = []
    if getattr(args, "share_with", None) and args.share_with.strip():
        extra_emails = [e.strip() for e in args.share_with.split(",") if e.strip()]
    for email in extra_emails:
        print(f"Sharing with {email} as Editor...")
        share_with_email(drive_service, new_file_id, email, role="writer")
    print("Sharing done.")

    print("Writing data to template sheets (batchUpdate)...")
    apply_template_updates(sheets_service, new_file_id, mapping)
    if not args.no_format:
        print("Applying Arial 9 center alignment to written ranges...")
        apply_arial9_format(sheets_service, new_file_id, mapping)
    print("Data written.")
    try:
        insert_chart_images(sheets_service, drive_service, new_file_id, folder_path)
        print("Login chart images inserted.")
    except Exception as img_err:
        print(f"Note: Chart images not inserted: {img_err}", file=sys.stderr)

    print(f"Done. Open: https://docs.google.com/spreadsheets/d/{new_file_id}/edit")


if __name__ == "__main__":
    main()
