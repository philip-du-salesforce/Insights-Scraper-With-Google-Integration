/**
 * Licenses Module
 * Scrapes user license information from Company Information
 */

class LicensesModule extends BaseModule {
  constructor() {
    super('Licenses', 'Extract user license information');
  }

  /**
   * Initialize the module
   */
  async initialize() {
    await super.initialize();
  }

  /**
   * Validate if the module can run
   */
  async validate() {
    return { valid: true };
  }

  /**
   * Main scraping method
   * @param {Object} context - Contains tabId, customerName, progressCallback, etc.
   */
  async scrape(context) {
    console.log('[LicensesModule] Starting licenses scraping...');

    // Step 1: Navigate to Company Information page
    console.log('[LicensesModule] Step 1: Navigating to Company Information page...');
    try {
      // Search for "Company Information"
      console.log('[LicensesModule] Searching for "Company Information"...');
      const searchResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: searchFunc,
        args: ['Company Information']
      });
      
      if (!searchResult[0]?.result?.success) {
        throw new Error(`Search failed: ${searchResult[0]?.result?.error || 'Unknown error'}`);
      }

      // Wait for search results to appear
      console.log('[LicensesModule] Waiting for search results...');
      await this.delay(2000);

      // Click on the Company Information link (id="CompanyProfileInfo_font")
      console.log('[LicensesModule] Clicking on Company Information link...');
      const clickResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: clickElementFunc,
        args: ['a#CompanyProfileInfo_font']
      });
      
      if (!clickResult[0]?.result?.success) {
        throw new Error(`Failed to click Company Information link: ${clickResult[0]?.result?.error || 'Unknown error'}`);
      }

      // Wait for page to load
      console.log('[LicensesModule] Waiting for Company Information page to load...');
      await this.delay(10000);
      
      console.log('[LicensesModule] Successfully navigated to Company Information page');
    } catch (error) {
      console.error('[LicensesModule] Error navigating to Company Information page:', error);
      throw new Error(`Failed to navigate to Company Information page: ${error.message}`);
    }

    // Step 2: Find and click the "Related User License List" link
    console.log('[LicensesModule] Step 2: Looking for Related User License List link...');
    try {
      const clickLicenseLink = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: findAndClickRelatedUserLicenseListFunc
      });
      
      if (!clickLicenseLink[0]?.result?.success) {
        throw new Error(`Failed to find/click Related User License List link: ${clickLicenseLink[0]?.result?.error || 'Unknown error'}`);
      }

      console.log('[LicensesModule] Clicked Related User License List link successfully');
      
      // Wait for the expanded section to appear
      console.log('[LicensesModule] Waiting for expanded section to appear...');
      await this.delay(3000);
    } catch (error) {
      console.error('[LicensesModule] Error clicking Related User License List:', error);
      throw new Error(`Failed to click Related User License List: ${error.message}`);
    }

    // Step 3: Find and click the "Go to list" link
    console.log('[LicensesModule] Step 3: Looking for "Go to list" link...');
    try {
      const clickGoToList = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: findAndClickGoToListFunc
      });
      
      if (!clickGoToList[0]?.result?.success) {
        throw new Error(`Failed to find/click "Go to list" link: ${clickGoToList[0]?.result?.error || 'Unknown error'}`);
      }

      console.log('[LicensesModule] Clicked "Go to list" link successfully');
      
      // Wait for the full licenses page to load
      console.log('[LicensesModule] Waiting for full licenses page to load...');
      await this.delay(5000);
    } catch (error) {
      console.error('[LicensesModule] Error clicking "Go to list" link:', error);
      throw new Error(`Failed to click "Go to list" link: ${error.message}`);
    }

    // Step 4: Scrape the licenses table
    console.log('[LicensesModule] Step 4: Scraping licenses table...');
    const licensesData = await chrome.scripting.executeScript({
      target: { tabId: context.tabId },
      func: scrapeLicensesTableFunc
    });

    const data = licensesData?.[0]?.result || { licenses: [] };
    console.log(`[LicensesModule] Extracted ${data.licenses.length} license records`);

    return data;
  }

  /**
   * Format the scraped data into tab-separated text for Excel
   */
  formatData(data) {
    let output = '';
    
    // Header section
    output += 'USER LICENSES REPORT\n';
    output += `Generated: ${new Date().toLocaleString()}\n`;
    output += `Total License Types: ${data.licenses.length}\n`;
    output += '\n';
    
    // Check if we have data
    if (data.licenses.length === 0) {
      output += 'No license data found\n';
      return output;
    }
    
    // Calculate license summaries
    const summary = this.calculateLicenseSummary(data);
    
    // Display license summary
    output += '='.repeat(100) + '\n';
    output += 'LICENSE SUMMARY\n';
    output += '='.repeat(100) + '\n';
    output += '\n';
    output += `Internal Licenses\t${summary.internal.used}\t${summary.internal.total}\n`;
    output += `Integration Licenses\t${summary.integration.used}\t${summary.integration.total}\n`;
    output += `External Licenses\t${summary.external.used}\t${summary.external.total}\n`;
    output += '\n';
    
    output += '='.repeat(100) + '\n';
    output += 'ALL USER LICENSES\n';
    output += '='.repeat(100) + '\n';
    output += '\n';
    
    // Headers
    if (data.headers && data.headers.length > 0) {
      output += data.headers.join('\t') + '\n';
    }
    
    // Data rows
    data.licenses.forEach(row => {
      output += row.join('\t') + '\n';
    });
    
    output += '\n';
    
    return output;
  }

  /**
   * Calculate license summary based on license categories
   */
  calculateLicenseSummary(data) {
    const summary = {
      internal: { used: 0, total: 0 },
      integration: { used: 0, total: 0 },
      external: { used: 0, total: 0 }
    };
    
    // License category definitions
    const internalLicenses = ['Salesforce', 'Salesforce Platform'];
    const integrationLicenses = ['Salesforce Integration'];
    const externalLicenses = [
      'Customer Community Login',
      'Partner Community',
      'Guest User License',
      'Partner Community Login',
      'Customer Community',
      'Customer Community Plus',
      'Partner Community Plus',
      'Customer Community Plus Login'
    ];
    
    // Find the column indices for Name, Total Licenses, and Used Licenses
    let nameIndex = -1;
    let totalLicensesIndex = -1;
    let usedLicensesIndex = -1;
    
    if (data.headers && data.headers.length > 0) {
      data.headers.forEach((header, index) => {
        const headerLower = header.toLowerCase();
        if (headerLower.includes('name')) {
          nameIndex = index;
        } else if (headerLower.includes('total') && headerLower.includes('license')) {
          totalLicensesIndex = index;
        } else if (headerLower.includes('used') && headerLower.includes('license')) {
          usedLicensesIndex = index;
        }
      });
    }
    
    console.log(`[calculateLicenseSummary] Column indices: name=${nameIndex}, total=${totalLicensesIndex}, used=${usedLicensesIndex}`);
    
    // Process each license row
    data.licenses.forEach((row, rowIndex) => {
      if (nameIndex === -1 || totalLicensesIndex === -1 || usedLicensesIndex === -1) {
        return; // Skip if we couldn't find the columns
      }
      
      const licenseName = row[nameIndex] || '';
      const totalStr = row[totalLicensesIndex] || '0';
      const usedStr = row[usedLicensesIndex] || '0';
      
      // Remove commas and parse numbers
      const total = parseInt(totalStr.replace(/,/g, ''), 10) || 0;
      const used = parseInt(usedStr.replace(/,/g, ''), 10) || 0;
      
      // Categorize and sum
      if (internalLicenses.includes(licenseName)) {
        summary.internal.total += total;
        summary.internal.used += used;
        console.log(`[calculateLicenseSummary] Internal: ${licenseName} - ${used}/${total}`);
      } else if (integrationLicenses.includes(licenseName)) {
        summary.integration.total += total;
        summary.integration.used += used;
        console.log(`[calculateLicenseSummary] Integration: ${licenseName} - ${used}/${total}`);
      } else if (externalLicenses.includes(licenseName)) {
        summary.external.total += total;
        summary.external.used += used;
        console.log(`[calculateLicenseSummary] External: ${licenseName} - ${used}/${total}`);
      }
    });
    
    console.log(`[calculateLicenseSummary] Summary:`, summary);
    return summary;
  }

  getJsonPayload(data) {
    return {
      headers: data.headers || [],
      licenses: data.licenses || []
    };
  }

  /**
   * Get filename for the output
   */
  getFilename() {
    return '1_licenses';
  }

  /**
   * Helper delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Find and click the Related User License List link
 * Injected into the Company Information page
 * Looks for: <a id="[DYNAMIC_ID]_RelatedUserLicenseList_link">
 * where [DYNAMIC_ID] is customer-specific (e.g., "00D2w000004NY4f")
 */
