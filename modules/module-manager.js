/**
 * Module Manager
 * Central registry for all scraping modules
 * Handles module loading, execution, and orchestration
 */

// Import base module (will be loaded via importScripts in background.js)
// Import all module implementations

class ModuleManager {
  constructor() {
    this.modules = new Map();
    this.executionOrder = [];
  }

  /**
   * Register a module
   * @param {string} id - Unique module identifier
   * @param {BaseModule} moduleInstance - Instance of a module class
   */
  registerModule(id, moduleInstance) {
    if (this.modules.has(id)) {
      console.warn(`Module ${id} is already registered. Overwriting...`);
    }
    this.modules.set(id, moduleInstance);
    console.log(`[ModuleManager] Registered module: ${id}`);
  }

  /**
   * Get a module by ID
   * @param {string} id - Module identifier
   * @returns {BaseModule|null}
   */
  getModule(id) {
    return this.modules.get(id) || null;
  }

  /**
   * Get all registered modules
   * @returns {Array<{id: string, module: BaseModule}>}
   */
  getAllModules() {
    const result = [];
    for (const [id, module] of this.modules.entries()) {
      result.push({ id, module });
    }
    return result;
  }

  /**
   * Enable specific modules by ID
   * @param {Array<string>} moduleIds - Array of module IDs to enable (order matters)
   */
  enableModules(moduleIds) {
    // First disable all
    for (const module of this.modules.values()) {
      module.disable();
    }
    
    // Store the execution order (preserves the order from the popup)
    this.executionOrder = [];
    
    // Then enable selected in the specified order
    for (const id of moduleIds) {
      const module = this.modules.get(id);
      if (module) {
        module.enable();
        this.executionOrder.push(id);
        console.log(`[ModuleManager] Enabled module: ${id}`);
      } else {
        console.warn(`[ModuleManager] Module not found: ${id}`);
      }
    }
  }

  /**
   * Get all enabled modules in the order they were enabled
   * @returns {Array<{id: string, module: BaseModule}>}
   */
  getEnabledModules() {
    const result = [];
    // Use the stored execution order to maintain the order from the popup
    for (const id of this.executionOrder) {
      const module = this.modules.get(id);
      if (module && module.isEnabled) {
        result.push({ id, module });
      }
    }
    return result;
  }

  /**
   * Execute all enabled modules
   * @param {Object} context - Execution context (tab, customerName, etc.)
   * @param {Function} progressCallback - Called with progress updates
   * @param {Function} completionCallback - Called when each module completes
   * @returns {Promise<Array<{moduleId: string, moduleName: string, data: Object, filename: string, error?: string}>>}
   */
  async executeEnabledModules(context, progressCallback, completionCallback) {
    const enabledModules = this.getEnabledModules();
    const results = [];
    const total = enabledModules.length;
    let current = 0;

    console.log(`[ModuleManager] Executing ${total} enabled modules`);

    for (const { id, module } of enabledModules) {
      current++;
      
      try {
        // Send start notification
        if (progressCallback) {
          progressCallback({
            type: 'MODULE_STARTED',
            moduleId: id,
            moduleName: module.name,
            current,
            total
          });
        }

        console.log(`[ModuleManager] Executing module: ${id} (${current}/${total})`);

        // Initialize module
        await module.initialize();

        // Validate if module can run
        const validation = await module.validate();
        if (!validation.valid) {
          throw new Error(validation.message || 'Module validation failed');
        }

        // Execute scraping (pass progressCallback in context for granular progress)
        const enrichedContext = {
          ...context,
          progressCallback: (progressUpdate) => {
            if (progressCallback) {
              progressCallback(progressUpdate);
            }
          }
        };
        // #region agent log
        try {
          fetch('http://127.0.0.1:7444/ingest/83f5e77a-0182-41af-9504-9e1ecf738f00', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'bc283e' }, body: JSON.stringify({ sessionId: 'bc283e', location: 'module-manager.js:beforeScrape', message: 'about to call module.scrape', data: { moduleId: id, tabId: context.tabId }, timestamp: Date.now(), hypothesisId: 'H2' }) }).catch(() => {});
        } catch (e) {}
        // #endregion
        const data = await module.scrape(enrichedContext);
        // #region agent log
        try {
          fetch('http://127.0.0.1:7444/ingest/83f5e77a-0182-41af-9504-9e1ecf738f00', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'bc283e' }, body: JSON.stringify({ sessionId: 'bc283e', location: 'module-manager.js:afterScrape', message: 'module.scrape resolved', data: { moduleId: id }, timestamp: Date.now(), hypothesisId: 'H5' }) }).catch(() => {});
        } catch (e) {}
        // #endregion

        // Format data
        const formattedData = module.formatData(data);

        // Structured JSON payload for .json output and sheet mapping
        const jsonPayload = typeof module.getJsonPayload === 'function'
          ? module.getJsonPayload(data)
          : data;

        // Collect result
        const result = {
          moduleId: id,
          moduleName: module.name,
          data: formattedData,
          filename: module.getFilename(),
          success: true,
          rawData: data,
          jsonPayload: jsonPayload
        };
        
        // Add dateFormat if module has getDateFormat method
        if (typeof module.getDateFormat === 'function') {
          result.dateFormat = module.getDateFormat();
        }
        
        results.push(result);

        console.log(`[ModuleManager] ✓ Module ${id} completed successfully`);
        console.log(`[ModuleManager] Result data length: ${formattedData?.length || 0} characters`);
        
        // Call completion callback immediately (for auto-download)
        if (completionCallback) {
          console.log(`[ModuleManager] Calling completion callback for ${id}...`);
          try {
            await completionCallback(result);
            console.log(`[ModuleManager] ✓ Completion callback finished for ${id}`);
          } catch (cbError) {
            console.error(`[ModuleManager] ❌ Error in completion callback for ${id}:`, cbError);
          }
        } else {
          console.warn(`[ModuleManager] ⚠️ No completion callback provided for ${id}`);
        }

      } catch (error) {
        // #region agent log
        try {
          fetch('http://127.0.0.1:7444/ingest/83f5e77a-0182-41af-9504-9e1ecf738f00', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'bc283e' }, body: JSON.stringify({ sessionId: 'bc283e', location: 'module-manager.js:catch', message: 'module threw', data: { moduleId: id, errorMessage: error?.message, errorName: error?.name }, timestamp: Date.now(), hypothesisId: 'H5' }) }).catch(() => {});
        } catch (e) {}
        // #endregion
        console.error(`[ModuleManager] Module ${id} failed:`, error);
        
        const result = {
          moduleId: id,
          moduleName: module.name,
          data: `Error: ${error.message}`,
          filename: module.getFilename(),
          error: error.message,
          success: false,
          jsonPayload: { error: error.message }
        };
        
        // Add dateFormat if module has getDateFormat method (even on error)
        if (typeof module.getDateFormat === 'function') {
          result.dateFormat = module.getDateFormat();
        }
        
        results.push(result);
        
        // Call completion callback even for errors
        if (completionCallback) {
          await completionCallback(result);
        }
      }

      // Small delay between modules
      await delay(500);
    }

    console.log(`[ModuleManager] All modules executed. ${results.filter(r => r.success).length}/${total} succeeded`);
    return results;
  }
}

/**
 * Helper delay function
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ModuleManager;
}
