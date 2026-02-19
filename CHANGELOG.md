# Changelog

All notable changes to SHC Hammr - Data Scraper will be documented in this file.

## [3.0.0] - 2026-01-14

### 🎉 Major Refactor - Modular Architecture

#### Added
- **Modular System Architecture**
  - `modules/base-module.js` - Abstract base class for all scraping modules
  - `modules/module-manager.js` - Central registry and orchestration system
  - `modules/profiles-module.js` - Refactored profile scraping into module
  - `modules/health-check-module.js` - Placeholder stub for health checks
  - `modules/storage-module.js` - Placeholder stub for storage analysis
  - `modules/sensitive-data-module.js` - Placeholder stub for sensitive data scanning
  - `modules/sandboxes-module.js` - Placeholder stub for sandbox info
  - `modules/login-history-module.js` - Placeholder stub for login history
  - `download-manager.js` - Handles file downloads with folder structure

- **Auto Customer Detection**
  - Automatically detects customer name from `blackTabBannerTxt` class
  - Displays customer name prominently in popup UI
  - Uses customer name for organizing download folders

- **New UI Design**
  - Modern, clean interface with better UX
  - Module selection via checkboxes/toggles
  - Customer name display at top
  - Progress tracking per module (not per profile)
  - Simplified single "Extract Data" button

- **Organized Downloads**
  - Files downloaded to `CustomerName_YYYY-MM-DD/` folder structure
  - Each module generates its own text file
  - Format: `profiles.txt`, `health-check.txt`, etc.

#### Changed
- **Extension Name**: "Profile Active Users Counter" → "SHC Hammr - Data Scraper"
- **Version**: 2.0.0 → 3.0.0
- **Background Script**: Completely refactored to use module system
- **Popup UI**: Redesigned for multi-module selection
- **Progress Tracking**: Changed from per-profile to per-module tracking

#### Technical Improvements
- Cleaner code organization with separation of concerns
- Extensible architecture for easy addition of new modules
- Better error handling and reporting
- Maintained backward compatibility for legacy TXT generation

#### Migration Notes
- Existing profile scraping functionality preserved and enhanced
- All original features still available through "Profiles" module
- Legacy `excel-generator.js` kept for backward compatibility but not used

### How to Use New Features

1. **Customer Detection**: Opens automatically when popup loads
2. **Module Selection**: Check/uncheck modules you want to run
3. **Extract Data**: Single button initiates all selected modules
4. **Download Location**: Files saved to `CustomerName_Date/` folder

### Future Module Development

Placeholder modules ready for implementation:
- Health Check - System health diagnostics
- Storage - Storage usage analysis
- Sensitive Data - Security scanning
- Sandboxes - Sandbox information
- Login History - User login tracking

Each module follows the base architecture and can be implemented independently.

---

## [2.0.0] - Previous Version

### Features
- Profile active users counting
- Pagination support
- Excel/TXT export
- Batch processing of profiles

---

## [1.0.0] - Initial Release

### Features
- Basic profile link extraction
- Active user counting
- Simple UI
