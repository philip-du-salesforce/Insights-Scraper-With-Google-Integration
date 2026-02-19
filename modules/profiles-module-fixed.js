/**
 * Profiles Module
 * Scrapes profile information including active user counts
 * This is the existing profile scraping logic refactored into the module system
 */

class ProfilesModule extends BaseModule {
  constructor() {
    super('Profiles', 'Extract profile information and count active users');
    this.extractedUrls = [];
  }

  /**
   * Initialize the module
   */
  async initialize() {
    await super.initialize();
    this.extractedUrls = [];
  }

  /**
   * Validate if the module can run
   */
  async validate() {
    // Check if we're on a page that has profile links
    return { valid: true };
  }

  /**
   * Main scraping method
   * @param {Object} context - Contains tabId, customerName, etc.
   */
  async scrape(context) {
    console.log('[ProfilesModule] Starting profile scraping...');
    console.log('[ProfilesModule] Context received:', context);
    console.log('[ProfilesModule] TabId:', context?.tabId);

    // Step 1: Extract profile links from the current page
    let links;
    try {
      links = await this.extractProfileLinks(context.tabId);
      
      if (links.length === 0) {
        throw new Error('No profile links found on the page. Make sure you are on the Salesforce Profiles list page.');
      }

      console.log(`[ProfilesModule] Found ${links.length} profile links`);
    } catch (error) {
      console.error('[ProfilesModule] Error extracting profile links:', error);
      throw new Error(`Failed to extract profile links: ${error.message}`);
    }
    
    this.extractedUrls = links;

    // Step 2: Scrape each profile
    const scrapedData = [];
    for (let i = 0; i < links.length; i++) {
      const url = links[i];
      console.log(`[ProfilesModule] Processing profile ${i + 1}/${links.length}: ${url}`);
      
      try {
        const profileData = await this.scrapeProfile(url);
        scrapedData.push(profileData);
      } catch (error) {
        console.error(`[ProfilesModule] Error scraping ${url}:`, error);
        scrapedData.push({
          url,
          profileName: 'ERROR',
          modifyAllData: false,
          runReports: false,
          exportReports: false,
          activeUserCount: 0,
          error: error.message
        });
      }

      // Delay between profiles
      await this.delay(1000);
    }

    console.log(`[ProfilesModule] Completed scraping ${scrapedData.length} profiles`);
    return scrapedData;
  }

  /**
   * Extract profile links from the page
   */
  async extractProfileLinks(tabId) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractLinksFromPageFunc
    });

    return results[0]?.result || [];
  }

  /**
   * Scrape a single profile
   * This includes the full logic from background.js scrapeUrl function
   */
  async scrapeProfile(url) {
    return new Promise(async (resolve, reject) => {
      let tab;
      // IMPORTANT: Capture 'this' context before entering callback
      const self = this;
      
      try {
        // Create a new tab for the profile page
        tab = await chrome.tabs.create({ 
          url, 
          active: false 
        });

        // Set a timeout
        const timeout = setTimeout(() => {
          chrome.tabs.remove(tab.id).catch(() => {});
          reject(new Error('Timeout: Operation took too long'));
        }, 120000);

        // Wait for page to load
        chrome.tabs.onUpdated.addListener(async function listener(tabId, changeInfo) {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            
            await self.delay(1500);
            
            try {
              // Get profile name
              const profileNameResult = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: getProfileNameFunc
              });
              const profileName = profileNameResult?.[0]?.result || url;

              // Get permissions
              const modifyAllDataResult = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: getPermissionFunc,
                args: ['Modify All Data']
              });
              const runReportsResult = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: getPermissionFunc,
                args: ['Run Reports']
              });
              const exportReportsResult = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: getPermissionFunc,
                args: ['Export Reports']
              });
              
              const modifyAllData = modifyAllDataResult?.[0]?.result || false;
              const runReports = runReportsResult?.[0]?.result || false;
              const exportReports = exportReportsResult?.[0]?.result || false;

              // Click View Users button
              const clickResult = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: clickViewUsersButtonFunc
              });

              if (!clickResult?.[0]?.result?.success) {
                clearTimeout(timeout);
                await chrome.tabs.remove(tab.id);
                resolve({
                  profileName,
                  modifyAllData,
                  runReports,
                  exportReports,
                  activeUserCount: 0,
                  error: 'View Users button not found',
                  url
                });
                return;
              }

              // Wait for navigation
              await self.delay(3000);

              // Count active users (simplified - no pagination for now in module)
              const countResult = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: countActiveUsersFunc
              });

              const activeUserCount = countResult?.[0]?.result || 0;

              clearTimeout(timeout);
              await chrome.tabs.remove(tab.id);

              resolve({
                profileName,
                modifyAllData,
                runReports,
                exportReports,
                activeUserCount,
                url
              });

            } catch (error) {
              clearTimeout(timeout);
              chrome.tabs.remove(tab.id).catch(() => {});
              reject(error);
            }
          }
        });

      } catch (error) {
        if (tab) {
          chrome.tabs.remove(tab.id).catch(() => {});
        }
        reject(error);
      }
    });
  }

  /**
   * Format the scraped data into text
   */
  formatData(data) {
    let output = 'PROFILE INFORMATION\n';
    output += '='.repeat(80) + '\n\n';
    output += `Total Profiles Processed: ${data.length}\n`;
    output += `Generated: ${new Date().toLocaleString()}\n\n`;
    output += '='.repeat(80) + '\n\n';

    data.forEach((profile, index) => {
      output += `${index + 1}. ${profile.profileName}\n`;
      output += `-`.repeat(60) + '\n';
      output += `   URL: ${profile.url}\n`;
      output += `   Modify All Data: ${profile.modifyAllData ? 'Yes' : 'No'}\n`;
      output += `   Run Reports: ${profile.runReports ? 'Yes' : 'No'}\n`;
      output += `   Export Reports: ${profile.exportReports ? 'Yes' : 'No'}\n`;
      output += `   Active Users: ${profile.activeUserCount}\n`;
      
      if (profile.error) {
        output += `   ERROR: ${profile.error}\n`;
      }
      
      output += '\n';
    });

    return output;
  }

  /**
   * Helper delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// STANDALONE FUNCTIONS FOR INJECTION
// These must be outside the class for chrome.scripting.executeScript to work
// ============================================================================

/**
 * Extract profile links from page
 * Injected into the active tab
 */
