// Set PDF.js worker
console.log('Setting up PDF.js worker...');
pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.js';
console.log('PDF.js GlobalWorkerOptions set to:', pdfjsLib.GlobalWorkerOptions.workerSrc);

// Copy the entire PDFHighlightViewer class and rename it for extension use
class PDFInstructorViewer {
    constructor() {
        console.log('PDFInstructorViewer constructor called');
        console.log('PDF.js version available:', typeof pdfjsLib !== 'undefined' ? 'YES' : 'NO');
        
        this.pdfDoc = null;
        this.currentPage = 1;
        this.pageRendering = false;
        this.pageNumPending = null;
        this.scale = 1.5;
        this.geometryData = null;
        this.currentHighlight = null;
        this.canvas = document.getElementById('pdfCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.overlayCanvas = document.getElementById('overlayCanvas');
        this.overlayCtx = this.overlayCanvas.getContext('2d');
        this.contextMenu = document.getElementById('contextMenu');
        this.currentClickedElement = null;
        this.textContent = null;
        this.textItems = [];
        this.currentWord = null;
        this.imageItems = [];
        this.imageCounter = 0;
        this.tablesByPage = {};
        this.tooltipMode = 'click';
        this.tooltipPinned = false;
        this.lineSpacingEnabled = false;
        this.lineGroups = [];
        this.lineSpacingMedian = 0;
        this.lineMismatches = [];
        this.lineSpacingThresholdPct = 15;

        this.initializeEventListeners();
        this.initializeMenuHandlers();

        // Modal setup
        this.coordModal = document.getElementById('coordModal');
        this.coordForm = document.getElementById('coordForm');
        this.coordFormStatus = document.getElementById('coordFormStatus');
        this.coordinateEndpoint = '/api/coordinates';
        this.setupModalHandlers();

        // Check if we should load from storage
        this.checkForStoredPDF();
    }

    async checkForStoredPDF() {
        try {
            console.log('Checking for stored PDF data...');
            const data = await chrome.storage.local.get(['pdfData', 'pdfName', 'pdfSize', 'pdfType', 'jsonData', 'jsonName']);
            console.log('Storage data retrieved:', { 
                hasPdfData: !!data.pdfData, 
                pdfName: data.pdfName,
                pdfSize: data.pdfSize,
                pdfType: data.pdfType,
                hasJsonData: !!data.jsonData,
                jsonName: data.jsonName
            });
            
            if (data.pdfData && data.pdfName) {
                document.getElementById('loadFromStorage').textContent = `Load: ${data.pdfName}`;
                this.showStatus(`PDF "${data.pdfName}" available from extension`, 'info');
            } else {
                console.log('No PDF data found in storage');
            }
        } catch (error) {
            console.error('Error checking stored PDF:', error);
        }
    }

    initializeEventListeners() {
        // Extension-specific event listeners
        document.getElementById('loadFromStorage').addEventListener('click', () => this.loadFromStorage());
        document.getElementById('loadFromFile').addEventListener('click', () => this.toggleFileInputs());

        // Original event listeners
        document.getElementById('pdfFile').addEventListener('change', (e) => this.handlePDFUpload(e));
        document.getElementById('jsonFile').addEventListener('change', (e) => this.handleJSONUpload(e));
        document.getElementById('prevPage').addEventListener('click', () => this.onPrevPage());
        document.getElementById('nextPage').addEventListener('click', () => this.onNextPage());

        const lineToggle = document.getElementById('lineSpacingToggle');
        if (lineToggle) {
            lineToggle.addEventListener('click', () => {
                if (!this.pdfDoc) return;
                this.lineSpacingEnabled = !this.lineSpacingEnabled;
                lineToggle.classList.toggle('active', this.lineSpacingEnabled);
                lineToggle.textContent = this.lineSpacingEnabled ? 'Line Spacing (On)' : 'Line Spacing';
                if (this.lineSpacingEnabled) {
                    this.computeLineSpacingMetrics();
                } else {
                    this.redrawCurrentOverlay();
                }
            });
        }

        const showDetectionsBtn = document.getElementById('showDetections');
        if (showDetectionsBtn) {
            showDetectionsBtn.addEventListener('click', () => {
                if (!this.pdfDoc) return;
                this.showAllDetections();
            });
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'd' && e.ctrlKey && e.shiftKey) {
                e.preventDefault();
                if (this.pdfDoc) {
                    this.runDiagnostics();
                }
            }
            if (e.key === 't' && e.ctrlKey && e.shiftKey) {
                e.preventDefault();
                this.testOverlayCanvas();
            }
        });

