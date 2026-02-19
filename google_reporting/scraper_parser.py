"""
Parse scraper output from the Insights Scraper Chrome extension.

Reads the folder produced by the extension (e.g. CustomerName_2026-02-19/)
containing .json files (preferred) or .txt files. Uses SheetMapper for JSON and
legacy parse_* functions for .txt when building the template mapping.
"""

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Tuple, Union

from sheet_mapper import SheetMapper


# Module filenames (without .txt) as produced by the extension
MODULE_FILES = [
    "1_licenses",
    "2_profiles",
    "3_general_info",
    "4_health_check",
    "5_storage",
    "6_sandboxes",
    "7_sharing_settings",
    "8_login_history",
    "sensitive-data",
]


def _extract_tsv_tables(content: str) -> List[List[List[str]]]:
    """
    Extract one or more tab-separated tables from module output.
    Each table is a list of rows; each row is a list of cell strings.
    """
    tables = []
    lines = content.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if "\t" in line and not line.strip().startswith("=") and "SUMMARY" not in line.upper():
            block = []
            while i < len(lines) and "\t" in lines[i]:
                block.append([cell.strip() for cell in lines[i].split("\t")])
                i += 1
            if len(block) >= 1:
                tables.append(block)
            continue
        i += 1
    if not tables:
        for i, line in enumerate(lines):
            if "\t" in line and len(line.split("\t")) >= 2:
                block = []
                j = i
                while j < len(lines) and "\t" in lines[j]:
                    block.append([cell.strip() for cell in lines[j].split("\t")])
                    j += 1
                if block:
                    tables.append(block)
                break
    return tables


def _parse_single_file(filepath: Path) -> Dict[str, Any]:
    """Parse one module .txt file. Returns dict with 'tables', 'raw_text', and optional 'raw_preview'."""
    text = filepath.read_text(encoding="utf-8", errors="replace")
    tables = _extract_tsv_tables(text)
    return {
        "tables": tables,
        "raw_text": text,
        "raw_preview": text[:500] if text else "",
    }


def parse_scraper_folder(folder_path: Union[str, Path]) -> dict:
    """
    Parse the scraper output folder (e.g. CustomerName_2026-02-19).
    Returns dict with customer_name, folder_path, module_data.
    """
    folder = Path(folder_path).resolve()
    if not folder.is_dir():
        raise NotADirectoryError(f"Scraper output path is not a directory: {folder}")
    folder_name = folder.name
    match = re.match(r"^(.+)_\d{4}-\d{2}-\d{2}$", folder_name)
    customer_name = match.group(1).strip() if match else folder_name
    if not customer_name or customer_name == "_":
        customer_name = "Unknown"
    module_data = {}
    for stem in MODULE_FILES:
        json_path = folder / f"{stem}.json"
        txt_path = folder / f"{stem}.txt"
        if json_path.exists():
            try:
                with open(json_path, encoding="utf-8") as f:
                    module_data[stem] = json.load(f)
            except (json.JSONDecodeError, OSError):
                if txt_path.exists():
                    module_data[stem] = _parse_single_file(txt_path)
        elif txt_path.exists():
            module_data[stem] = _parse_single_file(txt_path)
    return {
        "customer_name": customer_name,
        "folder_path": folder,
        "module_data": module_data,
    }


# ---------------------------------------------------------------------------
# Template-specific extraction (for exact sheet/cell mapping)
# ---------------------------------------------------------------------------

def _safe_cell(val: Any) -> str:
    """Return a string for a cell; use '' or '0' instead of crashing."""
    if val is None:
        return ""
    s = str(val).strip()
    return s if s else ""


def _key_value_pairs(text: str) -> Dict[str, str]:
    """Extract key-value pairs from lines like 'Key\tValue' or 'Key: Value'."""
    out = {}
    for line in text.splitlines():
        line = line.strip()
        if "\t" in line:
            parts = line.split("\t", 1)
            if len(parts) == 2:
                k, v = parts[0].strip(), parts[1].strip()
                if k:
                    out[k] = v
        elif ":" in line and not line.startswith("="):
            parts = line.split(":", 1)
            if len(parts) == 2:
                k, v = parts[0].strip(), parts[1].strip()
                if k:
                    out[k] = v
    return out