function findAndClickRelatedUserLicenseListFunc() {
  console.log('[findAndClickRelatedUserLicenseListFunc] Looking for User Licenses link...');
  
  // Find all <a> elements on the page
  const allLinks = document.querySelectorAll('a[id]');
  console.log(`[findAndClickRelatedUserLicenseListFunc] Found ${allLinks.length} links with id attribute`);
  
  let targetLink = null;
  
  // Look for an <a> whose id ends with "_RelatedUserLicenseList_link"
  for (const link of allLinks) {
    if (link.id.endsWith('_RelatedUserLicenseList_link')) {
      console.log(`[findAndClickRelatedUserLicenseListFunc] ✓ Found User Licenses link!`);
      console.log(`[findAndClickRelatedUserLicenseListFunc]   id="${link.id}"`);
      console.log(`[findAndClickRelatedUserLicenseListFunc]   href="${link.href}"`);
      console.log(`[findAndClickRelatedUserLicenseListFunc]   text="${link.textContent.trim()}"`);
      targetLink = link;
      break;
    }
  }
  
  if (!targetLink) {
    console.error('[findAndClickRelatedUserLicenseListFunc] ❌ Could not find link ending with "_RelatedUserLicenseList_link"');
    return {
      success: false,
      error: 'Could not find link with id ending in "_RelatedUserLicenseList_link"'
    };
  }

  console.log('[findAndClickRelatedUserLicenseListFunc] Clicking the User Licenses link...');
  targetLink.click();

  return {
    success: true,
    message: 'Successfully clicked User Licenses link'
  };
}

