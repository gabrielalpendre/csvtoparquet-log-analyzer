/**
 * ThemeManager - Handles dark/light mode toggling with localStorage persistence.
 * Designed to be loaded in <head> or before DOM content to prevent FOUC.
 */
const ThemeManager = {
  STORAGE_KEY: 'wm-theme-preference',
  VALID_THEMES: ['dark', 'light'],
  DEFAULT_THEME: 'dark',

  /**
   * Initialize the theme system.
   * Reads stored preference from localStorage, validates it, and applies the theme.
   * If no valid preference exists, defaults to dark mode.
   */
  init() {
    var stored = null;
    try {
      stored = localStorage.getItem(this.STORAGE_KEY);
    } catch (e) {
      // localStorage unavailable (private browsing) — fall through to default
    }

    if (!this.isValid(stored)) {
      stored = this.DEFAULT_THEME;
      try {
        localStorage.setItem(this.STORAGE_KEY, this.DEFAULT_THEME);
      } catch (e) {
        // Unable to persist — degrade gracefully
      }
    }

    this.setTheme(stored);
  },

  /**
   * Toggle between dark and light themes.
   * Reads the current theme, flips to the opposite, and applies it.
   */
  toggle() {
    var current = this.getTheme();
    var next = current === 'dark' ? 'light' : 'dark';
    this.setTheme(next);
  },

  /**
   * Get the current active theme from the data-theme attribute.
   * @returns {string} The current theme identifier ('dark' or 'light').
   */
  getTheme() {
    return document.documentElement.getAttribute('data-theme') || this.DEFAULT_THEME;
  },

  /**
   * Apply a specific theme with validation, attribute update, localStorage persistence,
   * and toggle icon update.
   * @param {string} theme - The theme identifier to apply ('dark' or 'light').
   */
  setTheme(theme) {
    if (!this.isValid(theme)) {
      theme = this.DEFAULT_THEME;
    }

    document.documentElement.setAttribute('data-theme', theme);

    try {
      localStorage.setItem(this.STORAGE_KEY, theme);
    } catch (e) {
      // localStorage unavailable — theme applies for current session only
    }

    this._updateIcon(theme);
  },

  /**
   * Check if a value is a recognized theme identifier.
   * @param {*} value - The value to validate.
   * @returns {boolean} True if the value is a valid theme identifier.
   */
  isValid(value) {
    return this.VALID_THEMES.indexOf(value) !== -1;
  },

  /**
   * Update the toggle button icon to reflect the active theme.
   * Icon classes: "bi bi-moon-fill" for dark mode, "bi bi-sun-fill" for light mode.
   * @param {string} theme - The active theme identifier.
   * @private
   */
  _updateIcon(theme) {
    var icon = document.getElementById('themeIcon');
    if (!icon) {
      return;
    }

    if (theme === 'dark') {
      icon.className = 'bi bi-moon-fill';
    } else {
      icon.className = 'bi bi-sun-fill';
    }
  }
};

// Initialize ThemeManager once the DOM is ready.
// The inline <head> script already sets data-theme to prevent FOUC,
// but init() is needed to update the toggle icon and validate state.
document.addEventListener('DOMContentLoaded', function() {
  ThemeManager.init();
});
