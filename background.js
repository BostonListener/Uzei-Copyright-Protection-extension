/**
 * Uzei - Literature Review Extension
 * Background Service Worker
 * 
 * Handles tab monitoring, session authentication, context menus,
 * communication between content scripts and popup.
 */

// Extension configuration
const CONFIG = {
  // Web app settings
  APP_BASE_URL: 'https://uzei.boslis.com',
  
  // Context menu settings
  CONTEXT_MENU_ENABLED: true,
  
  // Badge settings
  SHOW_BADGE: true,
  BADGE_COLOR: '#007bff',
  
  // Multi-tab settings
  ENABLE_MULTI_TAB_CONTEXT_MENU: true,
  MAX_TABS_IN_CONTEXT_MENU: 10,
  
  // Tab monitoring settings
  MONITOR_ALL_TABS: true,
  VALIDITY_CHECK_DELAY: 2000,
  
  // Session checking
  SESSION_CHECK_INTERVAL: 300000, // 5 minutes
  
  // PDF detection patterns - STRICT VERSION
  PDF_URL_PATTERNS: [
    '.pdf'
  ]
};

// Global state management
let tabValidityCache = new Map();
let pendingValidityChecks = new Set();
let userLoginStatus = { isLoggedIn: false, username: null, lastCheck: 0 };
let extensionSettings = {
  showNotifications: true,
  showBadges: true,
  contextMenu: true,
  enableMultiTab: true,
  autoExtract: true
};

/**
 * Load extension settings from storage
 */
async function loadExtensionSettings() {
  try {
    const settings = await new Promise((resolve) => {
      chrome.storage.sync.get([
        'showNotifications', 
        'showBadges',
        'contextMenu',
        'enableMultiTab',
        'autoExtract'
      ], resolve);
    });
    
    extensionSettings = {
      showNotifications: settings.showNotifications !== false,
      showBadges: settings.showBadges !== false,
      contextMenu: settings.contextMenu !== false,
      enableMultiTab: settings.enableMultiTab !== false,
      autoExtract: settings.autoExtract !== false
    };
    
    console.log('Extension settings loaded in background:', extensionSettings);
    
    // Update context menus based on settings
    if (extensionSettings.contextMenu) {
      createContextMenus();
    } else {
      chrome.contextMenus.removeAll();
    }
    
  } catch (error) {
    console.error('Error loading extension settings in background:', error);
    // Use defaults
    extensionSettings = {
      showNotifications: true,
      showBadges: true,
      contextMenu: true,
      enableMultiTab: true,
      autoExtract: true
    };
  }
}

/**
 * Check if URL points to a PDF document - STRICT VERSION
 */
