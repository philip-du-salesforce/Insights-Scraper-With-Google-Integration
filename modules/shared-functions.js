/**
 * Shared Functions for Module Injection
 * These are standalone functions that can be injected into pages by any module
 * Must be imported in background.js via importScripts()
 */

/**
 * Reusable search function
 * Finds the search box and enters the search text
 * Can be used by any module that needs to search
 * 
 * @param {string} searchText - Text to search for
 * @returns {Object} - {success: boolean, error?: string}
 * 
 * Usage in a module:
 *   const result = await chrome.scripting.executeScript({
 *     target: { tabId: context.tabId },
 *     func: searchFunc,
 *     args: ['Health Check']
 *   });
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
 * Wait for an element to appear on the page
 * Useful for waiting for content to load after navigation
 * 
 * @param {string} selector - CSS selector to wait for
 * @param {number} timeout - Maximum time to wait in milliseconds (default: 10000)
 * @returns {Object} - {success: boolean, error?: string}
 * 
 * Usage in a module:
 *   const result = await chrome.scripting.executeScript({
 *     target: { tabId: context.tabId },
 *     func: waitForElementFunc,
 *     args: ['.myElement', 5000]
 *   });
 */
function waitForElementFunc(selector, timeout = 10000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    const checkElement = () => {
      const element = document.querySelector(selector);
      
      if (element) {
        console.log('[waitForElementFunc] Element found:', selector);
        resolve({ success: true });
        return;
      }
      
      if (Date.now() - startTime >= timeout) {
        console.error('[waitForElementFunc] Timeout waiting for element:', selector);
        resolve({ success: false, error: `Timeout waiting for ${selector}` });
        return;
      }
      
      // Check again in 100ms
      setTimeout(checkElement, 100);
    };
    
    checkElement();
  });
}

/**
 * Click an element by selector
 * 
 * @param {string} selector - CSS selector for the element to click
 * @returns {Object} - {success: boolean, error?: string}
 * 
 * Usage in a module:
 *   const result = await chrome.scripting.executeScript({
 *     target: { tabId: context.tabId },
 *     func: clickElementFunc,
 *     args: ['#myButton']
 *   });
 */
function clickElementFunc(selector) {
  try {
    const element = document.querySelector(selector);
    
    if (!element) {
      console.error('[clickElementFunc] Element not found:', selector);
      return { success: false, error: `Element not found: ${selector}` };
    }
    
    console.log('[clickElementFunc] Clicking element:', selector);
    element.click();
    
    return { success: true };
    
  } catch (error) {
    console.error('[clickElementFunc] Error:', error);
    return { success: false, error: error.message };
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    searchFunc,
    waitForElementFunc,
    clickElementFunc
  };
}
