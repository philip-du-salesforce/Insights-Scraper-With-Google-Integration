# SHC Hammr - Modular Data Scraper

A Chrome extension for extracting data from Salesforce with a modular architecture supporting multiple scraping tasks.

## Features

### Modular Architecture
- **Profiles Module**: Extract profile information and count active users with pagination support
- **Health Check Module**: Placeholder for system health checks (to be implemented)
- **Storage Module**: Placeholder for storage analysis (to be implemented)
- **Sensitive Data Module**: Placeholder for sensitive data scanning (to be implemented)
- **Sandboxes Module**: Placeholder for sandbox information extraction (to be implemented)
- **Login History Module**: Placeholder for login history extraction (to be implemented)

### Key Capabilities
- **Automatic Customer Detection**: Identifies customer name from page elements (class: `blackTabBannerTxt`)
- **Multi-Module Selection**: Choose which modules to run via checkbox toggles
- **Organized Downloads**: Files downloaded to `CustomerName_YYYY-MM-DD/` folder structure
- **Progress Tracking**: Real-time progress updates showing current module being processed
- **Extensible Design**: Easy to add new scraping modules

## Installation

### Method 1: Load Unpacked (Standard Method)

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right corner)
3. Click "Load unpacked"
4. Select the folder: `/Users/nadim.diaz/Desktop/Repositories/The SHC Hammr`

### Method 2: Using Command Line

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --load-extension="/Users/nadim.diaz/Desktop/Repositories/The SHC Hammr" \
  --user-data-dir="$HOME/tmp/chrome-ext-test"
```

### Method 3: Use Chrome Canary or Edge

If Chrome has enterprise policies blocking extensions:
- Chrome Canary
- Microsoft Edge (`edge://extensions/`)
- Chromium browser

## Usage

1. **Navigate to a Salesforce page**
2. **Click the extension icon** in your browser toolbar
3. **Customer name will be auto-detected** and displayed at the top
4. **Select modules to run** using the checkboxes:
   - ☑ Scrap Profiles (extracts profile info and active user counts)
   - ☐ Scrap Health Check
   - ☐ Scrap Storage
   - ☐ Scrap Sensitive Data
   - ☐ Scrap Sandboxes
   - ☐ Scrap Login History
5. **Click "Extract Data"** to begin processing
6. **Monitor progress** as each module executes
7. **Files are automatically downloaded** to `CustomerName_YYYY-MM-DD/` folder

## Output Format

Each module generates a text file in the download folder:

```
CustomerName_2026-01-14/
├── profiles.txt
├── health-check.txt
├── storage.txt
├── sensitive-data.txt
├── sandboxes.txt
└── login-history.txt
```

### Profiles Module Output Example

```
PROFILE INFORMATION
================================================================================

Total Profiles Processed: 15
Generated: 1/14/2026, 3:45:12 PM

================================================================================

1. System Administrator
------------------------------------------------------------
   URL: https://...
   Modify All Data: Yes
   Run Reports: Yes
   Export Reports: Yes
   Active Users: 42

2. Standard User
------------------------------------------------------------
   URL: https://...
   Modify All Data: No
   Run Reports: Yes
   Export Reports: No
   Active Users: 128
```

## Architecture

### Module System

```
modules/
├── base-module.js           # Abstract base class
├── module-manager.js        # Module registry and orchestration
├── profiles-module.js       # Profile scraping (fully implemented)
├── health-check-module.js   # Placeholder stub
├── storage-module.js        # Placeholder stub
├── sensitive-data-module.js # Placeholder stub
├── sandboxes-module.js      # Placeholder stub
└── login-history-module.js  # Placeholder stub
```

### Core Files

- **manifest.json**: Extension configuration
- **popup.html**: Extension popup UI with module toggles
- **popup.js**: UI logic and customer name detection
- **popup.css**: Modern styling
- **content.js**: Page interaction and data extraction
- **background.js**: Module orchestration and download management
- **download-manager.js**: File download with folder structure

### Data Flow

```
1. Popup opens → Auto-detect customer name
2. User selects modules → Click "Extract Data"
3. Background script → Enable selected modules
4. Module Manager → Execute each module sequentially
5. Each module → Scrape data → Format as text
6. Download Manager → Save files to CustomerName_Date/ folder
7. Popup → Display completion summary
```

## How Profiles Module Works

### Step-by-Step Process per Profile:

1. **Extract Profile Links**: Finds all profiles with allowed user licenses from the page
2. **Open Profile Page**: Navigates to each profile URL in background
3. **Get Profile Details**: Extracts name, permissions (Modify All Data, Run Reports, Export Reports)
4. **Click "View Users"**: Finds and clicks the View Users button
5. **Count Active Users**: Identifies Active column and counts checked users
6. **Return Results**: Compiles profile data with user count

### Allowed User Licenses:
- Salesforce
- Salesforce Platform
- Customer Community Login
- Partner Community
- Guest User License
- Partner Community Login
- Customer Community
- Customer Community Plus
- Partner Community Plus
- Customer Community Plus Login
- Salesforce Integration

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

4. **Add to popup.js checkbox object**:

```javascript
const moduleCheckboxes = {
  // ...
  myModule: document.getElementById('module-my-module')
};
```

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
- Try command-line method with `--user-data-dir` flag
- Use Chrome Canary or Edge
- Check for enterprise policy restrictions

### Download fails
- Verify downloads permission is granted in manifest
- Check background service worker console: `chrome://extensions/` → "Inspect views: service worker"

## Technical Details

- **Manifest Version**: 3
- **Permissions**: activeTab, scripting, tabs, downloads, storage
- **Processing**: Sequential module execution with progress tracking
- **Timeout**: 120 seconds per profile (including pagination)
- **Max Pages**: 100 pages per profile (safety limit)

## Version History

### 3.0.0 (Current)
- Complete modular architecture refactor
- Multi-module selection with toggles
- Automatic customer name detection
- Organized folder structure for downloads
- Modern UI redesign

### 2.0.0 (Legacy)
- Profile active users counter
- Pagination support
- Excel/TXT export

## License

For internal use only.
