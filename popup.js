class PDFInstructorPopup {
    constructor() {
        this.pdfFile = null;
        this.jsonFile = null;
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        document.getElementById('pdfFile').addEventListener('change', (e) => this.handlePDFFile(e));
        document.getElementById('jsonFile').addEventListener('change', (e) => this.handleJSONFile(e));
        document.getElementById('openViewer').addEventListener('click', () => this.openViewer());
        document.getElementById('openInTab').addEventListener('click', () => this.openInTab());
    }

    handlePDFFile(event) {
        const file = event.target.files[0];
        if (file && file.type === 'application/pdf') {
            this.pdfFile = file;
            this.updateButtons();
            this.showStatus('PDF file selected', 'success');
        } else {
            this.showStatus('Please select a valid PDF file', 'error');
        }
    }

    handleJSONFile(event) {
        const file = event.target.files[0];
        if (file && file.type === 'application/json') {
            this.jsonFile = file;
            this.showStatus('JSON geometry file selected', 'success');
        } else {
            this.showStatus('Please select a valid JSON file', 'error');
        }
    }

    updateButtons() {
        const openViewerBtn = document.getElementById('openViewer');
        const openInTabBtn = document.getElementById('openInTab');

        if (this.pdfFile) {
            openViewerBtn.disabled = false;
            openInTabBtn.disabled = false;
        } else {
            openViewerBtn.disabled = true;
            openInTabBtn.disabled = true;
        }
    }

    async openViewer() {
        if (!this.pdfFile) {
            this.showStatus('Please select a PDF file first', 'error');
            return;
        }

        try {
            console.log('Processing PDF file...');
            console.log('PDF file size:', this.pdfFile.size, 'bytes');

            // Check file size - Chrome storage has limits
            const maxSize = 5 * 1024 * 1024; // 5MB limit for base64 encoding overhead
            if (this.pdfFile.size > maxSize) {
                this.showStatus(`PDF file too large (${Math.round(this.pdfFile.size / 1024 / 1024)}MB). Please use a file smaller than 5MB.`, 'error');
                return;
            }

            // Convert PDF to ArrayBuffer for storage
            const pdfArrayBuffer = await this.fileToArrayBuffer(this.pdfFile);
            console.log('PDF converted to ArrayBuffer');

            // Store PDF data directly in chrome storage
            // For large files, we'll store as base64 to avoid binary data issues
            const pdfBase64 = this.arrayBufferToBase64(pdfArrayBuffer);
            console.log('PDF converted to base64, length:', pdfBase64.length);

            const storageData = {
                pdfData: pdfBase64,
                pdfName: this.pdfFile.name,
                pdfSize: this.pdfFile.size,
                pdfType: 'base64'
            };

            if (this.jsonFile) {
                console.log('Processing JSON file...');
                const jsonText = await this.fileToText(this.jsonFile);
                storageData.jsonData = jsonText;
                storageData.jsonName = this.jsonFile.name;
            }

            // Store in chrome storage
            console.log('Storing PDF data in chrome storage...');
            await chrome.storage.local.set(storageData);
            console.log('PDF data stored successfully');

            // Open the viewer
            console.log('Opening viewer tab...');
            const viewerUrl = chrome.runtime.getURL('viewer.html');
            console.log('Viewer URL:', viewerUrl);

            const tab = await chrome.tabs.create({ url: viewerUrl });
            console.log('Tab created:', tab.id);

            // Close the popup
            window.close();

        } catch (error) {
            console.error('Error opening viewer:', error);
            console.error('Error stack:', error.stack);
            this.showStatus(`Error opening viewer: ${error.message}`, 'error');
        }
    }

    async openInTab() {
        if (!this.pdfFile) {
            this.showStatus('Please select a PDF file first', 'error');
            return;
        }

        try {
            // Create a blob URL for the PDF (this will work for direct opening)
            const pdfBlob = new Blob([this.pdfFile], { type: 'application/pdf' });
            const pdfUrl = URL.createObjectURL(pdfBlob);

            // Store additional JSON data if needed
            if (this.jsonFile) {
                const jsonText = await this.fileToText(this.jsonFile);
                await chrome.storage.local.set({
                    pendingJsonData: jsonText,
                    pendingJsonName: this.jsonFile.name
                });
            }

            // Open PDF in new tab
            chrome.tabs.create({ url: pdfUrl });

            // Close the popup
            window.close();

        } catch (error) {
            console.error('Error opening PDF in tab:', error);
            this.showStatus('Error opening PDF', 'error');
        }
    }

    fileToArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }

    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    fileToText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    showStatus(message, type = 'info') {
        const statusEl = document.getElementById('statusMessage');
        statusEl.className = `status-message ${type}`;
        statusEl.textContent = message;
        statusEl.style.display = 'block';

        if (type !== 'error') {
            setTimeout(() => {
                statusEl.style.display = 'none';
            }, 3000);
        }
    }
}

// Initialize the popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new PDFInstructorPopup();
});