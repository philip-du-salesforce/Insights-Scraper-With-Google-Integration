/**
 * Profiles Module
 * Scrapes profile information including active user counts
 * This is the existing profile scraping logic refactored into the module system
 */

class ProfilesModule extends BaseModule {
  constructor() {
    super('Profiles', 'Extract profile information and count active users');
    this.extractedUrls = [];
    // TEST MODE: Set to true to limit profiles for testing
    this.TEST_MODE = false;
    // Option 1: Limit by count (set to null to disable)
    this.TEST_MODE_LIMIT = null;
    // Option 2: Filter by profile name (set to null to disable)
    this.TEST_MODE_PROFILE_NAME = null;
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

    // Step 0: Navigate to Profiles page
    console.log('[ProfilesModule] Step 0: Navigating to Profiles page...');
    try {
      // Search for "Profiles"
      console.log('[ProfilesModule] Searching for "Profiles"...');
      const searchResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: searchFunc,
        args: ['Profiles']
      });
      
      if (!searchResult[0]?.result?.success) {
        throw new Error(`Search failed: ${searchResult[0]?.result?.error || 'Unknown error'}`);
      }

      // Wait for search results to appear
      console.log('[ProfilesModule] Waiting for search results...');
      await this.delay(2000);

      // Click on the Profiles link (id="Profiles_font")
      console.log('[ProfilesModule] Clicking on Profiles link...');
      const clickResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: clickElementFunc,
        args: ['a#Profiles_font']
      });
      
      if (!clickResult[0]?.result?.success) {
        throw new Error(`Failed to click Profiles link: ${clickResult[0]?.result?.error || 'Unknown error'}`);
      }

      // Wait for page to load
      console.log('[ProfilesModule] Waiting for Profiles page to load...');
      await this.delay(10000);
      
      console.log('[ProfilesModule] Successfully navigated to Profiles page');
    } catch (error) {
      console.error('[ProfilesModule] Error navigating to Profiles page:', error);
      throw new Error(`Failed to navigate to Profiles page: ${error.message}`);
    }

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
    
    // Apply TEST_MODE filters if enabled
    if (this.TEST_MODE) {
      console.log(`[ProfilesModule] ⚠️ TEST MODE ENABLED`);
      
      // Filter by profile name if specified
      if (this.TEST_MODE_PROFILE_NAME) {
        console.log(`[ProfilesModule] Filtering for profile: "${this.TEST_MODE_PROFILE_NAME}"`);
        const filtered = await this.filterProfilesByName(context.tabId, links, this.TEST_MODE_PROFILE_NAME);
        links = filtered;
        console.log(`[ProfilesModule] Found ${links.length} matching profiles`);
      }
      
      // Apply count limit if specified
      if (this.TEST_MODE_LIMIT && links.length > this.TEST_MODE_LIMIT) {
        console.log(`[ProfilesModule] Limiting to first ${this.TEST_MODE_LIMIT} profiles`);
        links = links.slice(0, this.TEST_MODE_LIMIT);
      }
    }
    
    const totalProfiles = links.length;
    console.log(`[ProfilesModule] Will scrape ${totalProfiles} profiles`);
    
    for (let i = 0; i < links.length; i++) {
      const url = links[i];
      const current = i + 1;
      
      console.log(`[ProfilesModule] Processing profile ${current}/${totalProfiles}: ${url}`);
      
      // Send progress update with profile count
      if (context.progressCallback) {
        context.progressCallback({
          type: 'MODULE_PROGRESS',
          moduleId: 'profiles',
          moduleName: this.name,
          percentage: Math.round((current / totalProfiles) * 100),
          statusText: `Scraping profile ${current} of ${totalProfiles}`,
          current,
          total: totalProfiles
        });
      }
      
      try {
        const profileData = await this.scrapeProfile(url);
        scrapedData.push(profileData);
      } catch (error) {
        console.error(`[ProfilesModule] Error scraping ${url}:`, error);
        scrapedData.push({
          url,
          profileName: 'ERROR',
          userLicense: 'Unknown',
          profileType: 'Unknown',
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
   * Extract all profile links from the Profiles list page, with pagination.
   * Handles multiple pages so no profile is missed; safety limit 100 pages.
   */
  async extractProfileLinks(tabId) {
    const allLinks = [];
    let pageNum = 1;
    const maxPages = 100; // safety limit

    while (pageNum <= maxPages) {
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractLinksFromPageFunc
      });
      const pageLinks = result[0]?.result || [];
      if (pageLinks.length === 0) {
        if (allLinks.length === 0) return [];
        break;
      }
      pageLinks.forEach(url => { if (!allLinks.includes(url)) allLinks.push(url); });

      const nextResult = await chrome.scripting.executeScript({
        target: { tabId },
        func: clickNextPageButtonFunc
      });
      const hasNext = nextResult?.[0]?.result?.success || false;
      if (!hasNext) break;
      await this.delay(2500); // wait for list to load
      pageNum++;
    }

    return allLinks;
  }

  /**
   * Filter profile links by name
   * @param {number} tabId - Tab ID
   * @param {Array<string>} links - Array of profile URLs
   * @param {string} profileName - Profile name to filter for (case-insensitive, partial match)
   */
  async filterProfilesByName(tabId, links, profileName) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: getProfileNamesFromLinksFunc,
      args: [links, profileName.toLowerCase()]
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

              // Get profile type (Standard / Custom)
              const profileTypeResult = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: getProfileTypeFunc
              });
              const profileType = profileTypeResult?.[0]?.result || 'Unknown';

              // Get User License (Profile Detail section, next to profile name)
              const userLicenseResult = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: getProfileUserLicenseFunc
              });
              const userLicense = userLicenseResult?.[0]?.result || 'Unknown';

              // Get permissions (from System Permissions on profile detail page)
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
                await chrome.tabs.remove(tab.id).catch(() => {});
                resolve({
                  profileName,
                  userLicense: userLicense,
                  profileType,
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

              // Count active users with pagination support
              console.log(`[ProfilesModule] Counting active users for ${profileName}...`);
              const activeUserCount = await self.countActiveUsersWithPagination(tab.id);
              console.log(`[ProfilesModule] Found ${activeUserCount} active users for ${profileName}`);

              clearTimeout(timeout);
              await chrome.tabs.remove(tab.id);

              resolve({
                profileName,
                userLicense,
                profileType,
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
   * Count active users with pagination support
   * @param {number} tabId - Tab ID where users are listed
   */
  async countActiveUsersWithPagination(tabId) {
    let totalCount = 0;
    let hasNextPage = true;
    let pageNum = 1;

    while (hasNextPage) {
      console.log(`[ProfilesModule] Counting users on page ${pageNum}...`);
      
      // Count users on current page
      const countResult = await chrome.scripting.executeScript({
        target: { tabId },
        func: countActiveUsersFunc
      });
      
      const pageCount = countResult?.[0]?.result || 0;
      totalCount += pageCount;
      console.log(`[ProfilesModule] Page ${pageNum}: ${pageCount} active users (total so far: ${totalCount})`);

      // Check for next page button
      console.log(`[ProfilesModule] Checking for Next button on page ${pageNum}...`);
      const nextButtonResult = await chrome.scripting.executeScript({
        target: { tabId },
        func: clickNextPageButtonFunc
      });

      console.log(`[ProfilesModule] Next button result:`, nextButtonResult?.[0]?.result);
      const nextClicked = nextButtonResult?.[0]?.result?.success || false;
      
      if (nextClicked) {
        console.log(`[ProfilesModule] ✓ Next button clicked! Navigating to page ${pageNum + 1}...`);
        await this.delay(3000); // Wait for page to load
        pageNum++;
      } else {
        console.log(`[ProfilesModule] ❌ No Next button found or click failed, stopping pagination`);
        console.log(`[ProfilesModule] TIP: Check the Salesforce page console (F12 on the page tab) for detailed pagination logs`);
        hasNextPage = false;
      }
    }

    return totalCount;
  }

  /**
   * Format the scraped data into tab-separated text for Excel
   */
  formatData(data) {
    let output = '';

    output += 'PROFILE INFORMATION REPORT\n';
    output += `Generated: ${new Date().toLocaleString()}\n`;
    output += '\n';

    output += 'Profile Name\tUser License\tProfile Type\tActive Users\tModify All Data\tRun Reports\tExport Reports\n';

    data.forEach(profile => {
      output += `${profile.profileName || 'N/A'}\t`;
      output += `${profile.userLicense || 'Unknown'}\t`;
      output += `${profile.profileType || 'Unknown'}\t`;
      output += `${profile.activeUserCount ?? 0}\t`;
      output += `${profile.modifyAllData ? 'Yes' : 'No'}\t`;
      output += `${profile.runReports ? 'Yes' : 'No'}\t`;
      output += `${profile.exportReports ? 'Yes' : 'No'}\n`;
    });

    return output;
  }

  getJsonPayload(data) {
    return { profiles: Array.isArray(data) ? data : [] };
  }

  /**
   * Get filename for the output
   */
  getFilename() {
    return '2_profiles';
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
 * Filter profile links by name
 * Injected into the profiles list page
 * @param {Array<string>} urls - Array of profile URLs to filter
 * @param {string} targetName - Profile name to search for (lowercase)
 */
function getProfileNamesFromLinksFunc(urls, targetName) {
  const matchingUrls = [];
  
  console.log(`[getProfileNamesFromLinksFunc] Filtering ${urls.length} URLs for profile: "${targetName}"`);
  
  // Find all profile links in the table
  const profileBlock = Array.from(document.querySelectorAll('div.bPageBlock'))
    .find(div => {
      const h3 = div.querySelector('h3');
      const h3Text = h3 ? h3.textContent.trim() : '';
      return h3Text === 'Profile';
    });

  if (!profileBlock) {
    console.warn('[getProfileNamesFromLinksFunc] Profile block not found');
    return matchingUrls;
  }

  const table = profileBlock.querySelector('table.list');
  if (!table) {
    console.warn('[getProfileNamesFromLinksFunc] Table not found');
    return matchingUrls;
  }

  const rows = table.querySelectorAll('tr.dataRow');
  
  rows.forEach(row => {
    const cells = row.querySelectorAll('th, td');
    const profileNameElement = cells[0]?.querySelector('a');
    
    if (profileNameElement) {
      const profileUrl = new URL(profileNameElement.href, window.location.href).href;
      const profileName = profileNameElement.textContent.trim().toLowerCase();
      
      // Check if this URL is in our list and matches the target name
      if (urls.includes(profileUrl) && profileName.includes(targetName)) {
        console.log(`[getProfileNamesFromLinksFunc] ✓ Match found: "${profileNameElement.textContent.trim()}"`);
        matchingUrls.push(profileUrl);
      }
    }
  });
  
  console.log(`[getProfileNamesFromLinksFunc] Found ${matchingUrls.length} matching profiles`);
  return matchingUrls;
}

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
 * Get profile type (e.g. Standard, Custom) from profile detail page
 * Injected into profile detail page. Looks for "Profile Type" or "Type" label.
 */
function getProfileTypeFunc() {
  const labelCols = document.querySelectorAll('td.labelCol');
  for (const labelCol of labelCols) {
    const labelText = labelCol.textContent.trim().toLowerCase();
    if (labelText === 'profile type' || labelText === 'type') {
      const valueCell = labelCol.nextElementSibling;
      if (valueCell && valueCell.tagName === 'TD') {
        return valueCell.textContent.trim() || 'Unknown';
      }
    }
  }
  return 'Unknown';
}

/**
 * Get User License from profile detail page (Profile Detail section).
 * Injected into profile detail page. Looks for "User License" label next to profile name.
 */
function getProfileUserLicenseFunc() {
  const labelCols = document.querySelectorAll('td.labelCol');
  for (const labelCol of labelCols) {
    if (labelCol.textContent.trim() === 'User License') {
      const valueCell = labelCol.nextElementSibling;
      if (valueCell && valueCell.tagName === 'TD') {
        return valueCell.textContent.trim() || 'Unknown';
      }
    }
  }
  return 'Unknown';
}

/**
 * Get permission status from page (System Permissions on profile detail page)
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

/**
 * Click next page button for pagination
 * Injected into users list page
 * Returns {success: true/false, debug: string} 
 */
function clickNextPageButtonFunc() {
  console.log('[clickNextPageButtonFunc] Starting pagination search...');
  
  const debugInfo = {
    totalLinks: 0,
    totalImages: 0,
    paginationContainers: 0,
    linksSampled: []
  };
  
  // Strategy 1: Look for all links on the page
  const allLinks = document.querySelectorAll('a');
  debugInfo.totalLinks = allLinks.length;
  console.log(`[clickNextPageButtonFunc] Found ${allLinks.length} total links on page`);
  
  for (const link of allLinks) {
    const text = (link.textContent || link.innerText || '').trim().toLowerCase();
    const title = (link.getAttribute('title') || '').toLowerCase();
    const className = link.className || '';
    
    // Check if it's a "Next" link by text or title (with various formats)
    // Matches: "next", "next page", "next page>", "next >", etc.
    if (text.includes('next page') || text === 'next' || title.includes('next')) {
      // Make sure it's not "previous"
      if (!text.includes('previous') && !text.includes('prev')) {
        console.log(`[clickNextPageButtonFunc] ✓ Found Next link by text/title: "${text || title}"`);
        console.log(`[clickNextPageButtonFunc] Link href: ${link.href}`);
        console.log(`[clickNextPageButtonFunc] Link class: ${className}`);
        link.click();
        return { success: true, debug: `Found Next link: text="${text}", title="${title}", class="${className}"` };
      }
    }
    
    // Check for arrow symbols that might indicate next
    if (text === '>' || text === '»' || text === '→' || text === 'next >') {
      console.log(`[clickNextPageButtonFunc] ✓ Found Next link by arrow symbol: "${text}"`);
      link.click();
      return { success: true, debug: `Found arrow symbol: "${text}"` };
    }
  }
  
  // Strategy 2: Look for image-based next buttons
  console.log('[clickNextPageButtonFunc] Trying image-based buttons...');
  const images = document.querySelectorAll('img');
  debugInfo.totalImages = images.length;
  console.log(`[clickNextPageButtonFunc] Found ${images.length} images on page`);
  
  for (const img of images) {
    const title = (img.getAttribute('title') || '').toLowerCase();
    const alt = (img.getAttribute('alt') || '').toLowerCase();
    const src = (img.getAttribute('src') || '').toLowerCase();
    
    // Check if image indicates "next"
    if (title.includes('next') || alt.includes('next') || src.includes('next')) {
      const parentLink = img.closest('a');
      if (parentLink) {
        console.log(`[clickNextPageButtonFunc] ✓ Found Next button via image`);
        console.log(`[clickNextPageButtonFunc] Image title: ${title}, alt: ${alt}`);
        console.log(`[clickNextPageButtonFunc] Link href: ${parentLink.href}`);
        parentLink.click();
        return { success: true, debug: `Found image next button: title="${title}", alt="${alt}"` };
      }
    }
  }
  
  // Strategy 3: Look for pagination-specific classes and containers
  console.log('[clickNextPageButtonFunc] Trying pagination containers...');
  const paginationContainers = document.querySelectorAll('.paginator, .pagination, .paginationLinks, div[class*="paging"], .bNext, .next');
  debugInfo.paginationContainers = paginationContainers.length;
  console.log(`[clickNextPageButtonFunc] Found ${paginationContainers.length} pagination containers`);
  
  for (const container of paginationContainers) {
    console.log(`[clickNextPageButtonFunc] Examining container: ${container.className}`);
    const links = container.querySelectorAll('a');
    
    for (const link of links) {
      const text = (link.textContent || link.innerText || '').trim().toLowerCase();
      const title = (link.getAttribute('title') || '').toLowerCase();
      
      // Check for "next" in text or title, but exclude "previous"
      if ((text.includes('next') || text === '>' || text === '»' || title.includes('next')) 
          && !text.includes('previous') && !text.includes('prev')) {
        console.log(`[clickNextPageButtonFunc] ✓ Found Next link in pagination container: "${text || title}"`);
        link.click();
        return { success: true, debug: `Found in pagination container: text="${text}", title="${title}"` };
      }
    }
  }
  
  // Strategy 4: Look for numbered pagination (e.g., 1, 2, 3... and a current page indicator)
  console.log('[clickNextPageButtonFunc] Strategy 4: Looking for numbered pagination...');
  
  // Find links that are just numbers
  const numberedLinks = Array.from(allLinks).filter(link => {
    const text = (link.textContent || '').trim();
    return /^\d+$/.test(text); // Just a number
  });
  
  console.log(`[clickNextPageButtonFunc] Found ${numberedLinks.length} numbered links`);
  
  if (numberedLinks.length > 0) {
    // Find the current page (often has a specific class or style)
    let currentPageNum = 1;
    
    // Look for current page indicators
    const currentPageElements = document.querySelectorAll('span.currentPage, .current, span[class*="current"], span[class*="active"]');
    for (const elem of currentPageElements) {
      const num = parseInt(elem.textContent.trim());
      if (!isNaN(num)) {
        currentPageNum = num;
        console.log(`[clickNextPageButtonFunc] Found current page indicator: ${currentPageNum}`);
        break;
      }
    }
    
    // Also check numbered links themselves for active/current styling
    for (const link of numberedLinks) {
      const linkNum = parseInt(link.textContent.trim());
      const classes = link.className.toLowerCase();
      if (classes.includes('current') || classes.includes('active') || classes.includes('selected')) {
        currentPageNum = linkNum;
        console.log(`[clickNextPageButtonFunc] Found current page from link class: ${currentPageNum}`);
        break;
      }
    }
    
    // Try to click the next numbered page
    const nextPageNum = currentPageNum + 1;
    for (const link of numberedLinks) {
      const linkNum = parseInt(link.textContent.trim());
      if (linkNum === nextPageNum) {
        console.log(`[clickNextPageButtonFunc] ✓ Found next page link: ${nextPageNum}`);
        link.click();
        return { success: true, debug: `Found numbered page link: current=${currentPageNum}, clicked=${nextPageNum}` };
      }
    }
    
    console.log(`[clickNextPageButtonFunc] Found numbered links but no page ${nextPageNum}`);
  }
  
  // Strategy 5: Sample some links for debugging
  console.log('[clickNextPageButtonFunc] ❌ No Next button found. Logging sample links:');
  const visibleLinks = Array.from(allLinks).filter(link => {
    const text = (link.textContent || '').trim();
    return text.length > 0 && text.length < 20; // Only short links
  }).slice(0, 15); // First 15
  
  visibleLinks.forEach(link => {
    const linkText = link.textContent.trim();
    const linkInfo = `Text: "${linkText}", Title: "${link.title}", Class: "${link.className}"`;
    console.log(`  - ${linkInfo}`);
    debugInfo.linksSampled.push(linkInfo);
  });
  
  const debugMessage = `Not found. Searched ${debugInfo.totalLinks} links, ${debugInfo.totalImages} images, ${debugInfo.paginationContainers} pagination containers. Numbered links: ${numberedLinks.length}. Sample: ${debugInfo.linksSampled.slice(0, 5).join(' | ')}`;
  
  return { success: false, debug: debugMessage };
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ProfilesModule;
}
