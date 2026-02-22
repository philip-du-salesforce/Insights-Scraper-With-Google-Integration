// Popup script for handling UI interactions

// DOM elements
const extractDataBtn = document.getElementById('extract-data-btn');
const cancelBtn = document.getElementById('cancel-btn');
const statusEl = document.getElementById('status');
const progressSection = document.getElementById('progress-section');
const modulesProgress = document.getElementById('modules-progress');
const progressSummary = document.getElementById('progress-summary');
const resultsSection = document.getElementById('results-section');
const resultsSummary = document.getElementById('results-summary');
const errorSection = document.getElementById('error-section');
const errorMessage = document.getElementById('error-message');
const customerNameEl = document.getElementById('customer-name');

// Module checkboxes
const moduleCheckboxes = {
  licenses: document.getElementById('module-licenses'),
  profiles: document.getElementById('module-profiles'),
  generalInfo: document.getElementById('module-general-info'),
  healthCheck: document.getElementById('module-health-check'),
  storage: document.getElementById('module-storage'),
  sandboxes: document.getElementById('module-sandboxes'),
  sharingSettings: document.getElementById('module-sharing-settings'),
  sensitiveData: document.getElementById('module-sensitive-data'),
  loginHistory: document.getElementById('module-login-history')
};

// Select All toggle
const selectAllToggle = document.getElementById('uncheck-all');

let customerName = 'Unknown_Customer';
let isExtracting = false;

/**
 * Initialize popup - detect customer name automatically
 */
async function initialize() {
  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      customerNameEl.textContent = 'No active tab';
      return;
    }

    // Inject and execute customer name detection
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: getCustomerNameFromPage
    });

    const detectedName = results[0]?.result;
    
    if (detectedName) {
      customerName = detectedName;
      customerNameEl.textContent = customerName;
      console.log('Customer name detected:', customerName);
    } else {
      customerName = 'Unknown_Customer';
      customerNameEl.textContent = 'Not detected';
      console.log('Customer name not detected, using default');
    }

  } catch (error) {
    console.error('Error detecting customer name:', error);
    customerNameEl.textContent = 'Detection failed';
    customerName = 'Unknown_Customer';
  }
}

/**
 * Function to extract customer name from page
 * This function is injected into the active tab
 */
function getCustomerNameFromPage() {
  try {
    // Look for element with class blackTabBannerTxt
    const bannerElement = document.querySelector('.blackTabBannerTxt');
    
    if (bannerElement) {
      const text = bannerElement.textContent.trim();
      if (text) {
        console.log('Found customer name:', text);
        return text;
      }
    }

    console.log('Element with class blackTabBannerTxt not found');
    return null;
  } catch (error) {
    console.error('Error extracting customer name:', error);
    return null;
  }
}

/**
 * Get selected modules in the same order as they appear in the popup
 */
function getSelectedModules() {
  const selected = [];
  
  // Order matches the popup display order
  if (moduleCheckboxes.licenses.checked) selected.push('licenses');
  if (moduleCheckboxes.profiles.checked) selected.push('profiles');
  if (moduleCheckboxes.generalInfo.checked) selected.push('general-info');
  if (moduleCheckboxes.healthCheck.checked) selected.push('health-check');
  if (moduleCheckboxes.storage.checked) selected.push('storage');
  if (moduleCheckboxes.sandboxes.checked) selected.push('sandboxes');
  if (moduleCheckboxes.sharingSettings.checked) selected.push('sharing-settings');
  if (moduleCheckboxes.sensitiveData.checked) selected.push('sensitive-data');
  if (moduleCheckboxes.loginHistory.checked) selected.push('login-history');
  
  return selected;
}

/**
 * Run Script button click handler
 */
