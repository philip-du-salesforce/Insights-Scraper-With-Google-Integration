/**
 * Health Check Module
 * Scrapes Salesforce Health Check data including security settings
 */

class HealthCheckModule extends BaseModule {
  constructor() {
    super('Health Check', 'Perform system health checks and extract security settings');
  }

  async scrape(context) {
    console.log('[HealthCheckModule] Starting health check scraping...');
    
    return new Promise(async (resolve, reject) => {
      let tab;
      let timeout;
      const self = this;
      
      try {
        // Get the active tab (where the user is)
        tab = await chrome.tabs.get(context.tabId);
        
        // Set a timeout (increased to account for wait time: 60s checks + 30s data load + 30s buffer)
        timeout = setTimeout(() => {
          reject(new Error('Timeout: Health Check operation took too long (exceeded 150 seconds)'));
        }, 150000); // 150 second timeout

        // Step 1: Search for "Health Check"
        console.log('[HealthCheckModule] Step 1: Searching for Health Check...');
        const searchResult = await chrome.scripting.executeScript({
          target: { tabId: context.tabId },
          func: searchFunc,
          args: ['Health Check']
        });

        if (!searchResult?.[0]?.result?.success) {
          clearTimeout(timeout);
          reject(new Error('Failed to search for Health Check: ' + (searchResult?.[0]?.result?.error || 'Unknown error')));
          return;
        }

        // Step 2: Wait 2 seconds
        console.log('[HealthCheckModule] Step 2: Waiting 2 seconds...');
        await self.delay(2000);

        // Step 3: Click on Health Check link
        console.log('[HealthCheckModule] Step 3: Clicking Health Check link...');
        const clickResult = await chrome.scripting.executeScript({
          target: { tabId: context.tabId },
          func: clickHealthCheckLinkFunc
        });

        if (!clickResult?.[0]?.result?.success) {
          clearTimeout(timeout);
          reject(new Error('Failed to click Health Check link: ' + (clickResult?.[0]?.result?.error || 'Unknown error')));
          return;
        }

        // Step 4: Wait for page to load, then wait for tables to appear
        const INITIAL_PAGE_LOAD_MS = 12000; // Health Check page can take ~10s to load
        console.log(`[HealthCheckModule] Step 4: Waiting ${INITIAL_PAGE_LOAD_MS / 1000}s for Health Check page to load...`);
        await self.delay(INITIAL_PAGE_LOAD_MS);

        // Now check for tables (with retries)
        console.log('[HealthCheckModule] Checking for tables...');
        let tablesFound = false;
        let retryCount = 0;
        const maxRetries = 6; // 6 * 5s = 30s max after initial wait (avoids long stall if tables never appear)

        while (!tablesFound && retryCount < maxRetries) {
          retryCount++;
          console.log(`[HealthCheckModule] Table check (attempt ${retryCount}/${maxRetries})...`);
          
          const checkResult = await chrome.scripting.executeScript({
            target: { tabId: context.tabId },
            func: checkHealthCheckTablesReadyFunc
          });
          
          if (checkResult?.[0]?.result?.ready) {
            tablesFound = true;
            console.log(`[HealthCheckModule] Tables found`);
            break;
          }
          console.log(`[HealthCheckModule] Tables not ready (found: ${checkResult?.[0]?.result?.found || 0}), waiting 5s before retry...`);
          if (retryCount < maxRetries) await self.delay(5000);
        }
        
        if (!tablesFound) {
          console.warn('[HealthCheckModule] Tables not found after waiting, proceeding anyway...');
        } else {
          // Step 4b: Try to expand all collapsible sections (Lightning) so rows are in the DOM
          console.log('[HealthCheckModule] Attempting to expand all sections...');
          await chrome.scripting.executeScript({
            target: { tabId: context.tabId },
            func: expandHealthCheckSectionsFunc
          });
          await self.delay(2000);
          // Step 4c: Short wait for data to settle (was 30s; 8s is enough)
          console.log('[HealthCheckModule] Waiting 8 seconds for data to load...');
          await self.delay(8000);
        }

        // Step 5: Scrape (with retry if we get 0% and no rows - page may not have finished loading)
        const SCRAPE_TIMEOUT_MS = 75000;
        const MAX_SCRAPE_ATTEMPTS = 3;
        const RETRY_WAIT_MS = 10000; // 10s wait before retry

        function looksLikeNoData(data) {
          if (!data) return true;
          const pct = (data.percentage || '').toString().trim();
          const totalSettings = (data.settings && data.settings.length) || 0;
          const hasRows = totalSettings > 0 || (data.highRisk && data.highRisk.length) || (data.mediumRisk && data.mediumRisk.length);
          return (pct === '0%' || pct === 'N/A' || !pct) && !hasRows;
        }

        let healthCheckData = null;
        for (let attempt = 1; attempt <= MAX_SCRAPE_ATTEMPTS; attempt++) {
          console.log(`[HealthCheckModule] Step 5: Scraping health check data (attempt ${attempt}/${MAX_SCRAPE_ATTEMPTS})...`);
          const dataResult = await Promise.race([
            chrome.scripting.executeScript({
              target: { tabId: context.tabId },
              func: scrapeHealthCheckDataFunc
            }),
            new Promise((_, rej) =>
              setTimeout(() => rej(new Error('Health Check scrape timed out after 75s (page may be too large)')), SCRAPE_TIMEOUT_MS)
            )
          ]);

          healthCheckData = dataResult?.[0]?.result;
          if (!healthCheckData) {
            clearTimeout(timeout);
            console.error('[HealthCheckModule] No data returned from scraping function');
            reject(new Error('Failed to scrape health check data - no data returned'));
            return;
          }

          if (healthCheckData.error && (!healthCheckData.settings || healthCheckData.settings.length === 0)) {
            clearTimeout(timeout);
            reject(new Error(`Health check scraping error: ${healthCheckData.error}`));
            return;
          }

          if (!looksLikeNoData(healthCheckData)) {
            console.log('[HealthCheckModule] Got valid data:', healthCheckData.percentage, 'settings:', healthCheckData.settings?.length || 0);
            break;
          }

          console.warn('[HealthCheckModule] Got 0% / no rows - page may still be loading');
          if (attempt < MAX_SCRAPE_ATTEMPTS) {
            console.log(`[HealthCheckModule] Waiting ${RETRY_WAIT_MS / 1000}s before retry...`);
            await self.delay(RETRY_WAIT_MS);
          }
        }

        console.log('[HealthCheckModule] Successfully scraped health check data');
        console.log('[HealthCheckModule] Percentage:', healthCheckData.percentage);
        console.log('[HealthCheckModule] Total settings:', healthCheckData.settings?.length || 0);

        clearTimeout(timeout);
        resolve(healthCheckData);

      } catch (error) {
        console.error('[HealthCheckModule] Error:', error);
        if (timeout) clearTimeout(timeout);
        reject(error);
      }
    });
  }