def parse_overview_from_files(parsed: dict) -> List[str]:
    """
    Extract Overview sheet values for C4-C7: Account Name, Org ID, Location, Edition.
    Source: 3_general_info.txt (and optionally 4_health_check, 5_storage for any org info).
    Returns list of 4 values [C4, C5, C6, C7]; missing values are '' or '0'.
    """
    kv = {}
    for stem in ("3_general_info", "4_health_check", "5_storage"):
        if stem not in parsed.get("module_data", {}):
            continue
        raw = parsed["module_data"][stem].get("raw_text", "")
        kv.update(_key_value_pairs(raw))
    # Normalize keys (case-insensitive, strip #)
    key_map = {}
    for k, v in kv.items():
        key_map[k.lower().replace("#", "").strip()] = v
    account = _safe_cell(
        key_map.get("account name")
        or key_map.get("organization name")
        or key_map.get("company name")
    )
    org_id = _safe_cell(
        key_map.get("organization id")
        or key_map.get("organization id:")
        or key_map.get("org id")
    )
    location = _safe_cell(
        key_map.get("instance")
        or key_map.get("location (instance)")
        or key_map.get("location")
    )
    edition = _safe_cell(
        key_map.get("organization edition")
        or key_map.get("organization edition:")
        or key_map.get("edition")
    )
    return [account, org_id, location, edition]


def parse_profiles_for_template(parsed: dict) -> List[List[str]]:
    """
    Parse 2_profiles.txt for sheet '2. Profiles'.
    Columns: Profile Name, User License, Profile Type, Active Users, Modify All Data, Run Reports, Export Reports (7 cols).
    """
    rows = []
    data = parsed.get("module_data", {}).get("2_profiles")
    if not data:
        return rows
    tables = data.get("tables", [])
    for table in tables:
        if len(table) < 2:
            continue
        header = table[0]
        data_start = 1 if len(header) >= 2 and "profile" in (header[0] or "").lower() else 0
        has_user_license_col = len(header) > 1 and "user license" in (header[1] or "").lower()
        for i in range(data_start, len(table)):
            r = table[i]
            if len(r) >= 1 and (r[0] or "").strip().upper() == "ERROR":
                continue
            if has_user_license_col and len(r) >= 7:
                profile_name = _safe_cell(r[0]) if len(r) > 0 else ""
                user_license = _safe_cell(r[1]) if len(r) > 1 else ""
                profile_type = _safe_cell(r[2]) if len(r) > 2 else ""
                active_users = _safe_cell(r[3]) if len(r) > 3 else "0"
                modify_all = _safe_cell(r[4]) if len(r) > 4 else ""
                run_reports = _safe_cell(r[5]) if len(r) > 5 else ""
                export_reports = _safe_cell(r[6]) if len(r) > 6 else ""
            else:
                profile_name = _safe_cell(r[0]) if len(r) > 0 else ""
                user_license = ""
                profile_type = _safe_cell(r[1]) if len(r) > 1 else ""
                active_users = _safe_cell(r[2]) if len(r) > 2 else "0"
                modify_all = _safe_cell(r[3]) if len(r) > 3 else ""
                run_reports = _safe_cell(r[4]) if len(r) > 4 else ""
                export_reports = _safe_cell(r[5]) if len(r) > 5 else ""
            rows.append([profile_name, user_license, profile_type, active_users, modify_all, run_reports, export_reports])
    return rows


def parse_health_check_score(parsed: dict) -> str:
    """
    Parse 4_health_check.txt for the Health Check score (e.g. "54%" or "N/A").
    Used for sheet '3. Health Check' cell C4.
    """
    data = parsed.get("module_data", {}).get("4_health_check")
    if not data:
        return ""
    raw = data.get("raw_text", "")
    m = re.search(r"Health Check Score:\s*(.+)", raw, re.IGNORECASE)
    if m:
        return (m.group(1) or "").strip()
    return ""


def parse_health_check_for_template(parsed: dict) -> List[List[str]]:
    """
    Parse 4_health_check.txt for sheet 'Health Check 2'.
    Columns: Status, Setting, Group, Your Value, Standard Value.
    Returns list of rows (include header as first row). Missing -> '' or 'N/A'.
    """
    data_rows = []
    data = parsed.get("module_data", {}).get("4_health_check")
    if not data:
        return [["Status", "Setting", "Group", "Your Value", "Standard Value"]]
    tables = data.get("tables", [])
    header = ["Status", "Setting", "Group", "Your Value", "Standard Value"]
    for table in tables:
        if not table:
            continue
        # First row may be header (STATUS, SETTING, ...)
        start = 1 if (len(table) >= 1 and (table[0][0] or "").strip().upper() == "STATUS") else 0
        for i in range(start, len(table)):
            r = table[i]
            row = [_safe_cell(r[j]) if j < len(r) else "" for j in range(5)]
            if any(row):
                data_rows.append(row[:5])
    return [header] + data_rows


