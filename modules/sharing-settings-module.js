/**
 * Sharing Settings Module
 * Scrapes Organization-Wide Defaults from Setup > Security > Sharing Settings
 */

class SharingSettingsModule extends BaseModule {
  constructor() {
    super('Sharing Settings', 'Extract Organization-Wide Defaults (Object, Internal/External Access)');
  }

  async initialize() {
    await super.initialize();
  }

  async validate() {
    return { valid: true };
  }

  async scrape(context) {
    console.log('[SharingSettingsModule] Starting sharing settings scrape...');

    // Step 1: Navigate to Sharing Settings
    try {
      const searchResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: searchFunc,
        args: ['Sharing Settings']
      });
      if (!searchResult[0]?.result?.success) {
        throw new Error(`Search failed: ${searchResult[0]?.result?.error || 'Unknown error'}`);
      }
      await this.delay(2000);

      const clickResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: clickSharingSettingsLinkFunc
      });
      if (!clickResult[0]?.result?.success) {
        throw new Error(`Failed to open Sharing Settings: ${clickResult[0]?.result?.error || 'Unknown error'}`);
      }

      await this.delay(8000);
    } catch (err) {
      console.error('[SharingSettingsModule] Navigation error:', err);
      throw new Error(`Failed to navigate to Sharing Settings: ${err.message}`);
    }

    const dataResult = await chrome.scripting.executeScript({
      target: { tabId: context.tabId },
      func: scrapeOrganizationWideDefaultsFunc
    });

    const data = dataResult?.[0]?.result || { rows: [], error: null };
    if (data.error) console.warn('[SharingSettingsModule] Scrape warning:', data.error);
    return data;
  }

  formatData(data) {
    let output = '';
    output += 'SHARING SETTINGS REPORT\n';
    output += `Generated: ${new Date().toLocaleString()}\n`;
    output += 'Source: Setup > Security > Sharing Settings > Organization-Wide Defaults\n';
    output += '\n';

    output += '='.repeat(100) + '\n';
    output += 'ORGANIZATION-WIDE DEFAULTS\n';
    output += '='.repeat(100) + '\n';
    output += '\n';
    output += 'Object\tDefault Internal Access\tDefault External Access\n';

    (data.rows || []).forEach(row => {
      output += `${row.object || ''}\t${row.defaultInternalAccess || ''}\t${row.defaultExternalAccess || ''}\n`;
    });

    return output;
  }

  getJsonPayload(data) {
    return { rows: data.rows || [] };
  }

  getFilename() {
    return '7_sharing_settings';
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Click Sharing Settings link under Security Controls (same category as Health Check).
 * Used after searching "security" so only Security Controls results (Health Check, Sharing Settings) are shown.
 */
function clickSharingSettingsLinkFunc() {
  try {
    // 1. Classic Setup: exact element id for Security > Sharing Settings
    const classicLink = document.querySelector('a#SharingSettings_font');
    if (classicLink) {
      classicLink.click();
      return { success: true };
    }

    // 2. After "security" search: clickable with exact text "Sharing Settings"
    const allClickables = document.querySelectorAll('a, button, [role="button"], span[class*="label"], div[class*="title"]');
    for (const el of allClickables) {
      const text = (el.textContent || '').trim();
      if (text === 'Sharing Settings') {
        el.click();
        return { success: true };
      }
    }

    // 3. Fallback: link with href SharingSettings but NOT Analytics (Report/Dashboard Folder Sharing)
    for (const a of document.querySelectorAll('a[href*="SharingSettings"]')) {
      const href = (a.getAttribute('href') || '').toLowerCase();
      if (href.includes('analytics')) continue;
      a.click();
      return { success: true };
    }

    return { success: false, error: 'Sharing Settings link not found (search for "security" then click Sharing Settings under Security Controls)' };
  } catch (error) {
    return { success: false, error: (error && error.message) || String(error) };
  }
}

/**
 * Find "Organization-Wide Defaults" table and scrape Object, Default Internal Access, Default External Access
 */
function scrapeOrganizationWideDefaultsFunc() {
  const result = { rows: [], error: null };

  const allBlocks = document.querySelectorAll('div.bPageBlock, div.pbBody, section');
  let targetTable = null;

  for (const block of allBlocks) {
    const heading = block.querySelector('h2, h3, .pbTitle, [class*="title"]');
    const title = heading ? heading.textContent.trim() : '';
    if (!title) continue;
    if (title.toLowerCase().includes('organization-wide default') || title.toLowerCase().includes('org-wide default')) {
      targetTable = block.querySelector('table.list, table[class*="list"]');
      if (targetTable) break;
    }
  }

  if (!targetTable) {
    const tables = document.querySelectorAll('table.list');
    for (const table of tables) {
      let prev = table.closest('div.bPageBlock');
      if (!prev) prev = table.parentElement;
      const h = prev ? prev.querySelector('h2, h3, .pbTitle') : null;
      const t = h ? h.textContent.trim().toLowerCase() : '';
      if (t.includes('organization-wide') || t.includes('org-wide default')) {
        targetTable = table;
        break;
      }
    }
  }

  if (!targetTable) {
    result.error = 'Organization-Wide Defaults table not found';
    return result;
  }

  const headerRow = targetTable.querySelector('tr.headerRow, thead tr, tr:first-child');
  if (!headerRow) {
    result.error = 'No header row in Organization-Wide Defaults table';
    return result;
  }

  const headers = Array.from(headerRow.querySelectorAll('th, td')).map(c => c.textContent.trim().toLowerCase());
  let colObject = headers.findIndex(h => h.includes('object') && !h.includes('access'));
  if (colObject < 0) colObject = headers.findIndex(h => h === 'object' || h.includes('object name'));
  if (colObject < 0) colObject = 0;

  let colInternal = headers.findIndex(h => h.includes('internal') && h.includes('access'));
  if (colInternal < 0) colInternal = headers.findIndex(h => h.includes('default internal'));
  if (colInternal < 0) colInternal = 1;

  let colExternal = headers.findIndex(h => h.includes('external') && h.includes('access'));
  if (colExternal < 0) colExternal = headers.findIndex(h => h.includes('default external'));
  if (colExternal < 0) colExternal = 2;

  const dataRows = targetTable.querySelectorAll('tr.dataRow, tbody tr:not(.headerRow)');
  dataRows.forEach(row => {
    if (row.classList.contains('headerRow')) return;
    const cells = Array.from(row.querySelectorAll('td, th'));
    const obj = (cells[colObject]?.textContent || '').trim();
    const internal = (cells[colInternal]?.textContent || '').trim();
    const external = (cells[colExternal]?.textContent || '').trim();
    if (obj || internal || external) {
      result.rows.push({
        object: obj,
        defaultInternalAccess: internal,
        defaultExternalAccess: external
      });
    }
  });

  return result;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SharingSettingsModule;
}