        this.overlayCanvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.overlayCanvas.addEventListener('mouseleave', () => this.handleMouseLeave());
        this.overlayCanvas.addEventListener('click', (e) => this.handleClick(e));
        this.overlayCanvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.handleContextMenu(e); });

        document.addEventListener('click', (e) => {
            if (!this.contextMenu.contains(e.target) && e.target !== this.overlayCanvas) {
                this.hideContextMenu();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.tooltipPinned) {
                this.tooltipPinned = false;
                this.hideTooltip();
                this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
            }
        });
    }

    toggleFileInputs() {
        const fileSection = document.getElementById('fileInputSection');

        if (fileSection.classList.contains('visible')) {
            fileSection.classList.remove('visible');
            document.getElementById('loadFromFile').textContent = 'Load New PDF';
        } else {
            fileSection.classList.add('visible');
            document.getElementById('loadFromFile').textContent = 'Hide File Inputs';
        }
    }

    async loadFromStorage() {
        try {
            console.log('loadFromStorage: Starting...');
            const data = await chrome.storage.local.get(['pdfData', 'pdfName', 'pdfSize', 'pdfType', 'jsonData', 'jsonName']);
            console.log('loadFromStorage: Storage data retrieved:', data);
            
            if (!data.pdfData) {
                console.error('loadFromStorage: No PDF data found in storage');
                this.showStatus('No PDF data found in storage', 'error');
                return;
            }

            console.log('loadFromStorage: Found PDF data, type:', data.pdfType);
            this.showStatus('Loading PDF from extension...', 'info');

            // Convert base64 back to ArrayBuffer
            let pdfArrayBuffer;
            if (data.pdfType === 'base64') {
                console.log('loadFromStorage: Converting base64 to ArrayBuffer...');
                pdfArrayBuffer = this.base64ToArrayBuffer(data.pdfData);
                console.log('loadFromStorage: Conversion complete, size:', pdfArrayBuffer.byteLength, 'bytes');
            } else {
                // Fallback for other formats if needed
                pdfArrayBuffer = data.pdfData;
            }

            console.log('loadFromStorage: Loading PDF with PDF.js...');
            const loadingTask = pdfjsLib.getDocument({ data: pdfArrayBuffer });
            
            loadingTask.promise.then((pdfDoc) => {
                console.log('loadFromStorage: PDF.js loaded successfully, pages:', pdfDoc.numPages);
                this.pdfDoc = pdfDoc;
                
                if (data.jsonData) {
                    try {
                        const jsonData = JSON.parse(data.jsonData);
                        if (jsonData.pdfGeometryV1 && jsonData.pdfGeometryV1.pages) {
                            this.geometryData = jsonData.pdfGeometryV1;
                            console.log('loadFromStorage: Geometry data loaded');
                            this.showStatus(`Loaded ${data.pdfName} with geometry data`, 'success');
                        }
                    } catch (jsonError) {
                        console.error('loadFromStorage: Error parsing JSON data:', jsonError);
                        this.showStatus(`Loaded ${data.pdfName} (JSON data invalid)`, 'success');
                    }
                } else {
                    console.log('loadFromStorage: No geometry data');
                    this.showStatus(`Loaded ${data.pdfName}`, 'success');
                }

                document.getElementById('pageCount').textContent = this.pdfDoc.numPages;
                document.getElementById('prevPage').disabled = false;
                document.getElementById('nextPage').disabled = false;
                document.getElementById('emptyState').style.display = 'none';
                document.getElementById('pageWrapper').style.display = 'block';
                this.currentPage = 1;
                
                console.log('loadFromStorage: Rendering first page...');
                this.renderPage(this.currentPage).then(() => {
                    console.log('loadFromStorage: First page rendered successfully');
                }).catch((renderError) => {
                    console.error('loadFromStorage: Error rendering first page:', renderError);
                    this.showStatus('Error rendering PDF page', 'error');
                });
                
                const lineToggle = document.getElementById('lineSpacingToggle');
                if (lineToggle) lineToggle.disabled = false;
                const showDetections = document.getElementById('showDetections');
                if (showDetections) showDetections.disabled = false;
                
            }).catch((pdfError) => {
                console.error('loadFromStorage: PDF.js loading error:', pdfError);
                this.showStatus(`Error loading PDF: ${pdfError.message}`, 'error');
            });
            
        } catch (error) {
            console.error('loadFromStorage: General error:', error);
            console.error('loadFromStorage: Error stack:', error.stack);
            this.showStatus(`Error loading PDF from storage: ${error.message}`, 'error');
        }
    }

    base64ToArrayBuffer(base64) {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    showStatus(message, type = 'info') {
        const statusEl = document.getElementById('statusMessage');
        statusEl.className = `status-message ${type}`;
        statusEl.textContent = message;
        statusEl.style.display = 'block';
        if (type !== 'error') {
            setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
        }
    }

    setupModalHandlers() {
        if (!this.coordModal) return;
        // Close triggers
        this.coordModal.querySelectorAll('[data-close-modal]').forEach(btn => {
            btn.addEventListener('click', () => this.closeCoordModal());
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.coordModal.classList.contains('hidden')) {
                this.closeCoordModal();
            }
        });
        if (this.coordForm) {
            this.coordForm.addEventListener('submit', (e) => this.handleCoordSubmit(e));
        }
    }

    openCoordModal(payload) {
        if (!this.coordModal) return;
        this.populateCoordForm(payload);
        this.coordModal.classList.remove('hidden');
        this.coordModal.setAttribute('aria-hidden', 'false');
        // focus first field
        const first = this.coordModal.querySelector('select, input, textarea');
        if (first) setTimeout(()=> first.focus(), 50);
    }

    closeCoordModal() {
        if (!this.coordModal) return;
        this.coordModal.classList.add('hidden');
        this.coordModal.setAttribute('aria-hidden', 'true');
        if (this.coordFormStatus) { this.coordFormStatus.textContent=''; this.coordFormStatus.className='form-status'; }
    }

    populateCoordForm(data) {
        if (!this.coordForm) return;
        const { type, page, pdfX, pdfY, canvasX, canvasY, reference, notes, lineNumber, lineText } = data;
        const setVal = (id,val)=> { const el = document.getElementById(id); if (el) el.value = (val ?? '') === undefined ? '' : val; };
        setVal('coordItemType', type);
        setVal('coordPage', page);
        setVal('coordPdfX', pdfX?.toFixed ? pdfX.toFixed(2) : pdfX);
        setVal('coordPdfY', pdfY?.toFixed ? pdfY.toFixed(2) : pdfY);
        setVal('coordCanvasX', canvasX?.toFixed ? canvasX.toFixed(0) : canvasX);
        setVal('coordCanvasY', canvasY?.toFixed ? canvasY.toFixed(0) : canvasY);
        setVal('coordReference', reference || '');
        setVal('coordNotes', notes || '');
        setVal('coordLineNumber', lineNumber ?? '');
        setVal('coordLineText', lineText || '');
        // Show/hide image operation select
        const opRow = document.getElementById('imageOperationRow');
        if (opRow) {
            if (type === 'image') { opRow.style.display = 'flex'; } else { opRow.style.display = 'none'; const sel = document.getElementById('imageOperationSelect'); if (sel) sel.value=''; }
        }
    }

    async handleCoordSubmit(event) {
        event.preventDefault();
        if (!this.coordForm) return;
        const formData = new FormData(this.coordForm);
        const payload = Object.fromEntries(formData.entries());
        // Convert numerics
        ['page','pdfX','pdfY','canvasX','canvasY','lineNumber'].forEach(k=> { if (payload[k] !== undefined && payload[k] !== '') payload[k] = Number(payload[k]); });
        // Attach operation if present and meaningful
        if (payload.imageOperation === '') delete payload.imageOperation;
        this.setCoordFormStatus('Submitting...', '');
        try {
            const res = await fetch(this.coordinateEndpoint, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
            if (!res.ok) throw new Error(`Server responded ${res.status}`);
            this.setCoordFormStatus('Submitted successfully.', 'success');
            setTimeout(()=> this.closeCoordModal(), 800);
            this.showStatus('Coordinate submitted', 'success');
        } catch (err) {
            console.error('Coordinate submit error:', err);
            this.setCoordFormStatus('Submission failed. Check console / server.', 'error');
            this.showStatus('Coordinate submission failed', 'error');
        }
    }

    setCoordFormStatus(message, type) {
        if (!this.coordFormStatus) return;
        this.coordFormStatus.textContent = message;
        this.coordFormStatus.className = 'form-status' + (type ? ' ' + type : '');
    }

    initializeMenuHandlers() {
        // Define available menu handlers that can be used
        this.menuHandlers = {
            copy: (element) => {
                console.log('Copy action for element:', element.id);
                this.showStatus(`Copied element ${element.id}`, 'success');
            },
            highlight: (element) => {
                console.log('Highlight action for element:', element.id);
                this.showStatus(`Highlighted element ${element.id}`, 'success');
            },
            annotate: (element) => {
                console.log('Annotate action for element:', element.id);
                const note = prompt('Enter annotation:');
                if (note) {
                    this.showStatus(`Added annotation to element ${element.id}`, 'success');
                }
            },
            delete: (element) => {
                console.log('Delete action for element:', element.id);
                if (confirm(`Delete element ${element.id}?`)) {
                    this.showStatus(`Deleted element ${element.id}`, 'success');
                }
            },
            properties: (element) => {
                const props = `Element Properties:\n\nID: ${element.id}\nRole: ${element.role}\nLanguage: ${element.lang || 'N/A'}\nQuads: ${element.quads.length}`;
                alert(props);
            },
            export: (element) => {
                console.log('Export action for element:', element.id);
                const data = JSON.stringify(element, null, 2);
                const blob = new Blob([data], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `element_${element.id}.json`;
                a.click();
                URL.revokeObjectURL(url);
                this.showStatus(`Exported element ${element.id}`, 'success');
            },
            translate: (element) => {
                console.log('Translate action for element:', element.id);
                this.showStatus(`Translation requested for element ${element.id}`, 'info');
            },
            search: (element) => {
                console.log('Search action for element:', element.id);
                this.showStatus(`Searching for similar elements...`, 'info');
            }
        };
    }

    getMenuOptionsForElement(element) {
        const menuOptions = [];
        menuOptions.push({ type: 'header', label: `Element: ${element.id}` });
        menuOptions.push({ label: 'Copy', icon: '📋', handler: () => this.menuHandlers.copy(element) });
        if (element.role === 'H1' || element.role === 'H2' || element.role === 'H3') {
            menuOptions.push({ label: 'Create Bookmark', icon: '🔖', handler: () => this.menuHandlers.highlight(element) });
        }
        if (element.role === 'P') {
            menuOptions.push({ label: 'Annotate', icon: '✏️', handler: () => this.menuHandlers.annotate(element) });
            menuOptions.push({ label: 'Search Similar', icon: '🔍', handler: () => this.menuHandlers.search(element) });
        }
        if (element.lang && element.lang !== 'en') {
            menuOptions.push({ label: 'Translate', icon: '🌐', handler: () => this.menuHandlers.translate(element) });
        }
        menuOptions.push({ type: 'divider' });
        menuOptions.push({ label: 'Properties', icon: 'ℹ️', handler: () => this.menuHandlers.properties(element) });
        menuOptions.push({ label: 'Export', icon: '💾', handler: () => this.menuHandlers.export(element) });
        if (element.role !== 'H1') {
            menuOptions.push({ label: 'Delete', icon: '🗑️', handler: () => this.menuHandlers.delete(element), className: 'danger' });
        }
        return menuOptions;
    }

    testOverlayCanvas() {
        console.log('=== TESTING OVERLAY CANVAS ===');

        // Clear the overlay
        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

        // Draw a test rectangle
        this.overlayCtx.fillStyle = 'rgba(255, 0, 0, 0.5)';
        this.overlayCtx.strokeStyle = 'red';
        this.overlayCtx.lineWidth = 3;
        this.overlayCtx.beginPath();
        this.overlayCtx.rect(50, 50, 200, 100);
        this.overlayCtx.fill();
        this.overlayCtx.stroke();

        // Draw text
        this.overlayCtx.fillStyle = 'blue';
        this.overlayCtx.font = 'bold 16px Arial';
        this.overlayCtx.textAlign = 'center';
        this.overlayCtx.textBaseline = 'middle';
        this.overlayCtx.fillText('OVERLAY TEST', 150, 100);

        console.log('Drew test rectangle and text on overlay canvas');
        console.log(`Canvas size: ${this.overlayCanvas.width}x${this.overlayCanvas.height}`);
        console.log(`Canvas style: position=${this.overlayCanvas.style.position}, pointerEvents=${this.overlayCanvas.style.pointerEvents}`);

        this.showStatus('Overlay test complete - red rectangle should be visible', 'info');
    }

    async runDiagnostics() {
        console.log('=== PDF DIAGNOSTICS ===');
        console.log(`PDF: ${this.pdfDoc.numPages} pages`);
        console.log(`Current page: ${this.currentPage}`);

        try {
            const page = await this.pdfDoc.getPage(this.currentPage);
            const viewport = page.getViewport({ scale: 1.0 });

            console.log('Page info:', {
                width: viewport.width,
                height: viewport.height,
                rotation: viewport.rotation
            });

            // Get all operations and categorize them
            const ops = await page.getOperatorList();
            const opCounts = {};
            const allOpsUsed = new Set();

            ops.fnArray.forEach(fn => {
                const opName = Object.keys(pdfjsLib.OPS).find(key => pdfjsLib.OPS[key] === fn) || `unknown_${fn}`;
                opCounts[opName] = (opCounts[opName] || 0) + 1;
                allOpsUsed.add(opName);
            });

            console.log('All PDF operations used:', Array.from(allOpsUsed).sort());
            console.log('Operation counts:', opCounts);

            // Check for image-related operations specifically
            const imageOps = [
                'paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject',
                'paintFormXObjectBegin', 'paintFormXObjectEnd', 'beginMarkedContent',
                'beginMarkedContentProps', 'endMarkedContent'
            ];

            const foundImageOps = imageOps.filter(op => allOpsUsed.has(op));
            console.log('Image-related operations found:', foundImageOps);

            // Get text content stats
            const textContent = await page.getTextContent();
            console.log(`Text items: ${textContent.items.length}`);
            console.log(`Current detected images: ${this.imageItems.length}`);
            console.log(`Current detected tables: ${(this.tablesByPage[this.currentPage] || []).length}`);

            // Check annotations
            const annotations = await page.getAnnotations();
            console.log(`Annotations: ${annotations.length}`);
            if (annotations.length > 0) {
                annotations.forEach((ann, i) => {
                    console.log(`Annotation ${i}:`, {
                        subtype: ann.subtype,
                        hasAppearance: ann.hasAppearance,
                        rect: ann.rect
                    });
                });
            }

            this.showStatus('Diagnostics complete - check console for details', 'info');

        } catch (error) {
            console.error('Error running diagnostics:', error);
        }
    }

    showAllDetections() {
        console.log('=== SHOW ALL DETECTIONS ===');
        console.log(`Current page: ${this.currentPage}`);
        console.log(`Images found: ${this.imageItems.length}`);
        console.log(`Tables found: ${(this.tablesByPage[this.currentPage] || []).length}`);

        // Clear overlay and redraw all detections
        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

        // Log all image details
        this.imageItems.forEach((image, index) => {
            console.log(`Image ${index + 1} details:`, {
                imageNumber: image.imageNumber,
                bounds: image.bounds,
                method: image.method,
                operatorName: image.operatorName
            });
        });

        // Draw all images with enhanced visibility
        this.imageItems.forEach((image, index) => {
            console.log(`Drawing image ${index + 1}:`, image);

            // Create a proper imageInfo object for highlighting
            const imageInfo = {
                imageNumber: image.imageNumber,
                type: image.type,
                bounds: image.bounds,
                pageNumber: image.pageNumber,
                coordinates: {
                    pdfX: (image.bounds.left + image.bounds.right) / 2,
                    pdfY: (image.bounds.bottom + image.bounds.top) / 2,
                    canvasX: 0,
                    canvasY: 0
                },
                canvasBounds: {
                    left: image.bounds.left * this.scale,
                    right: image.bounds.right * this.scale,
                    top: (this.canvas.height / this.scale - image.bounds.top) * this.scale,
                    bottom: (this.canvas.height / this.scale - image.bounds.bottom) * this.scale
                }
            };

            this.highlightImage(imageInfo);
        });

        // Draw all tables
        const tables = this.tablesByPage[this.currentPage] || [];
        tables.forEach((table, index) => {
            console.log(`Drawing table ${index + 1}:`, table);
            this.highlightTable(table);
        });

        if (this.imageItems.length === 0 && tables.length === 0) {
            this.showStatus('No images or tables detected on this page', 'info');
        } else {
            this.showStatus(`Highlighted ${this.imageItems.length} images and ${tables.length} tables`, 'success');
        }
    }

    async handlePDFUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        this.showStatus('Loading PDF...', 'info');
        try {
            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            this.pdfDoc = await loadingTask.promise;
            document.getElementById('pageCount').textContent = this.pdfDoc.numPages;
            document.getElementById('prevPage').disabled = false;
            document.getElementById('nextPage').disabled = false;
            document.getElementById('emptyState').style.display = 'none';
            document.getElementById('pageWrapper').style.display = 'block';
            this.currentPage = 1;
            await this.renderPage(this.currentPage);
            this.showStatus('PDF loaded successfully!', 'success');
            const lineToggle = document.getElementById('lineSpacingToggle');
            if (lineToggle) lineToggle.disabled = false;
            const showDetectionsBtn = document.getElementById('showDetections');
            if (showDetectionsBtn) showDetectionsBtn.disabled = false;
        } catch (error) {
            console.error('Error loading PDF:', error);
            this.showStatus('Error loading PDF. Please try another file.', 'error');
        }
    }

    async handleJSONUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (!data.pdfGeometryV1 || !data.pdfGeometryV1.pages) throw new Error('Invalid JSON format');
            this.geometryData = data.pdfGeometryV1;
            if (this.pdfDoc) await this.renderPage(this.currentPage);
            this.showStatus('Geometry data loaded successfully!', 'success');
        } catch (error) {
            console.error('Error loading JSON:', error);
            this.showStatus('Error loading JSON. Please check the file format.', 'error');
        }
    }

    async renderPage(num) {
        this.pageRendering = true;
        try {
            const page = await this.pdfDoc.getPage(num);
            const viewport = page.getViewport({ scale: this.scale });
            this.canvas.height = viewport.height;
            this.canvas.width = viewport.width;
            this.overlayCanvas.height = viewport.height;
            this.overlayCanvas.width = viewport.width;
            const renderContext = { canvasContext: this.ctx, viewport: viewport };
            await page.render(renderContext).promise;
            await this.extractTextContent(page);
            await this.extractImageContent(page);
            // Detect tables after text extraction (lightweight heuristic)
            this.detectTablesForCurrentPage();
            document.getElementById('pageNum').textContent = num;
            this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
            if (this.lineSpacingEnabled) {
                this.computeLineSpacingMetrics();
            }

            // Update status with detection counts
            const imageCount = this.imageItems.length;
            const tableCount = (this.tablesByPage[this.currentPage] || []).length;
            this.showStatus(`Page ${num}: Found ${imageCount} images, ${tableCount} tables`, 'info');

            this.pageRendering = false;
            if (this.pageNumPending !== null) {
                await this.renderPage(this.pageNumPending);
                this.pageNumPending = null;
            }
        } catch (error) {
            console.error('Error rendering page:', error);
            this.pageRendering = false;
        }
    }

    // Continue adding all remaining methods from the original script...
    // [Rest of methods will be added in next part due to length]

    async extractTextContent(page) {
        try {
            this.textContent = await page.getTextContent();
            this.textItems = [];
            for (const item of this.textContent.items) {
                if (item.str.trim()) {
                    const words = this.splitIntoWords(item);
                    this.textItems.push(...words);
                }
            }
            this.computePageFontStats();
        } catch (error) {
            console.error('Error extracting text content:', error);
            this.textContent = null;
            this.textItems = [];
        }
    }

    computePageFontStats() {
        if (!this.textItems.length) {
            this.pageFontStats = { median:0, min:0, max:0 };
            return;
        }
        const sizes = this.textItems.map(i=> i.fontSize).sort((a,b)=>a-b);
        const mid = Math.floor(sizes.length/2);
        const median = sizes.length % 2 ? sizes[mid] : (sizes[mid-1]+sizes[mid])/2;
        this.pageFontStats = { median, min: sizes[0], max: sizes[sizes.length-1] };
    }

    splitIntoWords(textItem) {
        const words = [];
        const text = textItem.str;
        const transform = textItem.transform;
        const fontSize = Math.sqrt(transform[0] * transform[0] + transform[1] * transform[1]);
        const fontSizeY = Math.sqrt(transform[2] * transform[2] + transform[3] * transform[3]);
        const wordPattern = /\S+/g;
        let match;
        while ((match = wordPattern.exec(text)) !== null) {
            const word = match[0];
            const startIndex = match.index;
            const charWidth = (textItem.width || fontSize * 0.6) / text.length;
            const wordX = transform[4] + (charWidth * startIndex);
            const wordY = transform[5];
            const wordWidth = charWidth * word.length;
            const wordHeight = fontSize;
            words.push({
                str: word, x: wordX, y: wordY, width: wordWidth, height: wordHeight, fontSize, fontSizeY,
                transform, startIndex, endIndex: startIndex + word.length - 1, originalItem: textItem
            });
        }
        return words;
    }

    getWordAtPosition(x, y) {
        if (!this.textItems.length) return null;
        const pdfX = x / this.scale;
        const pdfY = (this.canvas.height - y) / this.scale;
        for (const item of this.textItems) {
            const itemLeft = item.x;
            const itemRight = item.x + item.width;
            const itemBottom = item.y - item.height * 0.2;
            const itemTop = item.y + item.height * 0.8;
            if (pdfX >= itemLeft && pdfX <= itemRight && pdfY >= itemBottom && pdfY <= itemTop) {
                const charWidth = item.width / item.str.length;
                const relativeX = pdfX - item.x;
                const charIndex = Math.floor(relativeX / charWidth);
                return {
                    word: item.str,
                    x: item.x,
                    y: item.y,
                    width: item.width,
                    height: item.height,
                    fontSize: item.fontSize,
                    charIndex: Math.max(0, Math.min(charIndex, item.str.length - 1)),
                    globalCharIndex: item.startIndex + charIndex,
                    coordinates: { pdfX, pdfY, canvasX: x, canvasY: y },
                    bounds: {
                        left: itemLeft * this.scale,
                        right: itemRight * this.scale,
                        top: (this.canvas.height / this.scale - itemTop) * this.scale,
                        bottom: (this.canvas.height / this.scale - itemBottom) * this.scale
                    }
                };
            }
        }
        return null;
    }

    getLineInfoForWord(wordInfo) {
        if (!this.textItems.length || !wordInfo) {
            return { lineNumber: null, lineText: '' };
        }

        // Group text items by approximate Y position to form lines
        const lineThreshold = wordInfo.height * 0.5; // Words within this threshold are on the same line
        const lines = [];
        
        // Sort text items by Y position (top to bottom)
        const sortedItems = [...this.textItems].sort((a, b) => b.y - a.y);
        
        for (const item of sortedItems) {
            // Find existing line or create new one
            let foundLine = lines.find(line => 
                Math.abs(line.y - item.y) < lineThreshold
            );
            
            if (!foundLine) {
                foundLine = {
                    y: item.y,
                    items: [],
                    text: ''
                };
                lines.push(foundLine);
            }
            
            foundLine.items.push(item);
        }
        
        // Sort items within each line by X position (left to right)
        lines.forEach(line => {
            line.items.sort((a, b) => a.x - b.x);
            line.text = line.items.map(item => item.str).join(' ');
        });
        
        // Sort lines by Y position (top to bottom)
        lines.sort((a, b) => b.y - a.y);
        
        // Find which line contains our word
        const targetY = wordInfo.y;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (Math.abs(line.y - targetY) < lineThreshold) {
                return {
                    lineNumber: i + 1,
                    lineText: line.text.trim()
                };
            }
        }
        
        return { lineNumber: null, lineText: '' };
    }

    async extractImageContent(page) {
        try {
            this.imageCounter = 0;
            this.imageItems = [];

            // Method 1: Traditional operator list approach
            await this.extractImagesFromOperators(page);

            // Method 2: Try to get XObjects directly from page resources
            await this.extractImagesFromResources(page);

            // Method 3: Check for any operations that modify canvas state in ways that might indicate images
            await this.extractImagesFromCanvasOperations(page);

            console.log(`Finished extracting images from page ${page.pageNumber}: Found ${this.imageItems.length} images total`);

            // Filter out overlay images that might be correction marks
            this.filterOverlayImages();
            
            console.log(`Final image count after filtering: ${this.imageItems.length} images`);
            
            // Add visual debugging - draw all image bounds temporarily
            this.drawImageBoundsDebug();

            // If no images found, let's examine what we do have
            if (this.imageItems.length === 0) {
                console.warn(`No images found on page ${page.pageNumber}. This might indicate:`);
                console.warn('- Images are embedded as vector graphics');
                console.warn('- Images are part of complex Form XObjects');
                console.warn('- Images use non-standard PDF operators');
                console.warn('- The PDF uses a different image embedding method');

                // Try to get more info about the page content
                this.analyzePageContent(page);
            }

        } catch (error) {
            console.error('Error extracting image content:', error);
            this.imageItems = [];
            this.imageCounter = 0;
        }
    }

    async extractImagesFromOperators(page) {
        try {
            const ops = await page.getOperatorList();
            let transform = [1, 0, 0, 1, 0, 0];
            let transformStack = [];

            console.log(`Method 1 - Extracting images from operators on page ${page.pageNumber}: Found ${ops.fnArray.length} operations`);

            for (let i = 0; i < ops.fnArray.length; i++) {
                const fn = ops.fnArray[i];
                const args = ops.argsArray[i];

                if (fn === pdfjsLib.OPS.save) {
                    transformStack.push([...transform]);
                } else if (fn === pdfjsLib.OPS.restore) {
                    if (transformStack.length > 0) transform = transformStack.pop();
                } else if (fn === pdfjsLib.OPS.transform) {
                    const [a, b, c, d, e, f] = args;
                    const [ta, tb, tc, td, te, tf] = transform;
                    transform = [
                        ta * a + tb * c,
                        ta * b + tb * d,
                        tc * a + td * c,
                        tc * b + td * d,
                        te * a + tf * c + e,
                        te * b + tf * d + f
                    ];
                } else if (fn === pdfjsLib.OPS.paintImageXObject ||
                          fn === pdfjsLib.OPS.paintInlineImageXObject ||
                          fn === pdfjsLib.OPS.paintImageMaskXObject ||
                          fn === pdfjsLib.OPS.paintFormXObjectBegin) {
                    this.imageCounter++;
                    const bounds = this.calculateImageBounds(transform);
                    const opName = Object.keys(pdfjsLib.OPS).find(key => pdfjsLib.OPS[key] === fn) || `unknown_${fn}`;
                    
                    // Filter out small overlay images that are likely correction marks
                    const imageWidth = Math.abs(bounds.right - bounds.left);
                    const imageHeight = Math.abs(bounds.top - bounds.bottom);
                    const imageArea = imageWidth * imageHeight;
                    
                    // Skip very small images (likely correction marks or overlay text)
                    const minImageSize = 20; // minimum width/height in PDF units
                    const minImageArea = 400; // minimum area in PDF units squared
                    
                    if (imageWidth < minImageSize || imageHeight < minImageSize || imageArea < minImageArea) {
                        console.log(`Method 1 - Skipping small overlay image ${this.imageCounter} (likely correction mark) - size: ${imageWidth.toFixed(1)}x${imageHeight.toFixed(1)}, area: ${imageArea.toFixed(1)}`);
                        this.imageCounter--; // Don't count filtered images
                        continue;
                    }
                    
                    console.log(`Method 1 - Found image ${this.imageCounter} (${opName}) with bounds:`, bounds);

                    this.imageItems.push({
                        imageNumber: this.imageCounter,
                        type: 'image',
                        bounds,
                        transform: [...transform],
                        operatorType: fn,
                        operatorName: opName,
                        pageNumber: page.pageNumber,
                        method: 'operators',
                        dimensions: { width: imageWidth, height: imageHeight, area: imageArea }
                    });
                }
            }
        } catch (error) {
            console.error('Error in extractImagesFromOperators:', error);
        }
    }

    async extractImagesFromResources(page) {
        try {
            console.log(`Method 2 - Attempting to extract images from page resources`);

            const annotations = await page.getAnnotations();
            console.log('Page annotations found:', annotations.length);

            annotations.forEach((annotation, index) => {
                if (annotation.subtype === 'Widget' || annotation.hasAppearance) {
                    console.log(`Found annotation ${index} that might contain images:`, annotation);

                    if (annotation.rect && annotation.rect.length >= 4) {
                        const [x1, y1, x2, y2] = annotation.rect;
                        const bounds = {
                            left: Math.min(x1, x2),
                            right: Math.max(x1, x2),
                            bottom: Math.min(y1, y2),
                            top: Math.max(y1, y2),
                            width: Math.abs(x2 - x1),
                            height: Math.abs(y2 - y1)
                        };

                        this.imageCounter++;
                        this.imageItems.push({
                            imageNumber: this.imageCounter,
                            type: 'image',
                            bounds,
                            transform: [1, 0, 0, 1, 0, 0],
                            operatorType: 'annotation',
                            operatorName: 'annotation',
                            pageNumber: page.pageNumber,
                            method: 'annotation',
                            annotation: annotation
                        });

                        console.log(`Method 2 - Found image ${this.imageCounter} from annotation with bounds:`, bounds);
                    }
                }
            });

        } catch (error) {
            console.error('Error in extractImagesFromResources:', error);
        }
    }

    drawImageBoundsDebug() {
        if (this.imageItems.length === 0) return;
        
        console.log('Drawing debug bounds for all detected images...');
        
        // Draw thin red outlines around all detected images for debugging
        this.overlayCtx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
        this.overlayCtx.lineWidth = 2;
        this.overlayCtx.setLineDash([5, 5]); // Dashed line
        
        this.imageItems.forEach((image, index) => {
            const bounds = image.bounds;
            const canvasLeft = bounds.left * this.scale;
            const canvasRight = bounds.right * this.scale;
            const canvasTop = (this.canvas.height / this.scale - bounds.top) * this.scale;
            const canvasBottom = (this.canvas.height / this.scale - bounds.bottom) * this.scale;
            
            const width = canvasRight - canvasLeft;
            const height = canvasBottom - canvasTop;
            
            console.log(`Debug: Image ${image.imageNumber} canvas bounds: (${canvasLeft.toFixed(1)}, ${canvasTop.toFixed(1)}, ${width.toFixed(1)}x${height.toFixed(1)})`);
            
            // Draw debug rectangle
            this.overlayCtx.beginPath();
            this.overlayCtx.rect(canvasLeft, canvasTop, width, height);
            this.overlayCtx.stroke();
            
            // Draw image number in corner
            this.overlayCtx.fillStyle = 'red';
            this.overlayCtx.font = 'bold 12px Arial';
            this.overlayCtx.fillText(`#${image.imageNumber}`, canvasLeft + 5, canvasTop + 15);
        });
        
        this.overlayCtx.setLineDash([]); // Reset dash
        
        // Clear debug outlines after 5 seconds
        setTimeout(() => {
            console.log('Clearing debug image bounds...');
            this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        }, 5000);
    }

    filterOverlayImages() {
        if (this.imageItems.length <= 1) return; // No need to filter if only one image
        
        const originalCount = this.imageItems.length;
        const filteredImages = [];
        
        // Group images by overlapping regions
        for (let i = 0; i < this.imageItems.length; i++) {
            const currentImage = this.imageItems[i];
            let shouldKeep = true;
            
            // Check image characteristics that suggest it's an overlay
            const currentArea = currentImage.dimensions ? currentImage.dimensions.area : 
                (currentImage.bounds.right - currentImage.bounds.left) * (currentImage.bounds.top - currentImage.bounds.bottom);
            
            // Filter out very small images (likely correction marks)
            if (currentArea < 1000) { // Very small area threshold
                console.log(`Filtering out very small image ${currentImage.imageNumber} (area: ${currentArea.toFixed(1)}) - likely correction mark`);
                shouldKeep = false;
            }
            
            // Check if image is positioned over text (likely overlay)
            if (shouldKeep && this.textItems.length > 0) {
                const textOverlap = this.checkImageTextOverlap(currentImage);
                if (textOverlap.isOverText && textOverlap.overlapRatio > 0.7) {
                    console.log(`Filtering out image ${currentImage.imageNumber} positioned over text (${(textOverlap.overlapRatio * 100).toFixed(1)}% overlap) - likely correction overlay`);
                    shouldKeep = false;
                }
            }
            
            // Check if this image overlaps with any larger image
            if (shouldKeep) {
                for (let j = 0; j < this.imageItems.length; j++) {
                    if (i === j) continue;
                    
                    const otherImage = this.imageItems[j];
                    const overlap = this.imagesOverlap(currentImage.bounds, otherImage.bounds);
                    
                    if (overlap) {
                        const otherArea = otherImage.dimensions ? otherImage.dimensions.area :
                            (otherImage.bounds.right - otherImage.bounds.left) * (otherImage.bounds.top - otherImage.bounds.bottom);
                        
                        // If current image is significantly smaller, it's likely an overlay
                        if (currentArea < otherArea * 0.8) {
                            console.log(`Filtering out overlay image ${currentImage.imageNumber} (area: ${currentArea.toFixed(1)}) overlapped by larger image ${otherImage.imageNumber} (area: ${otherArea.toFixed(1)})`);
                            shouldKeep = false;
                            break;
                        }
                    }
                }
            }
            
            if (shouldKeep) {
                filteredImages.push(currentImage);
            }
        }
        
        // Renumber the remaining images
        filteredImages.forEach((image, index) => {
            image.imageNumber = index + 1;
        });
        
        this.imageItems = filteredImages;
        this.imageCounter = filteredImages.length;
        
        if (originalCount !== filteredImages.length) {
            console.log(`Filtered overlay images: ${originalCount} -> ${filteredImages.length} (removed ${originalCount - filteredImages.length} overlay images)`);
        }
    }
    
    checkImageTextOverlap(image) {
        // Check if image overlaps with text content
        let overlappingTextItems = 0;
        let totalTextItems = 0;
        
        for (const textItem of this.textItems) {
            const textBounds = {
                left: textItem.x,
                right: textItem.x + textItem.width,
                top: textItem.y + textItem.height * 0.8,
                bottom: textItem.y - textItem.height * 0.2
            };
            
            // Check if text overlaps with image
            const overlaps = !(image.bounds.right < textBounds.left || 
                              textBounds.right < image.bounds.left || 
                              image.bounds.top < textBounds.bottom || 
                              textBounds.top < image.bounds.bottom);
            
            if (overlaps) {
                overlappingTextItems++;
                
                // Check if the text contains correction-related keywords
                const text = textItem.str.toLowerCase();
                if (text.includes('corrected') || text.includes('proof') || text.includes('correction') || 
                    text.includes('revised') || text.includes('edit') || text.includes('update')) {
                    // Strong indication this is a correction overlay
                    return {
                        isOverText: true,
                        overlapRatio: 1.0,
                        hasCorrectText: true
                    };
                }
            }
            totalTextItems++;
        }
        
        const overlapRatio = totalTextItems > 0 ? overlappingTextItems / totalTextItems : 0;
        
        return {
            isOverText: overlappingTextItems > 0,
            overlapRatio: overlapRatio,
            hasCorrectText: false
        };
    }
    
    imagesOverlap(bounds1, bounds2) {
        // Check if two image bounds overlap
        const overlap = !(bounds1.right < bounds2.left || 
                         bounds2.right < bounds1.left || 
                         bounds1.top < bounds2.bottom || 
                         bounds2.top < bounds1.bottom);
        
        if (overlap) {
            // Calculate overlap percentage
            const overlapLeft = Math.max(bounds1.left, bounds2.left);
            const overlapRight = Math.min(bounds1.right, bounds2.right);
            const overlapTop = Math.min(bounds1.top, bounds2.top);
            const overlapBottom = Math.max(bounds1.bottom, bounds2.bottom);
            
            const overlapArea = (overlapRight - overlapLeft) * (overlapTop - overlapBottom);
            const bounds1Area = (bounds1.right - bounds1.left) * (bounds1.top - bounds1.bottom);
            const bounds2Area = (bounds2.right - bounds2.left) * (bounds2.top - bounds2.bottom);
            
            const overlapPercentage = overlapArea / Math.min(bounds1Area, bounds2Area);
            
            // Consider significant overlap if more than 50% of the smaller image overlaps
            return overlapPercentage > 0.5;
        }
        
        return false;
    }

    async extractImagesFromCanvasOperations(page) {
        try {
            console.log(`Method 3 - Looking for canvas operations that might indicate images`);

            const ops = await page.getOperatorList();
            let rectOperations = [];
            let currentTransform = [1, 0, 0, 1, 0, 0];

            for (let i = 0; i < ops.fnArray.length; i++) {
                const fn = ops.fnArray[i];
                const args = ops.argsArray[i];

                if (fn === pdfjsLib.OPS.transform) {
                    const [a, b, c, d, e, f] = args;
                    const [ta, tb, tc, td, te, tf] = currentTransform;
                    currentTransform = [
                        ta * a + tb * c,
                        ta * b + tb * d,
                        tc * a + td * c,
                        tc * b + td * d,
                        te * a + tf * c + e,
                        te * b + tf * d + f
                    ];
                }

                if (fn === pdfjsLib.OPS.rectangle) {
                    const [x, y, width, height] = args;
                    if (width > 50 && height > 50) {
                        rectOperations.push({
                            x, y, width, height,
                            transform: [...currentTransform],
                            index: i
                        });
                    }
                }
            }

            if (rectOperations.length > 0 && this.imageItems.length === 0) {
                console.log('Creating image items from rectangle operations...');
                rectOperations.forEach((rect, index) => {
                    this.imageCounter++;

                    this.imageItems.push({
                        imageNumber: this.imageCounter,
                        type: 'rectangle',
                        bounds: {
                            left: rect.x,
                            right: rect.x + rect.width,
                            bottom: rect.y,
                            top: rect.y + rect.height,
                            width: rect.width,
                            height: rect.height
                        },
                        transform: rect.transform,
                        operatorType: 'rectangle',
                        operatorName: 'rectangle',
                        pageNumber: page.pageNumber,
                        method: 'canvas-operations'
                    });
                });
            }

        } catch (error) {
            console.error('Error in extractImagesFromCanvasOperations:', error);
        }
    }

    calculateImageBounds(transform) {
        const [a, b, c, d, e, f] = transform;
        const corners = [[0,0],[1,0],[1,1],[0,1]];
        const transformedCorners = corners.map(([x,y]) => [a*x + c*y + e, b*x + d*y + f]);
        const xs = transformedCorners.map(([x]) => x);
        const ys = transformedCorners.map(([,y]) => y);
        return { left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys), width: Math.max(...xs)-Math.min(...xs), height: Math.max(...ys)-Math.min(...ys) };
    }

    getImageAtPosition(x, y) {
        if (!this.imageItems.length) {
            console.log('No images detected on this page');
            return null;
        }
        
        const pdfX = x / this.scale;
        const pdfY = (this.canvas.height - y) / this.scale;

        console.log(`Checking image position: Canvas(${x.toFixed(0)}, ${y.toFixed(0)}) -> PDF(${pdfX.toFixed(1)}, ${pdfY.toFixed(1)})`);
        console.log(`Total images on page: ${this.imageItems.length}`);

        for (let i = 0; i < this.imageItems.length; i++) {
            const image = this.imageItems[i];
            const bounds = image.bounds;
            
            console.log(`Image ${image.imageNumber} bounds: left=${bounds.left.toFixed(1)}, right=${bounds.right.toFixed(1)}, bottom=${bounds.bottom.toFixed(1)}, top=${bounds.top.toFixed(1)}`);
            
            const inBounds = pdfX >= bounds.left && pdfX <= bounds.right && pdfY >= bounds.bottom && pdfY <= bounds.top;
            
            console.log(`Image ${image.imageNumber} hit test: ${inBounds ? 'HIT' : 'MISS'}`);

            if (inBounds) {
                const canvasBounds = {
                    left: bounds.left * this.scale,
                    right: bounds.right * this.scale,
                    top: (this.canvas.height / this.scale - bounds.top) * this.scale,
                    bottom: (this.canvas.height / this.scale - bounds.bottom) * this.scale
                };

                console.log(`Image ${image.imageNumber} found at position! Canvas bounds:`, canvasBounds);

                return {
                    imageNumber: image.imageNumber,
                    type: image.type,
                    bounds: image.bounds,
                    pageNumber: image.pageNumber,
                    coordinates: { pdfX, pdfY, canvasX: x, canvasY: y },
                    canvasBounds: canvasBounds
                };
            }
        }
        
        console.log('No image found at position');
        return null;
    }

    queueRenderPage(num) {
        if (this.pageRendering) { this.pageNumPending = num; } else { this.renderPage(num); }
    }

    onPrevPage() {
        if (this.currentPage <= 1) return;
        this.currentPage--;
        this.queueRenderPage(this.currentPage);
        this.hideContextMenu();
    }

    onNextPage() {
        if (!this.pdfDoc || this.currentPage >= this.pdfDoc.numPages) return;
        this.currentPage++;
        this.queueRenderPage(this.currentPage);
        this.hideContextMenu();
    }

    handleClick(event) {
        if (!this.pdfDoc) return;
        const rect = this.overlayCanvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) * (this.overlayCanvas.width / rect.width);
        const y = (event.clientY - rect.top) * (this.overlayCanvas.height / rect.height);

        const tableInfo = this.getTableAtPosition(x, y);
        const wordInfo = this.getWordAtPosition(x, y);
        const imageInfo = this.getImageAtPosition(x, y);
        let foundElement = null;

        if (this.geometryData) {
            const pageIndex = this.currentPage - 1;
            const pageGeometry = this.geometryData.pages.find(p => p.index === pageIndex);
            if (pageGeometry) {
                for (const element of pageGeometry.elements) {
                    if (this.isPointInElement(x, y, element)) {
                        foundElement = element;
                        break;
                    }
                }
            }
        }

        if (!tableInfo && !wordInfo && !imageInfo && !foundElement) {
            this.hideContextMenu();
            return;
        }

        let type, payload, refText;
        if (tableInfo) {
            type = 'table';
            refText = `Table #${tableInfo.tableNumber}`;
            const pdfX = x / this.scale;
            const pdfY = (this.canvas.height - y) / this.scale;
            payload = { type, page: this.currentPage, pdfX, pdfY, canvasX: x, canvasY: y, reference: refText };
            this.overlayCtx.clearRect(0,0,this.overlayCanvas.width,this.overlayCanvas.height);
            this.highlightTable(tableInfo);
        } else if (wordInfo) {
            type = 'word';
            refText = wordInfo.word;
            
            // Calculate line number and line text
            const lineInfo = this.getLineInfoForWord(wordInfo);
            
            payload = { 
                type, 
                page: this.currentPage, 
                pdfX: wordInfo.coordinates.pdfX, 
                pdfY: wordInfo.coordinates.pdfY, 
                canvasX: wordInfo.coordinates.canvasX, 
                canvasY: wordInfo.coordinates.canvasY, 
                reference: refText,
                lineNumber: lineInfo.lineNumber,
                lineText: lineInfo.lineText
            };
            this.overlayCtx.clearRect(0,0,this.overlayCanvas.width,this.overlayCanvas.height);
            this.highlightWord(wordInfo);
        } else if (imageInfo) {
            type = 'image';
            refText = `Image #${imageInfo.imageNumber}`;
            payload = { type, page: this.currentPage, pdfX: imageInfo.coordinates.pdfX, pdfY: imageInfo.coordinates.pdfY, canvasX: imageInfo.coordinates.canvasX, canvasY: imageInfo.coordinates.canvasY, reference: refText };
            this.overlayCtx.clearRect(0,0,this.overlayCanvas.width,this.overlayCanvas.height);
            this.highlightImage(imageInfo);
            console.log('Clicked on image:', imageInfo.imageNumber, 'Opening modal with payload:', payload);
        } else if (foundElement) {
            type = 'element';
            refText = foundElement.id || foundElement.role || 'element';
            let pdfX = null, pdfY = null;
            if (foundElement.quads && foundElement.quads.length) {
                pdfX = foundElement.quads[0][0];
                pdfY = foundElement.quads[0][1];
            }
            payload = { type, page: this.currentPage, pdfX, pdfY, canvasX: x, canvasY: y, reference: refText };
            this.overlayCtx.clearRect(0,0,this.overlayCanvas.width,this.overlayCanvas.height);
            this.highlightElement(foundElement);
        }

        this.openCoordModal(payload);
    }

    handleContextMenu(event) {
        if (!this.pdfDoc) return;
        const rect = this.overlayCanvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) * (this.overlayCanvas.width / rect.width);
        const y = (event.clientY - rect.top) * (this.overlayCanvas.height / rect.height);

        const wordInfo = this.getWordAtPosition(x, y);
        const imageInfo = this.getImageAtPosition(x, y);
        let foundElement = null;

        if (this.geometryData) {
            const pageIndex = this.currentPage - 1;
            const pageGeometry = this.geometryData.pages.find(p => p.index === pageIndex);
            if (pageGeometry) {
                for (const element of pageGeometry.elements) {
                    if (this.isPointInElement(x, y, element)) {
                        foundElement = element;
                        break;
                    }
                }
            }
        }

        if (foundElement) {
            this.currentClickedElement = foundElement;
            this.showContextMenu(event, foundElement);
        }
        else if (imageInfo) {
            this.showImageContextMenu(event, imageInfo);
        }
        else if (wordInfo) {
            this.showWordContextMenu(event, wordInfo);
        }
        else {
            this.hideContextMenu();
        }
    }

    handleMouseMove(event) {
        if (!this.pdfDoc) return;
        const rect = this.overlayCanvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) * (this.overlayCanvas.width / rect.width);
        const y = (event.clientY - rect.top) * (this.overlayCanvas.height / rect.height);

        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

        const wordInfo = this.getWordAtPosition(x, y);
        const imageInfo = this.getImageAtPosition(x, y);
        const tableInfo = this.getTableAtPosition(x, y);

        let foundElement = null;
        if (this.geometryData) {
            const pageIndex = this.currentPage - 1;
            const pageGeometry = this.geometryData.pages.find(p => p.index === pageIndex);
            if (pageGeometry) {
                for (const element of pageGeometry.elements) {
                    if (this.isPointInElement(x, y, element)) {
                        foundElement = element;
                        break;
                    }
                }
            }
        }

        if (tableInfo) {
            this.highlightTable(tableInfo);
            this.overlayCanvas.style.cursor = 'crosshair';
            console.log('Hovering over table:', tableInfo.tableNumber);
        }
        else if (imageInfo) {
            this.highlightImage(imageInfo);
            this.overlayCanvas.style.cursor = 'crosshair';
            console.log('Hovering over image:', imageInfo.imageNumber);
        }
        else if (wordInfo) {
            this.highlightWord(wordInfo);
            this.overlayCanvas.style.cursor = 'text';
        }
        else if (foundElement) {
            this.highlightElement(foundElement);
            this.overlayCanvas.style.cursor = 'pointer';
        }
        else {
            this.overlayCanvas.style.cursor = 'default';
        }
    }

    handleMouseLeave() {
        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        this.overlayCanvas.style.cursor = 'default';
    }

    isPointInElement(x, y, element) {
        if (!element.quads) return false;
        for (const quad of element.quads) {
            if (this.isPointInQuad(x, y, quad)) return true;
        }
        return false;
    }

    isPointInQuad(x, y, quad) {
        const points = [];
        for (let i = 0; i < 8; i += 2) {
            points.push({
                x: quad[i] * this.scale,
                y: (this.canvas.height - quad[i + 1] * this.scale)
            });
        }
        let inside = false;
        for (let i = 0, j = 3; i < 4; j = i++) {
            const xi = points[i].x, yi = points[i].y;
            const xj = points[j].x, yj = points[j].y;
            const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    highlightElement(element) {
        if (!element.quads) return;
        this.overlayCtx.fillStyle = 'rgba(52, 152, 219, 0.2)';
        this.overlayCtx.strokeStyle = 'rgba(52, 152, 219, 0.8)';
        this.overlayCtx.lineWidth = 2;
        for (const quad of element.quads) {
            this.overlayCtx.beginPath();
            const x1 = quad[0] * this.scale;
            const y1 = this.canvas.height - quad[1] * this.scale;
            this.overlayCtx.moveTo(x1, y1);
            for (let i = 2; i < 8; i += 2) {
                const x = quad[i] * this.scale;
                const y = this.canvas.height - quad[i + 1] * this.scale;
                this.overlayCtx.lineTo(x, y);
            }
            this.overlayCtx.closePath();
            this.overlayCtx.fill();
            this.overlayCtx.stroke();
        }
    }

    highlightWord(wordInfo) {
        if (!wordInfo) return;
        this.overlayCtx.fillStyle = 'rgba(255, 193, 7, 0.3)';
        this.overlayCtx.strokeStyle = 'rgba(255, 193, 7, 0.8)';
        this.overlayCtx.lineWidth = 1;
        this.overlayCtx.beginPath();
        this.overlayCtx.rect(wordInfo.bounds.left, wordInfo.bounds.top, wordInfo.bounds.right - wordInfo.bounds.left, wordInfo.bounds.bottom - wordInfo.bounds.top);
        this.overlayCtx.fill();
        this.overlayCtx.stroke();
        const charWidth = (wordInfo.bounds.right - wordInfo.bounds.left) / wordInfo.word.length;
        const charX = wordInfo.bounds.left + (charWidth * wordInfo.charIndex);
        this.overlayCtx.fillStyle = 'rgba(220, 53, 69, 0.6)';
        this.overlayCtx.fillRect(charX, wordInfo.bounds.top, Math.max(charWidth, 2), wordInfo.bounds.bottom - wordInfo.bounds.top);
    }

    highlightImage(imageInfo) {
        if (!imageInfo) return;

        if (!imageInfo.canvasBounds) {
            const bounds = imageInfo.bounds;
            imageInfo.canvasBounds = {
                left: bounds.left * this.scale,
                right: bounds.right * this.scale,
                top: (this.canvas.height / this.scale - bounds.top) * this.scale,
                bottom: (this.canvas.height / this.scale - bounds.bottom) * this.scale
            };
        }

        const cb = imageInfo.canvasBounds;
        const width = cb.right - cb.left;
        const height = cb.bottom - cb.top;

        this.overlayCtx.fillStyle = 'rgba(40, 167, 69, 0.2)';
        this.overlayCtx.strokeStyle = 'rgba(40, 167, 69, 0.8)';
        this.overlayCtx.lineWidth = 3;
        this.overlayCtx.beginPath();
        this.overlayCtx.rect(cb.left, cb.top, width, height);
        this.overlayCtx.fill();
        this.overlayCtx.stroke();

        const centerX = (cb.left + cb.right) / 2;
        const centerY = (cb.top + cb.bottom) / 2;
        this.overlayCtx.fillStyle = 'rgba(40, 167, 69, 0.9)';
        this.overlayCtx.beginPath();
        this.overlayCtx.arc(centerX, centerY, 20, 0, 2 * Math.PI);
        this.overlayCtx.fill();
        this.overlayCtx.fillStyle = 'white';
        this.overlayCtx.font = 'bold 14px Arial';
        this.overlayCtx.textAlign = 'center';
        this.overlayCtx.textBaseline = 'middle';
        this.overlayCtx.fillText(imageInfo.imageNumber.toString(), centerX, centerY);
    }

    highlightTable(tableInfo) {
        if (!tableInfo || !tableInfo.bounds) return;
        const b = tableInfo.bounds;
        const left = b.left * this.scale;
        const right = b.right * this.scale;
        const top = (this.canvas.height / this.scale - b.top) * this.scale;
        const bottom = (this.canvas.height / this.scale - b.bottom) * this.scale;
        this.overlayCtx.fillStyle = 'rgba(155, 89, 182, 0.18)';
        this.overlayCtx.strokeStyle = 'rgba(155, 89, 182, 0.85)';
        this.overlayCtx.lineWidth = 2;
        this.overlayCtx.beginPath();
        this.overlayCtx.rect(left, top, right - left, bottom - top);
        this.overlayCtx.fill();
        this.overlayCtx.stroke();

        const label = `Table #${tableInfo.tableNumber}`;
        this.overlayCtx.font = 'bold 12px Arial';
        const metrics = this.overlayCtx.measureText(label);
        const padX = 6, padY = 3;
        const labelW = metrics.width + padX*2;
        const labelH = 18;
        let lx = left;
        let ly = top - labelH - 4;
        if (ly < 0) ly = top + 4;
        this.overlayCtx.fillStyle = 'rgba(155,89,182,0.9)';
        this.overlayCtx.beginPath();
        this.overlayCtx.roundRect(lx, ly, labelW, labelH, 6);
        this.overlayCtx.fill();
        this.overlayCtx.fillStyle = '#fff';
        this.overlayCtx.textBaseline = 'middle';
        this.overlayCtx.fillText(label, lx + padX, ly + labelH/2 + 1);
    }

    showContextMenu(event, element) {
        const menuOptions = this.getMenuOptionsForElement(element);
        this.buildAndShowContextMenu(event, menuOptions);
    }

    showWordContextMenu(event, wordInfo) {
        const menuOptions = [
            { type: 'header', label: `Word: "${wordInfo.word}"` },
            { label: 'Copy Word', icon: '📋', handler: () => { navigator.clipboard.writeText(wordInfo.word); this.showStatus(`Copied word: ${wordInfo.word}`, 'success'); } },
            { label: 'Word Info', icon: 'ℹ️', handler: () => { alert(`Word: "${wordInfo.word}"\nFont Size: ${wordInfo.fontSize.toFixed(1)}px\nCoordinates: (${wordInfo.coordinates.pdfX.toFixed(2)}, ${wordInfo.coordinates.pdfY.toFixed(2)})`); } }
        ];
        this.buildAndShowContextMenu(event, menuOptions);
    }

    showImageContextMenu(event, imageInfo) {
        const menuOptions = [
            { type: 'header', label: `Image #${imageInfo.imageNumber}` },
            { label: 'Copy Image Info', icon: '📋', handler: () => { const info = `Image #${imageInfo.imageNumber} - Page ${imageInfo.pageNumber}`; navigator.clipboard.writeText(info); this.showStatus(`Copied image info: ${info}`, 'success'); } },
            { label: 'Image Properties', icon: 'ℹ️', handler: () => { alert(`Image #${imageInfo.imageNumber}\nPage: ${imageInfo.pageNumber}\nDimensions: ${imageInfo.bounds.width.toFixed(1)} x ${imageInfo.bounds.height.toFixed(1)} units\nType: ${imageInfo.type}`); } }
        ];
        this.buildAndShowContextMenu(event, menuOptions);
    }

    buildAndShowContextMenu(event, menuOptions) {
        let menuHTML = '';
        for (const option of menuOptions) {
            if (option.type === 'header') menuHTML += `<div class="context-menu-header">${option.label}</div>`;
            else if (option.type === 'divider') menuHTML += '<div class="context-menu-divider"></div>';
            else {
                const className = option.className ? ` ${option.className}` : '';
                menuHTML += `<div class="context-menu-item${className}" data-action="${option.label}"><span class="context-menu-icon">${option.icon || ''}</span><span>${option.label}</span></div>`;
            }
        }
        this.contextMenu.innerHTML = menuHTML;
        const menuItems = this.contextMenu.querySelectorAll('.context-menu-item');
        menuItems.forEach((item, index) => {
            const option = menuOptions.filter(opt => opt.type !== 'header' && opt.type !== 'divider')[index];
            if (option && option.handler) {
                item.addEventListener('click', () => {
                    option.handler();
                    this.hideContextMenu();
                });
            }
        });
        let menuX = event.clientX;
        let menuY = event.clientY;
        if (menuX + 200 > window.innerWidth) menuX = window.innerWidth - 200;
        if (menuY + 200 > window.innerHeight) menuY = window.innerHeight - 200;
        this.contextMenu.style.left = menuX + 'px';
        this.contextMenu.style.top = menuY + 'px';
        this.contextMenu.classList.add('visible');
    }

    hideContextMenu() {
        this.contextMenu.classList.remove('visible');
        this.currentClickedElement = null;
    }

    // Lightweight table detection
    detectTablesForCurrentPage() {
        if (!this.textItems.length) {
            this.tablesByPage[this.currentPage] = [];
            return;
        }

        const lines = this.getOrBuildLineGroups();
        if (!lines.length) {
            this.tablesByPage[this.currentPage] = [];
            return;
        }

        const tables = [];
        let tableCounter = 1;
        const alignmentTolerance = 50;

        for (let i=0; i<lines.length; i++) {
            const line = lines[i];
            if (!line.fragments || line.fragments.length < 2) continue;

            const baseCenters = line.fragments.map(f => (f.left + f.right)/2);
            let j = i + 1;
            const candidate = [line];

            while (j < lines.length) {
                const nxt = lines[j];
                if (!nxt.fragments || nxt.fragments.length < 2) break;

                const centers = nxt.fragments.map(f => (f.left + f.right)/2);
                let alignedCount = 0;

                for (const c of centers) {
                    let best = Infinity;
                    for (const bc of baseCenters) {
                        const d = Math.abs(c - bc);
                        if (d < best) best = d;
                    }
                    if (best <= alignmentTolerance) alignedCount++;
                }

                const minRequired = Math.max(1, Math.min(baseCenters.length, centers.length) - 2);
                if (alignedCount < minRequired) break;

                candidate.push(nxt);
                j++;
            }

            if (candidate.length >= 2) {
                const left = Math.min(...candidate.map(l => l.bounds.left));
                const right = Math.max(...candidate.map(l => l.bounds.right));
                const top = Math.max(...candidate.map(l => l.bounds.top));
                const bottom = Math.min(...candidate.map(l => l.bounds.bottom));
                const rows = candidate.length;
                const columns = Math.max(...candidate.map(l => l.fragments.length));

                const bounds = { left, right, top, bottom, width: right-left, height: top-bottom };
                const table = {
                    tableNumber: tableCounter++,
                    pageNumber: this.currentPage,
                    bounds,
                    rows,
                    columns,
                    cellCount: rows * columns,
                    lines: candidate
                };

                tables.push(table);
                i = j - 1; // Skip processed lines
            }
        }

        this.tablesByPage[this.currentPage] = tables;
    }

    getTableAtPosition(canvasX, canvasY) {
        const tables = this.tablesByPage[this.currentPage] || [];
        if (!tables.length) return null;
        const pdfX = canvasX / this.scale;
        const pdfY = (this.canvas.height - canvasY) / this.scale;
        for (const t of tables) {
            const b = t.bounds;
            if (pdfX >= b.left && pdfX <= b.right && pdfY >= b.bottom && pdfY <= b.top) return t;
        }
        return null;
    }

    getOrBuildLineGroups() {
        if (!this.textItems.length) return [];
        if (this._cachedLineGroups && this._cachedLineGroupsPage === this.currentPage) return this._cachedLineGroups;

        const tolerance = 4;
        const lines = [];
        for (const item of this.textItems) {
            let line = lines.find(l => Math.abs(l.y - item.y) <= tolerance);
            if (!line) { line = { y: item.y, items: [] }; lines.push(line); }
            line.items.push(item);
        }

        lines.sort((a,b)=> b.y - a.y);
        let lineNumber = 1;
        for (const line of lines) {
            line.items.sort((a,b)=> a.x - b.x);
            const gapThreshold = this.estimateColumnGapThreshold(line.items);
            const fragments = [];
            let current = [];
            let lastRight = null;

            for (const it of line.items) {
                if (lastRight !== null) {
                    const gap = it.x - lastRight;
                    if (gap > gapThreshold) {
                        if (current.length) fragments.push(current);
                        current = [];
                    }
                }
                current.push(it);
                lastRight = it.x + it.width;
            }
            if (current.length) fragments.push(current);

            line.fragments = fragments.map(fItems => ({
                items: fItems,
                text: fItems.map(fi=>fi.str).join(' '),
                left: Math.min(...fItems.map(fi=>fi.x)),
                right: Math.max(...fItems.map(fi=>fi.x + fi.width))
            }));
            line.number = lineNumber++;
            const left = Math.min(...line.items.map(i=>i.x));
            const right = Math.max(...line.items.map(i=>i.x + i.width));
            const maxFont = Math.max(...line.items.map(i=>i.fontSize));
            const top = line.y + maxFont * 0.8;
            const bottom = line.y - maxFont * 0.2;
            line.bounds = { left, right, top, bottom };
        }

        this._cachedLineGroups = lines;
        this._cachedLineGroupsPage = this.currentPage;
        return lines;
    }

    estimateColumnGapThreshold(items) {
        if (!items || items.length < 2) return 40;
        const gaps = [];
        let lastRight = null;
        for (const it of items) {
            if (lastRight !== null) {
                const gap = it.x - lastRight;
                if (gap > 0) gaps.push(gap);
            }
            lastRight = it.x + it.width;
        }
        if (!gaps.length) return 40;
        const sorted = gaps.slice().sort((a,b)=>a-b);
        const mid = Math.floor(sorted.length/2);
        const median = sorted.length % 2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
        return Math.max(40, median * 2.5);
    }

    computeLineSpacingMetrics() {
        if (!this.textItems.length) return;
        const tolerance = 4;
        const lines = [];
        for (const item of this.textItems) {
            let line = lines.find(l => Math.abs(l.y - item.y) <= tolerance);
            if (!line) { line = { y: item.y, items: [] }; lines.push(line); }
            line.items.push(item);
        }
        lines.sort((a,b)=> b.y - a.y);
        const spacings = [];
        for (let i=1;i<lines.length;i++) {
            const prev = lines[i-1];
            const curr = lines[i];
            const gap = prev.y - curr.y;
            curr.spacingAbove = gap;
            if (gap > 0) spacings.push(gap);
        }
        const median = this.median(spacings);
        this.lineSpacingMedian = median || 0;
        this.lineGroups = lines;
    }

    median(arr) {
        if (!arr || !arr.length) return 0;
        const sorted = [...arr].sort((a,b)=>a-b);
        const mid = Math.floor(sorted.length/2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
    }

    analyzePageContent(page) {
        // Placeholder for page content analysis
        console.log('Analyzing page content...');
    }
}

// Initialize the viewer when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new PDFInstructorViewer();
});