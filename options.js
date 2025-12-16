/**
 * Uzei - Literature Review Extension
 * Options Page Script
 * 
 * Handles settings configuration, connection testing,
 * and user preferences management.
 */

// Default configuration settings
const DEFAULT_CONFIG = {
  // Web app settings - fixed deployed URL
  APP_BASE_URL: 'https://uzei.boslis.com',
  CONNECTION_TIMEOUT: 5000,  // 5 seconds
  
  // Extension behavior defaults
  AUTO_EXTRACT: true,
  SHOW_NOTIFICATIONS: true,
  SHOW_BADGES: true,
  CONTEXT_MENU: true,
  ENABLE_MULTI_TAB: true,
  
  // Content extraction defaults
  MIN_CONTENT_LENGTH: 200,
  MAX_CONTENT_LENGTH: 100000
};

/**
 * Show alert message to user
 */
function showAlert(message, type = 'info') {
  const container = document.getElementById('alert-container');
  const alertDiv = document.createElement('div');
  alertDiv.className = `alert alert-${type}`;
  alertDiv.textContent = message;
  
  // Clear existing alerts and show new one
  container.innerHTML = '';
  container.appendChild(alertDiv);
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    if (alertDiv.parentNode) {
      alertDiv.remove();
    }
  }, 5000);
}

/**
 * Update connection status indicator
 */
function updateConnectionStatus(connected, message = '') {
  const statusDiv = document.getElementById('connection-status');
  const indicator = statusDiv.querySelector('.status-indicator');
  const text = statusDiv.querySelector('span') || statusDiv.lastChild;
  
  if (connected === true) {
    indicator.className = 'status-indicator status-connected';
    text.textContent = message || 'Connected to Uzei Literature Review app ✓';
  } else if (connected === false) {
    indicator.className = 'status-indicator status-disconnected';
    text.textContent = message || 'Cannot connect to Uzei Literature Review app ✗';
  } else {
    indicator.className = 'status-indicator status-unknown';
    text.textContent = message || 'Connection status unknown';
  }
}

/**
 * Test connection to the web app
 */
async function testConnection() {
  const testButton = document.getElementById('test-connection');
  
  // Show loading state
  testButton.disabled = true;
  testButton.textContent = 'Testing...';
  updateConnectionStatus(null, 'Testing connection...');
  
  try {
    // Test the health endpoint
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_CONFIG.CONNECTION_TIMEOUT);
    
    const response = await fetch(`${DEFAULT_CONFIG.APP_BASE_URL}/api/health`, {
      method: 'GET',
      signal: controller.signal,
      credentials: 'include',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      updateConnectionStatus(true, `Connected to ${data.app_name || 'Uzei Literature Review app'} ✓`);
      showAlert('Connection successful! Uzei Literature Review app is reachable.', 'success');
      
      // Also check login status
      try {
        const sessionResponse = await fetch(`${DEFAULT_CONFIG.APP_BASE_URL}/api/check_session`, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Accept': 'application/json'
          }
        });
        
        if (sessionResponse.ok) {
          const sessionData = await sessionResponse.json();
          if (sessionData.authenticated) {
            showAlert(`Great! You're also logged in as ${sessionData.username}. The extension is ready to use.`, 'success');
          } else {
            showAlert('Connection successful, but you\'re not logged in. Please log in to the web app to use the extension.', 'info');
          }
        }
      } catch (sessionError) {
        // Session check failed, but connection works
        console.log('Session check failed, but connection works');
      }
      
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
  } catch (error) {
    console.error('Connection test failed:', error);
    
    let errorMessage = 'Cannot connect to Uzei Literature Review app';
    if (error.name === 'AbortError') {
      errorMessage += ' (timeout)';
    } else if (error.message.includes('fetch')) {
      errorMessage += ' (network error)';
    } else {
      errorMessage += ` (${error.message})`;
    }
    
    updateConnectionStatus(false, errorMessage + ' ✗');
    showAlert(`Connection failed: ${error.message}. Make sure you can access the web app.`, 'error');
    
  } finally {
    // Reset button state
    testButton.disabled = false;
    testButton.textContent = 'Test Connection';
  }
}

/**
 * Load saved settings from extension storage
 */
async function loadSettings() {
  try {
    const settings = await new Promise((resolve) => {
      chrome.storage.sync.get([
        'autoExtract',
        'showNotifications',
        'showBadges',
        'contextMenu',
        'enableMultiTab',
        'minContentLength',
        'maxContentLength'
      ], resolve);
    });
    
    // Populate form fields with saved values or defaults
    document.getElementById('auto-extract').checked = settings.autoExtract !== false;
    document.getElementById('show-notifications').checked = settings.showNotifications !== false;
    document.getElementById('show-badges').checked = settings.showBadges !== false;
    document.getElementById('context-menu').checked = settings.contextMenu !== false;
    document.getElementById('enable-multi-tab').checked = settings.enableMultiTab !== false;
    document.getElementById('min-content-length').value = settings.minContentLength || DEFAULT_CONFIG.MIN_CONTENT_LENGTH;
    document.getElementById('max-content-length').value = settings.maxContentLength || DEFAULT_CONFIG.MAX_CONTENT_LENGTH;
    
    console.log('Settings loaded:', settings);
    
  } catch (error) {
    console.error('Error loading settings:', error);
    showAlert('Error loading settings. Using default values.', 'error');
  }
}

