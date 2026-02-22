# Salesforce Insights Scraper with Google Integration

A Chrome extension for extracting data from Salesforce organizations, plus a Python workflow that uploads results to Google Sheets. Run the scraper from any Salesforce page, then optionally auto-upload to a copied report template shared with your team.

## Features

### Chrome extension (Salesforce Insights Scraper)
- **Modular extraction**: Run only the modules you need via checkboxes.
- **Automatic customer detection**: Identifies customer name from the page (e.g. `blackTabBannerTxt`).
- **Organized downloads**: Output goes to `CustomerName_YYYY-MM-DD/` (e.g. Desktop or Downloads) as `.txt` and/or `.json` files.
- **Progress tracking**: Real-time progress for each module.
- **Extensible design**: Add new modules by extending the base module and registering in the background script.

### Modules (extension)
| # | Module | Description |
|---|--------|-------------|
| 1 | **Licenses** | License types and counts |
| 2 | **Profiles** | Profile details and active user counts (with pagination) |
| 3 | **General Information** | Org-level general info |
| 4 | **Health Check** | Health check data |
| 5 | **Storage** | Storage usage |
| 6 | **Sandboxes** | Sandbox information |
| 7 | **Sharing Settings** | Sharing settings data |
| 8 | **Sensitive Data** | Coming soon (currently disabled in UI) |
| 9 | **Login History** | Download Login History (e.g. CSV) |

### Google Integration
- **Template-based reports**: Copy a Google Sheet template, rename to *[Customer] Security and Storage Report - [Month] [Year]*, share with chosen users, and fill with scraped data.
- **Auto-upload**: When the trigger server is running, the extension can trigger the upload automatically when extraction completes (no terminal step).
- **Configurable sharing**: Choose who to share the new report with (primary + optional extra) via popup or `emails_to_share.json`.
- **Login analysis**: Optional post-upload step to run login history analysis and update the report. See `google_reporting/README.md` and [SEAMLESS_UPLOAD.md](google_reporting/SEAMLESS_UPLOAD.md).

## Installation

### Chrome extension

**Load unpacked**

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked**
4. Select this project folder (e.g. `Insights-Scraper-With-Google-Integration`)

**Optional – command line (separate profile)**

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --load-extension="/path/to/Insights-Scraper-With-Google-Integration" \
  --user-data-dir="$HOME/tmp/chrome-ext-test"
```

**If enterprise policies block extensions**: use Chrome Canary, Microsoft Edge (`edge://extensions/`), or Chromium.

### Google Sheets integration (optional)

1. One-time: [Google OAuth setup](GOOGLE_OAUTH_SETUP.md) — enable Drive + Sheets APIs, create OAuth Desktop credentials, add `google_reporting/credentials.json`.
2. Install Python deps: `cd google_reporting && pip install -r requirements.txt`
3. First run: execute the uploader or trigger server once; complete browser sign-in to create `token.json`.
4. For **auto-upload** when extraction finishes: start the trigger server and leave it running — see [Seamless upload](google_reporting/SEAMLESS_UPLOAD.md) and [Google reporting README](google_reporting/README.md).

## Usage

1. **Open a Salesforce page** in Chrome (e.g. Setup or a page that shows the customer banner).
2. **Click the extension icon** and confirm **Customer** is detected at the top.
3. **Select modules** with the checkboxes (e.g. Licenses, Profiles, General Info, Health Check, Storage, Sandboxes, Sharing Settings, Login History). Sensitive Data is “Coming soon” and disabled.
4. **Google Sheets**: Leave **“Auto-upload to Google Sheets when extraction completes”** checked if you want the upload to run after extraction (requires the trigger server to be running). Use the dropdown and optional “Also share with” checkboxes to choose who gets the new report.
5. **Click “Run Script”** to start extraction.
6. **Monitor progress** in the popup; files download as each module completes.
7. **Output**: Files go to `CustomerName_YYYY-MM-DD/` (e.g. on Desktop or in Downloads). If auto-upload is on and the trigger server is running, the Google Sheets upload runs when extraction finishes and the popup shows the result (e.g. link to the new spreadsheet).

## Output Format

Each module writes one or more files into the extraction folder. The uploader and parsers expect the numbered `.txt` / `.json` names below:

```
CustomerName_2026-02-22/
├── 1_licenses.txt (and/or .json)
├── 2_profiles.txt (and/or .json)
├── 3_general_info.txt (and/or .json)
├── 4_health_check.txt (and/or .json)
├── 5_storage.txt (and/or .json)
├── 6_sandboxes.txt (and/or .json)
├── 7_sharing_settings.txt (and/or .json)
├── 8_login_history.txt (and/or .json)
└── (optional) sensitive-data.txt / .json
```

The Google Sheets uploader parses these files and maps data into the report template (Overview, Profiles, Health Check, Storage, Sandboxes, etc.). See `google_reporting/README.md` and `google_reporting/scraper_parser.py`.

