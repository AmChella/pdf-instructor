// Settings page functionality
class SettingsManager {
    constructor() {
        this.init();
    }

    async init() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupEventListeners());
        } else {
            this.setupEventListeners();
        }

        // Load existing settings
        await this.loadSettings();
    }

    setupEventListeners() {
        const form = document.getElementById('settingsForm');
        const testButton = document.getElementById('testConnection');
        const resetButton = document.getElementById('resetSettings');

        if (form) {
            form.addEventListener('submit', (e) => this.handleSubmit(e));
        }

        if (testButton) {
            testButton.addEventListener('click', () => this.testConnection());
        }

        if (resetButton) {
            resetButton.addEventListener('click', () => this.resetSettings());
        }
    }

    async loadSettings() {
        try {
            const result = await chrome.storage.sync.get(['apiUrl', 'apiToken']);

            const apiUrlInput = document.getElementById('apiUrl');
            const apiTokenInput = document.getElementById('apiToken');

            if (apiUrlInput && result.apiUrl) {
                apiUrlInput.value = result.apiUrl;
            }

            if (apiTokenInput && result.apiToken) {
                apiTokenInput.value = result.apiToken;
            }
        } catch (error) {
            console.error('Error loading settings:', error);
            this.showStatus('Error loading settings', 'error');
        }
    }

    async handleSubmit(event) {
        event.preventDefault();

        const formData = new FormData(event.target);
        const apiUrl = formData.get('apiUrl').trim();
        const apiToken = formData.get('apiToken').trim();

        // Validate inputs
        if (!apiUrl || !apiToken) {
            this.showStatus('Please fill in all required fields', 'error');
            return;
        }

        // Validate URL format
        try {
            new URL(apiUrl);
        } catch (error) {
            this.showStatus('Please enter a valid URL', 'error');
            return;
        }

        try {
            // Save to Chrome storage
            await chrome.storage.sync.set({
                apiUrl: apiUrl,
                apiToken: apiToken
            });

            this.showStatus('Settings saved successfully!', 'success');

            // Auto-hide success message after 3 seconds
            setTimeout(() => {
                this.hideStatus();
            }, 3000);

        } catch (error) {
            console.error('Error saving settings:', error);
            this.showStatus('Error saving settings. Please try again.', 'error');
        }
    }

    async testConnection() {
        const apiUrlInput = document.getElementById('apiUrl');
        const apiTokenInput = document.getElementById('apiToken');
        const testButton = document.getElementById('testConnection');
        const testResult = document.getElementById('testResult');

        const apiUrl = apiUrlInput?.value.trim();
        const apiToken = apiTokenInput?.value.trim();

        if (!apiUrl || !apiToken) {
            this.showTestResult('Please enter both API URL and token before testing', 'error');
            return;
        }

        // Validate URL format
        try {
            new URL(apiUrl);
        } catch (error) {
            this.showTestResult('Please enter a valid URL', 'error');
            return;
        }

        // Show loading state
        testButton.classList.add('loading');
        testButton.disabled = true;
        this.showTestResult('Testing connection...', 'loading');

        try {
            // Test the API endpoint with a simple request
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiToken}`,
                },
                body: JSON.stringify({
                    test: true,
                    message: 'PDF Instructor settings test'
                })
            });

            if (response.ok) {
                this.showTestResult('✅ Connection successful! API is reachable.', 'success');
            } else {
                const responseText = await response.text();
                this.showTestResult(`❌ Connection failed: ${response.status} ${response.statusText}`, 'error');
            }

        } catch (error) {
            console.error('Connection test error:', error);

            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                this.showTestResult('❌ Connection failed: Network error or CORS issue', 'error');
            } else {
                this.showTestResult(`❌ Connection failed: ${error.message}`, 'error');
            }
        } finally {
            // Remove loading state
            testButton.classList.remove('loading');
            testButton.disabled = false;
        }
    }

    async resetSettings() {
        if (confirm('Are you sure you want to reset all settings? This action cannot be undone.')) {
            try {
                // Clear stored settings
                await chrome.storage.sync.remove(['apiUrl', 'apiToken']);

                // Clear form inputs
                const apiUrlInput = document.getElementById('apiUrl');
                const apiTokenInput = document.getElementById('apiToken');

                if (apiUrlInput) apiUrlInput.value = '';
                if (apiTokenInput) apiTokenInput.value = '';

                // Clear test result
                this.hideTestResult();

                this.showStatus('Settings reset successfully', 'success');

                // Auto-hide success message
                setTimeout(() => {
                    this.hideStatus();
                }, 3000);

            } catch (error) {
                console.error('Error resetting settings:', error);
                this.showStatus('Error resetting settings', 'error');
            }
        }
    }

    showStatus(message, type) {
        const statusEl = document.getElementById('statusMessage');
        if (statusEl) {
            statusEl.textContent = message;
            statusEl.className = `status-message ${type}`;
        }
    }

    hideStatus() {
        const statusEl = document.getElementById('statusMessage');
        if (statusEl) {
            statusEl.style.display = 'none';
        }
    }

    showTestResult(message, type) {
        const testResultEl = document.getElementById('testResult');
        if (testResultEl) {
            testResultEl.textContent = message;
            testResultEl.className = `test-result ${type}`;
        }
    }

    hideTestResult() {
        const testResultEl = document.getElementById('testResult');
        if (testResultEl) {
            testResultEl.style.display = 'none';
        }
    }
}

// Static method to get settings from storage (used by other parts of the extension)
SettingsManager.getSettings = async function() {
    try {
        const result = await chrome.storage.sync.get(['apiUrl', 'apiToken']);
        return {
            apiUrl: result.apiUrl || '',
            apiToken: result.apiToken || ''
        };
    } catch (error) {
        console.error('Error getting settings:', error);
        return {
            apiUrl: '',
            apiToken: ''
        };
    }
};

// Initialize settings manager
new SettingsManager();