function isPDFUrl(url) {
  if (!url) return false;
  
  try {
    const urlLower = url.toLowerCase();
    
    // STRICT CHECK 1: Direct PDF file URLs - must end with .pdf
    if (urlLower.endsWith('.pdf')) {
      return true;
    }
    
    // STRICT CHECK 2: PDF with query parameters or fragments
    if (/\.pdf[?#]/i.test(url)) {
      return true;
    }
    
    // STRICT CHECK 3: Known direct PDF patterns only
    // ArXiv direct PDF links
    if (urlLower.includes('arxiv.org/pdf/') && urlLower.match(/arxiv\.org\/pdf\/[\d.]+\.pdf/)) {
      return true;
    }
    
    // Advanced URL object analysis - STRICT version
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    
    // Only if pathname actually ends with .pdf
    if (pathname.endsWith('.pdf')) {
      return true;
    }
    
    return false;
  } catch (error) {
    console.warn('Error checking PDF URL:', error);
    return false;
  }
}

/**
 * Safe wrapper for tab operations that might fail if tab is closed
 */
async function safeTabOperation(operation, fallbackValue = null) {
  try {
    return await operation();
  } catch (error) {
    if (error.message.includes('No tab with id') || 
        error.message.includes('Tab not found') ||
        error.message.includes('Could not establish connection')) {
      return fallbackValue;
    }
    throw error;
  }
}

/**
 * Check if a tab still exists
 */
async function tabExists(tabId) {
  return await safeTabOperation(async () => {
    const tab = await chrome.tabs.get(tabId);
    return !!tab;
  }, false);
}

/**
 * Check user login status with the web app
 */
async function checkLoginStatus() {
  try {
    // Verify session with server directly
    const response = await fetch(`${CONFIG.APP_BASE_URL}/api/check_session`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      userLoginStatus = {
        isLoggedIn: data.authenticated || false,
        username: data.username || null,
        lastCheck: Date.now()
      };
    } else {
      userLoginStatus = { isLoggedIn: false, username: null, lastCheck: Date.now() };
    }
    
    // Update extension badge
    updateLoginBadge();
    
    return userLoginStatus;
    
  } catch (error) {
    console.error('Error checking login status:', error);
    userLoginStatus = { isLoggedIn: false, username: null, lastCheck: Date.now() };
    return userLoginStatus;
  }
}

/**
 * Update extension badge based on login status
 */
function updateLoginBadge() {
  if (!extensionSettings.showBadges) return;
  
  try {
    if (userLoginStatus.isLoggedIn) {
      chrome.action.setBadgeText({ text: '✓' });
      chrome.action.setBadgeBackgroundColor({ color: '#28a745' });
      chrome.action.setTitle({ title: `Uzei - Literature Review - Logged in as ${userLoginStatus.username}` });
    } else {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
      chrome.action.setTitle({ title: 'Uzei - Literature Review - Please log in to the web app' });
    }
  } catch (error) {
    console.error('Error updating login badge:', error);
  }
}

/**
 * Create right-click context menu items
 */
function createContextMenus() {
  if (!extensionSettings.contextMenu) return;
  
  // Remove existing menus first
  chrome.contextMenus.removeAll(() => {
    // Single page context menus
    chrome.contextMenus.create({
      id: 'add-to-literature-review',
      title: 'Add page to Uzei Literature Review',
      contexts: ['page']
    });
    
    chrome.contextMenus.create({
      id: 'add-selection-to-review',
      title: 'Add selected text to Uzei Literature Review',
      contexts: ['selection']
    });
    
    // Multi-tab context menus
    if (extensionSettings.enableMultiTab) {
      chrome.contextMenus.create({
        id: 'separator-1',
        type: 'separator',
        contexts: ['page']
      });
      
      chrome.contextMenus.create({
        id: 'add-all-tabs',
        title: 'Add all valid tabs to Uzei Literature Review',
        contexts: ['page']
      });
      
      chrome.contextMenus.create({
        id: 'add-selected-tabs',
        title: 'Select tabs to add...',
        contexts: ['page']
      });
    }
  });
}

/**
 * Check if a tab URL is suitable for content extraction
 */
function isValidTabUrl(url) {
  if (!url) return false;
  
  try {
    const urlObj = new URL(url);
    
    // Skip browser internal protocols
    if (['chrome:', 'chrome-extension:', 'moz-extension:', 'about:', 'data:', 'javascript:'].some(protocol => 
        urlObj.protocol.startsWith(protocol))) {
      return false;
    }
    
    // Skip our own app to avoid processing app pages
    if (urlObj.hostname === 'uzei.boslis.com') {
      return false;
    }
    
    // Skip search engines - search results aren't article content
    const searchEngines = ['www.google.com', 'www.bing.com', 'duckduckgo.com', 'search.yahoo.com'];
    if (searchEngines.includes(urlObj.hostname)) {
      return false;
    }
    
    // PDFs are valid for server-side processing
    if (isPDFUrl(url)) {
      console.log(`PDF URL detected as valid: ${url}`);
      return true;
    }
    
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get all tabs that are valid for content extraction
 */
async function getValidTabs() {
  try {
    const allTabs = await chrome.tabs.query({});
    return allTabs.filter(tab => isValidTabUrl(tab.url));
  } catch (error) {
    console.error('Error getting valid tabs:', error);
    return [];
  }
}

/**
 * Check if a tab has extractable content
 */
async function checkTabContentValidity(tabId) {
  // Return cached result if available
  if (pendingValidityChecks.has(tabId)) {
    return tabValidityCache.get(tabId) || { valid: false, reason: 'checking' };
  }
  
  if (tabValidityCache.has(tabId)) {
    return tabValidityCache.get(tabId);
  }
  
  // Check if tab still exists
  const exists = await tabExists(tabId);
  if (!exists) {
    const result = { valid: false, reason: 'tab_not_found' };
    tabValidityCache.set(tabId, result);
    return result;
  }
  
  // Get tab info
  const tab = await safeTabOperation(async () => {
    return await chrome.tabs.get(tabId);
  });
  
  if (!tab) {
    const result = { valid: false, reason: 'tab_not_found' };
    tabValidityCache.set(tabId, result);
    return result;
  }
  
  // PDFs are always valid - server will process them
  if (isPDFUrl(tab.url)) {
    const result = { valid: true, reason: 'pdf_detected', isPDF: true };
    tabValidityCache.set(tabId, result);
    return result;
  }
  
  // For non-PDF pages, check content extraction
  pendingValidityChecks.add(tabId);
  
  try {
    const response = await safeTabOperation(async () => {
      return await chrome.tabs.sendMessage(tabId, { action: 'extractContent' });
    });
    
    const result = {
      valid: response && response.success && response.data.isValidContent,
      reason: !response ? 'no_response' : 
              !response.success ? response.error || 'extraction_failed' :
              !response.data.isValidContent ? 'content_too_short' : 'valid',
      data: response?.data
    };
    
    tabValidityCache.set(tabId, result);
    return result;
    
  } catch (error) {
    const result = {
      valid: false,
      reason: 'content_script_error',
      error: error.message
    };
    
    tabValidityCache.set(tabId, result);
    return result;
  } finally {
    pendingValidityChecks.delete(tabId);
  }
}

/**
 * Update tab badges to show content validity status
 */
async function updateTabBadges(specificTabId = null) {
  if (!extensionSettings.showBadges) return;
  
  try {
    let tabs = [];
    
    if (specificTabId) {
      // Update specific tab only
      const exists = await tabExists(specificTabId);
      if (exists) {
        const tab = await safeTabOperation(async () => {
          return await chrome.tabs.get(specificTabId);
        });
        if (tab) {
          tabs = [tab];
        }
      }
    } else {
      // Update all tabs
      tabs = await chrome.tabs.query({});
    }
    
    // Process each tab
    for (const tab of tabs) {
      if (!tab || !tab.id) continue;
      
      // Verify tab still exists
      const stillExists = await tabExists(tab.id);
      if (!stillExists) {
        continue;
      }
      
      // Skip invalid URLs
      if (!isValidTabUrl(tab.url)) {
        await safeTabOperation(async () => {
          await chrome.action.setBadgeText({ text: '', tabId: tab.id });
        });
        continue;
      }
      
      // Handle PDFs
      if (isPDFUrl(tab.url)) {
        await safeTabOperation(async () => {
          if (userLoginStatus.isLoggedIn) {
            await chrome.action.setBadgeText({ text: '✓', tabId: tab.id });
            await chrome.action.setBadgeBackgroundColor({ color: '#28a745', tabId: tab.id });
          } else {
            await chrome.action.setBadgeText({ text: '?', tabId: tab.id });
            await chrome.action.setBadgeBackgroundColor({ color: '#ffc107', tabId: tab.id });
          }
        });
        continue;
      }
      
      // Check content validity for non-PDF tabs
      const validity = await checkTabContentValidity(tab.id);
      
      // Update badge if tab still exists
      const existsForBadge = await tabExists(tab.id);
      if (!existsForBadge) {
        continue;
      }
      
      await safeTabOperation(async () => {
        if (validity.valid && userLoginStatus.isLoggedIn) {
          await chrome.action.setBadgeText({ text: '✓', tabId: tab.id });
          await chrome.action.setBadgeBackgroundColor({ color: '#28a745', tabId: tab.id });
        } else if (validity.valid && !userLoginStatus.isLoggedIn) {
          await chrome.action.setBadgeText({ text: '?', tabId: tab.id });
          await chrome.action.setBadgeBackgroundColor({ color: '#ffc107', tabId: tab.id });
        } else if (validity.reason === 'checking') {
          await chrome.action.setBadgeText({ text: '...', tabId: tab.id });
          await chrome.action.setBadgeBackgroundColor({ color: '#ffc107', tabId: tab.id });
        } else {
          await chrome.action.setBadgeText({ text: '!', tabId: tab.id });
          await chrome.action.setBadgeBackgroundColor({ color: '#dc3545', tabId: tab.id });
        }
      });
    }
  } catch (error) {
    console.error('Error updating tab badges:', error);
  }
}

/**
 * Handle context menu item clicks
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    // Verify tab still exists
    if (!tab || !tab.id || !(await tabExists(tab.id))) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Uzei - Literature Review',
        message: 'Tab no longer exists. Please try again.'
      });
      return;
    }
    
    // Check login status
    const loginStatus = await checkLoginStatus();
    if (!loginStatus.isLoggedIn) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Uzei - Literature Review',
        message: 'Please log in to the web app first. Click the extension icon for instructions.'
      });
      return;
    }
    
    // Handle different context menu actions
    if (info.menuItemId === 'add-to-literature-review') {
      // Clear any pending data
      await chrome.storage.local.remove('pendingSelection');
      
      // Handle PDFs directly
      if (isPDFUrl(tab.url)) {
        console.log('PDF detected in context menu, opening popup directly');
        chrome.action.openPopup();
        return;
      }
      
      // Extract content for non-PDFs
      const response = await safeTabOperation(async () => {
        return await chrome.tabs.sendMessage(tab.id, { action: 'extractContent' });
      });
      
      if (response && response.success && response.data.isValidContent) {
        chrome.action.openPopup();
      } else {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Uzei - Literature Review',
          message: 'This page doesn\'t have enough content for analysis.'
        });
      }
    } 
    else if (info.menuItemId === 'add-selection-to-review') {
      // Handle selected text
      const selectedText = info.selectionText;
      if (selectedText && selectedText.length > 100) {
        const selectionData = {
          url: tab.url,
          title: `Selected text from ${tab.title}`,
          authors: 'Unknown Author',
          content: selectedText,
          abstract: selectedText.substring(0, 200),
          keywords: [],
          publicationYear: new Date().getFullYear(),
          domain: new URL(tab.url).hostname,
          extractedAt: new Date().toISOString(),
          contentLength: selectedText.length,
          isValidContent: selectedText.length >= 100,
          isSelection: true
        };
        
        await chrome.storage.local.set({ 'pendingSelection': selectionData });
        chrome.action.openPopup();
      } else {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Uzei - Literature Review',
          message: 'Selected text is too short. Please select at least 100 characters.'
        });
      }
    }
    else if (info.menuItemId === 'add-all-tabs') {
      // Process all valid tabs
      const validTabs = await getValidTabs();
      
      if (validTabs.length === 0) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Uzei - Literature Review',
          message: 'No valid tabs found for content extraction.'
        });
        return;
      }
      
      // Store tab IDs for popup
      await chrome.storage.local.set({ 
        'batchTabIds': validTabs.map(t => t.id),
        'triggerBatchMode': true
      });
      
      chrome.action.openPopup();
    }
    else if (info.menuItemId === 'add-selected-tabs') {
      // Trigger multi-tab selection mode
      await chrome.storage.local.set({ 'triggerMultiTabMode': true });
      chrome.action.openPopup();
    }
    
  } catch (error) {
    console.error('Error handling context menu:', error);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Uzei - Literature Review',
      message: 'Error processing content. Please ensure you are logged in to the web app.'
    });
  }
});

/**
 * Handle extension installation and updates
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    if (details.reason === 'install') {
      console.log('Uzei - Literature Review extension installed');
      
      // Set default settings
      await chrome.storage.sync.set({
        autoExtract: true,
        showNotifications: true,
        enableMultiTab: true,
        showBadges: true,
        contextMenu: true
      });
      
      // Open options page on first install
      chrome.runtime.openOptionsPage();
    }
    
    // Load extension settings
    await loadExtensionSettings();
    
    // Create context menus based on settings
    createContextMenus();
    
    // Set initial badge color
    if (extensionSettings.showBadges) {
      chrome.action.setBadgeBackgroundColor({ color: CONFIG.BADGE_COLOR });
    }
    
    // Clear validity cache
    tabValidityCache.clear();
    
    // Check initial login status
    await checkLoginStatus();
  } catch (error) {
    console.error('Error during installation:', error);
  }
});

/**
 * Monitor tab updates and refresh badges
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // Clear cached validity for this tab
    tabValidityCache.delete(tabId);
    
    if (!isValidTabUrl(tab.url)) {
      if (extensionSettings.showBadges) {
        await safeTabOperation(async () => {
          await chrome.action.setBadgeText({ text: '', tabId: tabId });
        });
      }
      return;
    }
    
    // Add delay before checking validity
    const delay = isPDFUrl(tab.url) ? 500 : CONFIG.VALIDITY_CHECK_DELAY;
    
    setTimeout(async () => {
      try {
        const stillExists = await tabExists(tabId);
        if (stillExists) {
          const updatedTab = await safeTabOperation(async () => {
            return await chrome.tabs.get(tabId);
          });
          
          if (updatedTab && updatedTab.url === tab.url) {
            await updateTabBadges(tabId);
          }
        }
      } catch (error) {
        console.log(`Tab ${tabId} no longer exists during delayed update`);
      }
    }, delay);
  }
});

/**
 * Clean up when tabs are closed
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  tabValidityCache.delete(tabId);
  pendingValidityChecks.delete(tabId);
  chrome.storage.local.remove(`tab_${tabId}_data`);
});

/**
 * Update badge when tab is activated
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (extensionSettings.showBadges) {
    try {
      const exists = await tabExists(activeInfo.tabId);
      if (!exists) {
        return;
      }
      
      const tab = await safeTabOperation(async () => {
        return await chrome.tabs.get(activeInfo.tabId);
      });
      
      if (tab && isValidTabUrl(tab.url) && !tabValidityCache.has(activeInfo.tabId)) {
        const delay = isPDFUrl(tab.url) ? 100 : 500;
        setTimeout(() => updateTabBadges(activeInfo.tabId), delay);
      }
    } catch (error) {
      console.log(`Tab ${activeInfo.tabId} no longer exists during activation`);
    }
  }
});

/**
 * Handle messages from popup and content scripts
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Return extension settings
  if (request.action === 'getSettings') {
    chrome.storage.sync.get([
      'autoExtract', 
      'showNotifications',
      'enableMultiTab',
      'showBadges',
      'contextMenu'
    ], (result) => {
      sendResponse({
        appUrl: CONFIG.APP_BASE_URL,
        autoExtract: result.autoExtract !== false,
        showNotifications: result.showNotifications !== false,
        enableMultiTab: result.enableMultiTab !== false,
        showBadges: result.showBadges !== false,
        contextMenu: result.contextMenu !== false
      });
    });
    return true;
  }
  
  // Handle settings updates
  if (request.action === 'settingsUpdated') {
    console.log('Settings updated, reloading extension settings...');
    loadExtensionSettings().then(() => {
      console.log('Extension settings reloaded in background');
      // Broadcast to popup if open
      chrome.runtime.sendMessage({
        action: 'settingsReloaded',
        settings: extensionSettings
      }).catch(() => {
        // Popup might not be open, ignore error
      });
    });
    sendResponse({ success: true });
    return true;
  }
  
  // Check user login status
  if (request.action === 'checkLoginStatus') {
    checkLoginStatus().then(status => {
      sendResponse(status);
    }).catch(error => {
      sendResponse({ isLoggedIn: false, username: null, error: error.message });
    });
    return true;
  }
  
  // Open web app in new tab
  if (request.action === 'openWebApp') {
    chrome.tabs.create({ url: CONFIG.APP_BASE_URL });
    sendResponse({ success: true });
    return true;
  }
  
  // Show desktop notification
  if (request.action === 'showNotification') {
    if (request.title && request.message && extensionSettings.showNotifications) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: request.title,
        message: request.message
      });
    }
  }
  
  // Get all valid tabs
  if (request.action === 'getAllValidTabs') {
    getValidTabs().then(tabs => {
      sendResponse({ success: true, tabs });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  // Check validity of specific tabs
  if (request.action === 'checkTabsValidity') {
    const tabIds = request.tabIds || [];
    
    Promise.all(tabIds.map(async (tabId) => {
      const validity = await checkTabContentValidity(tabId);
      return { tabId, ...validity };
    })).then(results => {
      sendResponse({ success: true, results });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  // Clear cached tab validity
  if (request.action === 'clearTabValidityCache') {
    const tabIds = request.tabIds;
    if (tabIds) {
      tabIds.forEach(tabId => tabValidityCache.delete(tabId));
    } else {
      tabValidityCache.clear();
    }
    sendResponse({ success: true });
  }
  
  // Handle batch processing completion
  if (request.action === 'batchProcessComplete') {
    const { successful, failed, total } = request;
    
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Batch Processing Complete',
      message: `${successful} of ${total} tabs processed successfully. ${failed} failed.`
    });
  }
});

/**
 * Handle extension startup
 */
chrome.runtime.onStartup.addListener(async () => {
  try {
    console.log('Uzei - Literature Review extension started');
    await loadExtensionSettings();
    createContextMenus();
    tabValidityCache.clear();
    await checkLoginStatus();
  } catch (error) {
    console.error('Error during startup:', error);
  }
});

/**
 * Refresh tab validity when window gains focus
 */
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  
  try {
    const tabs = await chrome.tabs.query({ windowId, active: true });
    for (const tab of tabs) {
      if (tab && tab.id && isValidTabUrl(tab.url)) {
        const exists = await tabExists(tab.id);
        if (exists) {
          tabValidityCache.delete(tab.id);
          const delay = isPDFUrl(tab.url) ? 100 : 300;
          setTimeout(() => updateTabBadges(tab.id), delay);
        }
      }
    }
  } catch (error) {
    console.log('Window no longer exists during focus change');
  }
});

/**
 * Periodic maintenance tasks
 */
async function performPeriodicCleanup() {
  try {
    const allTabs = await chrome.tabs.query({});
    const activeTabIds = new Set(allTabs.map(tab => tab.id));
    
    // Remove cache entries for closed tabs
    for (const [tabId] of tabValidityCache) {
      if (!activeTabIds.has(tabId)) {
        tabValidityCache.delete(tabId);
        pendingValidityChecks.delete(tabId);
      }
    }
    
    // Refresh login status periodically
    if (Date.now() - userLoginStatus.lastCheck > CONFIG.SESSION_CHECK_INTERVAL) {
      await checkLoginStatus();
    }
  } catch (error) {
    console.error('Error during cache cleanup:', error);
  }
}

/**
 * Handle scheduled alarm events
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refreshAllTabsValidity') {
    // Refresh validity for all tabs
    tabValidityCache.clear();
    chrome.tabs.query({}).then(tabs => {
      tabs.forEach(tab => {
        if (tab && tab.id && isValidTabUrl(tab.url)) {
          const delay = isPDFUrl(tab.url) ? Math.random() * 500 : Math.random() * 2000;
          setTimeout(() => updateTabBadges(tab.id), delay);
        }
      });
    }).catch(error => {
      console.error('Error refreshing all tabs validity:', error);
    });
  } else if (alarm.name === 'checkLoginStatus') {
    checkLoginStatus();
  } else if (alarm.name === 'periodicCleanup') {
    performPeriodicCleanup();
  }
});

/**
 * Handle storage changes from options page
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync') {
    console.log('Storage changed, reloading extension settings...');
    loadExtensionSettings();
  }
});

// Set up periodic maintenance alarms
try {
  chrome.alarms.create('checkLoginStatus', { periodInMinutes: 5 });
  chrome.alarms.create('periodicCleanup', { periodInMinutes: 1 });
} catch (error) {
  console.error('Error creating alarms:', error);
}

// Initialize background script
console.log('Uzei - Literature Review Background Script loaded');
console.log(`Web App URL: ${CONFIG.APP_BASE_URL}`);
console.log(`Multi-tab context menus: ${extensionSettings.enableMultiTab ? 'Enabled' : 'Disabled'}`);
console.log(`Tab monitoring: ${CONFIG.MONITOR_ALL_TABS ? 'Enabled' : 'Disabled'}`);
console.log(`Badge indicators: ${extensionSettings.showBadges ? 'Enabled' : 'Disabled'}`);
console.log('STRICT PDF detection enabled - only direct PDF URLs');

// Load settings on startup
loadExtensionSettings();