## Architecture

### Extension

**Modules** (`modules/`):

- `base-module.js` — base class for all modules  
- `module-manager.js` — registry and execution order  
- `shared-functions.js` — shared helpers  
- `licenses-module.js`, `profiles-module.js`, `general-info-module.js`  
- `health-check-module.js`, `storage-module.js`, `sandboxes-module.js`  
- `sharing-settings-module.js`, `sensitive-data-module.js`, `login-history-module.js`

**Core files**

- `manifest.json` — extension config (MV3); host permission for `http://127.0.0.1:8765/*` for trigger server
- `popup.html` / `popup.js` / `popup.css` — UI, customer detection, module toggles, Google Sheets options
- `content.js` — page interaction and scraping
- `background.js` — module orchestration, downloads, optional trigger-server call when extraction completes
- `download-manager.js` — per-module file download into `CustomerName_YYYY-MM-DD/`

**Data flow (extension)**

1. Popup opens → customer name detected  
2. User selects modules and Google options → **Run Script**  
3. Background enables selected modules and runs them in order  
4. Each module scrapes → formats → result downloaded (and optionally JSON for uploader)  
5. When all complete, if auto-upload is on, extension POSTs to trigger server with folder name and share email  
6. Popup shows completion and, if upload ran, link to the new spreadsheet  

### Google reporting (Python)

- **upload_trigger_server.py** — HTTP server (default port 8765). `POST /upload` runs the uploader for the given folder; can also run login analysis and update the report.
- **google_sheets_uploader.py** — OAuth, copy template, rename, share, parse scraper output, write to sheets. See `google_reporting/README.md`.
- **scraper_parser.py** / **sheet_mapper.py** — parse `CustomerName_YYYY-MM-DD` output and map to template sheets.
- **config.py** — credentials path, token path, template ID, share email, optional `emails_to_share.json`.
- **login_analysis.py** — optional post-upload step (e.g. find Login History CSV, run analysis, update sheet).

## Adding New Modules

To implement a new scraping module:

1. **Create module file** in `modules/` directory:

```javascript
class MyNewModule extends BaseModule {
  constructor() {
    super('My Module', 'Module description');
  }

  async scrape(context) {
    // Your scraping logic here
    return { /* data */ };
  }

  formatData(data) {
    // Format data as text
    return "MODULE OUTPUT\n...";
  }
}
```

2. **Register in background.js**:

```javascript
importScripts('modules/my-new-module.js');
moduleManager.registerModule('my-module', new MyNewModule());
```

3. **Add checkbox to popup.html**:

```html
<label class="module-item">
  <input type="checkbox" id="module-my-module" value="my-module">
  <span class="module-label">Scrap My Module</span>
</label>
```

4. **Wire the checkbox in popup.js** (e.g. add to the `moduleCheckboxes` object and to the list of IDs sent in the extraction message).

## Troubleshooting

### Customer name not detected
- Ensure you're on a Salesforce page with class `blackTabBannerTxt`
- Check browser console (F12) for detection errors
- Extension will use "Unknown_Customer" as fallback

### No profiles found
- Verify you're on the Salesforce Profiles list page
- Check that profiles have allowed user licenses
- Look for "Profile" block with `bPageBlock` class

### Extension won't load
- Use the command-line method with `--user-data-dir` or try Chrome Canary / Edge if policies block extensions.

### Download fails
- Confirm the **downloads** permission in `manifest.json` and the background service worker console (`chrome://extensions/` → Inspect service worker).

### Auto-upload to Google Sheets doesn’t run
- Start the trigger server: `python google_reporting/upload_trigger_server.py` (default port 8765). Leave it running.
- Ensure the extraction folder exists under `~/Desktop` or `~/Downloads` with the same name the extension used (e.g. `CustomerName_YYYY-MM-DD`).
- See [SEAMLESS_UPLOAD.md](google_reporting/SEAMLESS_UPLOAD.md) and [GOOGLE_OAUTH_SETUP.md](GOOGLE_OAUTH_SETUP.md).

## Technical Details

- **Manifest**: Version 3; permissions: activeTab, scripting, tabs, downloads, storage; host permission for `http://127.0.0.1:8765/*` for the upload trigger.
- **Processing**: Modules run sequentially; each module’s output is downloaded (and optionally sent to the trigger server when extraction completes).
- **Google reporting**: OAuth 2.0 (Drive + Sheets); template copy and share via Drive API; data written via Sheets API. Optional Drive Labels scope for future use.

## Version History

### 3.0.0 (Current)
- Modular extension: Licenses, Profiles, General Info, Health Check, Storage, Sandboxes, Sharing Settings, Login History (Sensitive Data coming soon).
- Google Integration: template copy, rename, share, upload scraper output to Sheets; optional auto-upload via trigger server and login analysis.
- Auto customer detection, organized downloads, “Run Script” UI, progress and result summary.

## License

For internal use only.
