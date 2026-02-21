/**
 * Download Manager
 * Handles downloading files with folder path suggestions
 */

/**
 * Download module results to files with folder structure
 * @param {string} customerName - Customer name for folder
 * @param {Array} moduleResults - Array of module results
 * @returns {Promise<Array>} Array of download IDs
 */
async function downloadModuleResults(customerName, moduleResults) {
  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const folderName = `${sanitizeFilename(customerName.replace(/_/g, ' '))}_${timestamp}`;
  
  console.log(`[DownloadManager] Downloading ${moduleResults.length} files to folder: ${folderName}`);
  
  const downloadIds = [];
  
  for (const result of moduleResults) {
    try {
      const ext = result.jsonPayload != null ? 'json' : 'txt';
      const filename = `${result.filename}.${ext}`;
      const filepath = `${folderName}/${filename}`;
      const content = result.jsonPayload != null
        ? JSON.stringify(result.jsonPayload, null, 2)
        : (result.data || '');
      const mimeType = result.jsonPayload != null ? 'application/json' : 'text/plain';
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      
      // Download file with suggested folder path
      const downloadId = await chrome.downloads.download({
        url: url,
        filename: filepath,
        saveAs: false // Don't show save dialog for each file
      });
      
      downloadIds.push(downloadId);
      console.log(`[DownloadManager] Downloaded: ${filepath} (ID: ${downloadId})`);
      
      // Clean up blob URL after a delay
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      
    } catch (error) {
      console.error(`[DownloadManager] Error downloading ${result.filename}:`, error);
    }
  }
  
  return downloadIds;
}

/**
 * Sanitize folder/filename: keep spaces, remove only invalid path characters
 * @param {string} name - Original name
 * @returns {string} Sanitized name
 */
function sanitizeFilename(name) {
  return String(name).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim().replace(/_+/g, '_') || 'Unknown_Customer';
}

/**
 * Get current date in YYYY-MM-DD format
 * @returns {string} Formatted date
 */
function getCurrentDate() {
  return new Date().toISOString().split('T')[0];
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { downloadModuleResults, sanitizeFilename, getCurrentDate };
}