extractDataBtn.addEventListener('click', async () => {
  try {
    const selectedModules = getSelectedModules();
    
    if (selectedModules.length === 0) {
      showError('Please select at least one module to extract');
      return;
    }

    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      showError('No active tab found');
      return;
    }

    // Hide results and errors
    resultsSection.style.display = 'none';
    errorSection.style.display = 'none';

    // Show progress
    progressSection.style.display = 'block';
    progressSummary.textContent = `0/${selectedModules.length} completed`;
    statusEl.textContent = 'Extracting...';
    
    // Initialize individual module progress bars
    initializeModuleProgress(selectedModules);

    // Disable button and show cancel
    extractDataBtn.disabled = true;
    cancelBtn.style.display = 'inline-block';
    isExtracting = true;

    // Send primary share from dropdown at click time (no async get so value is never lost)
    const primaryShareEl = document.getElementById('primary-share-select');
    const primaryShareEmail = (primaryShareEl && primaryShareEl.value && primaryShareEl.value.trim()) ? primaryShareEl.value.trim() : undefined;
    chrome.runtime.sendMessage({
      type: 'START_EXTRACTION',
      modules: selectedModules,
      customerName: customerName,
      tabId: tab.id,
      primaryShareEmail
    });

  } catch (error) {
    console.error('Error starting extraction:', error);
    showError(`Error: ${error.message}`);
    resetUI();
  }
});

/**
 * Cancel button click handler
 */
cancelBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CANCEL_EXTRACTION' });
  statusEl.textContent = 'Cancelled';
  progressSection.style.display = 'none';
  resetUI();
});

/**
 * Initialize individual module progress bars
 */
function initializeModuleProgress(moduleIds) {
  modulesProgress.innerHTML = '';
  
  const moduleNames = {
    'licenses': 'Licenses',
    'profiles': 'Profiles',
    'general-info': 'General Information',
    'health-check': 'Health Check',
    'storage': 'Storage',
    'sandboxes': 'Sandboxes',
    'sharing-settings': 'Sharing Settings',
    'sensitive-data': 'Sensitive Data',
    'login-history': 'Download Login History'
  };
  
  moduleIds.forEach(moduleId => {
    const item = document.createElement('div');
    item.className = 'module-progress-item';
    item.id = `module-progress-${moduleId}`;
    item.innerHTML = `
      <div class="module-progress-header">
        <div class="module-progress-name">
          <span class="module-progress-icon">⏳</span>
          <span>${moduleNames[moduleId] || moduleId}</span>
        </div>
        <span class="module-progress-status status-pending">Pending</span>
      </div>
      <div class="module-progress-bar">
        <div class="module-progress-fill" style="width: 0%;">0%</div>
      </div>
      <div class="module-progress-message">Waiting to start...</div>
    `;
    modulesProgress.appendChild(item);
  });
}

/**
 * Update module progress
 */
function updateModuleProgress(moduleId, percentage, status, message) {
  const item = document.getElementById(`module-progress-${moduleId}`);
  if (!item) return;
  
  const icon = item.querySelector('.module-progress-icon');
  const statusBadge = item.querySelector('.module-progress-status');
  const progressFill = item.querySelector('.module-progress-fill');
  const messageEl = item.querySelector('.module-progress-message');
  
  // Update progress bar
  progressFill.style.width = `${percentage}%`;
  progressFill.textContent = `${percentage}%`;
  
  // Update status and styling
  item.className = 'module-progress-item';
  
  if (status === 'processing') {
    item.classList.add('active');
    icon.textContent = '⚙️';
    statusBadge.textContent = 'Processing';
    statusBadge.className = 'module-progress-status status-processing';
  } else if (status === 'completed') {
    item.classList.add('completed');
    icon.textContent = '✅';
    statusBadge.textContent = 'Completed';
    statusBadge.className = 'module-progress-status status-completed';
    progressFill.classList.add('completed');
  } else if (status === 'error') {
    item.classList.add('error');
    icon.textContent = '❌';
    statusBadge.textContent = 'Failed';
    statusBadge.className = 'module-progress-status status-error';
    progressFill.classList.add('error');
  }
  
  // Update message
  if (message) {
    messageEl.textContent = message;
  }
}