def parse_storage_overview_for_template(parsed: dict) -> List[List[str]]:
    """
    Parse 5_storage.txt PART A (Storage Overview) for '7. Storage Usage' B25:E27.
    Columns: Storage Type, Limit, Used, Percentage Used. Up to 3 rows (e.g. Data Storage, File Storage).
    """
    data = parsed.get("module_data", {}).get("5_storage")
    if not data:
        return []
    tables = data.get("tables", [])
    for table in tables:
        if len(table) < 2:
            continue
        header = [ (h or "").strip().lower() for h in table[0] ]
        if "storage type" not in header and "limit" not in header:
            continue
        rows = []
        for i in range(1, len(table)):
            r = table[i] if isinstance(table[i], list) else []
            row = [_safe_cell(r[j]) if j < len(r) else "" for j in range(4)]
            if any(row):
                rows.append(row[:4])
        if rows:
            return rows[:3]
    return []


def parse_storage_usage_for_template(parsed: dict) -> List[List[str]]:
    """
    Parse 5_storage.txt for '7. Storage Usage' – Current Data Storage Usage only (Top Users by Data Storage Usage).
    Columns: Record Type, Record Count, Storage, Percent. Map to B30:E* (template has headers at B29:E29).
    Returns list of data rows; missing -> '' or '0'.
    """
    data = parsed.get("module_data", {}).get("5_storage")
    if not data:
        return []
    tables = data.get("tables", [])
    for table in tables:
        if len(table) < 2:
            continue
        header = [ (h or "").strip().lower() for h in table[0] ]
        if "record" not in " ".join(header) and "storage" not in " ".join(header):
            continue
        if "storage type" in header and "limit" in header:
            continue
        rows = []
        for i in range(1, len(table)):
            r = table[i] if isinstance(table[i], list) else []
            row = [_safe_cell(r[j]) if j < len(r) else "0" for j in range(4)]
            if any(row):
                rows.append(row[:4])
        return rows
    chosen = (tables[1] if len(tables) >= 2 else tables[0]) if tables else []
    if not chosen or len(chosen) < 2:
        return []
    rows = []
    for i in range(1, len(chosen)):
        r = chosen[i] if isinstance(chosen[i], list) else []
        row = [_safe_cell(r[j]) if j < len(r) else "0" for j in range(4)]
        if any(row):
            rows.append(row[:4])
    return rows


def parse_sandbox_licenses_for_template(parsed: dict) -> List[List[str]]:
    """
    Parse 6_sandboxes.txt AVAILABLE SANDBOX LICENSES for '8. Sandboxes' B5:D8.
    Returns 4 rows: [Type, Used, Allowance] for Developer, Developer Pro, Partial Copy, Full.
    Column B = Sandbox Type (for matching), C = Used, D = Allowance.
    """
    data = parsed.get("module_data", {}).get("6_sandboxes")
    if not data:
        return []
    tables = data.get("tables", [])
    for table in tables:
        if len(table) < 2:
            continue
        header = [ (h or "").strip().lower() for h in table[0] ]
        if "used" not in header or "allowance" not in header:
            continue
        rows = []
        for i in range(1, len(table)):
            r = table[i]
            row = [_safe_cell(r[j]) if j < len(r) else "" for j in range(3)]
            if any(row):
                rows.append(row[:3])
        if rows:
            return rows[:4]
    return []


def parse_sandboxes_for_template(parsed: dict) -> List[List[str]]:
    """
    Parse 6_sandboxes.txt for sheet '8. Sandboxes'.
    Columns: Name, Type, Status, Location, Release Type, Current Org Id, Completed On, Description, Copied From (9 cols).
    Returns list of data rows; missing -> ''.
    """
    rows = []
    data = parsed.get("module_data", {}).get("6_sandboxes")
    if not data:
        return rows
    tables = data.get("tables", [])
    for table in tables:
        if len(table) < 2:
            continue
        header = table[0]
        if not any("name" in (h or "").lower() or "type" in (h or "").lower() or "status" in (h or "").lower() for h in header):
            continue
        for i in range(1, len(table)):
            r = table[i]
            row = [_safe_cell(r[j]) if j < len(r) else "" for j in range(9)]
            rows.append(row[:9])
    return rows


