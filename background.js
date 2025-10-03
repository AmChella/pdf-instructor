// Background script for PDF Instructor Chrome Extension

// Extension lifecycle management
chrome.runtime.onInstalled.addListener((details) => {
    console.log('PDF Instructor extension installed/updated:', details.reason);
    
    if (details.reason === 'install') {
        console.log('Welcome to PDF Instructor! Click the extension icon to get started.');
    } else if (details.reason === 'update') {
        console.log('PDF Instructor updated to version:', chrome.runtime.getManifest().version);
    }
    
    // Context menu integration available for future updates
    console.log('Extension ready - context menu integration available for future updates');
});

// Handle extension startup
chrome.runtime.onStartup.addListener(() => {
    console.log('PDF Instructor extension started');
});

// Handle messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Background received message:', message);
    
    switch (message.type) {
        case 'OPEN_VIEWER':
            // Open the PDF viewer in a new tab
            chrome.tabs.create({
                url: chrome.runtime.getURL('viewer.html')
            });
            sendResponse({ success: true });
            break;
            
        case 'GET_STORAGE_DATA':
            // Help retrieve stored PDF data
            chrome.storage.local.get(message.keys || null)
                .then(data => sendResponse({ success: true, data }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true; // Keep message channel open for async response
            
        case 'SET_STORAGE_DATA':
            // Help store PDF data
            chrome.storage.local.set(message.data)
                .then(() => sendResponse({ success: true }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true; // Keep message channel open for async response
            
        case 'CLEAR_STORAGE':
            // Clear stored PDF data
            chrome.storage.local.clear()
                .then(() => sendResponse({ success: true }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true; // Keep message channel open for async response
            
        default:
            console.log('Unknown message type:', message.type);
            sendResponse({ success: false, error: 'Unknown message type' });
    }
});

// Handle tab updates (useful for PDF detection)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        // Check if the tab contains a PDF
        if (tab.url.endsWith('.pdf') || tab.url.includes('.pdf')) {
            console.log('PDF detected in tab:', tab.url);
        }
    }
});

// Handle extension icon click (when popup is not available)
chrome.action.onClicked.addListener((tab) => {
    // This only fires when no popup is defined
    // Since we have a popup, this won't normally be called
    console.log('Extension icon clicked');
});

// Error handling
chrome.runtime.onSuspend.addListener(() => {
    console.log('PDF Instructor background script suspending...');
});

// Log any errors
self.addEventListener('error', (event) => {
    console.error('Background script error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
    console.error('Background script unhandled rejection:', event.reason);
});

console.log('PDF Instructor background script loaded');