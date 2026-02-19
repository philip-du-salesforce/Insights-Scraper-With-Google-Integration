# Excel Import Guide

## Quick Start: 3 Steps to Excel

### Step 1: Get Your Data
Run the extension and download your files to:
```
CustomerName_2026-01-14/
├── profiles.txt
├── health-check.txt
└── ...
```

### Step 2: Open in Text Editor
Open any `.txt` file and find the data section:
```
====================================================================================================
DETAILED DATA (Tab-Separated - Copy to Excel)
====================================================================================================

Column1	Column2	Column3
Data1	Data2	Data3
```

### Step 3: Copy & Paste into Excel
1. Select from the column headers down to the last data row
2. Copy (Ctrl+C / Cmd+C)
3. Open Excel
4. Click cell A1
5. Paste (Ctrl+V / Cmd+V)
6. Done! ✨

## Visual Example

### What You See in profiles.txt:
```
PROFILE INFORMATION REPORT
Generated: 1/14/2026, 4:30:00 PM
Total Profiles: 3

SUMMARY STATISTICS
Total Active Users (All Profiles):	265
Average Active Users per Profile:	88.33
Profiles with "Modify All Data":	1
Profiles with "Run Reports":	3
Profiles with "Export Reports":	2

====================================================================================================
DETAILED DATA (Tab-Separated - Copy to Excel)
====================================================================================================

Profile Name	Modify All Data	Run Reports	Export Reports	Active Users	Status	URL
System Administrator	Yes	Yes	Yes	42	Success	https://instance.salesforce.com/profile1
Standard User	No	Yes	No	128	Success	https://instance.salesforce.com/profile2
Sales User	No	Yes	Yes	95	Success	https://instance.salesforce.com/profile3
```

### What You Get in Excel:

| A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|
| **Profile Name** | **Modify All Data** | **Run Reports** | **Export Reports** | **Active Users** | **Status** | **URL** |
| System Administrator | Yes | Yes | Yes | 42 | Success | https://instance.salesforce.com/profile1 |
| Standard User | No | Yes | No | 128 | Success | https://instance.salesforce.com/profile2 |
| Sales User | No | Yes | Yes | 95 | Success | https://instance.salesforce.com/profile3 |

### What You See in health-check.txt:
```
HEALTH CHECK REPORT
Generated: 1/14/2026, 4:30:00 PM
Health Check Score: 85%

SUMMARY STATISTICS
Total Settings:	42
Passed:	35
Failed:	5
Warnings:	2

====================================================================================================
DETAILED SECURITY SETTINGS (Tab-Separated - Copy to Excel)
====================================================================================================

Status	Setting	Group	Your Value	Standard Value
Failed	Session Timeout	Session Management	2 hours	15 minutes
Passed	Password Expiration	Password Policies	90 days	90 days
Warning	Login IP Ranges	Network Security	Not configured	Configured
Passed	Two-Factor Authentication	Authentication	Enabled	Enabled
Failed	Clickjack Protection	Security Settings	Disabled	Enabled
```

### What You Get in Excel:

| A | B | C | D | E |
|---|---|---|---|---|
| **Status** | **Setting** | **Group** | **Your Value** | **Standard Value** |
| Failed | Session Timeout | Session Management | 2 hours | 15 minutes |
| Passed | Password Expiration | Password Policies | 90 days | 90 days |
| Warning | Login IP Ranges | Network Security | Not configured | Configured |
| Passed | Two-Factor Authentication | Authentication | Enabled | Enabled |
| Failed | Clickjack Protection | Security Settings | Disabled | Enabled |

## Excel Power Features

Once your data is in Excel, you can:

### 📊 Create Pivot Tables
```
1. Select your data (including headers)
2. Insert → PivotTable
3. Drag fields to create summaries
   Example: Count of Profiles by Status
   Example: Sum of Active Users by Permission
```

### 🎨 Apply Conditional Formatting
```
1. Select the Status column
2. Home → Conditional Formatting → Highlight Cell Rules
3. Set rules:
   - "Failed" = Red background
   - "Warning" = Yellow background
   - "Passed" = Green background
```

### 📈 Create Charts
```
1. Select relevant columns
2. Insert → Chart
   Example: Bar chart of Active Users by Profile
   Example: Pie chart of Status distribution
```

### 🔍 Use Filters
```
1. Select header row
2. Data → Filter (or Ctrl+Shift+L)
3. Click dropdown arrows in headers
4. Filter by:
   - Failed items only
   - Profiles with >50 active users
   - Specific groups
```

### 🧮 Add Formulas
```
Example calculations you can add:
- Total active users: =SUM(E2:E100)
- Average: =AVERAGE(E2:E100)
- Count failures: =COUNTIF(F2:F100,"Failed")
- Percentage: =E2/SUM($E$2:$E$100)
```

## Pro Tips

### Tip 1: Save as Excel Workbook
After pasting, save as `.xlsx`:
```
File → Save As → Excel Workbook (.xlsx)
```

### Tip 2: Multiple Modules in One Workbook
```
1. Paste profiles.txt data into Sheet1
2. Rename Sheet1 to "Profiles"
3. Add new sheet (Sheet2)
4. Paste health-check.txt data into Sheet2
5. Rename Sheet2 to "Health Check"
6. Repeat for all modules
Result: One workbook with all your data!
```

### Tip 3: Create a Dashboard Sheet
```
1. Add a new sheet called "Dashboard"
2. Use formulas to pull key metrics:
   =Sheet1!B2  (pulls data from Profiles sheet)
3. Create summary charts
4. Add key findings and notes
```

### Tip 4: Freeze Headers
```
1. Click cell A2 (first data row)
2. View → Freeze Panes → Freeze Top Row
3. Now scroll through data while headers stay visible
```

### Tip 5: Auto-fit Columns
```
1. Select all data (Ctrl+A)
2. Double-click between any two column headers
3. All columns automatically resize to fit content
```

## Troubleshooting

### Problem: Data Doesn't Split into Columns
**Solution**: Make sure you're copying from the "DETAILED DATA" section, not the summary section.

### Problem: Some Columns are Too Wide
**Solution**: 
```
1. Select the column header (click the letter)
2. Right-click → Column Width
3. Set desired width (e.g., 20)
```

### Problem: URLs Show as #VALUE! Error
**Solution**: URLs are text by default. To make them clickable:
```
1. Right-click the cell
2. Edit Hyperlink
3. Or use formula: =HYPERLINK(G2, "Open")
```

### Problem: Numbers Show as Text
**Solution**: The data is already formatted correctly, but if needed:
```
1. Select the column
2. Data → Text to Columns
3. Click Finish
4. Numbers will be recognized properly
```

## Example Report Template

Here's a suggested Excel workbook structure:

```
📊 CustomerName_HealthCheck_2026-01-14.xlsx
├── 📄 Dashboard (summary, key metrics, charts)
├── 📄 Profiles (raw data from profiles.txt)
├── 📄 Health Check (raw data from health-check.txt)
├── 📄 Storage (raw data from storage.txt)
├── 📄 Sandboxes (raw data from sandboxes.txt)
└── 📄 Analysis (your custom analysis, pivot tables)
```

## Next Steps

After importing your data:
1. ✅ Add filters to headers
2. ✅ Apply conditional formatting for status
3. ✅ Create summary charts
4. ✅ Calculate totals and averages
5. ✅ Add your findings and recommendations
6. ✅ Share with stakeholders

**Your data is now ready for professional analysis!** 📊✨
