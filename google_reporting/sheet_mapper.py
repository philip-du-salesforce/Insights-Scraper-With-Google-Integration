"""
Central mapper from scraper JSON output to Google Sheet template.

Consumes module_data loaded from .json files (or legacy .txt parsed structure)
and produces the same mapping dict expected by build_template_batch_updates:
overview, profiles, health_check_score, health_check_2, storage_overview,
storage_usage, sandbox_licenses, sandboxes, sharing_settings.
"""

from typing import Any, Dict, List


def _safe(val: Any) -> str:
    if val is None:
        return ""
    s = str(val).strip()
    return s if s else ""


def _safe_int(val: Any, default: int = 0) -> str:
    if val is None:
        return str(default)
    try:
        return str(int(val))
    except (TypeError, ValueError):
        return str(default)


class SheetMapper:
    """
    Builds template-sheet mapping from structured module data (JSON or legacy).
    All methods accept module_data: dict of stem -> loaded data (JSON object or {tables, raw_text}).
    """

    @staticmethod
    def _is_json_shape(data: Any, *keys: str) -> bool:
        if not isinstance(data, dict):
            return False
        return any(k in data for k in keys)

    @staticmethod
    def overview_from_json(module_data: dict) -> List[str]:
        """Overview C4:C7 = [Account Name, Org ID, Location, Edition]."""
        gen = module_data.get("3_general_info") or {}
        if not SheetMapper._is_json_shape(gen, "companyInfo"):
            return []
        ci = gen.get("companyInfo") or {}
        account = _safe(ci.get("accountName")) or _safe(ci.get("organizationName"))
        org_id = _safe(ci.get("orgId"))
        location = _safe(ci.get("location")) or _safe(ci.get("instance"))
        edition = _safe(ci.get("edition"))
        return [account, org_id, location, edition]

    @staticmethod
    def profiles_from_json(module_data: dict) -> List[List[str]]:
        """2. Profiles: A16:F* = Profile Name, User License, Number Of Users, Modify All Data, Run Reports, Export Reports (no Profile Type)."""
        data = module_data.get("2_profiles") or {}
        profiles = data.get("profiles") if isinstance(data.get("profiles"), list) else []
        rows = []
        for p in profiles:
            if not isinstance(p, dict):
                continue
            name = _safe(p.get("profileName"))
            license_ = _safe(p.get("userLicense"))
            active = _safe_int(p.get("activeUserCount"), 0)
            modify = "Yes" if p.get("modifyAllData") else "No"
            run = "Yes" if p.get("runReports") else "No"
            export = "Yes" if p.get("exportReports") else "No"
            rows.append([name, license_, active, modify, run, export])
        return rows

    @staticmethod
    def health_check_score_from_json(module_data: dict) -> str:
        """3. Health Check C4 = percentage string."""
        data = module_data.get("4_health_check") or {}
        if not isinstance(data, dict):
            return ""
        return _safe(data.get("percentage"))

    @staticmethod
    def health_check_2_from_json(module_data: dict) -> List[List[str]]:
        """Health Check 2 A1:E* = [header] + rows (Status, Setting, Group, Your Value, Standard Value)."""
        data = module_data.get("4_health_check") or {}
        if not isinstance(data, dict):
            return []

        def row_from_setting(s: dict) -> List[str]:
            return [
                _safe(s.get("status")),
                _safe(s.get("setting")),
                _safe(s.get("group")),
                _safe(s.get("yourValue")),
                _safe(s.get("standardValue")),
            ]

        header = ["Status", "Setting", "Group", "Your Value", "Standard Value"]
        rows = []
        for key in ("highRisk", "mediumRisk", "lowRisk", "informational"):
            arr = data.get(key)
            if not isinstance(arr, list):
                continue
            for item in arr:
                if isinstance(item, dict):
                    rows.append(row_from_setting(item))
        if not rows:
            return [header]
        return [header] + rows

    @staticmethod
    def storage_overview_from_json(module_data: dict) -> List[List[str]]:
        """7. Storage Usage B25:E27 = up to 3 rows [Storage Type, Limit, Used, Percent Used]."""
        data = module_data.get("5_storage") or {}
        overview = data.get("overview") if isinstance(data, dict) else {}
        if not isinstance(overview, dict):
            return []
        rows = overview.get("rows") or []
        if not isinstance(rows, list):
            return []
        out = []
        for r in rows[:3]:
            if isinstance(r, list):
                out.append([_safe(r[j]) if j < len(r) else "" for j in range(4)])
            elif isinstance(r, dict):
                out.append([
                    _safe(r.get("storageType") or r.get("Storage Type")),
                    _safe(r.get("limit") or r.get("Limit")),
                    _safe(r.get("used") or r.get("Used")),
                    _safe(r.get("percentUsed") or r.get("Percentage Used") or r.get("Percent Used")),
                ])
        return out[:3]

    @staticmethod
    def storage_usage_from_json(module_data: dict) -> List[List[str]]:
        """7. Storage Usage B30:E* = Data Storage Usage rows [Record Type, Record Count, Storage, Percent]."""
        data = module_data.get("5_storage") or {}
        dso = data.get("dataStorageObjects") if isinstance(data, dict) else {}
        if not isinstance(dso, dict):
            return []
        rows = dso.get("rows") or []
        if not isinstance(rows, list):
            return []
        out = []
        for r in rows:
            if isinstance(r, list):
                out.append([_safe(r[j]) if j < len(r) else "0" for j in range(4)])
            elif isinstance(r, dict):
                out.append([
                    _safe(r.get("recordType") or r.get("Record Type")),
                    _safe(r.get("recordCount") or r.get("Record Count") or "0"),
                    _safe(r.get("storage") or r.get("Storage") or "0"),
                    _safe(r.get("percent") or r.get("Percent") or "0"),
                ])
        return out

    @staticmethod
    def sandbox_licenses_from_json(module_data: dict) -> List[List[str]]:
        """8. Sandboxes B5:D8 = up to 4 rows [Type, Used, Allowance]."""
        data = module_data.get("6_sandboxes") or {}
        licenses = data.get("licenses") if isinstance(data, dict) else []
        if not isinstance(licenses, list):
            return []
        out = []
        for L in licenses[:4]:
            if isinstance(L, dict):
                out.append([
                    _safe(L.get("type")),
                    _safe(L.get("used")),
                    _safe(L.get("allowance")),
                ])
            elif isinstance(L, (list, tuple)):
                out.append([_safe(L[j]) if j < len(L) else "" for j in range(3)])
        return out[:4]

    @staticmethod
    def sandboxes_from_json(module_data: dict) -> List[List[str]]:
        """8. Sandboxes B11:J* = rows [Name, Type, Status, Location, Release Type, Current Org Id, Completed On, Description, Copied From]."""
        data = module_data.get("6_sandboxes") or {}
        rows = data.get("rows") if isinstance(data, dict) else []
        if not isinstance(rows, list):
            return []
        out = []
        keys = ("name", "type", "status", "location", "releaseType", "currentOrgId", "completedOn", "description", "copiedFrom")
        for r in rows:
            if isinstance(r, dict):
                out.append([_safe(r.get(k)) for k in keys])
            elif isinstance(r, (list, tuple)):
                out.append([_safe(r[j]) if j < len(r) else "" for j in range(9)])
        return out

    @staticmethod
    def sharing_settings_from_json(module_data: dict) -> List[List[str]]:
        """4. Sharing Settings C30:E* = [Object, Default Internal Access, Default External Access]."""
        data = module_data.get("7_sharing_settings") or {}
        rows = data.get("rows") if isinstance(data, dict) else []
        if not isinstance(rows, list):
            return []
        out = []
        for r in rows:
            if isinstance(r, dict):
                out.append([
                    _safe(r.get("object")),              # column C
                    _safe(r.get("defaultInternalAccess")),  # column D
                    _safe(r.get("defaultExternalAccess")),  # column E
                ])
            elif isinstance(r, (list, tuple)):
                out.append([_safe(r[j]) if j < len(r) else "" for j in range(3)])
        return out

    @staticmethod
    def build_mapping(module_data: dict) -> Dict[str, Any]:
        """
        Build the full template mapping from module_data (JSON-shaped or legacy).
        Returns dict with keys: overview, profiles, health_check_score, health_check_2,
        storage_overview, storage_usage, sandbox_licenses, sandboxes, sharing_settings.
        """
        mapping = {}

        # Overview and SSO (2. Profiles C4, C5): from 3_general_info JSON
        gen = module_data.get("3_general_info")
        if SheetMapper._is_json_shape(gen, "companyInfo"):
            mapping["overview"] = SheetMapper.overview_from_json(module_data)
            ci = (gen or {}).get("companyInfo") or {}
            mapping["saml_enabled"] = "Yes" if ci.get("samlEnabled") else "No"
            names = ci.get("samlSettingNames")
            mapping["saml_setting_names"] = ", ".join(names) if isinstance(names, list) else (names or "")

        # Profiles: from 2_profiles JSON
        if SheetMapper._is_json_shape(module_data.get("2_profiles"), "profiles"):
            mapping["profiles"] = SheetMapper.profiles_from_json(module_data)

        # Health Check score and table: from 4_health_check JSON
        hc = module_data.get("4_health_check")
        if isinstance(hc, dict) and (hc.get("percentage") is not None or hc.get("highRisk") is not None):
            mapping["health_check_score"] = SheetMapper.health_check_score_from_json(module_data)
            mapping["health_check_2"] = SheetMapper.health_check_2_from_json(module_data)

        # Storage: from 5_storage JSON
        if SheetMapper._is_json_shape(module_data.get("5_storage"), "overview", "dataStorageObjects"):
            mapping["storage_overview"] = SheetMapper.storage_overview_from_json(module_data)
            mapping["storage_usage"] = SheetMapper.storage_usage_from_json(module_data)

        # Sandboxes: from 6_sandboxes JSON
        if SheetMapper._is_json_shape(module_data.get("6_sandboxes"), "licenses", "rows"):
            mapping["sandbox_licenses"] = SheetMapper.sandbox_licenses_from_json(module_data)
            mapping["sandboxes"] = SheetMapper.sandboxes_from_json(module_data)

        # Sharing settings: from 7_sharing_settings JSON
        if SheetMapper._is_json_shape(module_data.get("7_sharing_settings"), "rows"):
            mapping["sharing_settings"] = SheetMapper.sharing_settings_from_json(module_data)

        return mapping