  formatData(data) {
    let output = '';

    output += 'HEALTH CHECK REPORT\n';
    output += `Generated: ${new Date().toLocaleString()}\n`;
    output += `Health Check Score: ${data.percentage || 'N/A'}\n`;
    output += '\n';

    const headerRow = 'STATUS\tSETTING\tGROUP\tYOUR VALUE\tSTANDARD VALUE\n';
    const rowToLine = (s) => `${s.status || 'N/A'}\t${s.setting || 'N/A'}\t${s.group || 'N/A'}\t${s.yourValue || 'N/A'}\t${s.standardValue || 'N/A'}\n`;

    if (data.tables && data.tables.length > 0) {
      data.tables.forEach((table) => {
        output += '='.repeat(100) + '\n';
        output += (table.title || 'Security Settings').toUpperCase() + '\n';
        output += '='.repeat(100) + '\n';
        output += '\n';
        output += headerRow;
        (table.settings || []).forEach(setting => { output += rowToLine(setting); });
        output += '\n';
      });
    } else {
      const sections = [
        { key: 'highRisk', title: 'HIGH-RISK SECURITY SETTINGS' },
        { key: 'mediumRisk', title: 'MEDIUM-RISK SECURITY SETTINGS' },
        { key: 'lowRisk', title: 'LOW-RISK SECURITY SETTINGS' },
        { key: 'informational', title: 'INFORMATIONAL SECURITY SETTINGS' }
      ];
      sections.forEach(({ key, title }) => {
        const rows = data[key] || [];
        output += '='.repeat(100) + '\n';
        output += title + '\n';
        output += '='.repeat(100) + '\n';
        output += '\n';
        output += headerRow;
        rows.forEach(setting => { output += rowToLine(setting); });
        output += '\n';
      });
    }

    return output;
  }