/**
 * Listen for messages from background script
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'MODULE_STARTED') {
    const { moduleId, moduleName } = message;
    console.log(`[Popup] Module ${moduleName} started`);
    
    // Update to processing with 0% progress
    updateModuleProgress(moduleId, 0, 'processing', 'Starting extraction...');
    statusEl.textContent = `Processing: ${moduleName}`;
  }
  else if (message.type === 'MODULE_PROGRESS') {
    const { moduleId, moduleName, percentage } = message;
    
    // Update individual module progress bar
    updateModuleProgress(moduleId, percentage, 'processing', 'Extracting data...');
    statusEl.textContent = `Processing: ${moduleName} (${percentage}%)`;
  }
  else if (message.type === 'MODULE_COMPLETED') {
    const { moduleId, moduleName, filename, current, total } = message;
    console.log(`[Popup] Module ${moduleName} completed, file: ${filename}`);
    
    // Update to 100% and completed
    updateModuleProgress(moduleId, 100, 'completed', `Saved: ${filename}`);
    
    // Update overall summary
    progressSummary.textContent = `${current}/${total} completed`;
    statusEl.textContent = `Completed: ${moduleName}`;
  }
  else if (message.type === 'MODULE_ERROR') {
    const { moduleId, moduleName, error } = message;
    console.error(`[Popup] Module ${moduleName} failed:`, error);
    
    // Update to error state
    updateModuleProgress(moduleId, 0, 'error', `Error: ${error}`);
  }
  else if (message.type === 'EXTRACTION_COMPLETE') {
    const { results, filename } = message;
    
    statusEl.textContent = 'Extraction complete!';
    
    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;
    
    resultsSummary.innerHTML = `
      <p><strong>✅ Extraction completed!</strong></p>
      <p><strong>Total modules:</strong> ${results.length}</p>
      <p><strong>Successful:</strong> ${successCount}</p>
      <p><strong>Failed:</strong> ${errorCount}</p>
      <p><strong>Folder:</strong> ${filename}</p>
      <p style="margin-top: 10px; font-size: 12px; color: #666;">
        Files saved. Google Sheets upload triggered (check server or run manually if needed).
      </p>
    `;
    resultsSection.style.display = 'block';
    
    resetUI();
  }
  else if (message.type === 'AUTO_UPLOAD_RESULT') {
    const { success, message: msg, spreadsheetUrl } = message;
    const el = document.getElementById('results-summary');
    if (el) {
      const extra = document.createElement('p');
      extra.style.marginTop = '10px';
      extra.style.fontSize = '12px';
      if (success) {
        extra.innerHTML = '<strong>✅ Google Sheets:</strong> Upload completed.' +
          (spreadsheetUrl ? ` <a href="${spreadsheetUrl}" target="_blank">Open spreadsheet</a>` : '');
      } else {
        extra.innerHTML = '<strong>⚠️ Google Sheets:</strong> ' + (msg || 'Upload not triggered.');
      }
      el.appendChild(extra);
    }
  }
  else if (message.type === 'LOGIN_ANALYSIS_TRIGGERED') {
    const { success, message: msg } = message;
    const el = document.getElementById('results-summary');
    if (el) {
      const extra = document.createElement('p');
      extra.style.marginTop = '8px';
      extra.style.fontSize = '12px';
      extra.innerHTML = success
        ? '<strong>✅ Login analysis:</strong> Started in background (runs after ~15s; output in the same customer folder).'
        : '<strong>⚠️ Login analysis:</strong> ' + (msg || 'Not triggered.');
      el.appendChild(extra);
    }
  }
  else if (message.type === 'EXTRACTION_ERROR') {
    progressSection.style.display = 'none';
    showError(message.error);
    resetUI();
  }
});

/**
 * Show error message
 */
function showError(message) {
  errorMessage.textContent = message;
  errorSection.style.display = 'block';
}

/**
 * Reset UI to ready state
 */
function resetUI() {
  extractDataBtn.disabled = false;
  cancelBtn.style.display = 'none';
  isExtracting = false;
}

/**
 * Handle Select All toggle
 */
selectAllToggle.addEventListener('change', () => {
  const isChecked = selectAllToggle.checked;
  
  // Update all non-disabled module checkboxes
  Object.values(moduleCheckboxes).forEach(checkbox => {
    if (!checkbox.disabled) {
      checkbox.checked = isChecked;
    }
  });
});

// Auto-upload checkbox and "Also share with" dropdown
const autoUploadCheckbox = document.getElementById('auto-upload-sheets');
const shareColleaguesWrap = document.getElementById('share-colleagues-wrap');
const extraShareSelect = document.getElementById('extra-share-select');

function setShareColleaguesVisible(visible) {
  if (shareColleaguesWrap) {
    shareColleaguesWrap.classList.toggle('hidden', !visible);
  }
}

