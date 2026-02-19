# Salesforce Insights Scraper - Extension Flow

## Overview
This Chrome extension automates the extraction of organizational data from Salesforce Setup pages.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CHROME EXTENSION                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │  popup.html │  │ background.js │  │   content.js        │   │
│  │  popup.js   │  │   (Service   │  │   (Injected into    │   │
│  │  popup.css  │  │    Worker)   │  │   Salesforce pages) │   │
│  └─────────────┘  └──────────────┘  └─────────────────────┘   │
│        │                 │                      │                │
│        │                 │                      │                │
│  ┌─────▼─────────────────▼──────────────────────▼──────────┐   │
│  │              Module Manager (module-manager.js)          │   │
│  │  - Coordinates module execution                          │   │
│  │  - Manages execution order                               │   │
│  │  - Handles progress tracking                             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                             │                                    │
│                             │                                    │
│  ┌──────────────────────────▼────────────────────────────────┐  │
│  │                    Module Layer                            │  │
│  ├────────────────────────────────────────────────────────────┤ │
│  │  ┌───────────────────────────────────────────────────┐   │  │
│  │  │ 1. Licenses Module     (licenses-module.js)       │   │  │
│  │  │    - Scrapes user license usage                   │   │  │
│  │  │    - Internal/Integration/External categorization │   │  │
│  │  └───────────────────────────────────────────────────┘   │  │
│  │                                                            │  │
│  │  ┌───────────────────────────────────────────────────┐   │  │
│  │  │ 2. Profiles Module     (profiles-module.js)       │   │  │
│  │  │    - Scrapes profile details and permissions      │   │  │
│  │  │    - Calculates unused profiles                   │   │  │
│  │  └───────────────────────────────────────────────────┘   │  │
│  │                                                            │  │
│  │  ┌───────────────────────────────────────────────────┐   │  │
│  │  │ 3. General Info Module (general-info-module.js)   │   │  │
│  │  │    - Sites information (active/inactive)          │   │  │
│  │  │    - Release updates status                       │   │  │
│  │  └───────────────────────────────────────────────────┘   │  │
│  │                                                            │  │
│  │  ┌───────────────────────────────────────────────────┐   │  │
│  │  │ 4. Health Check Module (health-check-module.js)   │   │  │
│  │  │    - Security health check score                  │   │  │
│  │  │    - Security settings compliance                 │   │  │
│  │  └───────────────────────────────────────────────────┘   │  │
│  │                                                            │  │
│  │  ┌───────────────────────────────────────────────────┐   │  │
│  │  │ 5. Storage Module      (storage-module.js)        │   │  │
│  │  │    - Data storage usage overview                  │   │  │
│  │  │    - Record type storage breakdown                │   │  │
│  │  └───────────────────────────────────────────────────┘   │  │
│  │                                                            │  │
│  │  ┌───────────────────────────────────────────────────┐   │  │
│  │  │ 6. Sandboxes Module    (sandboxes-module.js)      │   │  │
│  │  │    - Sandbox license usage                        │   │  │
│  │  │    - Available sandbox types                      │   │  │
│  │  └───────────────────────────────────────────────────┘   │  │
│  │                                                            │  │
│  │  ┌───────────────────────────────────────────────────┐   │  │
│  │  │ 7. Sensitive Data Module (sensitive-data-module.js)│  │  │
│  │  │    - Shield Platform Encryption status            │   │  │
│  │  │    - Event Monitoring status                      │   │  │
│  │  └───────────────────────────────────────────────────┘   │  │
│  │                                                            │  │
│  │  ┌───────────────────────────────────────────────────┐   │  │
│  │  │ 8. Login History Module (login-history-module.js) │   │  │
│  │  │    - Downloads login history CSV                  │   │  │
│  │  └───────────────────────────────────────────────────┘   │  │
│  └────────────────────────────────────────────────────────┘  │
│                             │                                    │
│  ┌──────────────────────────▼────────────────────────────────┐  │
│  │          Utilities and Helper Functions                   │  │
│  ├────────────────────────────────────────────────────────────┤ │
│  │  - utils.js: Common utility functions                     │  │
│  │  - download-manager.js: File download orchestration       │  │
│  │  - excel-generator.js: Excel file generation              │  │
│  │  - shared-functions.js: Shared scraping functions         │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Execution Flow

