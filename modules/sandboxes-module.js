/**
 * Sandboxes Module
 * Target: Setup > Environments > Sandboxes
 * 1. Available Sandbox Licenses: Type, Used, Allowance
 * 2. Sandboxes table: Name, Type, Status, Location, Release Type, Current Org Id, Completed On, Description, Copied From
 */

class SandboxesModule extends BaseModule {
  constructor() {
    super('Sandboxes', 'Extract sandbox licenses and full sandbox table');
  }

  async initialize() {
    await super.initialize();
  }

  async validate() {
    return { valid: true };
  }

  async scrape(context) {
    console.log('[SandboxesModule] Starting sandboxes scraping...');

    try {
      const searchResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: searchFunc,
        args: ['Sandboxes']
      });
      if (!searchResult[0]?.result?.success) {
        throw new Error(`Search failed: ${searchResult[0]?.result?.error || 'Unknown error'}`);
      }
      await this.delay(2000);

      const clickResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: clickElementFunc,
        args: ['a#DataManagementCreateTestInstance_font']
      });
      if (!clickResult[0]?.result?.success) {
        throw new Error(`Failed to open Sandboxes: ${clickResult[0]?.result?.error || 'Unknown error'}`);
      }
      await this.delay(10000);
      console.log('[SandboxesModule] Navigated to Sandboxes page');
    } catch (err) {
      console.error('[SandboxesModule] Navigation error:', err);
      throw new Error(`Failed to navigate to Sandboxes: ${err.message}`);
    }

    const dataResult = await chrome.scripting.executeScript({
      target: { tabId: context.tabId },
      func: scrapeSandboxesDataFunc
    });

    const data = dataResult?.[0]?.result || { usage: { headers: [], rows: [] }, sandboxes: { headers: [], rows: [] } };
    // Normalize to licenses + rows for formatData/getJsonPayload
    const licenses = (data.usage && data.usage.rows.length) ? data.usage.rows.map(r => ({
      type: r[0] || '',
      used: r[1] ?? '',
      allowance: r[2] ?? ''
    })) : (data.licenses || []);
    const rows = (data.sandboxes && data.sandboxes.rows.length) ? data.sandboxes.rows.map(row => {
      const h = (data.sandboxes.headers || []).map(x => (x || '').toLowerCase());
      const name = row[h.findIndex(x => x.includes('name'))] ?? row[0] ?? '';
      const type = row[h.findIndex(x => x.includes('type') && !x.includes('release'))] ?? row[1] ?? '';
      const status = row[h.findIndex(x => x.includes('status'))] ?? row[2] ?? '';
      const location = row[h.findIndex(x => x.includes('location'))] ?? row[3] ?? '';
      const releaseType = row[h.findIndex(x => x.includes('release'))] ?? row[4] ?? '';
      const currentOrgId = row[h.findIndex(x => x.includes('org'))] ?? row[5] ?? '';
      const completedOn = row[h.findIndex(x => x.includes('completed'))] ?? row[6] ?? '';
      const description = row[h.findIndex(x => x.includes('description'))] ?? row[7] ?? '';
      const copiedFrom = row[h.findIndex(x => x.includes('copied'))] ?? row[8] ?? '';
      return { name, type, status, location, releaseType, currentOrgId, completedOn, description, copiedFrom };
    }) : (data.rows || []);
    console.log(`[SandboxesModule] Licenses: ${licenses.length}, Sandboxes: ${rows.length}`);
    return { licenses, rows };
  }

  formatData(data) {
    let output = '';
    output += 'SANDBOXES REPORT\n';
    output += `Generated: ${new Date().toLocaleString()}\n`;
    output += 'Source: Setup > Environments > Sandboxes\n';
    output += '\n';

    output += '='.repeat(100) + '\n';
    output += 'AVAILABLE SANDBOX LICENSES\n';
    output += '='.repeat(100) + '\n';
    output += '\n';
    output += 'Type\tUsed\tAllowance\n';
    (data.licenses || []).forEach(l => {
      output += `${l.type || ''}\t${l.used ?? ''}\t${l.allowance ?? ''}\n`;
    });
    output += '\n';

    output += '='.repeat(100) + '\n';
    output += 'SANDBOXES (FULL TABLE)\n';
    output += '='.repeat(100) + '\n';
    output += '\n';
    output += 'Name\tType\tStatus\tLocation\tRelease Type\tCurrent Org Id\tCompleted On\tDescription\tCopied From\n';
    (data.rows || []).forEach(row => {
      output += [
        row.name || '',
        row.type || '',
        row.status || '',
        row.location || '',
        row.releaseType || '',
        row.currentOrgId || '',
        row.completedOn || '',
        row.description || '',
        row.copiedFrom || ''
      ].join('\t') + '\n';
    });
    return output;
  }

  getJsonPayload(data) {
    return {
      licenses: data.licenses || [],
      rows: data.rows || []
    };
  }

  getFilename() {
    return '6_sandboxes';
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Scrape sandboxes data from the page.
 * License usage: from table#licenseInfo – one row per license type (thead th.licenseHead = type, tbody td = "X of Y Licenses In Use").
 * Sandbox list: from table.list with Name/Type/Status etc.
 */
function scrapeSandboxesDataFunc() {
  const result = {
    usage: { headers: [], rows: [] },
    sandboxes: { headers: [], rows: [] }
  };

  function normalizeLicenseType(type) {
    const lower = (type || '').toLowerCase();
    if (lower.includes('full')) return 'Full Sandbox';
    if (lower.includes('partial')) return 'Partial Copy Sandbox';
    if (lower.includes('developer pro')) return 'Developer Pro Sandbox';
    if (lower.includes('developer')) return 'Developer Sandbox';
    return (type || '').trim() ? type + ' Sandbox' : type;
  }

  function parseUsageString(usageStr) {
    const match = (usageStr || '').match(/(\d+)\s+of\s+(\d+)/);
    if (match) return { used: match[1], allowance: match[2] };
    return { used: '', allowance: '' };
  }

  // Part 1: Available Sandbox Licenses from table#licenseInfo
  const licenseTable = document.getElementById('licenseInfo');
  if (licenseTable) {
    result.usage.headers = ['Type', 'Used', 'Allowance'];

    const thead = licenseTable.querySelector('thead');
    const licenseHeads = thead ? thead.querySelectorAll('th.licenseHead') : [];
    const licenseTypes = [];
    licenseHeads.forEach(th => {
      const t = (th.textContent || '').trim();
      if (t) licenseTypes.push(t);
    });

    const tbody = licenseTable.querySelector('tbody');
    const usageCells = tbody ? Array.from(tbody.querySelectorAll('td')) : [];

    licenseTypes.forEach((type, index) => {
      const td = usageCells[index];
      const usageText = td ? (td.textContent || '').trim() : '';
      const parsed = parseUsageString(usageText);
      const normalizedType = normalizeLicenseType(type);
      result.usage.rows.push([normalizedType, parsed.used, parsed.allowance]);
    });
  }

  // Part 2: Sandboxes list table
  const possibleTables = document.querySelectorAll('table.list, table[class*="sandbox"], .bRelatedList table');
  for (const table of possibleTables) {
    const headerRow = table.querySelector('tr.headerRow, thead tr, tr:first-child');
    if (!headerRow) continue;

    const headers = Array.from(headerRow.querySelectorAll('th, td')).map(c => (c.textContent || '').trim());
    const hasRelevant = headers.some(h => {
      const l = (h || '').toLowerCase();
      return l.includes('name') || l.includes('type') || l.includes('status') || l.includes('sandbox');
    });
    if (!hasRelevant) continue;

    result.sandboxes.headers = headers;

    const dataRows = table.querySelectorAll('tr.dataRow, tbody tr:not(.headerRow), tr:not(:first-child)');
    dataRows.forEach(row => {
      if (row.classList.contains('headerRow') || row === headerRow) return;
      const cells = row.querySelectorAll('td, th');
      if (cells.length === 0) return;
      const rowData = Array.from(cells).map(cell => {
        const link = cell.querySelector('a');
        return link ? link.textContent.trim() : cell.textContent.trim();
      });
      if (rowData.some(cell => (cell || '').length > 0)) {
        result.sandboxes.rows.push(rowData);
      }
    });

    if (result.sandboxes.rows.length > 0) break;
  }

  return result;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SandboxesModule;
}
