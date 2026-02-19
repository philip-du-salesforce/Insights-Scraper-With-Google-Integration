// TXT file generation with tab-separated values

// Store the base filename to use for incremental updates
let currentTxtFilename = null;

/**
 * Appends scraped data to TXT file after each profile is processed
 * Downloads an updated version of the file with all data so far
 * @param {Array<Object>} scrapedData - Array of all scraped profile data so far
 * @param {number} current - Current profile number
 * @param {number} total - Total number of profiles to scrape
 */
async function appendToTxtFile(scrapedData, current, total) {
  console.log(`=== Appending to TXT File (Profile ${current}/${total}) ===`);
  
  // Generate filename on first call
  if (!currentTxtFilename) {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
    currentTxtFilename = `salesforce_profiles_${timestamp}`;
  }
  
  // Prepare lines for TXT file
  const lines = [];
  
  // Add header row (tab-separated)
  lines.push('Profile Name\tModify All Data\tRun Reports\tExport Reports\tNumber of Active Users');

  // Add data rows (tab-separated)
  scrapedData.forEach((item) => {
    const profileName = item.profileName || item.url || 'Unknown';
    const modifyAllData = item.modifyAllData ? 'True' : 'False';
    const runReports = item.runReports ? 'True' : 'False';
    const exportReports = item.exportReports ? 'True' : 'False';
    const activeUserCount = item.activeUserCount || 0;
    
    lines.push(`${profileName}\t${modifyAllData}\t${runReports}\t${exportReports}\t${activeUserCount}`);
  });

  // Join lines with newline character
  const txtContent = lines.join('\n');
  
  // Generate filename with progress indicator
  const filename = `${currentTxtFilename}_${current}_of_${total}.txt`;
  
  // Convert to blob, then to base64 for Chrome downloads API
  const blob = new Blob([txtContent], { 
    type: 'text/plain;charset=utf-8' 
  });
  
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  const dataUrl = `data:text/plain;charset=utf-8;base64,${base64}`;
  
  // Download the file (will replace previous version)
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: false,  // Don't prompt, auto-download
      conflictAction: 'overwrite'  // Overwrite previous version
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('Download failed:', chrome.runtime.lastError);
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        console.log(`TXT file updated with ID: ${downloadId} (${current}/${total} profiles)`);
        resolve(downloadId);
      }
    });
  });
}

/**
 * Creates and downloads a final TXT file from scraped data
 * @param {Array<Object>} scrapedData - Array of scraped profile data
 */
async function createAndDownloadTxtFile(scrapedData) {
  console.log('=== Creating Final TXT File ===');
  console.log(`Number of profiles: ${scrapedData.length}`);
  
  // Prepare lines for TXT file
  const lines = [];
  
  // Add header row (tab-separated)
  lines.push('Profile Name\tModify All Data\tRun Reports\tExport Reports\tNumber of Active Users');

  // Add data rows (tab-separated)
  scrapedData.forEach((item) => {
    const profileName = item.profileName || item.url || 'Unknown';
    const modifyAllData = item.modifyAllData ? 'True' : 'False';
    const runReports = item.runReports ? 'True' : 'False';
    const exportReports = item.exportReports ? 'True' : 'False';
    const activeUserCount = item.activeUserCount || 0;
    
    lines.push(`${profileName}\t${modifyAllData}\t${runReports}\t${exportReports}\t${activeUserCount}`);
  });

  // Join lines with newline character
  const txtContent = lines.join('\n');
  
  // Use stored filename or generate new one
  let filename;
  if (currentTxtFilename) {
    filename = `${currentTxtFilename}_FINAL.txt`;
    // Reset for next scraping session
    currentTxtFilename = null;
  } else {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
    filename = `salesforce_profiles_${timestamp}_FINAL.txt`;
  }
  
  // Convert to blob, then to base64 for Chrome downloads API
  const blob = new Blob([txtContent], { 
    type: 'text/plain;charset=utf-8' 
  });
  
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  const dataUrl = `data:text/plain;charset=utf-8;base64,${base64}`;
  
  // Download the file with saveAs prompt for final version
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('Download failed:', chrome.runtime.lastError);
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        console.log('Final TXT file downloaded successfully with ID:', downloadId);
        resolve(downloadId);
      }
    });
  });
}
