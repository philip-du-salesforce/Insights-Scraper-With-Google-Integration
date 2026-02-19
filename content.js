// Content script for extracting data from web pages

// This function extracts key information from the current page
function extractPageData() {
  const data = {
    url: window.location.href,
    title: document.title || '',
    metaDescription: '',
    h1: '',
    h2s: [],
    ogTitle: '',
    ogDescription: '',
    ogImage: '',
    timestamp: new Date().toISOString()
  };

  // Extract meta description
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) {
    data.metaDescription = metaDesc.getAttribute('content') || '';
  }

  // Extract H1 heading
  const h1 = document.querySelector('h1');
  if (h1) {
    data.h1 = h1.textContent.trim();
  }

  // Extract first 3 H2 headings
  const h2s = document.querySelectorAll('h2');
  data.h2s = Array.from(h2s)
    .slice(0, 3)
    .map(h2 => h2.textContent.trim())
    .filter(text => text.length > 0);

  // Extract Open Graph tags
  const ogTitleMeta = document.querySelector('meta[property="og:title"]');
  if (ogTitleMeta) {
    data.ogTitle = ogTitleMeta.getAttribute('content') || '';
  }

  const ogDescMeta = document.querySelector('meta[property="og:description"]');
  if (ogDescMeta) {
    data.ogDescription = ogDescMeta.getAttribute('content') || '';
  }

  const ogImageMeta = document.querySelector('meta[property="og:image"]');
  if (ogImageMeta) {
    data.ogImage = ogImageMeta.getAttribute('content') || '';
  }

  // Additional useful metadata
  const keywords = document.querySelector('meta[name="keywords"]');
  if (keywords) {
    data.keywords = keywords.getAttribute('content') || '';
  }

  const author = document.querySelector('meta[name="author"]');
  if (author) {
    data.author = author.getAttribute('content') || '';
  }

  return data;
}

/**
 * Extract customer name from the page
 * Looks for element with class 'blackTabBannerTxt'
 * @returns {string|null} Customer name or null if not found
 */
function getCustomerName() {
  try {
    const bannerElement = document.querySelector('.blackTabBannerTxt');
    
    if (bannerElement) {
      const text = bannerElement.textContent.trim();
      if (text) {
        console.log('[getCustomerName] Found customer name:', text);
        return text;
      }
    }

    console.log('[getCustomerName] Element with class blackTabBannerTxt not found');
    return null;
  } catch (error) {
    console.error('[getCustomerName] Error extracting customer name:', error);
    return null;
  }
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT_DATA') {
    try {
      const data = extractPageData();
      sendResponse({ success: true, data });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true; // Keep the message channel open for async response
  } else if (message.type === 'GET_CUSTOMER_NAME') {
    try {
      const customerName = getCustomerName();
      sendResponse({ success: true, customerName });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }
});

// Export for use in popup
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extractPageData, getCustomerName };
}