/**
 * Find and click the "Go to list" link
 * Injected into the Company Information page after expanding User Licenses
 * Looks for: <a href="/100?rlid=RelatedUserLicenseList&id=[DYNAMIC_ID]">Go to list (##) »</a>
 */
function findAndClickGoToListFunc() {
  console.log('[findAndClickGoToListFunc] Looking for "Go to list" link...');
  
  // Find all <a> elements on the page
  const allLinks = document.querySelectorAll('a[href]');
  console.log(`[findAndClickGoToListFunc] Found ${allLinks.length} links`);
  
  let targetLink = null;
  
  // Look for an <a> whose href contains "/100?rlid=RelatedUserLicenseList"
  for (const link of allLinks) {
    if (link.href.includes('/100?rlid=RelatedUserLicenseList')) {
      console.log(`[findAndClickGoToListFunc] ✓ Found "Go to list" link!`);
      console.log(`[findAndClickGoToListFunc]   href="${link.href}"`);
      console.log(`[findAndClickGoToListFunc]   text="${link.textContent.trim()}"`);
      targetLink = link;
      break;
    }
  }
  
  if (!targetLink) {
    console.error('[findAndClickGoToListFunc] ❌ Could not find link with href containing "/100?rlid=RelatedUserLicenseList"');
    
    // Log some links for debugging
    console.log('[findAndClickGoToListFunc] Sample hrefs:');
    allLinks.forEach((link, index) => {
      if (index < 10 && link.href.includes('RelatedUserLicense')) {
        console.log(`  - ${link.href} | Text: ${link.textContent.trim()}`);
      }
    });
    
    return {
      success: false,
      error: 'Could not find "Go to list" link with href containing "/100?rlid=RelatedUserLicenseList"'
    };
  }
  
  // Click the link
  console.log('[findAndClickGoToListFunc] Clicking the "Go to list" link...');
  targetLink.click();
  
  return {
    success: true,
    message: 'Successfully clicked "Go to list" link'
  };
}

/**
 * Scrape the licenses table from the page
 * Injected into the licenses page
 * Looks for table with class="listRelatedObject sysAdminBlock"
 */
function scrapeLicensesTableFunc() {
  console.log('[scrapeLicensesTableFunc] Looking for licenses table...');
  
  const result = {
    headers: [],
    licenses: []
  };
  
  // Find the table with class="listRelatedObject sysAdminBlock"
  const table = document.querySelector('.listRelatedObject.sysAdminBlock table.list');
  
  if (!table) {
    console.warn('[scrapeLicensesTableFunc] Could not find table with .listRelatedObject.sysAdminBlock table.list');
    return result;
  }
  
  console.log('[scrapeLicensesTableFunc] Found licenses table');
  
  // Extract headers
  const headerRow = table.querySelector('tr.headerRow');
  if (headerRow) {
    const headerCells = headerRow.querySelectorAll('th');
    headerCells.forEach(cell => {
      result.headers.push(cell.textContent.trim());
    });
    console.log(`[scrapeLicensesTableFunc] Headers: ${result.headers.join(', ')}`);
  }
  
  // Extract data rows
  const dataRows = table.querySelectorAll('tr.dataRow');
  console.log(`[scrapeLicensesTableFunc] Found ${dataRows.length} data rows`);
  
  dataRows.forEach((row, rowIndex) => {
    const cells = row.querySelectorAll('th, td');
    if (cells.length > 0) {
      const rowData = [];
      cells.forEach(cell => {
        // Get text content, handling links and spans
        const link = cell.querySelector('a');
        const span = cell.querySelector('span');
        let text = '';
        
        if (link) {
          text = link.textContent.trim();
        } else if (span) {
          text = span.textContent.trim();
        } else {
          text = cell.textContent.trim();
        }
        
        rowData.push(text);
      });
      
      // Only add if row has content
      if (rowData.some(cell => cell.length > 0)) {
        result.licenses.push(rowData);
        if (rowIndex < 3) { // Log first 3 rows for debugging
          console.log(`[scrapeLicensesTableFunc] Row ${rowIndex + 1}: ${rowData.join(' | ')}`);
        }
      }
    }
  });
  
  console.log(`[scrapeLicensesTableFunc] Extracted ${result.licenses.length} license records`);
  return result;
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LicensesModule;
}
