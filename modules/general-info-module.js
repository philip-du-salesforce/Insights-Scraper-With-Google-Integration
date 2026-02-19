/**
 * General Information Module
 * Scrapes general organization information including Sites and other metrics
 */

class GeneralInfoModule extends BaseModule {
  constructor() {
    super('General Information', 'Extract general organization information');
    this.data = {
      companyInfo: {
        accountName: '',
        orgId: '',
        location: '',
        edition: '',
        samlEnabled: false,
        samlSettingNames: [],
        found: false
      },
      sites: {
        total: 0,
        active: 0,
        inactive: 0,
        found: false
      },
      releaseUpdates: {
        overdueSecurityUpdates: 'Not checked',
        securityUpdatesDueSoon: 'Not checked',
        found: false
      }
    };
  }

  async scrape(context) {
    console.log('[GeneralInfoModule] Starting general information scraping...');
    console.log('[GeneralInfoModule] Context received:', context);

    this.data = {
      companyInfo: { accountName: '', orgId: '', location: '', edition: '', samlEnabled: false, samlSettingNames: [], found: false },
      sites: { total: 0, active: 0, inactive: 0, found: false },
      releaseUpdates: { overdueSecurityUpdates: 'Not checked', securityUpdatesDueSoon: 'Not checked', found: false }
    };

    // Step 0: Scrape Company Information (Account Name, Org ID, Location, Edition)
    await this.scrapeCompanyInfo(context);

    // Step 0b: Scrape Single Sign-On (SAML Enabled, SAML setting names)
    await this.scrapeSingleSignOnInfo(context);

    // Step 1: Scrape Sites information
    await this.scrapeSitesInfo(context);

    // Step 2: Scrape Release Updates information
    await this.scrapeReleaseUpdatesInfo(context);

    return this.data;
  }

  /**
   * Scrape Company Information: Account Name, Organization ID, Location (Instance), Edition
   */
  async scrapeCompanyInfo(context) {
    console.log('[GeneralInfoModule] Step 0: Scraping Company Information...');
    try {
      const searchResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: searchFunc,
        args: ['Company Information']
      });
      if (!searchResult[0]?.result?.success) {
        console.warn('[GeneralInfoModule] Company Information search failed');
        return;
      }
      await this.delay(2000);