def parse_sharing_settings_for_template(parsed: dict) -> List[List[str]]:
    """
    Parse 7_sharing_settings.txt for sheet '4. Sharing Settings'.
    Columns: Object, Default Internal Access, Default External Access (3 cols).
    Returns list of data rows for C30:E*; missing -> ''.
    """
    rows = []
    data = parsed.get("module_data", {}).get("7_sharing_settings")
    if not data:
        return rows
    tables = data.get("tables", [])
    for table in tables:
        if len(table) < 2:
            continue
        header = [(h or "").strip().lower() for h in table[0]]
        if "object" not in header or "default internal access" not in header:
            continue
        for i in range(1, len(table)):
            r = table[i] if isinstance(table[i], list) else []
            row = [_safe_cell(r[j]) if j < len(r) else "" for j in range(3)]
            rows.append(row[:3])
        return rows
    return rows


def _get_template_mapping_legacy(parsed: dict) -> Dict[str, Any]:
    """Build template mapping from legacy .txt parsed data (tables + raw_text)."""
    return {
        "overview": parse_overview_from_files(parsed),
        "profiles": parse_profiles_for_template(parsed),
        "health_check_score": parse_health_check_score(parsed),
        "health_check_2": parse_health_check_for_template(parsed),
        "storage_overview": parse_storage_overview_for_template(parsed),
        "storage_usage": parse_storage_usage_for_template(parsed),
        "sandbox_licenses": parse_sandbox_licenses_for_template(parsed),
        "sandboxes": parse_sandboxes_for_template(parsed),
        "sharing_settings": parse_sharing_settings_for_template(parsed),
    }


def get_template_mapping(parsed: dict) -> Dict[str, Any]:
    """
    Build all template-sheet data for the batch updater.
    Prefers JSON-shaped module_data (SheetMapper); falls back to legacy .txt parsing.
    Returns dict with keys: overview, profiles, health_check_score, health_check_2,
    storage_overview, storage_usage, sandbox_licenses, sandboxes, sharing_settings.
    """
    module_data = parsed.get("module_data") or {}
    json_mapping = SheetMapper.build_mapping(module_data)
    legacy_mapping = _get_template_mapping_legacy(parsed)

    def _choose(key: str) -> Any:
        jv = json_mapping.get(key)
        lv = legacy_mapping.get(key)
        # Prefer JSON value when present and non-empty; else legacy
        if jv is not None:
            if jv == "" or (isinstance(jv, list) and len(jv) == 0):
                return lv if lv is not None else jv
            return jv
        return lv

    return {
        "overview": _choose("overview") or [],
        "profiles": _choose("profiles") or [],
        "saml_enabled": json_mapping.get("saml_enabled"),
        "saml_setting_names": json_mapping.get("saml_setting_names"),
        "health_check_score": _choose("health_check_score") or "",
        "health_check_2": _choose("health_check_2") or [],
        "storage_overview": _choose("storage_overview") or [],
        "storage_usage": _choose("storage_usage") or [],
        "sandbox_licenses": _choose("sandbox_licenses") or [],
        "sandboxes": _choose("sandboxes") or [],
        "sharing_settings": _choose("sharing_settings") or [],
    }


# ---------------------------------------------------------------------------
# Legacy: generic tables for simple upload (unchanged behavior)
# ---------------------------------------------------------------------------

def get_all_tables_for_sheets(parsed: dict) -> List[Tuple[str, List[List[str]]]]:
    """Legacy: flatten parsed module data into (sheet_label, rows) for simple write."""
    result = []
    order = ["1_licenses", "2_profiles", "3_general_info", "4_health_check", "5_storage", "6_sandboxes", "8_login_history", "sensitive-data"]
    names = {
        "1_licenses": "Licenses",
        "2_profiles": "Profiles",
        "3_general_info": "General Info",
        "4_health_check": "Health Check",
        "5_storage": "Storage",
        "6_sandboxes": "Sandboxes",
        "8_login_history": "Login History",
        "sensitive-data": "Sensitive Data",
    }
    for stem in order:
        if stem not in parsed.get("module_data", {}):
            continue
        data = parsed["module_data"][stem]
        tables = data.get("tables", [])
        if not tables:
            continue
        table = tables[0]
        if table:
            result.append((names.get(stem, stem), table))
    return result
