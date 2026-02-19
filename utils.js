// Utility functions for the Chrome extension

/**
 * Validates and normalizes a URL
 * @param {string} url - The URL to validate
 * @returns {string|null} - Normalized URL or null if invalid
 */
function validateAndNormalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
      return urlObj.href;
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Sanitizes text data for CSV/Excel output
 * @param {string} text - The text to sanitize
 * @returns {string} - Sanitized text
 */
function sanitizeText(text) {
  if (typeof text !== 'string') {
    return '';
  }
  // Remove extra whitespace and newlines
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Creates a delay promise
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise} - Promise that resolves after the delay
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Formats an array of strings into a single string
 * @param {Array<string>} arr - Array of strings
 * @param {string} separator - Separator to use (default: ', ')
 * @returns {string} - Formatted string
 */
function formatArray(arr, separator = ', ') {
  if (!Array.isArray(arr)) {
    return '';
  }
  return arr.filter(item => item && item.trim()).join(separator);
}

/**
 * Extracts domain from URL
 * @param {string} url - The URL to extract domain from
 * @returns {string} - Domain name or empty string
 */
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (error) {
    return '';
  }
}

/**
 * Generates a filename with timestamp
 * @param {string} prefix - Prefix for the filename
 * @param {string} extension - File extension (default: 'xlsx')
 * @returns {string} - Generated filename
 */
function generateFilename(prefix = 'scraped_data', extension = 'xlsx') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  return `${prefix}_${timestamp}.${extension}`;
}

/**
 * Truncates text to a maximum length
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} - Truncated text
 */
function truncateText(text, maxLength = 100) {
  if (typeof text !== 'string' || text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + '...';
}

/**
 * Checks if a URL is valid and accessible
 * @param {string} url - URL to check
 * @returns {boolean} - True if valid
 */
function isValidUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

/**
 * Removes duplicate URLs from an array
 * @param {Array<string>} urls - Array of URLs
 * @returns {Array<string>} - Array without duplicates
 */
function removeDuplicateUrls(urls) {
  return [...new Set(urls)];
}

/**
 * Formats date to readable string
 * @param {string|Date} date - Date to format
 * @returns {string} - Formatted date string
 */
function formatDate(date) {
  try {
    const d = new Date(date);
    return d.toLocaleString();
  } catch (error) {
    return '';
  }
}

// Export functions for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validateAndNormalizeUrl,
    sanitizeText,
    delay,
    formatArray,
    extractDomain,
    generateFilename,
    truncateText,
    isValidUrl,
    removeDuplicateUrls,
    formatDate
  };
}