      let clickResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: clickElementFunc,
        args: ['a#CompanyProfileInfo_font']
      });
      if (!clickResult[0]?.result?.success) {
        clickResult = await chrome.scripting.executeScript({
          target: { tabId: context.tabId },
          func: clickCompanyInformationLinkFunc
        });
      }
      if (!clickResult[0]?.result?.success) {
        console.warn('[GeneralInfoModule] Could not click Company Information');
        return;
      }
      await this.delay(6000);

      const scrapeResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: scrapeCompanyInfoFunc
      });
      const info = scrapeResult[0]?.result || {};
      if (info.accountName || info.orgId || info.location || info.edition) {
        this.data.companyInfo = {
          accountName: info.accountName || '',
          orgId: info.orgId || '',
          location: info.location || '',
          edition: info.edition || '',
          found: true
        };
        console.log('[GeneralInfoModule] Company info:', this.data.companyInfo);
      }
    } catch (err) {
      console.error('[GeneralInfoModule] Error scraping Company Information:', err);
      this.data.companyInfo.found = false;
    }
  }

  /**
   * Scrape Single Sign-On page: SAML Enabled (checkbox) and SAML Single Sign-On Settings names.
   */
  async scrapeSingleSignOnInfo(context) {
    console.log('[GeneralInfoModule] Step 0b: Scraping Single Sign-On...');
    try {
      const searchResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: searchFunc,
        args: ['Single Sign-On']
      });
      if (!searchResult[0]?.result?.success) {
        console.warn('[GeneralInfoModule] Single Sign-On search failed');
        return;
      }
      await this.delay(2000);

      let clickResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: clickElementFunc,
        args: ['a#SAMLSSO_font']
      });
      if (!clickResult[0]?.result?.success) {
        clickResult = await chrome.scripting.executeScript({
          target: { tabId: context.tabId },
          func: clickSingleSignOnLinkFunc
        });
      }
      if (!clickResult[0]?.result?.success) {
        console.warn('[GeneralInfoModule] Could not click Single Sign-On link');
        return;
      }
      await this.delay(5000);

      const scrapeResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: scrapeSSOFunc
      });
      const sso = scrapeResult[0]?.result || {};
      this.data.companyInfo.samlEnabled = !!sso.samlEnabled;
      this.data.companyInfo.samlSettingNames = Array.isArray(sso.samlSettingNames) ? sso.samlSettingNames : [];
      console.log('[GeneralInfoModule] SSO:', { samlEnabled: this.data.companyInfo.samlEnabled, samlSettingNames: this.data.companyInfo.samlSettingNames });
    } catch (err) {
      console.error('[GeneralInfoModule] Error scraping Single Sign-On:', err);
    }
  }

  /**
   * Scrape Sites information
   */
  async scrapeSitesInfo(context) {
    console.log('[GeneralInfoModule] Step 1: Scraping Sites information...');

    try {
      // Search for "Sites"
      console.log('[GeneralInfoModule] Searching for "Sites"...');
      const searchResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: searchFunc,
        args: ['Sites']
      });

      if (!searchResult[0]?.result?.success) {
        throw new Error(`Search failed: ${searchResult[0]?.result?.error || 'Unknown error'}`);
      }

      await this.delay(2000); // Wait for search results

      // Try to find the Sites link
      console.log('[GeneralInfoModule] Looking for SetupNetworks_font link...');
      const checkLinkResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: checkElementExistsFunc,
        args: ['a#SetupNetworks_font']
      });

      const linkExists = checkLinkResult[0]?.result;

      if (!linkExists) {
        console.log('[GeneralInfoModule] Sites link not found. Sites feature not available.');
        this.data.sites.found = false;
        return;
      }

      // Click on the Sites link
      console.log('[GeneralInfoModule] Clicking on Sites link...');
      const clickResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: clickElementFunc,
        args: ['a#SetupNetworks_font']
      });

      if (!clickResult[0]?.result?.success) {
        throw new Error(`Failed to click Sites link: ${clickResult[0]?.result?.error || 'Unknown error'}`);
      }

      await this.delay(5000); // Wait for Sites page to load

      // Scrape the Sites table
      console.log('[GeneralInfoModule] Scraping Sites table...');
      const sitesDataResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: scrapeSitesTableFunc
      });

      const sitesData = sitesDataResult[0]?.result;

      if (sitesData) {
        this.data.sites.found = true;
        this.data.sites.active = sitesData.active || 0;
        this.data.sites.inactive = sitesData.inactive || 0;
        this.data.sites.total = sitesData.total || 0;
        console.log('[GeneralInfoModule] Sites data:', this.data.sites);
      } else {
        console.warn('[GeneralInfoModule] No sites data returned');
        this.data.sites.found = false;
      }

    } catch (error) {
      console.error('[GeneralInfoModule] Error scraping Sites info:', error);
      this.data.sites.found = false;
      this.data.sites.error = error.message;
    }
  }

  /**
   * Scrape Release Updates information
   */
  async scrapeReleaseUpdatesInfo(context) {
    console.log('[GeneralInfoModule] Step 2: Scraping Release Updates information...');

    try {
      // Search for "Release Updates"
      console.log('[GeneralInfoModule] Searching for "Release Updates"...');
      const searchResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: searchFunc,
        args: ['Release Updates']
      });

      if (!searchResult[0]?.result?.success) {
        throw new Error(`Search failed: ${searchResult[0]?.result?.error || 'Unknown error'}`);
      }

      await this.delay(2000); // Wait for search results

      // Try to find the Release Updates link
      console.log('[GeneralInfoModule] Looking for ReleaseUpdates_font link...');
      const checkLinkResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: checkElementExistsFunc,
        args: ['a#ReleaseUpdates_font']
      });

      const linkExists = checkLinkResult[0]?.result;

      if (!linkExists) {
        console.log('[GeneralInfoModule] Release Updates link not found. Feature not available.');
        this.data.releaseUpdates.found = false;
        return;
      }

      // Click on the Release Updates link
      console.log('[GeneralInfoModule] Clicking on Release Updates link...');
      const clickResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: clickElementFunc,
        args: ['a#ReleaseUpdates_font']
      });

      if (!clickResult[0]?.result?.success) {
        throw new Error(`Failed to click Release Updates link: ${clickResult[0]?.result?.error || 'Unknown error'}`);
      }

      await this.delay(5000); // Wait for Release Updates page to load

      // Check Overdue Security Updates (click on duesoon__item)
      console.log('[GeneralInfoModule] Checking overdue security updates...');
      const clickDueSoonResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: clickElementFunc,
        args: ['a#duesoon__item']
      });

      if (!clickDueSoonResult[0]?.result?.success) {
        console.warn('[GeneralInfoModule] Could not click duesoon__item:', clickDueSoonResult[0]?.result?.error);
      } else {
        await this.delay(2000); // Wait for content to load

        // Check if "All clear over here" exists
        const checkAllClearResult = await chrome.scripting.executeScript({
          target: { tabId: context.tabId },
          func: checkForAllClearFunc
        });

        const isAllClear = checkAllClearResult[0]?.result;
        this.data.releaseUpdates.overdueSecurityUpdates = isAllClear ? 'None' : 'Found';
        console.log(`[GeneralInfoModule] Overdue Security Updates: ${this.data.releaseUpdates.overdueSecurityUpdates}`);
      }

      // Check Security Updates Due Soon (click on overdue__item)
      console.log('[GeneralInfoModule] Checking security updates due soon...');
      const clickOverdueResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: clickElementFunc,
        args: ['a#overdue__item']
      });

      if (!clickOverdueResult[0]?.result?.success) {
        console.warn('[GeneralInfoModule] Could not click overdue__item:', clickOverdueResult[0]?.result?.error);
      } else {
        await this.delay(2000); // Wait for content to load

        // Check if "All clear over here" exists
        const checkAllClearResult = await chrome.scripting.executeScript({
          target: { tabId: context.tabId },
          func: checkForAllClearFunc
        });

        const isAllClear = checkAllClearResult[0]?.result;
        this.data.releaseUpdates.securityUpdatesDueSoon = isAllClear ? 'None' : 'Found';
        console.log(`[GeneralInfoModule] Security Updates Due Soon: ${this.data.releaseUpdates.securityUpdatesDueSoon}`);
      }

      this.data.releaseUpdates.found = true;

    } catch (error) {
      console.error('[GeneralInfoModule] Error scraping Release Updates info:', error);
      this.data.releaseUpdates.found = false;
      this.data.releaseUpdates.error = error.message;
    }
  }

  formatData(data) {
    let output = '';
    output += 'GENERAL INFORMATION REPORT\n';
    output += `Generated: ${new Date().toLocaleString()}\n`;
    output += '\n';

    // Company / Org info (Account Name, Org ID, Location, Edition)
    output += '='.repeat(100) + '\n';
    output += 'COMPANY / ORGANIZATION INFORMATION\n';
    output += '='.repeat(100) + '\n';
    output += '\n';
    const ci = data.companyInfo || {};
    if (ci.found) {
      output += `Account Name\t${ci.accountName || ''}\n`;
      output += `Organization ID\t${ci.orgId || ''}\n`;
      output += `Location (Instance)\t${ci.location || ''}\n`;
      output += `Edition\t${ci.edition || ''}\n`;
    } else {
      output += 'Account Name\t\n';
      output += 'Organization ID\t\n';
      output += 'Location (Instance)\t\n';
      output += 'Edition\t\n';
    }
    output += `SAML Enabled\t${ci.samlEnabled ? 'Yes' : 'No'}\n`;
    output += `SAML Settings\t${(ci.samlSettingNames || []).join(', ')}\n`;
    output += '\n';

    // Sites section
    output += '='.repeat(100) + '\n';
    output += 'SITES INFORMATION\n';
    output += '='.repeat(100) + '\n';
    output += '\n';
    
    if (!data.sites.found) {
      output += 'Sites\t0\n';
      if (data.sites.error) {
        output += `Error\t${data.sites.error}\n`;
      }
    } else {
      output += `Total Sites\t${data.sites.total}\n`;
      output += `Active Sites\t${data.sites.active}\n`;
      output += `Inactive Sites\t${data.sites.inactive}\n`;
    }
    
    output += '\n';
    
    // Release Updates section
    output += '='.repeat(100) + '\n';
    output += 'RELEASE UPDATES INFORMATION\n';
    output += '='.repeat(100) + '\n';
    output += '\n';
    
    if (!data.releaseUpdates.found) {
      output += '# Overdue Security Updates\tNot Available\n';
      output += '# Security Updates Due Soon\tNot Available\n';
      if (data.releaseUpdates.error) {
        output += `Error\t${data.releaseUpdates.error}\n`;
      }
    } else {
      output += `# Overdue Security Updates\t${data.releaseUpdates.overdueSecurityUpdates}\n`;
      output += `# Security Updates Due Soon\t${data.releaseUpdates.securityUpdatesDueSoon}\n`;
    }
    
    output += '\n';
    
    return output;
  }

  getJsonPayload(data) {
    const ci = data.companyInfo || {};
    return {
      companyInfo: {
        found: ci.found,
        accountName: ci.accountName || '',
        orgId: ci.orgId || '',
        location: ci.location || '',
        edition: ci.edition || '',
        samlEnabled: !!ci.samlEnabled,
        samlSettingNames: Array.isArray(ci.samlSettingNames) ? ci.samlSettingNames : []
      },
      sites: data.sites || { found: false, total: 0, active: 0, inactive: 0 },
      releaseUpdates: data.releaseUpdates || { found: false }
    };
  }

  getFilename() {
    return '3_general_info';
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// STANDALONE FUNCTIONS FOR INJECTION
// ============================================================================

/**
 * Check if an element exists on the page
 * @param {string} selector - CSS selector to check
 * @returns {boolean}
 */
function checkElementExistsFunc(selector) {
  const element = document.querySelector(selector);
  const exists = element !== null;
  console.log(`[checkElementExistsFunc] Checking selector "${selector}": ${exists ? 'Found' : 'Not found'}`);
  return exists;
}

/**
 * Click Company Information link (fallback when a#CompanyProfileInfo_font not found, e.g. Lightning).
 */
function clickCompanyInformationLinkFunc() {
  const classic = document.querySelector('a#CompanyProfileInfo_font');
  if (classic) {
    classic.click();
    return { success: true };
  }
  const links = document.querySelectorAll('a, [role="link"], [role="button"]');
  for (const el of links) {
    const text = (el.textContent || '').trim();
    if (text === 'Company Information') {
      el.click();
      return { success: true };
    }
  }
  return { success: false, error: 'Company Information link not found' };
}

/**
 * Click Single Sign-On link (fallback when a#SAMLSSO_font not found).
 */
function clickSingleSignOnLinkFunc() {
  const classic = document.querySelector('a#SAMLSSO_font');
  if (classic) {
    classic.click();
    return { success: true };
  }
  const links = document.querySelectorAll('a, [role="link"], [role="button"]');
  for (const el of links) {
    const text = (el.textContent || '').trim();
    if (text === 'Single Sign-On Settings' || text === 'Single Sign-On' || text === 'Single Sign On') {
      el.click();
      return { success: true };
    }
  }
  return { success: false, error: 'Single Sign-On link not found' };
}

/**
 * Scrape Single Sign-On Settings page: SAML Enabled checkbox and SAML Single Sign-On Settings table names.
 * Salesforce often renders the checkbox as an image (checkbox_checked.gif / checkbox_unchecked.gif) in td.dataCol.
 */
function scrapeSSOFunc() {
  const result = { samlEnabled: false, samlSettingNames: [] };

  // 1. SAML Enabled: find label "SAML Enabled" (td.labelCol) and check value cell (td.dataCol)
  const labelCols = document.querySelectorAll('td.labelCol');
  for (const td of labelCols) {
    const text = (td.textContent || '').trim();
    if (text !== 'SAML Enabled') continue;
    const valueCell = td.nextElementSibling;
    if (!valueCell || !valueCell.classList.contains('dataCol')) continue;

    // Real checkbox input (e.g. Lightning)
    const cb = valueCell.querySelector('input[type="checkbox"]');
    if (cb) {
      result.samlEnabled = !!cb.checked;
      break;
    }

    // Image-based checkbox (Classic): img with checkbox_checked.gif or alt/title "Checked"
    const img = valueCell.querySelector('img.checkImg, img[src*="checkbox"]');
    if (img) {
      const src = (img.getAttribute('src') || '').toLowerCase();
      const alt = (img.getAttribute('alt') || '').trim();
      const title = (img.getAttribute('title') || '').trim();
      result.samlEnabled = src.includes('checkbox_checked') ||
        alt === 'Checked' || title === 'Checked';
      break;
    }

    break;
  }

  // 2. SAML Single Sign-On Settings table: find table with "Name" column (and optionally "SAML Version", "Issuer", "Entity ID")
  const tables = document.querySelectorAll('table.list, table[class*="list"]');
  for (const table of tables) {
    const headerRow = table.querySelector('tr.headerRow, thead tr, tr:first-child');
    if (!headerRow) continue;
    const headers = Array.from(headerRow.querySelectorAll('th, td')).map(c => (c.textContent || '').trim().toLowerCase());
    const nameCol = headers.findIndex(h => h === 'name');
    if (nameCol < 0) continue;
    const dataRows = table.querySelectorAll('tr.dataRow, tbody tr:not(.headerRow)');
    if (dataRows.length === 0) continue;
    const names = [];
    dataRows.forEach(row => {
      if (row.classList.contains('headerRow')) return;
      const cells = row.querySelectorAll('td, th');
      const nameCell = cells[nameCol];
      if (nameCell) {
        const name = (nameCell.textContent || '').trim();
        if (name) names.push(name);
      }
    });
    if (names.length > 0) {
      result.samlSettingNames = names;
      break;
    }
  }

  return result;
}

/**
 * Scrape Company Information page for Account Name, Org ID, Location, Edition.
 * Account Name & Org ID: from banner div.blackTabBannerInfo .blackTabBannerTxt (a text + span "Org ID ...").
 * Location: from banner div.blackTabBannerTab span.blackTabBannerTxt, text after "|" (e.g. "Production | AUS72" -> "AUS72").
 * Edition: from table td.labelCol "Salesforce Edition" -> adjacent td.dataCol.
 */
function scrapeCompanyInfoFunc() {
  const result = { accountName: '', orgId: '', location: '', edition: '' };

  // 1. Banner: Account Name and Org ID from div.blackTabBannerInfo (class may be "blackTabBannerInfo plain")
  const bannerInfo = document.querySelector('div.blackTabBannerInfo, div[id="blackTabBannerInfo plain"]');
  if (bannerInfo) {
    const link = bannerInfo.querySelector('a.blackTabBannerTxt');
    if (link) result.accountName = (link.textContent || '').trim();
    const spans = bannerInfo.querySelectorAll('span.blackTabBannerTxt');
    for (const span of spans) {
      const text = (span.textContent || '').trim();
      const orgMatch = text.match(/\(Org ID\s+([^)]+)\)/);
      if (orgMatch) {
        result.orgId = orgMatch[1].trim();
        break;
      }
    }
  }

  // 2. Banner: Location from div.blackTabBannerTab (text after "|", e.g. "Production | AUS72" -> "AUS72")
  const bannerTab = document.querySelector('div.blackTabBannerTab');
  if (bannerTab) {
    const span = bannerTab.querySelector('span.blackTabBannerTxt');
    if (span) {
      const text = (span.textContent || '').trim();
      const pipeIdx = text.indexOf('|');
      if (pipeIdx >= 0) result.location = text.slice(pipeIdx + 1).trim();
    }
  }

  // 3. Table: Salesforce Edition from labelCol "Salesforce Edition" -> dataCol value
  const labelCols = document.querySelectorAll('td.labelCol');
  labelCols.forEach(td => {
    const label = (td.textContent || '').trim();
    if (label !== 'Salesforce Edition') return;
    const valueCell = td.nextElementSibling;
    const value = valueCell && valueCell.classList && valueCell.classList.contains('dataCol')
      ? (valueCell.textContent || '').trim() : '';
    if (value) result.edition = value.replace(/^Default:\s*/i, '').trim() || value;
  });

  // Fallback: if banner didn't yield account/org/location, try table labels (legacy)
  if (!result.accountName || !result.orgId || !result.location) {
    labelCols.forEach(td => {
      const label = (td.textContent || '').trim().toLowerCase();
      const valueCell = td.nextElementSibling;
      const value = valueCell && valueCell.tagName === 'TD' ? (valueCell.textContent || '').trim() : '';
      if (!label) return;
      if ((label.includes('organization name') || label.includes('company name') || label === 'account name') && !result.accountName) result.accountName = value;
      else if ((label.includes('organization id') || label === 'org id') && !result.orgId) result.orgId = value;
      else if ((label.includes('instance') || label === 'location') && !result.location) result.location = value;
    });
  }
  if (!result.edition) {
    labelCols.forEach(td => {
      const label = (td.textContent || '').trim().toLowerCase();
      if (!label.includes('edition') && !label.includes('organization edition')) return;
      const valueCell = td.nextElementSibling;
      const value = valueCell && valueCell.tagName === 'TD' ? (valueCell.textContent || '').trim() : '';
      if (value) result.edition = value.replace(/^Default:\s*/i, '').trim() || value;
    });
  }

  return result;
}

