# Module Output Format Standard

## Overview
All modules output **tab-separated text files** that can be easily copied and pasted into Excel or any spreadsheet application.

## Format Structure

Each module's `.txt` file follows this standard structure:

```
[MODULE NAME] REPORT
Generated: [Date and Time]
[Module-specific summary info]

SUMMARY STATISTICS
Stat 1:	[value]
Stat 2:	[value]
Stat 3:	[value]

====================================================================================================
DETAILED DATA (Tab-Separated - Copy to Excel)
====================================================================================================

Column1	Column2	Column3	Column4	Column5
Data1	Data2	Data3	Data4	Data5
Data1	Data2	Data3	Data4	Data5
...
```

## Key Features

### ✅ Tab-Separated Values (TSV)
- Each data field is separated by a **TAB character** (`\t`)
- Works perfectly with Excel's paste functionality
- Maintains data integrity (no comma conflicts)

### ✅ Excel-Ready
1. Open the `.txt` file
2. Select the data table section
3. Copy (Ctrl+C / Cmd+C)
4. Paste into Excel (Ctrl+V / Cmd+V)
5. Data automatically splits into columns!

### ✅ Human-Readable
- Headers and summaries in plain text
- Clear section dividers
- Statistics at the top for quick reference

## Example Outputs

### Profiles Module Output

```
PROFILE INFORMATION REPORT
Generated: 1/14/2026, 4:30:00 PM
Total Profiles: 15

SUMMARY STATISTICS
Total Active Users (All Profiles):	342
Average Active Users per Profile:	22.80
Profiles with "Modify All Data":	3
Profiles with "Run Reports":	12
Profiles with "Export Reports":	8

====================================================================================================
DETAILED DATA (Tab-Separated - Copy to Excel)
====================================================================================================

Profile Name	Modify All Data	Run Reports	Export Reports	Active Users	Status	URL
System Administrator	Yes	Yes	Yes	42	Success	https://...
Standard User	No	Yes	No	128	Success	https://...
Sales User	No	Yes	Yes	95	Success	https://...
Marketing User	No	No	No	33	Success	https://...
```

**In Excel, this becomes:**

| Profile Name | Modify All Data | Run Reports | Export Reports | Active Users | Status | URL |
|--------------|-----------------|-------------|----------------|--------------|--------|-----|
| System Administrator | Yes | Yes | Yes | 42 | Success | https://... |
| Standard User | No | Yes | No | 128 | Success | https://... |
| Sales User | No | Yes | Yes | 95 | Success | https://... |

### Health Check Module Output

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
```

**In Excel, this becomes:**

| Status | Setting | Group | Your Value | Standard Value |
|--------|---------|-------|------------|----------------|
| Failed | Session Timeout | Session Management | 2 hours | 15 minutes |
| Passed | Password Expiration | Password Policies | 90 days | 90 days |
| Warning | Login IP Ranges | Network Security | Not configured | Configured |

## Implementation Guidelines

### For Module Developers

When creating a new module's `formatData()` method:

```javascript
formatData(data) {
  let output = '';
  
  // 1. Header Section (human-readable)
  output += '[MODULE NAME] REPORT\n';
  output += `Generated: ${new Date().toLocaleString()}\n`;
  output += `[Key metric]: [value]\n`;
  output += '\n';
  
  // 2. Summary Statistics (tab-separated for easy reading)
  output += 'SUMMARY STATISTICS\n';
  output += `Stat Name:\t${value}\n`;
  output += `Another Stat:\t${value}\n`;
  output += '\n';
  
  // 3. Data Table Header
  output += '='.repeat(100) + '\n';
  output += 'DETAILED DATA (Tab-Separated - Copy to Excel)\n';
  output += '='.repeat(100) + '\n';
  output += '\n';
  
  // 4. Column Headers (tab-separated)
  output += 'Column1\tColumn2\tColumn3\tColumn4\n';
  
  // 5. Data Rows (tab-separated)
  data.forEach(item => {
    output += `${item.field1 || 'N/A'}\t`;
    output += `${item.field2 || 'N/A'}\t`;
    output += `${item.field3 || 'N/A'}\t`;
    output += `${item.field4 || 'N/A'}\n`;
  });
  
  return output;
}
```

### Key Rules

1. **Use `\t` (tab character)** for column separation
2. **Use `\n` (newline)** for row separation
3. **Include column headers** as the first data row
4. **Handle null/undefined** with `|| 'N/A'`
5. **Add summary statistics** at the top
6. **Use clear section dividers** (`=`.repeat(100))
7. **Label the data section** as "Tab-Separated - Copy to Excel"

## Benefits

### ✅ For Users
- **No manual formatting** - paste directly into Excel
- **Preserves data types** - numbers stay numbers
- **Easy to analyze** - use Excel pivot tables, formulas, charts
- **Shareable** - standard Excel format everyone understands

### ✅ For Developers
- **Simple to implement** - just use `\t` between values
- **Consistent format** - all modules follow same pattern
- **Easy to test** - human-readable even in .txt format
- **Flexible** - add/remove columns easily

## Testing Your Module Output

### 1. Check in Text Editor
```
Open the .txt file in Notepad/TextEdit
✓ Headers should be readable
✓ Tabs should create visual spacing
✓ Summary stats should be clear
```

### 2. Test in Excel
```
1. Open Excel
2. Create new workbook
3. Copy the data table section from .txt file
4. Paste into Excel
5. Verify:
   ✓ Data splits into correct columns
   ✓ Headers are in row 1
   ✓ No extra/missing columns
   ✓ Numbers are treated as numbers
```

### 3. Validate Data
```
✓ No data truncation
✓ Special characters handled correctly
✓ URLs preserved properly
✓ Multi-word values stay in same column
```

## Common Pitfalls to Avoid

### ❌ Don't Use Commas for Separation
```javascript
// BAD - commas can be in data
output += `${field1}, ${field2}, ${field3}\n`;

// GOOD - tabs are safe
output += `${field1}\t${field2}\t${field3}\n`;
```

### ❌ Don't Include Tabs in Data Values
```javascript
// BAD - if data contains tabs, it breaks columns
output += `${description}\t${value}\n`;  // description might have \t

// GOOD - sanitize data
output += `${description.replace(/\t/g, ' ')}\t${value}\n`;
```

### ❌ Don't Forget Column Headers
```javascript
// BAD - no headers
data.forEach(item => output += `${item.a}\t${item.b}\n`);

// GOOD - headers first
output += 'Column A\tColumn B\n';
data.forEach(item => output += `${item.a}\t${item.b}\n`);
```

## Future Enhancements

Potential improvements to consider:

- [ ] Add CSV export option alongside TSV
- [ ] Include Excel formulas in output (e.g., =SUM())
- [ ] Generate actual .xlsx files (requires library)
- [ ] Add data validation rules
- [ ] Support for multiple sheets (via multiple sections)

## Questions?

If you're developing a new module and unsure about the output format:
1. Look at `profiles-module.js` or `health-check-module.js` as examples
2. Follow the template above
3. Test in Excel before committing

**Remember**: The goal is to make data instantly usable in Excel with zero manual formatting!