function extractLinksFromPageFunc() {
  const allowedLicenses = [
    'Salesforce', 'Salesforce Platform', 'Customer Community Login',
    'Partner Community', 'Guest User License', 'Partner Community Login',
    'Customer Community', 'Customer Community Plus', 'Partner Community Plus',
    'Customer Community Plus Login', 'Salesforce Integration'
  ];
  
  const urls = new Set();
  
  // Find the specific "Profile" table block
  const profileBlock = Array.from(document.querySelectorAll('div.bPageBlock'))
    .find(div => {
      const h3 = div.querySelector('h3');
      const h3Text = h3 ? h3.textContent.trim() : '';
      return h3Text === 'Profile';
    });

  if (!profileBlock) {
    console.warn('Profile block not found');
    return [];
  }

  const table = profileBlock.querySelector('table.list');
  if (!table) {
    console.warn('Table not found in profile block');
    return [];
  }

  const headerRow = table.querySelector('tr.headerRow');
  if (!headerRow) {
    console.warn('Header row not found');
    return [];
  }

  const headers = Array.from(headerRow.querySelectorAll('th, td'));
  let userLicenseColIndex = -1;
  headers.forEach((header, index) => {
    if (header.textContent.trim() === 'User License') {
      userLicenseColIndex = index;
    }
  });

  if (userLicenseColIndex === -1) {
    console.warn('User License column not found');
    return [];
  }

  const rows = table.querySelectorAll('tr.dataRow');
  
  rows.forEach(row => {
    const cells = row.querySelectorAll('th, td');
    const profileNameElement = cells[0]?.querySelector('a');
    const profileUrl = profileNameElement ? new URL(profileNameElement.href, window.location.href).href : null;
    const userLicenseCell = cells[userLicenseColIndex];
    const licenseValue = userLicenseCell ? userLicenseCell.textContent.trim() : 'N/A';

    if (profileUrl && allowedLicenses.includes(licenseValue)) {
      urls.add(profileUrl);
    }
  });

  return Array.from(urls);
}

/**
 * Get profile name from page
 * Injected into profile detail page
 */
function getProfileNameFunc() {
  const labelCols = document.querySelectorAll('td.labelCol');
  for (const labelCol of labelCols) {
    if (labelCol.textContent.trim() === 'Name') {
      const valueCell = labelCol.nextElementSibling;
      if (valueCell && valueCell.tagName === 'TD') {
        return valueCell.textContent.trim();
      }
    }
  }
  return document.title || window.location.href;
}

/**
 * Get permission status from page
 * Injected into profile detail page
 */
function getPermissionFunc(permissionName) {
  const labelCols = document.querySelectorAll('td.labelCol');
  for (const labelCol of labelCols) {
    if (labelCol.textContent.trim().includes(permissionName)) {
      const valueCell = labelCol.nextElementSibling;
      if (valueCell && valueCell.tagName === 'TD') {
        const checkedImg = valueCell.querySelector('img[title="Checked"]');
        return checkedImg !== null;
      }
    }
  }
  return false;
}

/**
 * Click View Users button
 * Injected into profile detail page
 */
function clickViewUsersButtonFunc() {
  const buttons = document.querySelectorAll('input[type="button"], input[type="submit"], button');
  for (const button of buttons) {
    const value = button.value || button.textContent || button.innerText;
    if (value && value.trim().toLowerCase().includes('view users')) {
      button.click();
      return { success: true };
    }
  }
  return { success: false };
}

/**
 * Count active users on page
 * Injected into users list page
 */
function countActiveUsersFunc() {
  let count = 0;
  const tables = document.querySelectorAll('table');
  
  for (const table of tables) {
    const headerRow = table.querySelector('tr.headerRow');
    if (!headerRow) continue;
    
    const headers = Array.from(headerRow.querySelectorAll('th, td'));
    let activeColIndex = -1;
    
    headers.forEach((header, index) => {
      if (header.textContent.trim().toLowerCase().includes('active')) {
        activeColIndex = index;
      }
    });
    
    if (activeColIndex !== -1) {
      const rows = table.querySelectorAll('tr.dataRow');
      rows.forEach(row => {
        const cells = row.querySelectorAll('th, td');
        const activeCell = cells[activeColIndex];
        if (activeCell && activeCell.classList.contains('booleanColumn')) {
          const img = activeCell.querySelector('img');
          if (img && (img.getAttribute('title') === 'Checked' || img.getAttribute('alt') === 'Checked')) {
            count++;
          }
        }
      });
      break;
    }
  }
  
  return count;
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ProfilesModule;
}