/**
 * Scrape the Sites table
 * Injected into the Sites page
 */
function scrapeSitesTableFunc() {
  console.log('[scrapeSitesTableFunc] Starting Sites table scraping...');
  
  const result = {
    total: 0,
    active: 0,
    inactive: 0,
    sites: []
  };

  // Find the "All Sites" h3 element
  const h3Elements = document.querySelectorAll('h3');
  let allSitesH3 = null;
  
  h3Elements.forEach(h3 => {
    if (h3.textContent.trim() === 'All Sites') {
      allSitesH3 = h3;
      console.log('[scrapeSitesTableFunc] ✓ Found "All Sites" h3 element');
    }
  });

  if (!allSitesH3) {
    console.warn('[scrapeSitesTableFunc] "All Sites" section not found');
    return result;
  }

  // Navigate up to find the bPageBlock div that contains this h3
  // Structure: div.bPageBlock > div.pbHeader > table > td > h3
  const bPageBlock = allSitesH3.closest('div.bPageBlock');
  
  if (!bPageBlock) {
    console.warn('[scrapeSitesTableFunc] Could not find parent div.bPageBlock');
    return result;
  }

  console.log('[scrapeSitesTableFunc] ✓ Found parent div.bPageBlock');

  // Now find the pbBody div within the same bPageBlock
  const pbBody = bPageBlock.querySelector('div.pbBody');
  
  if (!pbBody) {
    console.warn('[scrapeSitesTableFunc] Could not find div.pbBody');
    return result;
  }

  console.log('[scrapeSitesTableFunc] ✓ Found div.pbBody');

  // Find the table with class "list" inside pbBody
  const tableElement = pbBody.querySelector('table.list');

  if (!tableElement) {
    console.warn('[scrapeSitesTableFunc] Table with class "list" not found in pbBody');
    return result;
  }

  console.log('[scrapeSitesTableFunc] ✓ Found table.list element');

  // Get all data rows
  const dataRows = tableElement.querySelectorAll('tr.dataRow');
  console.log(`[scrapeSitesTableFunc] Found ${dataRows.length} data rows`);

  dataRows.forEach((row, index) => {
    const cells = row.querySelectorAll('th, td');
    
    if (cells.length >= 5) {
      // The 5th cell (index 4) contains the status
      const statusCell = cells[4];
      const status = statusCell.textContent.trim();
      
      // Get site name from first cell
      const nameCell = cells[0];
      const nameSpan = nameCell.querySelector('span.network-name');
      const siteName = nameSpan ? nameSpan.textContent.trim() : 'Unknown';
      
      console.log(`[scrapeSitesTableFunc] Row ${index + 1}: Site="${siteName}", Status="${status}"`);
      
      result.total++;
      
      if (status === 'Active') {
        result.active++;
      } else if (status === 'Inactive') {
        result.inactive++;
      }
      
      result.sites.push({
        name: siteName,
        status: status
      });
    }
  });

  console.log(`[scrapeSitesTableFunc] ✅ Final counts - Total: ${result.total}, Active: ${result.active}, Inactive: ${result.inactive}`);
  return result;
}

/**
 * Check if "All clear over here" text exists on the page
 * Injected into the Release Updates page
 * @returns {boolean}
 */
function checkForAllClearFunc() {
  console.log('[checkForAllClearFunc] Checking for "All clear over here" text...');
  
  // Look for divs that might contain this text
  const allDivs = document.querySelectorAll('div');
  
  for (const div of allDivs) {
    const text = div.textContent.trim();
    if (text.includes('All clear over here')) {
      console.log('[checkForAllClearFunc] ✓ Found "All clear over here"');
      return true;
    }
  }
  
  console.log('[checkForAllClearFunc] ✗ "All clear over here" not found');
  return false;
}

// Export for use in background script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeneralInfoModule;
}