  getJsonPayload(data) {
    return {
      percentage: data.percentage || 'N/A',
      highRisk: data.highRisk || [],
      mediumRisk: data.mediumRisk || [],
      lowRisk: data.lowRisk || [],
      informational: data.informational || []
    };
  }

  /**
   * Get filename for the output
   */
  getFilename() {
    return '4_health_check';
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// STANDALONE FUNCTIONS FOR INJECTION
// These must be outside the class for chrome.scripting.executeScript to work
// ============================================================================

/**
 * Reusable search function
 * Finds the search box and enters the search text
 * @param {string} searchText - Text to search for
 * @returns {Object} - {success: boolean, error?: string}
 */
function searchFunc(searchText) {
  try {
    console.log('[searchFunc] Looking for search box container...');
    
    // Find the search box container
    const searchContainer = document.querySelector('.searchBoxContainer');
    if (!searchContainer) {
      console.error('[searchFunc] Search box container not found');
      return { success: false, error: 'Search box container not found' };
    }

    // Find the input field within the container
    const searchInput = searchContainer.querySelector('input[type="text"], input[type="search"], input');
    if (!searchInput) {
      console.error('[searchFunc] Search input not found');
      return { success: false, error: 'Search input not found' };
    }

    console.log('[searchFunc] Found search input, entering text:', searchText);
    
    // Clear existing value and set new value
    searchInput.value = '';
    searchInput.value = searchText;
    
    // Trigger input events to ensure the search is registered
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    searchInput.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Try to submit the form or trigger search
    const form = searchInput.closest('form');
    if (form) {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
    
    // Also try pressing Enter key
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    searchInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }));
    searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));

    console.log('[searchFunc] Search completed successfully');
    return { success: true };
    
  } catch (error) {
    console.error('[searchFunc] Error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Click on the Health Check link (Classic Setup or Lightning)
 * @returns {Object} - {success: boolean, error?: string}
 */
function clickHealthCheckLinkFunc() {
  try {
    console.log('[clickHealthCheckLinkFunc] Looking for Health Check link...');

    // Classic Setup: link with id=HealthCheck_font
    let healthCheckLink = document.getElementById('HealthCheck_font');
    if (healthCheckLink) {
      healthCheckLink.click();
      return { success: true };
    }

    // Lightning / search result: link or span containing "Health Check"
    const allClickables = document.querySelectorAll('a, button, [role="button"], span[class*="label"], div[class*="title"]');
    for (const el of allClickables) {
      const text = (el.textContent || '').trim();
      if (text === 'Health Check' || (text.toLowerCase().includes('health') && text.toLowerCase().includes('check'))) {
        el.click();
        return { success: true };
      }
    }

    return { success: false, error: 'Health Check link not found (tried Classic id and Lightning search)' };
  } catch (error) {
    console.error('[clickHealthCheckLinkFunc] Error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Expand all collapsible sections on Health Check page (Lightning) so table rows are in the DOM.
 * Self-contained (no dependency on getAllRoots/getTextContent) for injection.
 */
function expandHealthCheckSectionsFunc() {
  try {
    const sectionLabels = ['High-Risk', 'Medium-Risk', 'Low-Risk', 'Informational'];
    const candidates = document.querySelectorAll('button, [role="button"], a, div[class*="accordion"], div[class*="section"], div[class*="header"]');
    let expanded = 0;
    candidates.forEach((el) => {
      const text = (el.textContent || '').trim();
      const match = sectionLabels.some((label) => text.includes(label));
      if (match && el.offsetParent !== null) {
        try {
          el.click();
          expanded++;
        } catch (e) { /* ignore */ }
      }
    });
    if (typeof console !== 'undefined' && console.log) {
      console.log('[expandHealthCheckSectionsFunc] Expanded', expanded, 'sections');
    }
  } catch (error) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('[expandHealthCheckSectionsFunc] Error:', error);
    }
  }
}

/**
 * Collect all document roots (document + shadow roots) for Lightning/Aura DOM
 * @returns {Array<Document|ShadowRoot>}
 */
function getAllRoots() {
  const roots = [document];
  function walk(el) {
    if (el.shadowRoot) {
      roots.push(el.shadowRoot);
      walk(el.shadowRoot);
      el.shadowRoot.querySelectorAll('*').forEach(walk);
    }
  }
  try {
    document.querySelectorAll('*').forEach(walk);
  } catch (e) { /* Locker may restrict some access */ }
  return roots;
}

/**
 * Get all elements matching selector from document and all shadow roots
 * @param {string} selector
 * @returns {Array<Element>}
 */
function queryAllIncludingShadow(selector) {
  const out = [];
  getAllRoots().forEach((root) => {
    try {
      root.querySelectorAll(selector).forEach((el) => out.push(el));
    } catch (e) { /* ignore */ }
  });
  return out;
}

/**
 * Get text content of an element (including shadow descendants)
 * @param {Element} el
 * @returns {string}
 */
function getTextContent(el) {
  if (!el) return '';
  return (el.innerText || el.textContent || '').trim();
}

/**
 * Check if a table has Health Check columns (STATUS, SETTING, GROUP, YOUR VALUE, STANDARD VALUE)
 * @param {HTMLTableElement} table
 * @returns {Object|null} columnMap or null
 */
function getHealthCheckColumnMap(table) {
  const headerRow = table.querySelector('thead tr, tr:first-child');
  if (!headerRow) return null;
  const headers = Array.from(headerRow.querySelectorAll('th, td'));
  const columnMap = {};
  headers.forEach((header, index) => {
    const t = getTextContent(header).toUpperCase();
    if (t.includes('STATUS')) columnMap.status = index;
    if (t.includes('SETTING')) columnMap.setting = index;
    if (t.includes('GROUP')) columnMap.group = index;
    if (t.includes('YOUR VALUE')) columnMap.yourValue = index;
    if (t.includes('STANDARD VALUE')) columnMap.standardValue = index;
  });
  const hasAll = columnMap.setting !== undefined && (columnMap.yourValue !== undefined || columnMap.standardValue !== undefined);
  return hasAll ? columnMap : null;
}

/**
 * Find section title (High-Risk, Medium-Risk, Low-Risk, Informational) for an element by walking up
 * @param {Element} el
 * @returns {string}
 */
function findSectionTitleForElement(el) {
  let node = el;
  for (let i = 0; i < 30 && node; i++) {
    const text = getTextContent(node);
    const lower = text.toLowerCase();
    if (lower.includes('high') && lower.includes('risk')) return 'High-Risk Security Settings';
    if (lower.includes('medium') && lower.includes('risk')) return 'Medium-Risk Security Settings';
    if (lower.includes('low') && lower.includes('risk')) return 'Low-Risk Security Settings';
    if (lower.includes('informational')) return 'Informational Security Settings';
    node = node.parentElement || node.host;
  }
  return '';
}

/**
 * Check if Health Check tables are ready on the page (classic or Lightning).
 * Self-contained for injection: uses document + shadow DOM and inline header check.
 * @returns {Object} - {ready: boolean, found: number}
 */
function checkHealthCheckTablesReadyFunc() {
  try {
    function hasHealthCheckHeader(table) {
      var headerRow = table.querySelector('thead tr') || table.querySelector('tr:first-child');
      if (!headerRow) return false;
      var headers = Array.from(headerRow.querySelectorAll('th, td'));
      var hasSetting = false, hasValue = false;
      for (var hi = 0; hi < headers.length; hi++) {
        var t = (headers[hi].textContent || '').trim().toUpperCase();
        if (t.indexOf('SETTING') !== -1) hasSetting = true;
        if (t.indexOf('YOUR VALUE') !== -1 || t.indexOf('STANDARD VALUE') !== -1) hasValue = true;
      }
      return hasSetting && hasValue;
    }
    function countTablesInRoot(root) {
      var n = 0;
      try {
        var tables = root.querySelectorAll('table');
        for (var t = 0; t < tables.length; t++) {
          if (hasHealthCheckHeader(tables[t])) n++;
        }
      } catch (e) {}
      return n;
    }
    function getRootsBoundedLocal(maxRoots, maxDepth) {
      var roots = [document];
      var count = 1;
      function walk(el, depth) {
        if (count >= maxRoots || depth >= maxDepth) return;
        if (!el.shadowRoot) return;
        roots.push(el.shadowRoot);
        count++;
        try {
          var nodes = el.shadowRoot.querySelectorAll('*');
          for (var i = 0; i < nodes.length && count < maxRoots; i++) walk(nodes[i], depth + 1);
        } catch (e) {}
      }
      try {
        var all = document.querySelectorAll('*');
        for (var j = 0; j < all.length && count < maxRoots; j++) walk(all[j], 0);
      } catch (e) {}
      return roots;
    }
    var percentageDiv = document.querySelector('.standardPercentageNumber, div.standardPercentageNumber');
    var classicTables = document.querySelectorAll('.securityHealthRelatedListCard, table.securityHealthRelatedListCard, table[class*="security"], table[class*="health"], table.list, table.uiDataGrid, table[class*="uiDataGrid"]');
    var healthCheckTableCount = countTablesInRoot(document);
    try {
      var iframes = document.querySelectorAll('iframe');
      for (var fi = 0; fi < iframes.length; fi++) {
        try {
          var doc = iframes[fi].contentDocument;
          if (doc) healthCheckTableCount += countTablesInRoot(doc);
        } catch (e) {}
      }
    } catch (e) {}
    getRootsBoundedLocal(80, 3).forEach(function (root) {
      healthCheckTableCount += countTablesInRoot(root);
    });
    var totalTables = Math.max(classicTables.length, healthCheckTableCount);
    var ready = totalTables > 0 || percentageDiv !== null || healthCheckTableCount > 0;
    return { ready: ready, found: totalTables, hasPercentage: percentageDiv !== null };
  } catch (error) {
    return { ready: false, found: 0, error: error && error.message ? error.message : String(error) };
  }
}

/**
 * Scrape Health Check data from the page, segmented by risk level.
 * Works for both Classic Setup and Lightning Security Health Check (Aura).
 * Self-contained so all helpers are inlined for chrome.scripting.executeScript injection.
 * @returns {Object} - { percentage, highRisk, mediumRisk, lowRisk, informational, settings, tables }
 */
function scrapeHealthCheckDataFunc() {
  function getText(el) {
    if (!el) return '';
    return (el.innerText || el.textContent || '').trim();
  }
  // Bounded shadow-DOM walk so we never hang on huge pages (max roots, max depth)
  function getRootsBounded(maxRoots, maxDepth) {
    var roots = [document];
    var count = 1;
    function walk(el, depth) {
      if (count >= maxRoots || depth >= maxDepth) return;
      if (!el.shadowRoot) return;
      roots.push(el.shadowRoot);
      count++;
      try {
        var nodes = el.shadowRoot.querySelectorAll('*');
        for (var i = 0; i < nodes.length && count < maxRoots; i++) walk(nodes[i], depth + 1);
      } catch (e) {}
    }
    try {
      var all = document.querySelectorAll('*');
      for (var j = 0; j < all.length && count < maxRoots; j++) walk(all[j], 0);
    } catch (e) {}
    return roots;
  }
  function collectAllTables() {
    var seen = new Set();
    var out = [];
    function addTables(root) {
      if (!root || !root.querySelectorAll) return;
      try {
        var tables = root.querySelectorAll('table');
        for (var i = 0; i < tables.length; i++) {
          if (!seen.has(tables[i])) {
            seen.add(tables[i]);
            out.push(tables[i]);
          }
        }
      } catch (e) {}
    }
    addTables(document);
    try {
      var iframes = document.querySelectorAll('iframe');
      for (var f = 0; f < iframes.length; f++) {
        try {
          var doc = iframes[f].contentDocument;
          if (doc) addTables(doc);
        } catch (e) {}
      }
    } catch (e) {}
    var roots = getRootsBounded(80, 3);
    for (var r = 1; r < roots.length; r++) addTables(roots[r]);
    return out;
  }
  function queryAllIncludingShadow(selector) {
    var out = [];
    var docTables = document.querySelectorAll(selector);
    for (var i = 0; i < docTables.length; i++) out.push(docTables[i]);
    var roots = getRootsBounded(80, 3);
    for (var r = 1; r < roots.length; r++) {
      try {
        var list = roots[r].querySelectorAll(selector);
        for (var k = 0; k < list.length; k++) out.push(list[k]);
      } catch (e) {}
    }
    return out;
  }
  function getColumnMap(table) {
    var headerRow = table.querySelector('thead tr');
    if (!headerRow) headerRow = table.querySelector('tr:first-child');
    if (!headerRow) return null;
    var headerCells = Array.from(headerRow.querySelectorAll('th, td'));
    var columnMap = {};
    for (var i = 0; i < headerCells.length; i++) {
      var t = getText(headerCells[i]).toUpperCase();
      if (t.indexOf('STATUS') !== -1) columnMap.status = i;
      if (t.indexOf('SETTING') !== -1) columnMap.setting = i;
      if (t.indexOf('GROUP') !== -1) columnMap.group = i;
      if (t.indexOf('YOUR VALUE') !== -1) columnMap.yourValue = i;
      if (t.indexOf('STANDARD VALUE') !== -1) columnMap.standardValue = i;
    }
    var hasAll = columnMap.setting !== undefined && (columnMap.yourValue !== undefined || columnMap.standardValue !== undefined);
    if (hasAll) return columnMap;
    return null;
  }
  function findSectionTitle(el) {
    var node = el;
    for (var i = 0; i < 30 && node; i++) {
      var text = getText(node);
      var lower = text.toLowerCase();
      if (lower.indexOf('high') !== -1 && lower.indexOf('risk') !== -1) return 'High-Risk Security Settings';
      if (lower.indexOf('medium') !== -1 && lower.indexOf('risk') !== -1) return 'Medium-Risk Security Settings';
      if (lower.indexOf('low') !== -1 && lower.indexOf('risk') !== -1) return 'Low-Risk Security Settings';
      if (lower.indexOf('informational') !== -1) return 'Informational Security Settings';
      node = node.parentElement || node.host;
    }
    return '';
  }
  function parseRows(table, columnMap, headerRow) {
    var rows = [];
    var dataRows = table.querySelectorAll('tbody tr');
    if (!dataRows.length) dataRows = table.querySelectorAll('tr');
    for (var i = 0; i < dataRows.length; i++) {
      var row = dataRows[i];
      if (row === headerRow || row.classList.contains('headerRow')) continue;
      var cells = Array.from(row.querySelectorAll('td, th'));
      if (cells.length === 0) continue;
      var setting = {
        status: columnMap.status !== undefined ? getText(cells[columnMap.status]) : '',
        setting: columnMap.setting !== undefined ? getText(cells[columnMap.setting]) : '',
        group: columnMap.group !== undefined ? getText(cells[columnMap.group]) : '',
        yourValue: columnMap.yourValue !== undefined ? getText(cells[columnMap.yourValue]) : '',
        standardValue: columnMap.standardValue !== undefined ? getText(cells[columnMap.standardValue]) : ''
      };
      if (setting.setting || setting.status) rows.push(setting);
    }
    return rows;
  }

  /** Original working logic: classic Salesforce selectors + tr.dataRow + title from DOM */
  function scrapeWithOriginalSelectors(root) {
    root = root || document;
    var tables = root.querySelectorAll('.securityHealthRelatedListCard, table.securityHealthRelatedListCard');
    if (!tables.length) tables = root.querySelectorAll('table[class*="security"], table[class*="health"], table.list, table.uiDataGrid, table[class*="uiDataGrid"]');
    if (!tables.length) return null;
    var pairs = [];
    for (var ti = 0; ti < tables.length; ti++) {
      var table = tables[ti];
      var headerRow = table.querySelector('thead tr, tr.headerRow, tr:first-child');
      if (!headerRow) continue;
      var headers = Array.from(headerRow.querySelectorAll('th, td'));
      var columnMap = {};
      for (var hi = 0; hi < headers.length; hi++) {
        var t = getText(headers[hi]).toUpperCase();
        if (t.indexOf('STATUS') !== -1) columnMap.status = hi;
        if (t.indexOf('SETTING') !== -1) columnMap.setting = hi;
        if (t.indexOf('GROUP') !== -1) columnMap.group = hi;
        if (t.indexOf('YOUR VALUE') !== -1) columnMap.yourValue = hi;
        if (t.indexOf('STANDARD VALUE') !== -1) columnMap.standardValue = hi;
      }
      if (columnMap.setting === undefined || (columnMap.yourValue === undefined && columnMap.standardValue === undefined)) continue;
      var title = '';
      var titleEl = table.previousElementSibling;
      while (titleEl && !getText(titleEl)) titleEl = titleEl.previousElementSibling;
      if (titleEl && (titleEl.tagName === 'H3' || titleEl.tagName === 'H2' || titleEl.classList.contains('pbTitle'))) title = getText(titleEl);
      if (!title) {
        var container = table.closest && table.closest('.pbBody, .securityHealthRelatedList');
        if (container) {
          var heading = container.querySelector('h3, h2, .pbTitle');
          if (heading) title = getText(heading);
        }
      }
      if (!title) title = 'Security Settings Group ' + (ti + 1);
      var dataRows = table.querySelectorAll('tbody tr, tr.dataRow, tr:not(.headerRow):not(:first-child)');
      var settings = [];
      for (var ri = 0; ri < dataRows.length; ri++) {
        var row = dataRows[ri];
        if (row.classList.contains('headerRow')) continue;
        var cells = Array.from(row.querySelectorAll('td, th'));
        if (cells.length === 0) continue;
        var setting = {
          status: columnMap.status !== undefined ? getText(cells[columnMap.status]) : '',
          setting: columnMap.setting !== undefined ? getText(cells[columnMap.setting]) : '',
          group: columnMap.group !== undefined ? getText(cells[columnMap.group]) : '',
          yourValue: columnMap.yourValue !== undefined ? getText(cells[columnMap.yourValue]) : '',
          standardValue: columnMap.standardValue !== undefined ? getText(cells[columnMap.standardValue]) : ''
        };
        if (setting.setting || setting.status) settings.push(setting);
      }
      pairs.push({ title: title, settings: settings });
    }
    return pairs.length ? pairs : null;
  }

  try {
    const result = {
      percentage: 'N/A',
      highRisk: [],
      mediumRisk: [],
      lowRisk: [],
      informational: [],
      settings: [],
      tables: []
    };

    function findPercentageInRoot(root) {
      if (!root) return null;
      try {
        var div = root.querySelector && root.querySelector('.standardPercentageNumber, div.standardPercentageNumber');
        if (div) return getText(div);
        var body = root.body || root;
        var text = (body.innerText || body.textContent || '').toString();
        var m = text.match(/\d+%\s*(?:Very Poor|Poor|Fair|Good|Very Good)?/i) || text.match(/\d+%/);
        return m ? m[0].trim() : null;
      } catch (e) { return null; }
    }
    result.percentage = findPercentageInRoot(document) || 'N/A';
    if (result.percentage === 'N/A') {
      try {
        var iframes = document.querySelectorAll('iframe');
        for (var fi = 0; fi < iframes.length; fi++) {
          try {
            var doc = iframes[fi].contentDocument;
            if (doc) {
              var pct = findPercentageInRoot(doc);
              if (pct) { result.percentage = pct; break; }
            }
          } catch (e) {}
        }
      } catch (e) {}
    }
    if (result.percentage === 'N/A') {
      getRootsBounded(80, 3).forEach(function (root) {
        if (result.percentage !== 'N/A') return;
        var pct = findPercentageInRoot(root);
        if (pct) result.percentage = pct;
      });
    }

    var sectionTablePairs = [];
    var originalPairs = scrapeWithOriginalSelectors(document);
    if (!originalPairs) {
      try {
        var iframes = document.querySelectorAll('iframe');
        for (var fi = 0; fi < iframes.length; fi++) {
          try {
            var doc = iframes[fi].contentDocument;
            if (doc) originalPairs = scrapeWithOriginalSelectors(doc);
            if (originalPairs && originalPairs.length) break;
          } catch (e) {}
        }
      } catch (e) {}
    }
    if (originalPairs && originalPairs.length > 0 && originalPairs.some(function (p) { return p.settings.length > 0; })) {
      sectionTablePairs = originalPairs;
    } else {
      var allTables = collectAllTables();
      allTables.forEach(function (table) {
        var columnMap = getColumnMap(table);
        if (!columnMap) return;
        var headerRow = table.querySelector('thead tr, tr:first-child');
        var sectionTitle = findSectionTitle(table);
        var settings = parseRows(table, columnMap, headerRow);
        if (settings.length > 0 || sectionTitle) {
          sectionTablePairs.push({ title: sectionTitle || 'Security Settings', settings: settings });
        }
      });
    }

    sectionTablePairs.forEach(function (pair) {
      var title = pair.title;
      var settings = pair.settings;
      var titleLower = title.toLowerCase();
      if (titleLower.indexOf('high') !== -1 && titleLower.indexOf('risk') !== -1) {
        result.highRisk = result.highRisk.concat(settings);
      } else if (titleLower.indexOf('medium') !== -1 && titleLower.indexOf('risk') !== -1) {
        result.mediumRisk = result.mediumRisk.concat(settings);
      } else if (titleLower.indexOf('low') !== -1 && titleLower.indexOf('risk') !== -1) {
        result.lowRisk = result.lowRisk.concat(settings);
      } else if (titleLower.indexOf('informational') !== -1) {
        result.informational = result.informational.concat(settings);
      }
      result.settings = result.settings.concat(settings);
      result.tables.push({ title: title, settings: settings });
    });

    if (result.settings.length > 0 && result.highRisk.length === 0 && result.mediumRisk.length === 0 && result.lowRisk.length === 0 && result.informational.length === 0) {
      result.highRisk = result.settings;
    }

    return result;
  } catch (error) {
    return {
      percentage: 'Error',
      highRisk: [],
      mediumRisk: [],
      lowRisk: [],
      informational: [],
      settings: [],
      tables: [],
      error: error && error.message ? error.message : String(error)
    };
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = HealthCheckModule;
}