/**
 * Save settings to extension storage
 */
async function saveSettings() {
  try {
    const settings = {
      appUrl: DEFAULT_CONFIG.APP_BASE_URL, // Always use the fixed URL
      autoExtract: document.getElementById('auto-extract').checked,
      showNotifications: document.getElementById('show-notifications').checked,
      showBadges: document.getElementById('show-badges').checked,
      contextMenu: document.getElementById('context-menu').checked,
      enableMultiTab: document.getElementById('enable-multi-tab').checked,
      minContentLength: parseInt(document.getElementById('min-content-length').value),
      maxContentLength: parseInt(document.getElementById('max-content-length').value)
    };
    
    // Validate settings
    if (settings.minContentLength < 100 || settings.minContentLength > 5000) {
      showAlert('Minimum content length must be between 100 and 5000 characters', 'error');
      return;
    }
    
    if (settings.maxContentLength < 10000 || settings.maxContentLength > 100000) {
      showAlert('Maximum content length must be between 10,000 and 100,000 characters', 'error');
      return;
    }
    
    if (settings.minContentLength >= settings.maxContentLength) {
      showAlert('Minimum content length must be less than maximum content length', 'error');
      return;
    }
    
    // Save to storage
    await new Promise((resolve, reject) => {
      chrome.storage.sync.set(settings, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
    
    // Notify background script of changes
    chrome.runtime.sendMessage({ 
      action: 'settingsUpdated', 
      settings: settings 
    });
    
    showAlert('Settings saved successfully!', 'success');
    console.log('Settings saved:', settings);
    
  } catch (error) {
    console.error('Error saving settings:', error);
    showAlert(`Error saving settings: ${error.message}`, 'error');
  }
}

/**
 * Reset all settings to default values
 */
async function resetSettings() {
  if (!confirm('Are you sure you want to reset all settings to their default values?')) {
    return;
  }
  
  try {
    // Clear all settings except the fixed app URL
    await new Promise((resolve, reject) => {
      chrome.storage.sync.clear(() => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
    
    // Set the fixed app URL
    await new Promise((resolve, reject) => {
      chrome.storage.sync.set({ appUrl: DEFAULT_CONFIG.APP_BASE_URL }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
    
    // Reload the page to show defaults
    window.location.reload();
    
  } catch (error) {
    console.error('Error resetting settings:', error);
    showAlert(`Error resetting settings: ${error.message}`, 'error');
  }
}

/**
 * Open web app in new tab
 */
function openWebApp() {
  window.open(DEFAULT_CONFIG.APP_BASE_URL, '_blank');
}

/**
 * Setup form validation for number inputs
 */
function setupFormHandlers() {
  // Validate number inputs in real-time
  const numberInputs = ['min-content-length', 'max-content-length'];
  numberInputs.forEach(id => {
    const input = document.getElementById(id);
    input.addEventListener('input', () => {
      const value = parseInt(input.value);
      const min = parseInt(input.min);
      const max = parseInt(input.max);
      
      // Visual feedback for invalid values
      if (isNaN(value) || value < min || value > max) {
        input.style.borderColor = '#dc3545';
      } else {
        input.style.borderColor = '#ced4da';
      }
    });
  });
}

/**
 * Set up all event listeners
 */
function setupEventListeners() {
  // Connection testing
  document.getElementById('test-connection')?.addEventListener('click', testConnection);
  
  // Settings management
  document.getElementById('save-settings')?.addEventListener('click', saveSettings);
  document.getElementById('reset-settings')?.addEventListener('click', resetSettings);
  
  // External links - open web app
  const webAppLinks = document.querySelectorAll('.btn-open-webapp, a[href*="uzei.boslis.com"]');
  webAppLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      openWebApp();
    });
  });
}

/**
 * Initialize options page
 */
async function initialize() {
  console.log('Initializing Uzei - Literature Review options page...');
  
  // Set up event listeners
  setupEventListeners();
  
  // Set up form handlers
  setupFormHandlers();
  
  // Load existing settings
  await loadSettings();
  
  // Set initial connection status
  updateConnectionStatus(null);
  
  console.log('Options page initialized');
  console.log(`Connected to: ${DEFAULT_CONFIG.APP_BASE_URL}`);
}

/**
 * Handle storage changes from other parts of the extension
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync') {
    console.log('Settings changed externally:', changes);
    // Could reload settings here if needed
  }
});

/**
 * Handle messages from background script
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'connectionStatusChanged') {
    updateConnectionStatus(request.connected, request.message);
  }
});

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initialize);

// Handle keyboard shortcuts
document.addEventListener('keydown', (event) => {
  // Ctrl/Cmd + S to save settings
  if (event.ctrlKey || event.metaKey) {
    if (event.key === 's') {
      event.preventDefault();
      saveSettings();
    }
  }
});

// Auto-save logic could be implemented here if desired
window.addEventListener('beforeunload', () => {
  // Could implement auto-save logic here if desired
});