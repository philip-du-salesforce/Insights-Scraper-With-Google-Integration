// Background service worker for orchestrating the scraping process

// Import all necessary scripts
importScripts(
  'modules/base-module.js',
  'modules/module-manager.js',
  'modules/shared-functions.js',
  'modules/licenses-module.js',
  'modules/profiles-module.js',
  'modules/general-info-module.js',
  'modules/health-check-module.js',
  'modules/storage-module.js',
  'modules/sandboxes-module.js',
  'modules/sharing-settings-module.js',
  'modules/sensitive-data-module.js',
  'modules/login-history-module.js',
  'download-manager.js'
);

// Initialize module manager
const moduleManager = new ModuleManager();

// Register all modules
moduleManager.registerModule('licenses', new LicensesModule());
moduleManager.registerModule('profiles', new ProfilesModule());
moduleManager.registerModule('general-info', new GeneralInfoModule());
moduleManager.registerModule('health-check', new HealthCheckModule());
moduleManager.registerModule('storage', new StorageModule());
moduleManager.registerModule('sandboxes', new SandboxesModule());
moduleManager.registerModule('sharing-settings', new SharingSettingsModule());
moduleManager.registerModule('sensitive-data', new SensitiveDataModule());
moduleManager.registerModule('login-history', new LoginHistoryModule());

let isExtractionActive = false;
let currentExtractionJob = null;

console.log('[Background] Service worker initialized with module system');

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_EXTRACTION') {
    startExtraction(message.modules, message.customerName, message.tabId);
    sendResponse({ success: true });
  } else if (message.type === 'CANCEL_EXTRACTION') {
    cancelExtraction();
    sendResponse({ success: true });
  } else if (message.type === 'GENERATE_TXT') {
    createAndDownloadTxtFile(message.data)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('Error creating TXT file:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
  return true;
});

/**
 * Start the extraction process for selected modules
 * @param {Array<string>} moduleIds - Array of module IDs to execute
 * @param {string} customerName - Customer name for folder structure
 * @param {number} tabId - Active tab ID
 */
