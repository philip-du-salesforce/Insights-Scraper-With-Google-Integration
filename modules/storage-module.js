/**
 * Storage Module
 * Target: Setup > Data > Storage Usage
 * Part A: Top summary table (Data Storage, File Storage) - Storage Type, Limit, Used, Percentage Used
 * Part B: All data storage objects + all file storage objects (full detail tables)
 */

class StorageModule extends BaseModule {
  constructor() {
    super('Storage', 'Extract storage overview and data/file storage object details');
  }

  async initialize() {
    await super.initialize();
  }

  async validate() {
    return { valid: true };
  }

  async scrape(context) {
    console.log('[StorageModule] Starting storage scraping...');

    try {
      const searchResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: searchFunc,
        args: ['Storage']
      });
      if (!searchResult[0]?.result?.success) {
        throw new Error(`Search failed: ${searchResult[0]?.result?.error || 'Unknown error'}`);
      }
      await this.delay(2000);

      const clickResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: clickElementFunc,
        args: ['a#CompanyResourceDisk_font']
      });
      if (!clickResult[0]?.result?.success) {
        throw new Error(`Failed to click Storage link: ${clickResult[0]?.result?.error || 'Unknown error'}`);
      }
      await this.delay(10000);
      console.log('[StorageModule] Navigated to Storage Usage page');
    } catch (err) {
      console.error('[StorageModule] Navigation error:', err);
      throw new Error(`Failed to navigate to Storage: ${err.message}`);
    }

    const dataResult = await chrome.scripting.executeScript({
      target: { tabId: context.tabId },
      func: scrapeStorageUsageFullFunc
    });

    const data = dataResult?.[0]?.result || {
      overview: { headers: [], rows: [] },
      dataStorageObjects: { headers: [], rows: [] },
      fileStorageObjects: { headers: [], rows: [] }
    };
    console.log('[StorageModule] Overview rows:', data.overview?.rows?.length || 0,
      'Data objects:', data.dataStorageObjects?.rows?.length || 0,
      'File objects:', data.fileStorageObjects?.rows?.length || 0);
    return data;
  }

  formatData(data) {
    let output = '';
    output += 'STORAGE USAGE REPORT\n';
    output += `Generated: ${new Date().toLocaleString()}\n`;
    output += 'Source: Setup > Data > Storage Usage\n';
    output += '\n';

    // Part A: Overview (Data Storage, File Storage - global limits)
    output += '='.repeat(100) + '\n';
    output += 'PART A – STORAGE OVERVIEW (GLOBAL LIMITS)\n';
    output += '='.repeat(100) + '\n';
    output += 'Columns: Storage Type, Limit, Used, Percentage Used\n';
    output += '\n';
    const overview = data.overview || { headers: [], rows: [] };
    if (overview.headers && overview.headers.length) {
      output += overview.headers.join('\t') + '\n';
    }
    (overview.rows || []).forEach(row => {
      output += (Array.isArray(row) ? row : Object.values(row)).join('\t') + '\n';
    });
    output += '\n';

    // Part B: Data storage objects (all rows)
    output += '='.repeat(100) + '\n';
    output += 'PART B – DATA STORAGE OBJECTS (ALL ROWS)\n';
    output += '='.repeat(100) + '\n';
    output += '\n';
    const dataObjs = data.dataStorageObjects || { headers: [], rows: [] };
    if (dataObjs.headers && dataObjs.headers.length) {
      output += dataObjs.headers.join('\t') + '\n';
    }
    (dataObjs.rows || []).forEach(row => {
      output += (Array.isArray(row) ? row : Object.values(row)).join('\t') + '\n';
    });
    output += '\n';

    // Part B: File storage objects (all rows)
    output += '='.repeat(100) + '\n';
    output += 'PART B – FILE STORAGE OBJECTS (ALL ROWS)\n';
    output += '='.repeat(100) + '\n';
    output += '\n';
    const fileObjs = data.fileStorageObjects || { headers: [], rows: [] };
    if (fileObjs.headers && fileObjs.headers.length) {
      output += fileObjs.headers.join('\t') + '\n';
    }
    (fileObjs.rows || []).forEach(row => {
      output += (Array.isArray(row) ? row : Object.values(row)).join('\t') + '\n';
    });

    return output;
  }

  getJsonPayload(data) {
    return {
      overview: data.overview || { headers: [], rows: [] },
      dataStorageObjects: data.dataStorageObjects || { headers: [], rows: [] },
      fileStorageObjects: data.fileStorageObjects || { headers: [], rows: [] }
    };
  }

  getFilename() {
    return '5_storage';
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Scrape Storage Usage page: Part A = top summary table; Part B = all data + all file storage object tables
 */
function scrapeStorageUsageFullFunc() {
  const result = {
    overview: { headers: [], rows: [] },
    dataStorageObjects: { headers: [], rows: [] },
    fileStorageObjects: { headers: [], rows: [] }
  };

  const tables = document.querySelectorAll('table.list');
  if (tables.length === 0) return result;

  // Part A: First table = Storage Overview (Storage Type, Limit, Used, Percent Used)
  const firstTable = tables[0];
  const overviewHeaderRow = firstTable.querySelector('tr.headerRow, thead tr');
  if (overviewHeaderRow) {
    result.overview.headers = Array.from(overviewHeaderRow.querySelectorAll('th, td')).map(c => c.textContent.trim());
  }
  const overviewDataRows = firstTable.querySelectorAll('tr.dataRow');
  overviewDataRows.forEach(row => {
    const cells = row.querySelectorAll('th, td');
    const rowData = Array.from(cells).map(c => {
      const span = c.querySelector('span');
      return (span ? span.textContent : c.textContent).trim();
    });
    if (rowData.some(c => c.length > 0) && !(rowData[0] || '').toLowerCase().includes('total')) {
      result.overview.rows.push(rowData);
    }
  });

  // Part B: Find "Current Data Storage Usage" and "File Storage" (or similar) sections and scrape all rows
  const pageBlocks = document.querySelectorAll('div.bPageBlock');
  pageBlocks.forEach(block => {
    const h3 = block.querySelector('div.pbHeader h3, h3');
    const title = h3 ? h3.textContent.trim().toLowerCase() : '';
    const table = block.querySelector('table.list');
    if (!table) return;

    const headerRow = table.querySelector('tr.headerRow, thead tr');
    const headers = headerRow ? Array.from(headerRow.querySelectorAll('th, td')).map(c => c.textContent.trim()) : [];
    const dataRows = table.querySelectorAll('tr.dataRow');
    const rows = [];
    dataRows.forEach(row => {
      const cells = row.querySelectorAll('th, td');
      const rowData = Array.from(cells).map(c => {
        const span = c.querySelector('span');
        return (span ? span.textContent : c.textContent).trim();
      });
      if (rowData.some(c => c.length > 0) && !(rowData[0] || '').toLowerCase().includes('total')) {
        rows.push(rowData);
      }
    });

    if (title.includes('data storage') && title.includes('usage')) {
      result.dataStorageObjects.headers = headers;
      result.dataStorageObjects.rows = result.dataStorageObjects.rows.concat(rows);
    } else if (title.includes('file storage') || (title.includes('file') && title.includes('storage'))) {
      result.fileStorageObjects.headers = headers.length ? headers : result.fileStorageObjects.headers;
      result.fileStorageObjects.rows = result.fileStorageObjects.rows.concat(rows);
    }
  });

  // Fallback: if we didn't find named blocks, treat second table as data storage and third as file (if any)
  if (result.dataStorageObjects.rows.length === 0 && tables.length >= 2) {
    const t2 = tables[1];
    const hr2 = t2.querySelector('tr.headerRow, thead tr');
    if (hr2) {
      result.dataStorageObjects.headers = Array.from(hr2.querySelectorAll('th, td')).map(c => c.textContent.trim());
    }
    t2.querySelectorAll('tr.dataRow').forEach(row => {
      const cells = row.querySelectorAll('th, td');
      const rowData = Array.from(cells).map(c => (c.querySelector('span') || c).textContent.trim());
      if (rowData.some(c => c.length > 0)) result.dataStorageObjects.rows.push(rowData);
    });
  }
  if (result.fileStorageObjects.rows.length === 0 && tables.length >= 3) {
    const t3 = tables[2];
    const hr3 = t3.querySelector('tr.headerRow, thead tr');
    if (hr3) {
      result.fileStorageObjects.headers = Array.from(hr3.querySelectorAll('th, td')).map(c => c.textContent.trim());
    }
    t3.querySelectorAll('tr.dataRow').forEach(row => {
      const cells = row.querySelectorAll('th, td');
      const rowData = Array.from(cells).map(c => (c.querySelector('span') || c).textContent.trim());
      if (rowData.some(c => c.length > 0)) result.fileStorageObjects.rows.push(rowData);
    });
  }

  return result;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageModule;
}