### 1. User Interaction Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      USER OPENS POPUP                            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  POPUP DISPLAYS:                                                 │
│  ✓ Module selection checkboxes (8 modules)                      │
│  ✓ "Select All" toggle                                          │
│  ✓ Customer Name input field                                    │
│  ✓ "Execute Selected Modules" button                            │
│  ✓ Progress indicators for each module                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  USER ACTIONS:                                                   │
│  1. Selects modules to execute (default: all except Login)      │
│  2. Enters customer name (e.g., "Acme Corp")                    │
│  3. Clicks "Execute Selected Modules"                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  VALIDATION:                                                     │
│  ✓ At least one module selected?                                │
│  ✓ Customer name provided?                                      │
│  ✓ User on Salesforce Setup page?                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                        [EXECUTION]
```

### 2. Module Execution Flow

```
┌─────────────────────────────────────────────────────────────────┐
│              BACKGROUND.JS RECEIVES EXECUTE MESSAGE              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  MODULE MANAGER INITIALIZATION                                   │
│  1. Creates ModuleManager instance                               │
│  2. Registers all modules in execution order                     │
│  3. Gets enabled modules from user selection                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  FOR EACH SELECTED MODULE (in order):                           │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  MODULE EXECUTION:                                        │  │
│  │                                                            │  │
│  │  1. Update progress: "⏳ In progress..."                  │  │
│  │  2. Create execution context                              │  │
│  │  3. Call module.scrape(context)                           │  │
│  │     │                                                      │  │
│  │     ├─► Navigate to Salesforce Setup section              │  │
│  │     ├─► Search for relevant page                          │  │
│  │     ├─► Click navigation links                            │  │
│  │     ├─► Wait for page load                                │  │
│  │     ├─► Inject content scripts                            │  │
│  │     ├─► Scrape DOM elements                               │  │
│  │     └─► Extract and format data                           │  │
│  │                                                            │  │
│  │  4. Call module.formatData(scrapedData)                   │  │
│  │  5. Create .txt file with formatted data                  │  │
│  │  6. Update progress: "✓ Complete"                         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
│  [Repeat for next module]                                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  ALL MODULES COMPLETE                                            │
│  1. Collect all generated .txt files                             │
│  2. Generate Excel file with all data                            │
│  3. Create folder: "CustomerName_YYYY-MM-DD"                     │
│  4. Download folder with all files to default Downloads          │
│  5. Show completion message                                      │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Detailed Module Execution Example (Health Check)

```
┌─────────────────────────────────────────────────────────────────┐
│  HEALTH CHECK MODULE EXECUTION                                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 1: Search for "Health Check"                              │
│  - Inject search function into page                              │
│  - Find search box (.searchBoxContainer input)                   │
│  - Enter "Health Check" text                                     │
│  - Trigger search events                                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 2: Wait 2 seconds for search results                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 3: Click Health Check link                                │
│  - Find link with id="HealthCheck_font"                          │
│  - Click the link                                                │
│  - Page navigates to Health Check dashboard                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 4: Wait for page and tables to load                       │
│  - Retry loop: Check every 5 seconds (max 12 retries = 60s)     │
│  - Look for:                                                     │
│    • .standardPercentageNumber (health score)                    │
│    • .securityHealthRelatedListCard (tables)                     │
│  - When found: Wait additional 30 seconds for data to load      │
│  - Total max wait: 60s + 30s = 90 seconds                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 5: Scrape health check data                               │
│  - Extract health percentage (e.g., "85%")                       │
│  - For each security table:                                      │
│    • Extract table title                                         │
│    • Parse header row to identify columns                        │
│    • Extract each setting row:                                   │
│      - Status (✓/✗/Info)                                         │
│      - Setting name                                              │
│      - Group/Category                                            │
│      - Your value                                                │
│      - Standard value                                            │
│  - Return structured data                                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 6: Format data into .txt file                             │
│  - Header with timestamp and score                               │
│  - For each table:                                               │
│    • Section title                                               │
│    • Tab-separated columns                                       │
│    • All settings rows                                           │
│  - Save as "4_health_check.txt"                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

```
┌─────────────────┐
│  Salesforce DOM │  ◄─── User navigates to Setup
└────────┬────────┘
         │
         │ (1) Content script injection
         ▼
┌─────────────────┐
│  content.js     │  ◄─── Scrapes DOM elements
└────────┬────────┘
         │
         │ (2) Raw HTML data
         ▼
