/**
 * Base Module Class
 * Abstract base class that all scraping modules should extend
 */
class BaseModule {
  /**
   * @param {string} name - Module name
   * @param {string} description - Module description
   */
  constructor(name, description) {
    if (new.target === BaseModule) {
      throw new TypeError("Cannot construct BaseModule instances directly");
    }
    this.name = name;
    this.description = description;
    this.isEnabled = false;
  }

  /**
   * Initialize the module (optional override)
   * Called before scraping begins
   */
  async initialize() {
    console.log(`[${this.name}] Initializing...`);
  }

  /**
   * Validate if the module can run on the current page (optional override)
   * @returns {Promise<{valid: boolean, message?: string}>}
   */
  async validate() {
    return { valid: true };
  }

  /**
   * Main scraping method - MUST be implemented by child classes
   * @param {Object} context - Context object with tab info, customer name, etc.
   * @returns {Promise<Object>} - Scraped data object
   */
  async scrape(context) {
    throw new Error(`scrape() method must be implemented by ${this.name} module`);
  }

  /**
   * Format the scraped data into text for inclusion in ZIP
   * @param {Object} data - Raw scraped data
   * @returns {string} - Formatted text content
   */
  formatData(data) {
    throw new Error(`formatData() method must be implemented by ${this.name} module`);
  }

  /**
   * Get the filename for this module's output
   * @returns {string} - Filename (without extension)
   */
  getFilename() {
    return this.name.toLowerCase().replace(/\s+/g, '-');
  }

  /**
   * Return the structured JSON payload for this module (used for .json output and sheet mapping).
   * Override in subclasses to return a consistent shape. Default returns data as-is.
   * @param {Object} data - Raw scraped data from scrape()
   * @returns {Object} - Serializable object for JSON.stringify
   */
  getJsonPayload(data) {
    return data;
  }

  /**
   * Enable this module
   */
  enable() {
    this.isEnabled = true;
  }

  /**
   * Disable this module
   */
  disable() {
    this.isEnabled = false;
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BaseModule;
}
