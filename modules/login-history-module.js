/**
 * Login History Module
 * Downloads login history CSV from Salesforce
 */

class LoginHistoryModule extends BaseModule {
  constructor() {
    super('Login History', 'Download login history CSV file');
  }

  async scrape(context) {
    console.log('[LoginHistoryModule] Starting login history download...');
    
    try {
      // Step 1: Search for "Login History"
      console.log('[LoginHistoryModule] Step 1: Searching for "Login History"...');
      const searchResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: searchFunc,
        args: ['Login History']
      });

      if (!searchResult[0]?.result?.success) {
        throw new Error(`Search failed: ${searchResult[0]?.result?.error || 'Unknown error'}`);
      }

      await this.delay(2000); // Wait for search results

      // Step 2: Find and click the Login History link
      console.log('[LoginHistoryModule] Step 2: Clicking on Login History link...');
      const clickLinkResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: clickElementFunc,
        args: ['a#OrgLoginHistory_font']
      });

      if (!clickLinkResult[0]?.result?.success) {
        throw new Error(`Failed to click Login History link: ${clickLinkResult[0]?.result?.error || 'Unknown error'}`);
      }

      await this.delay(5000); // Wait for page to load

      // Step 3: Find and click the download button
      console.log('[LoginHistoryModule] Step 3: Clicking download button...');
      const clickDownloadResult = await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: clickElementFunc,
        args: ['input#downloadHistoryNow']
      });

      if (!clickDownloadResult[0]?.result?.success) {
        throw new Error(`Failed to click download button: ${clickDownloadResult[0]?.result?.error || 'Unknown error'}`);
      }

      // Step 4: Wait 10 seconds for download to start
      console.log('[LoginHistoryModule] Step 4: Waiting 10 seconds for download to start...');
      await this.delay(10000);

      console.log('[LoginHistoryModule] Download initiated successfully');

      return {
        success: true,
        message: 'Login History CSV download initiated successfully'
      };

    } catch (error) {
      console.error('[LoginHistoryModule] Error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  formatData(data) {
    // This module doesn't generate a txt file - it only triggers CSV download
    // Return empty string since the file won't be downloaded
    return '';
  }

  getJsonPayload(data) {
    return data && typeof data === 'object' ? data : { csvDownloadOnly: true };
  }

  getFilename() {
    return '8_login_history';
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LoginHistoryModule;
}