┌─────────────────┐
│  Module.scrape()│  ◄─── Module-specific parsing logic
└────────┬────────┘
         │
         │ (3) Structured data objects
         ▼
┌─────────────────┐
│ Module.format() │  ◄─── Formats data as tab-separated text
└────────┬────────┘
         │
         │ (4) Formatted text strings
         ▼
┌─────────────────┐
│  .txt files     │  ◄─── Individual module outputs
└────────┬────────┘
         │
         │ (5) All text files
         ▼
┌─────────────────┐
│ excel-generator │  ◄─── Converts to Excel with sheets
└────────┬────────┘
         │
         │ (6) Excel + text files
         ▼
┌─────────────────┐
│download-manager │  ◄─── Creates folder and downloads
└────────┬────────┘
         │
         │ (7) ZIP/folder download
         ▼
┌─────────────────┐
│ User's Downloads│  ◄─── Final output: CustomerName_YYYY-MM-DD/
└─────────────────┘       ├── 1_licenses.txt
                          ├── 2_profiles.txt
                          ├── 3_general_info.txt
                          ├── 4_health_check.txt
                          ├── 5_storage.txt
                          ├── 6_sandboxes.txt
                          ├── 7_sensitive_data.txt
                          ├── 8_login_history.txt
                          └── CustomerName_YYYY-MM-DD.xlsx
```

---

## Error Handling Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  MODULE EXECUTION ERROR                                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  Error Type?   │
                    └────┬───────┬───┘
                         │       │
         ┌───────────────┘       └───────────────┐
         │                                        │
         ▼                                        ▼
┌────────────────────┐                  ┌────────────────────┐
│  Timeout Error     │                  │  Scraping Error    │
│  (> 120 seconds)   │                  │  (element not      │
│                    │                  │   found, parse     │
│  - Log error       │                  │   error, etc.)     │
│  - Mark module ✗   │                  │                    │
│  - Continue with   │                  │  - Return partial  │
│    next module     │                  │    data if any     │
└────────────────────┘                  │  - Mark module ⚠   │
                                        │  - Continue with   │
                                        │    next module     │
                                        └────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  CONTINUE WITH REMAINING MODULES                                 │
│  - Execution is non-blocking                                     │
│  - Partial results are better than no results                    │
│  - User sees status for each module individually                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Features

### 1. **Modular Architecture**
- Each scraping task is isolated in its own module
- Modules extend BaseModule class
- Easy to add/remove modules

### 2. **Progress Tracking**
- Real-time progress updates in popup
- Individual module status indicators
- Clear error messaging

### 3. **Robust Scraping**
- Dynamic element detection (handles varying Salesforce org IDs)
- Retry mechanisms for slow-loading pages
- Fallback selectors when primary ones fail

### 4. **Data Export**
- Tab-separated text files (Excel-compatible)
- Comprehensive Excel workbook with sheets
- Organized folder structure with timestamps

### 5. **Error Recovery**
- Timeouts prevent infinite waits
- Partial data capture when possible
- Non-blocking execution (one module failure doesn't stop others)

---

## Output Format

Each module produces a `.txt` file with tab-separated values:

```
Module Name
Generated: Date/Time

Column1    Column2    Column3    ...
Value1     Value2     Value3     ...
Value1     Value2     Value3     ...
```

Final output folder structure:
```
CustomerName_2026-01-16/
├── 1_licenses.txt
├── 2_profiles.txt
├── 3_general_info.txt
├── 4_health_check.txt
├── 5_storage.txt
├── 6_sandboxes.txt
├── 7_sensitive_data.txt
├── 8_login_history.txt (if selected)
└── CustomerName_2026-01-16.xlsx
```

---

## Technologies Used

- **Chrome Extension APIs**: tabs, scripting, downloads, storage
- **JavaScript**: ES6+ with async/await
- **DOM Manipulation**: Direct DOM scraping with content scripts
- **File Generation**: Dynamic text and Excel file creation
- **Service Worker**: Background script for coordination

---

## Future Enhancements

- [ ] Add more modules (workflows, flows, custom objects, etc.)
- [ ] Support for scheduled/automatic scraping
- [ ] Cloud storage integration
- [ ] Historical comparison (track changes over time)
- [ ] PDF report generation
- [ ] Custom field mapping configuration