async function startExtraction(moduleIds, customerName, tabId) {
  if (isExtractionActive) {
    console.warn('[Background] Extraction already in progress');
    return;
  }

  isExtractionActive = true;
  console.log(`[Background] Starting extraction with modules: ${moduleIds.join(', ')}`);
  console.log(`[Background] Customer: ${customerName}`);

  currentExtractionJob = {
    moduleIds,
    customerName,
    tabId,
    cancelled: false
  };

  try {
    // Enable selected modules
    moduleManager.enableModules(moduleIds);

    const folderName = `${sanitizeFilename(customerName)}_${getCurrentDate()}`;
    let completedCount = 0;
    const totalModules = moduleIds.length;

    // Execute all enabled modules with immediate download callback
    const results = await moduleManager.executeEnabledModules(
      { tabId, customerName },
      // Progress callback - called for progress updates
      (progress) => {
        // Send progress updates to popup
        if (!currentExtractionJob?.cancelled) {
          // Forward the progress update directly to popup
          sendMessageToPopup(progress);
        }
      },
      // Completion callback - called immediately after each module finishes
      async (result) => {
        console.log(`[Background] ✓✓✓ Completion callback triggered for ${result.moduleName}`);
        console.log(`[Background] Result object:`, { moduleId: result.moduleId, moduleName: result.moduleName, success: result.success, dataLength: result.data?.length });
        
        if (currentExtractionJob?.cancelled) {
          console.log(`[Background] Job was cancelled, skipping download`);
          return;
        }
        
        completedCount++;
        console.log(`[Background] Module ${result.moduleName} completed (${completedCount}/${totalModules})`);
        
        // Skip txt file download for login-history module (it only triggers CSV download)
        if (result.moduleId === 'login-history') {
          console.log(`[Background] Login History module - skipping txt file download (CSV download triggered)`);
          sendMessageToPopup({
            type: 'MODULE_COMPLETED',
            moduleId: result.moduleId,
            moduleName: result.moduleName,
            success: result.success,
            filename: 'N/A (CSV download only)',
            current: completedCount,
            total: totalModules
          });
          return;
        }
        
        // Save date format if this is the login history module
        if (result.moduleId === 'login-history' && result.dateFormat) {
          console.log(`[Background] Saving login history date format: ${result.dateFormat}`);
          chrome.storage.local.set({ loginHistoryDateFormat: result.dateFormat });
        }

        console.log(`[Background] Downloading JSON file immediately...`);

        try {
          const filename = `${result.filename}.json`;
          const filepath = `${folderName}/${filename}`;
          const payload = result.jsonPayload != null ? result.jsonPayload : { error: result.error || 'Unknown' };
          const jsonString = JSON.stringify(payload, null, 2);
          const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(jsonString)}`;

          const downloadId = await chrome.downloads.download({
            url: dataUrl,
            filename: filepath,
            saveAs: false,
            conflictAction: 'uniquify'
          });

          console.log(`[Background] ✓✓✓ Downloaded: ${filepath} (ID: ${downloadId})`);

          sendMessageToPopup({
            type: 'MODULE_COMPLETED',
            moduleId: result.moduleId,
            moduleName: result.moduleName,
            filename: filename,
            current: completedCount,
            total: totalModules
          });
          
          console.log(`[Background] ✓✓✓ All steps completed successfully for ${result.moduleName}`);
          
        } catch (downloadError) {
          console.error(`[Background] ❌❌❌ Error downloading ${result.moduleName}:`, downloadError);
          console.error('[Background] Error name:', downloadError.name);
          console.error('[Background] Error message:', downloadError.message);
          console.error('[Background] Error stack:', downloadError.stack);
          
          // Notify popup about the error
          sendMessageToPopup({
            type: 'MODULE_ERROR',
            moduleId: result.moduleId,
            moduleName: result.moduleName,
            error: downloadError.message
          });
        }
      }
    );

    // Check if cancelled during execution
    if (currentExtractionJob?.cancelled) {
      console.log('[Background] Extraction was cancelled');
      return;
    }

    console.log(`[Background] All modules completed. Results:`, results);

    // Send completion message to popup (all files already downloaded)
    sendMessageToPopup({
      type: 'EXTRACTION_COMPLETE',
      results: results,
      filename: folderName
    });

    // Auto-trigger Google Sheets upload if enabled (trigger server must be running)
    chrome.storage.local.get(['autoUploadToSheets', 'shareWithEmails'], (storage) => {
      const enabled = storage.autoUploadToSheets !== false;
      if (!enabled) return;
      const shareWith = Array.isArray(storage.shareWithEmails) ? storage.shareWithEmails : [];
      const triggerUrl = 'http://127.0.0.1:8765/upload';
      const body = JSON.stringify({ folder: folderName, shareWith });
      fetch(triggerUrl, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body
      })
        .then(res => res.json())
        .then((data) => {
          console.log('[Background] Auto-upload trigger response:', data);
          sendMessageToPopup({ type: 'AUTO_UPLOAD_RESULT', success: data.success, message: data.message || '', spreadsheetUrl: data.spreadsheetUrl });
        })
        .catch((err) => {
          console.warn('[Background] Auto-upload trigger failed (is the trigger server running?):', err.message);
          sendMessageToPopup({ type: 'AUTO_UPLOAD_RESULT', success: false, message: 'Trigger server not reached. Run: python google_reporting/upload_trigger_server.py' });
        });
    });

    // If Login History was run, trigger login analysis after a delay (server runs script in background)
    const loginHistoryWasRun = results.some(r => r.moduleId === 'login-history');
    // #region agent log
    fetch('http://127.0.0.1:7444/ingest/83f5e77a-0182-41af-9504-9e1ecf738f00',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'99ad26'},body:JSON.stringify({sessionId:'99ad26',location:'background.js:login-analysis-check',message:'Login history run check',data:{moduleIds:results.map(r=>r.moduleId),loginHistoryWasRun},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    if (loginHistoryWasRun) {
      const loginAnalysisDelaySeconds = 15;
      const loginAnalysisUrl = 'http://127.0.0.1:8765/run-login-analysis';
      // #region agent log
      fetch('http://127.0.0.1:7444/ingest/83f5e77a-0182-41af-9504-9e1ecf738f00',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'99ad26'},body:JSON.stringify({sessionId:'99ad26',location:'background.js:before-fetch',message:'About to fetch run-login-analysis',data:{url:loginAnalysisUrl},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
      // #endregion
      fetch(loginAnalysisUrl, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delaySeconds: loginAnalysisDelaySeconds, folder: folderName })
      })
        .then(res => {
          // #region agent log
          fetch('http://127.0.0.1:7444/ingest/83f5e77a-0182-41af-9504-9e1ecf738f00',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'99ad26'},body:JSON.stringify({sessionId:'99ad26',location:'background.js:fetch-response',message:'run-login-analysis response',data:{status:res.status,ok:res.ok},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
          // #endregion
          return res.json();
        })
        .then((data) => {
          // #region agent log
          fetch('http://127.0.0.1:7444/ingest/83f5e77a-0182-41af-9504-9e1ecf738f00',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'99ad26'},body:JSON.stringify({sessionId:'99ad26',location:'background.js:fetch-ok',message:'Login analysis trigger response',data:data,timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
          // #endregion
          console.log('[Background] Login analysis trigger response:', data);
          sendMessageToPopup({ type: 'LOGIN_ANALYSIS_TRIGGERED', success: data.success, message: data.message || '' });
        })
        .catch((err) => {
          // #region agent log
          fetch('http://127.0.0.1:7444/ingest/83f5e77a-0182-41af-9504-9e1ecf738f00',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'99ad26'},body:JSON.stringify({sessionId:'99ad26',location:'background.js:fetch-catch',message:'Login analysis fetch failed',data:{message:err.message,name:err.name},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
          // #endregion
          console.warn('[Background] Login analysis trigger failed (is the trigger server running?):', err.message);
          sendMessageToPopup({ type: 'LOGIN_ANALYSIS_TRIGGERED', success: false, message: 'Trigger server not reached. Run: python google_reporting/upload_trigger_server.py' });
        });
    }

  } catch (error) {
    console.error('[Background] Extraction process error:', error);
    sendMessageToPopup({
      type: 'EXTRACTION_ERROR',
      error: error.message
    });
  } finally {
    isExtractionActive = false;
    currentExtractionJob = null;
  }
}

/**
 * Cancel the current extraction job
 */
function cancelExtraction() {
  if (currentExtractionJob) {
    currentExtractionJob.cancelled = true;
    console.log('[Background] Extraction cancelled by user');
  }
  isExtractionActive = false;
}

/**
 * Send a message to the popup
 * @param {Object} message - Message to send
 */
function sendMessageToPopup(message) {
  chrome.runtime.sendMessage(message).catch(error => {
    // Popup might be closed, that's okay
    console.log('[Background] Could not send message to popup:', error.message);
  });
}

/**
 * Legacy function - Create and download TXT file from scraped profile data
 * Kept for backward compatibility
 */
async function createAndDownloadTxtFile(data) {
  console.log('[Background] Creating TXT file with data:', data);
  
  let output = 'PROFILE ACTIVE USERS REPORT\n';
  output += '='.repeat(80) + '\n\n';
  output += `Generated: ${new Date().toLocaleString()}\n`;
  output += `Total Profiles: ${data.length}\n\n`;
  output += '='.repeat(80) + '\n\n';

  data.forEach((item, index) => {
    output += `${index + 1}. ${item.profileName}\n`;
    output += `-`.repeat(60) + '\n';
    output += `   Modify All Data: ${item.modifyAllData ? 'Yes' : 'No'}\n`;
    output += `   Run Reports: ${item.runReports ? 'Yes' : 'No'}\n`;
    output += `   Export Reports: ${item.exportReports ? 'Yes' : 'No'}\n`;
    output += `   Active Users: ${item.activeUserCount}\n`;
    
    if (item.error) {
      output += `   ERROR: ${item.error}\n`;
    }
    
    output += '\n';
  });

  const blob = new Blob([output], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `profile_active_users_${timestamp}.txt`;

  try {
    await chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    });
    
    console.log('[Background] TXT file download initiated:', filename);
    
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (error) {
    console.error('[Background] Error downloading TXT file:', error);
    throw error;
  }
}

/**
 * Helper delay function
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise} - Promise that resolves after delay
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sanitize filename (remove invalid characters)
 */
function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9-_]/g, '_');
}

/**
 * Get current date in YYYY-MM-DD format
 */
function getCurrentDate() {
  return new Date().toISOString().slice(0, 10);
}