function getSelectedShareEmails() {
  if (!extraShareSelect || !extraShareSelect.value || !extraShareSelect.value.trim()) return [];
  return [extraShareSelect.value.trim()];
}

function getSelectedShareNames() {
  if (!extraShareSelect || extraShareSelect.selectedIndex < 0) return [];
  const opt = extraShareSelect.options[extraShareSelect.selectedIndex];
  const text = (opt && opt.textContent) ? opt.textContent.trim() : '';
  if (!text || !opt.value) return [];
  const dash = text.indexOf(' – ');
  return [dash >= 0 ? text.slice(0, dash).trim() : text];
}

function getPrimaryShareName(selectEl) {
  if (!selectEl || selectEl.selectedIndex < 0) return null;
  const opt = selectEl.options[selectEl.selectedIndex];
  const text = (opt && opt.textContent) ? opt.textContent.trim() : '';
  const dash = text.indexOf(' – ');
  return dash >= 0 ? text.slice(0, dash).trim() : text;
}

const primaryShareSelect = document.getElementById('primary-share-select');
const TRIGGER_SERVER_URL = 'http://127.0.0.1:8765';

function persistPrimaryShare() {
  if (primaryShareSelect && primaryShareSelect.value) {
    chrome.storage.local.set({ primaryShareEmail: primaryShareSelect.value });
  }
}

function syncSharePrefsToServer() {
  const primaryEl = document.getElementById('primary-share-select');
  const primary = (primaryEl && primaryEl.value && primaryEl.value.trim()) ? primaryEl.value.trim() : null;
  const primaryName = getPrimaryShareName(primaryEl);
  const extra = extraShareSelect ? getSelectedShareEmails() : [];
  const extraNames = extraShareSelect ? getSelectedShareNames() : [];
  const body = { primaryShareEmail: primary, primaryName: primaryName || undefined, shareWith: extra, shareWithNames: extraNames };
  fetch(`${TRIGGER_SERVER_URL}/save-share-prefs`, {
    method: 'POST',
    mode: 'cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(() => {}).catch(() => {});
}

if (primaryShareSelect) {
  chrome.storage.local.get(['primaryShareEmail'], (s) => {
    if (s.primaryShareEmail) {
      primaryShareSelect.value = s.primaryShareEmail;
    }
    persistPrimaryShare();
  });
  primaryShareSelect.addEventListener('change', () => {
    persistPrimaryShare();
    syncSharePrefsToServer();
  });
  window.addEventListener('pagehide', () => {
    persistPrimaryShare();
    syncSharePrefsToServer();
  });
}

if (autoUploadCheckbox) {
  chrome.storage.local.get(['autoUploadToSheets', 'shareWithEmails', 'primaryShareEmail', 'extraShareEmail'], (s) => {
    autoUploadCheckbox.checked = s.autoUploadToSheets !== false;
    setShareColleaguesVisible(autoUploadCheckbox.checked);
    if (primaryShareSelect && s.primaryShareEmail) {
      primaryShareSelect.value = s.primaryShareEmail;
    }
    persistPrimaryShare();
    const storedExtra = (s.extraShareEmail && typeof s.extraShareEmail === 'string') ? s.extraShareEmail : (Array.isArray(s.shareWithEmails) && s.shareWithEmails[0]) ? s.shareWithEmails[0] : '';
    if (extraShareSelect && storedExtra) {
      const hasOption = Array.from(extraShareSelect.options).some(opt => opt.value === storedExtra);
      if (hasOption) extraShareSelect.value = storedExtra;
    }
  });
  autoUploadCheckbox.addEventListener('change', () => {
    const checked = autoUploadCheckbox.checked;
    chrome.storage.local.set({ autoUploadToSheets: checked });
    setShareColleaguesVisible(checked);
  });
}

if (extraShareSelect) {
  extraShareSelect.addEventListener('change', () => {
    const emails = getSelectedShareEmails();
    chrome.storage.local.set({ extraShareEmail: emails[0] || '', shareWithEmails: emails });
    syncSharePrefsToServer();
  });
  window.addEventListener('pagehide', () => {
    const emails = getSelectedShareEmails();
    chrome.storage.local.set({ extraShareEmail: emails[0] || '', shareWithEmails: emails });
  });
}

// Initialize when popup opens
initialize();
