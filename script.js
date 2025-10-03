// Set PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

class PDFHighlightViewer {
    constructor() {
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
        // Table detection state (reintroduced lightweight version)
        this.tablesByPage = {}; // pageNumber -> array of table objects
    // Removed table/reference detection per request
    // Tooltip interaction mode: 'click' (default now) or 'hover'
    this.tooltipMode = 'click';
    // Track whether a tooltip is pinned due to click
    this.tooltipPinned = false;

    // Line spacing analysis state
    this.lineSpacingEnabled = false;
    this.lineGroups = []; // grouped lines with baseline info
    this.lineSpacingMedian = 0;
    this.lineMismatches = []; // subset of lineGroups flagged
    this.lineSpacingThresholdPct = 15; // configurable later

        this.initializeEventListeners();
        this.initializeMenuHandlers();

        // Modal setup
        this.coordModal = document.getElementById('coordModal');
        this.coordForm = document.getElementById('coordForm');
        this.coordFormStatus = document.getElementById('coordFormStatus');
        this.coordinateEndpoint = '/api/coordinates'; // configurable endpoint
        this.setupModalHandlers();
    }

    initializeEventListeners() {
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
        
        // Add a diagnostic button for debugging PDF issues
        document.addEventListener('keydown', (e) => {
            if (e.key === 'd' && e.ctrlKey && e.shiftKey) {
                e.preventDefault();
                if (this.pdfDoc) {
                    this.runDiagnostics();
                }
            }
            // Add a visual test for overlay canvas
            if (e.key === 't' && e.ctrlKey && e.shiftKey) {
                e.preventDefault();
                this.testOverlayCanvas();
            }
        });
        
        this.overlayCanvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.overlayCanvas.addEventListener('mouseleave', () => this.handleMouseLeave());
        this.overlayCanvas.addEventListener('click', (e) => this.handleClick(e));
        this.overlayCanvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.handleContextMenu(e); });

        // Close context menu when clicking elsewhere
        document.addEventListener('click', (e) => {
            if (!this.contextMenu.contains(e.target) && e.target !== this.overlayCanvas) {
                this.hideContextMenu();
            }
        });

        // Allow ESC to unpin tooltip
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.tooltipPinned) {
                this.tooltipPinned = false;
                this.hideTooltip();
                this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
            }
        });
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
        this.attachModalQuickActions();
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

    showStatus(message, type = 'info') {
        const statusEl = document.getElementById('statusMessage');
        statusEl.className = `status-message ${type}`;
        statusEl.textContent = message;
        statusEl.style.display = 'block';
        if (type !== 'error') {
            setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
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
    
    async extractImagesFromCanvasOperations(page) {
        try {
            console.log(`Method 3 - Looking for canvas operations that might indicate images`);
            
            const ops = await page.getOperatorList();
            let hasComplexGraphics = false;
            let rectOperations = [];
            let currentTransform = [1, 0, 0, 1, 0, 0];
            
            // Look for patterns that might indicate image-like content
            for (let i = 0; i < ops.fnArray.length; i++) {
                const fn = ops.fnArray[i];
                const args = ops.argsArray[i];
                
                // Track transform changes
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
                
                // Look for rect operations that might be image placeholders
                if (fn === pdfjsLib.OPS.rectangle) {
                    const [x, y, width, height] = args;
                    if (width > 50 && height > 50) { // Reasonable image size
                        rectOperations.push({
                            x, y, width, height,
                            transform: [...currentTransform],
                            index: i
                        });
                    }
                }
                
                // Check for complex path operations
                if (fn === pdfjsLib.OPS.constructPath || 
                    fn === pdfjsLib.OPS.clip || 
                    fn === pdfjsLib.OPS.fill ||
                    fn === pdfjsLib.OPS.fillAndStroke) {
                    hasComplexGraphics = true;
                }
            }
            
            console.log(`Found ${rectOperations.length} potential image rectangles`);
            console.log(`Has complex graphics: ${hasComplexGraphics}`);
            
            // If we found rectangles but no images, they might be image placeholders
            if (rectOperations.length > 0 && this.imageItems.length === 0) {
                console.log('Creating image items from rectangle operations...');
                rectOperations.forEach((rect, index) => {
                    this.imageCounter++;
                    const bounds = this.calculateImageBounds(rect.transform.concat([rect.x, rect.y]));
                    
                    console.log(`Method 3 - Found potential image ${this.imageCounter} from rectangle:`, bounds);
                    
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
    
    async analyzePageContent(page) {
        try {
            console.log('=== PAGE CONTENT ANALYSIS ===');
            
            // Get viewport info
            const viewport = page.getViewport({ scale: 1.0 });
            console.log('Page viewport:', { width: viewport.width, height: viewport.height });
            
            // Try to get page dictionary info
            const annotations = await page.getAnnotations();
            console.log(`Found ${annotations.length} annotations`);
            
            annotations.forEach((ann, i) => {
                console.log(`Annotation ${i}:`, {
                    subtype: ann.subtype,
                    hasAppearance: ann.hasAppearance,
                    rect: ann.rect,
                    contents: ann.contents
                });
            });
            
            // Check text content to see if there are references to images
            const textContent = await page.getTextContent();
            const textStr = textContent.items.map(item => item.str).join(' ');
            const imageKeywords = ['image', 'figure', 'fig', 'photo', 'picture', 'graphic'];
            const foundKeywords = imageKeywords.filter(keyword => 
                textStr.toLowerCase().includes(keyword));
            
            if (foundKeywords.length > 0) {
                console.log('Found image-related text keywords:', foundKeywords);
                console.log('This suggests the page should contain images');
            }
            
        } catch (error) {
            console.error('Error analyzing page content:', error);
        }
    }
    
    async extractImagesFromOperators(page) {
        try {
            const ops = await page.getOperatorList();
            let transform = [1, 0, 0, 1, 0, 0];
            let transformStack = [];
            
            console.log(`Method 1 - Extracting images from operators on page ${page.pageNumber}: Found ${ops.fnArray.length} operations`);
            
            // Debug: Count different operation types
            const opCounts = {};
            ops.fnArray.forEach(fn => {
                const opName = Object.keys(pdfjsLib.OPS).find(key => pdfjsLib.OPS[key] === fn) || `unknown_${fn}`;
                opCounts[opName] = (opCounts[opName] || 0) + 1;
            });
            console.log('Operation counts:', opCounts);
            
            // Check for any graphics-related operations
            const graphicsOps = ['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject', 
                               'paintFormXObjectBegin', 'paintFormXObjectEnd', 'beginMarkedContent', 
                               'beginMarkedContentProps', 'endMarkedContent'];
            const foundGraphicsOps = {};
            graphicsOps.forEach(op => {
                if (opCounts[op]) foundGraphicsOps[op] = opCounts[op];
            });
            console.log('Graphics-related operations found:', foundGraphicsOps);
            
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
                    console.log(`Method 1 - Found image ${this.imageCounter} (${opName}) with bounds:`, bounds);
                    console.log(`Transform matrix:`, transform);
                    console.log(`Arguments:`, args);
                    
                    this.imageItems.push({ 
                        imageNumber: this.imageCounter, 
                        type: 'image', 
                        bounds, 
                        transform: [...transform], 
                        operatorType: fn, 
                        operatorName: opName,
                        pageNumber: page.pageNumber,
                        method: 'operators'
                    });
                }
                
                // Also check for Form XObjects that might contain images
                else if (fn === pdfjsLib.OPS.paintFormXObjectBegin) {
                    console.log(`Found Form XObject operation with args:`, args);
                    // Form XObjects can contain images, let's track them too
                    this.imageCounter++;
                    const bounds = this.calculateImageBounds(transform);
                    console.log(`Method 1 - Found Form XObject ${this.imageCounter} with bounds:`, bounds);
                    
                    this.imageItems.push({ 
                        imageNumber: this.imageCounter, 
                        type: 'form', 
                        bounds, 
                        transform: [...transform], 
                        operatorType: fn, 
                        operatorName: 'paintFormXObjectBegin',
                        pageNumber: page.pageNumber,
                        method: 'operators'
                    });
                }
            }
        } catch (error) {
            console.error('Error in extractImagesFromOperators:', error);
        }
    }
    
    async extractImagesFromResources(page) {
        try {
            // Alternative method: try to access page resources directly
            console.log(`Method 2 - Attempting to extract images from page resources`);
            
            // Get page viewport for bounds calculation
            const viewport = page.getViewport({ scale: 1.0 });
            
            // Try to access the page's resource dictionary
            const pageDict = await page.getAnnotations();
            console.log('Page annotations found:', pageDict.length);
            
            // Look for images in annotations (some PDFs embed images this way)
            pageDict.forEach((annotation, index) => {
                if (annotation.subtype === 'Widget' || annotation.hasAppearance) {
                    console.log(`Found annotation ${index} that might contain images:`, annotation);
                    
                    // Create a rough bounding box from annotation rect
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

    calculateImageBounds(transform) {
        const [a, b, c, d, e, f] = transform;
        const corners = [[0,0],[1,0],[1,1],[0,1]];
        const transformedCorners = corners.map(([x,y]) => [a*x + c*y + e, b*x + d*y + f]);
        const xs = transformedCorners.map(([x]) => x);
        const ys = transformedCorners.map(([,y]) => y);
        return { left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys), width: Math.max(...xs)-Math.min(...xs), height: Math.max(...ys)-Math.min(...ys) };
    }

    getImageAtPosition(x, y) {
        if (!this.imageItems.length) return null;
        const pdfX = x / this.scale;
        const pdfY = (this.canvas.height - y) / this.scale;
        
        // Debug every mouse position check
        console.log(`Checking position: Canvas(${x.toFixed(0)}, ${y.toFixed(0)}) -> PDF(${pdfX.toFixed(1)}, ${pdfY.toFixed(1)})`);
        console.log(`Available images: ${this.imageItems.length}`);
        
        for (const image of this.imageItems) {
            const bounds = image.bounds;
            console.log(`Image ${image.imageNumber} bounds: left=${bounds.left.toFixed(1)}, right=${bounds.right.toFixed(1)}, bottom=${bounds.bottom.toFixed(1)}, top=${bounds.top.toFixed(1)}`);
            
            const inBounds = pdfX >= bounds.left && pdfX <= bounds.right && pdfY >= bounds.bottom && pdfY <= bounds.top;
            console.log(`Image ${image.imageNumber} hit test: ${inBounds}`);
            
            if (inBounds) {
                // Calculate canvas bounds correctly
                const canvasBounds = {
                    left: bounds.left * this.scale,
                    right: bounds.right * this.scale,
                    top: (this.canvas.height / this.scale - bounds.top) * this.scale,
                    bottom: (this.canvas.height / this.scale - bounds.bottom) * this.scale
                };
                
                console.log(`Image ${image.imageNumber} HIT! Canvas bounds:`, canvasBounds);
                
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
        return null;
    }


    calculateBounds(items) {
        if (!items.length) return null;
        const xs = items.map(i=>i.x);
        const ys = items.map(i=>i.y);
        const rights = items.map(i=>i.x + i.width);
        const bottoms = items.map(i=>i.y - i.height);
        return { left: Math.min(...xs), right: Math.max(...rights), top: Math.max(...ys), bottom: Math.min(...bottoms), width: Math.max(...rights)-Math.min(...xs), height: Math.max(...ys)-Math.min(...bottoms) };
    }

    /* ================= Line Grouping (Lightweight) ================= */
    // Returns cached grouping if already computed for current page & scale.
    getOrBuildLineGroups() {
        if (!this.textItems.length) return [];
        if (this._cachedLineGroups && this._cachedLineGroupsPage === this.currentPage) return this._cachedLineGroups;
        const tolerance = 4; // PDF units baseline tolerance
        const lines = [];
        for (const item of this.textItems) {
            let line = lines.find(l => Math.abs(l.y - item.y) <= tolerance);
            if (!line) { line = { y: item.y, items: [] }; lines.push(line); }
            line.items.push(item);
        }
        // Sort lines visually top-to-bottom: PDF y higher means nearer top, so sort descending -> then reverse to top->bottom order
        lines.sort((a,b)=> b.y - a.y); // descending
        // Build textual representation
        let lineNumber = 1;
        for (const line of lines) {
            line.items.sort((a,b)=> a.x - b.x);
            // Column fragment detection: split on large horizontal gaps
            const words = line.items.map(w=> w.str);
            const gapThreshold = this.estimateColumnGapThreshold(line.items);
            const fragments = [];
            let current = [];
            let lastRight = null;
            for (const it of line.items) {
                if (lastRight !== null) {
                    const gap = it.x - lastRight;
                    if (gap > gapThreshold) { // start new fragment
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
            line.text = line.fragments.map(f=>f.text).join('  '); // full line if needed
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
        if (!items || items.length < 2) return 40; // default
        // Compute consecutive gaps
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
        // Use median gap * 2.5 as threshold (bigger indicates column break)
        const sorted = gaps.slice().sort((a,b)=>a-b);
        const mid = Math.floor(sorted.length/2);
        const median = sorted.length % 2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
        const threshold = Math.max(40, median * 2.5); // enforce minimum
        return threshold;
    }

    // Removed reference/table classification & hit-testing per request

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
        // Left click: open coordinate modal for word/image/element (no dropdown)
        if (!this.pdfDoc) return;
        const rect = this.overlayCanvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) * (this.overlayCanvas.width / rect.width);
        const y = (event.clientY - rect.top) * (this.overlayCanvas.height / rect.height);
        // Table detection has priority: classify click within a table before word/image/element
        const tableInfo = this.getTableAtPosition(x, y);
        const wordInfo = this.getWordAtPosition(x, y);
        const imageInfo = this.getImageAtPosition(x, y);
        let foundElement = null;
        if (this.geometryData) {
            const pageIndex = this.currentPage - 1;
            const pageGeometry = this.geometryData.pages.find(p => p.index === pageIndex);
            if (pageGeometry) {
                for (const element of pageGeometry.elements) { if (this.isPointInElement(x, y, element)) { foundElement = element; break; } }
            }
        }
        if (!tableInfo && !wordInfo && !imageInfo && !foundElement) { this.hideContextMenu(); return; }
        // Determine primary target preference order: word > image > element
        let type, payload, refText, lineMeta = { number:null, text:'' };
        const lineGroups = this.getOrBuildLineGroups();
        const resolveLineForWord = (wi) => {
            if (!wi) return null;
            // Find line whose bounds contain the pdfY of the word center
            const pdfY = wi.y; // baseline
            // Because baseline near bottom of the glyph, include tolerance
            let best = null; let minDelta = Infinity;
            for (const line of lineGroups) {
                const delta = Math.abs(line.y - pdfY);
                if (delta < minDelta) { minDelta = delta; best = line; }
            }
            return best;
        };
        const resolveLineForElement = (el) => {
            if (!el || !el.quads || !el.quads.length) return null;
            const quad = el.quads[0];
            const baselineY = quad[1];
            let best = null; let minDelta = Infinity;
            for (const line of lineGroups) {
                const delta = Math.abs(line.y - baselineY);
                if (delta < minDelta) { minDelta = delta; best = line; }
            }
            return best;
        };
        let resolvedLine = null;
        if (tableInfo) {
            type = 'table';
            refText = `Table #${tableInfo.tableNumber}`;
            // line association: pick nearest baseline among lines used by table to clicked pdfY
            const pdfX = x / this.scale;
            const pdfY = (this.canvas.height - y) / this.scale;
            let nearestLine = null; let minDelta = Infinity;
            for (const ln of tableInfo.lines) {
                const d = Math.abs(ln.y - pdfY);
                if (d < minDelta) { minDelta = d; nearestLine = ln; }
            }
            if (nearestLine) lineMeta = { number: nearestLine.number, text: nearestLine.text };
            payload = { type, page: this.currentPage, pdfX, pdfY, canvasX: x, canvasY: y, reference: refText, lineNumber: lineMeta.number, lineText: lineMeta.text };
            this.overlayCtx.clearRect(0,0,this.overlayCanvas.width,this.overlayCanvas.height);
            if (this.lineSpacingEnabled) this.drawLineSpacingOverlay();
            this.highlightTable(tableInfo);
        } else if (wordInfo) {
            type = 'word';
            refText = wordInfo.word;
            resolvedLine = resolveLineForWord(wordInfo);
            if (resolvedLine) lineMeta = { number: resolvedLine.number, text: resolvedLine.text };
            // Pick fragment containing the word
            if (resolvedLine && resolvedLine.fragments) {
                const pdfX = wordInfo.x;
                const frag = resolvedLine.fragments.find(f => pdfX >= f.left && pdfX <= f.right);
                if (frag) lineMeta.text = frag.text;
            }
            payload = { type, page: this.currentPage, pdfX: wordInfo.coordinates.pdfX, pdfY: wordInfo.coordinates.pdfY, canvasX: wordInfo.coordinates.canvasX, canvasY: wordInfo.coordinates.canvasY, reference: refText, lineNumber: lineMeta.number, lineText: lineMeta.text };
            this.overlayCtx.clearRect(0,0,this.overlayCanvas.width,this.overlayCanvas.height);
            if (this.lineSpacingEnabled) this.drawLineSpacingOverlay();
            this.highlightWord(wordInfo);
        } else if (imageInfo) {
            type = 'image';
            refText = `Image #${imageInfo.imageNumber}`;
            // Attempt to approximate line using vertical center to nearest baseline (less meaningful for images)
            const pseudoWord = { y: imageInfo.coordinates.pdfY };
            resolvedLine = resolveLineForWord(pseudoWord);
            if (resolvedLine) lineMeta = { number: resolvedLine.number, text: resolvedLine.text };
            if (resolvedLine && resolvedLine.fragments) {
                // Use nearest fragment by horizontal center of image
                const centerX = (imageInfo.bounds.left + imageInfo.bounds.right)/2;
                let best = null; let min = Infinity;
                for (const f of resolvedLine.fragments) {
                    const fCenter = (f.left + f.right)/2;
                    const d = Math.abs(centerX - fCenter);
                    if (d < min) { min = d; best = f; }
                }
                if (best) lineMeta.text = best.text;
            }
            payload = { type, page: this.currentPage, pdfX: imageInfo.coordinates.pdfX, pdfY: imageInfo.coordinates.pdfY, canvasX: imageInfo.coordinates.canvasX, canvasY: imageInfo.coordinates.canvasY, reference: refText, lineNumber: lineMeta.number, lineText: lineMeta.text };
            this.overlayCtx.clearRect(0,0,this.overlayCanvas.width,this.overlayCanvas.height);
            if (this.lineSpacingEnabled) this.drawLineSpacingOverlay();
            this.highlightImage(imageInfo);
        } else if (foundElement) {
            type = 'element';
            refText = foundElement.id || foundElement.role || 'element';
            // approximate pdf coords from first quad's first point
            let pdfX = null, pdfY = null;
            if (foundElement.quads && foundElement.quads.length) { pdfX = foundElement.quads[0][0]; pdfY = foundElement.quads[0][1]; }
            resolvedLine = resolveLineForElement(foundElement);
            if (resolvedLine) lineMeta = { number: resolvedLine.number, text: resolvedLine.text };
            if (resolvedLine && resolvedLine.fragments && pdfX !== null) {
                const frag = resolvedLine.fragments.find(f => pdfX >= f.left && pdfX <= f.right);
                if (frag) lineMeta.text = frag.text;
            }
            const canvasX = x; const canvasY = y;
            payload = { type, page: this.currentPage, pdfX, pdfY, canvasX, canvasY, reference: refText, lineNumber: lineMeta.number, lineText: lineMeta.text };
            this.overlayCtx.clearRect(0,0,this.overlayCanvas.width,this.overlayCanvas.height);
            if (this.lineSpacingEnabled) this.drawLineSpacingOverlay();
            this.highlightElement(foundElement);
        }
        this.openCoordModal(payload);
    }

    // Removed click dropdown logic per updated requirement; operations moved to modal select (image only)

    handleContextMenu(event) {
        // Right-click (context menu) retains original context menu functionality
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
                for (const element of pageGeometry.elements) { if (this.isPointInElement(x, y, element)) { foundElement = element; break; } }
            }
        }
        if (foundElement) { this.currentClickedElement = foundElement; this.showContextMenu(event, foundElement); }
        else if (imageInfo) { this.showImageContextMenu(event, imageInfo); }
        else if (wordInfo) { this.showWordContextMenu(event, wordInfo); }
        else { this.hideContextMenu(); }
    }

    showContextMenu(event, element) {
        const menuOptions = this.getMenuOptionsForElement(element);
        let menuHTML = '';
        for (const option of menuOptions) {
            if (option.type === 'header') {
                menuHTML += `<div class="context-menu-header">${option.label}</div>`;
            } else if (option.type === 'divider') {
                menuHTML += '<div class="context-menu-divider"></div>';
            } else {
                const className = option.className ? ` ${option.className}` : '';
                menuHTML += `\n<div class="context-menu-item${className}" data-action="${option.label}">\n<span class="context-menu-icon">${option.icon || ''}</span>\n<span>${option.label}</span>\n</div>`;
            }
        }
        this.contextMenu.innerHTML = menuHTML;
        const menuItems = this.contextMenu.querySelectorAll('.context-menu-item');
        menuItems.forEach((item, index) => {
            const option = menuOptions.filter(opt => opt.type !== 'header' && opt.type !== 'divider')[index];
            if (option && option.handler) { item.addEventListener('click', () => { option.handler(); this.hideContextMenu(); }); }
        });
        let menuX = event.clientX; let menuY = event.clientY;
        const menuRect = this.contextMenu.getBoundingClientRect();
        if (menuX + 200 > window.innerWidth) menuX = window.innerWidth - 200;
        if (menuY + menuRect.height > window.innerHeight) menuY = window.innerHeight - menuRect.height;
        this.contextMenu.style.left = menuX + 'px';
        this.contextMenu.style.top = menuY + 'px';
        this.contextMenu.classList.add('visible');
    }

    showWordContextMenu(event, wordInfo) {
        const menuOptions = [
            { type: 'header', label: `Word: "${wordInfo.word}"` },
            { label: 'Copy Word', icon: '📋', handler: () => { navigator.clipboard.writeText(wordInfo.word); this.showStatus(`Copied word: ${wordInfo.word}`, 'success'); } },
            { label: 'Copy Character', icon: '📝', handler: () => { navigator.clipboard.writeText(wordInfo.word[wordInfo.charIndex]); this.showStatus(`Copied character: ${wordInfo.word[wordInfo.charIndex]}`, 'success'); } },
            { label: 'Copy Coordinates', icon: '📍', handler: () => { const coords = `PDF: (${wordInfo.coordinates.pdfX.toFixed(2)}, ${wordInfo.coordinates.pdfY.toFixed(2)})`; navigator.clipboard.writeText(coords); this.showStatus('Copied coordinates', 'success'); } },
            { type: 'divider' },
            { label: 'Word Info', icon: 'ℹ️', handler: () => { const info = `Word Information:\n\nWord: "${wordInfo.word}"\nCharacter: "${wordInfo.word[wordInfo.charIndex]}" (${wordInfo.charIndex + 1}/${wordInfo.word.length})\nFont Size: ${wordInfo.fontSize.toFixed(1)}px\nPDF Coordinates: (${wordInfo.coordinates.pdfX.toFixed(2)}, ${wordInfo.coordinates.pdfY.toFixed(2)})\nCanvas Coordinates: (${wordInfo.coordinates.canvasX.toFixed(0)}, ${wordInfo.coordinates.canvasY.toFixed(0)})`; alert(info); } }
        ];
        let menuHTML = '';
        for (const option of menuOptions) {
            if (option.type === 'header') menuHTML += `<div class="context-menu-header">${option.label}</div>`;
            else if (option.type === 'divider') menuHTML += '<div class="context-menu-divider"></div>';
            else { const className = option.className ? ` ${option.className}` : ''; menuHTML += `\n<div class="context-menu-item${className}" data-action="${option.label}">\n<span class="context-menu-icon">${option.icon || ''}</span>\n<span>${option.label}</span>\n</div>`; }
        }
        this.contextMenu.innerHTML = menuHTML;
        const menuItems = this.contextMenu.querySelectorAll('.context-menu-item');
        menuItems.forEach((item, index) => { const option = menuOptions.filter(opt => opt.type !== 'header' && opt.type !== 'divider')[index]; if (option && option.handler) { item.addEventListener('click', () => { option.handler(); this.hideContextMenu(); }); } });
        let menuX = event.clientX; let menuY = event.clientY;
        if (menuX + 200 > window.innerWidth) menuX = window.innerWidth - 200;
        if (menuY + 150 > window.innerHeight) menuY = window.innerHeight - 150;
        this.contextMenu.style.left = menuX + 'px';
        this.contextMenu.style.top = menuY + 'px';
        this.contextMenu.classList.add('visible');
    }

    showImageContextMenu(event, imageInfo) {
        const menuOptions = [
            { type: 'header', label: `Image #${imageInfo.imageNumber}` },
            { label: 'Copy Image Info', icon: '📋', handler: () => { const info = `Image #${imageInfo.imageNumber} - Page ${imageInfo.pageNumber}`; navigator.clipboard.writeText(info); this.showStatus(`Copied image info: ${info}`, 'success'); } },
            { label: 'Copy Coordinates', icon: '📍', handler: () => { const coords = `PDF: (${imageInfo.coordinates.pdfX.toFixed(2)}, ${imageInfo.coordinates.pdfY.toFixed(2)})`; navigator.clipboard.writeText(coords); this.showStatus('Copied image coordinates', 'success'); } },
            { label: 'Copy Dimensions', icon: '📏', handler: () => { const dims = `${imageInfo.bounds.width.toFixed(1)} x ${imageInfo.bounds.height.toFixed(1)} units`; navigator.clipboard.writeText(dims); this.showStatus('Copied image dimensions', 'success'); } },
            { type: 'divider' },
            { label: 'Image Properties', icon: 'ℹ️', handler: () => { const props = `Image Properties:\n\nImage Number: ${imageInfo.imageNumber}\nPage: ${imageInfo.pageNumber}\nPDF Coordinates: (${imageInfo.coordinates.pdfX.toFixed(2)}, ${imageInfo.coordinates.pdfY.toFixed(2)})\nCanvas Coordinates: (${imageInfo.coordinates.canvasX.toFixed(0)}, ${imageInfo.coordinates.canvasY.toFixed(0)})\nDimensions: ${imageInfo.bounds.width.toFixed(1)} x ${imageInfo.bounds.height.toFixed(1)} units\nType: ${imageInfo.type}`; alert(props); } },
            { label: 'Export Image Data', icon: '💾', handler: () => { const data = JSON.stringify(imageInfo, null, 2); const blob = new Blob([data], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `image_${imageInfo.imageNumber}_page_${imageInfo.pageNumber}.json`; a.click(); URL.revokeObjectURL(url); this.showStatus(`Exported image ${imageInfo.imageNumber} data`, 'success'); } }
        ];
        let menuHTML = '';
        for (const option of menuOptions) { if (option.type === 'header') menuHTML += `<div class="context-menu-header">${option.label}</div>`; else if (option.type === 'divider') menuHTML += '<div class="context-menu-divider"></div>'; else { const className = option.className ? ` ${option.className}` : ''; menuHTML += `\n<div class="context-menu-item${className}" data-action="${option.label}">\n<span class="context-menu-icon">${option.icon || ''}</span>\n<span>${option.label}</span>\n</div>`; } }
        this.contextMenu.innerHTML = menuHTML;
        const menuItems = this.contextMenu.querySelectorAll('.context-menu-item');
        menuItems.forEach((item, index) => { const option = menuOptions.filter(opt => opt.type !== 'header' && opt.type !== 'divider')[index]; if (option && option.handler) { item.addEventListener('click', () => { option.handler(); this.hideContextMenu(); }); } });
        let menuX = event.clientX; let menuY = event.clientY;
        if (menuX + 200 > window.innerWidth) menuX = window.innerWidth - 200;
        if (menuY + 200 > window.innerHeight) menuY = window.innerHeight - 200;
        this.contextMenu.style.left = menuX + 'px';
        this.contextMenu.style.top = menuY + 'px';
        this.contextMenu.classList.add('visible');
    }

    showTableContextMenu(event, tableInfo) {
        const menuOptions = [
            { type: 'header', label: `Table #${tableInfo.tableNumber}` },
            { label: 'Copy Table Info', icon: '📋', handler: () => { const info = `Table #${tableInfo.tableNumber} (${tableInfo.rows}×${tableInfo.columns}) - Page ${tableInfo.pageNumber}`; navigator.clipboard.writeText(info); this.showStatus(`Copied table info: ${info}`, 'success'); } },
            { label: 'Copy Coordinates', icon: '📍', handler: () => { const coords = `PDF: (${tableInfo.coordinates.pdfX.toFixed(2)}, ${tableInfo.coordinates.pdfY.toFixed(2)})`; navigator.clipboard.writeText(coords); this.showStatus('Copied table coordinates', 'success'); } },
            { label: 'Copy Structure', icon: '🔢', handler: () => { const structure = `${tableInfo.rows} rows × ${tableInfo.columns} columns (${tableInfo.cellCount} cells)`; navigator.clipboard.writeText(structure); this.showStatus('Copied table structure', 'success'); } },
            { type: 'divider' },
            { label: 'Table Properties', icon: 'ℹ️', handler: () => { const props = `Table Properties:\n\nTable Number: ${tableInfo.tableNumber}\nPage: ${tableInfo.pageNumber}\nStructure: ${tableInfo.rows} rows × ${tableInfo.columns} columns\nTotal Cells: ${tableInfo.cellCount}\nPDF Coordinates: (${tableInfo.coordinates.pdfX.toFixed(2)}, ${tableInfo.coordinates.pdfY.toFixed(2)})\nCanvas Coordinates: (${tableInfo.coordinates.canvasX.toFixed(0)}, ${tableInfo.coordinates.canvasY.toFixed(0)})\nDimensions: ${tableInfo.bounds.width.toFixed(1)} × ${tableInfo.bounds.height.toFixed(1)} units`; alert(props); } },
            { label: 'Export Table Data', icon: '💾', handler: () => { const data = JSON.stringify(tableInfo, null, 2); const blob = new Blob([data], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `table_${tableInfo.tableNumber}_page_${tableInfo.pageNumber}.json`; a.click(); URL.revokeObjectURL(url); this.showStatus(`Exported table ${tableInfo.tableNumber} data`, 'success'); } }
        ];
        this.buildAndShowContextMenu(event, menuOptions);
    }

    showReferenceContextMenu(event, referenceInfo) {
        const menuOptions = [
            { type: 'header', label: `Reference #${referenceInfo.referenceNumber}` },
            { label: 'Copy Reference Text', icon: '📋', handler: () => { navigator.clipboard.writeText(referenceInfo.text); this.showStatus(`Copied reference: ${referenceInfo.text}`, 'success'); } },
            { label: 'Copy Reference Type', icon: '🏷️', handler: () => { navigator.clipboard.writeText(referenceInfo.referenceType); this.showStatus(`Copied reference type: ${referenceInfo.referenceType}`, 'success'); } },
            { label: 'Copy Coordinates', icon: '📍', handler: () => { const coords = `PDF: (${referenceInfo.coordinates.pdfX.toFixed(2)}, ${referenceInfo.coordinates.pdfY.toFixed(2)})`; navigator.clipboard.writeText(coords); this.showStatus('Copied reference coordinates', 'success'); } },
            { type: 'divider' },
            { label: 'Reference Properties', icon: 'ℹ️', handler: () => { const props = `Reference Properties:\n\nReference Number: ${referenceInfo.referenceNumber}\nPage: ${referenceInfo.pageNumber}\nText: "${referenceInfo.text}"\nType: ${referenceInfo.referenceType}\nFont Size: ${referenceInfo.fontSize.toFixed(1)}px\nPDF Coordinates: (${referenceInfo.coordinates.pdfX.toFixed(2)}, ${referenceInfo.coordinates.pdfY.toFixed(2)})\nCanvas Coordinates: (${referenceInfo.coordinates.canvasX.toFixed(0)}, ${referenceInfo.coordinates.canvasY.toFixed(0)})`; alert(props); } },
            { label: 'Export Reference Data', icon: '💾', handler: () => { const data = JSON.stringify(referenceInfo, null, 2); const blob = new Blob([data], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `reference_${referenceInfo.referenceNumber}_page_${referenceInfo.pageNumber}.json`; a.click(); URL.revokeObjectURL(url); this.showStatus(`Exported reference ${referenceInfo.referenceNumber} data`, 'success'); } }
        ];
        this.buildAndShowContextMenu(event, menuOptions);
    }

    buildAndShowContextMenu(event, menuOptions) {
        let menuHTML = '';
        for (const option of menuOptions) {
            if (option.type === 'header') menuHTML += `<div class="context-menu-header">${option.label}</div>`;
            else if (option.type === 'divider') menuHTML += '<div class="context-menu-divider"></div>';
            else { const className = option.className ? ` ${option.className}` : ''; menuHTML += `\n<div class="context-menu-item${className}" data-action="${option.label}">\n<span class="context-menu-icon">${option.icon || ''}</span>\n<span>${option.label}</span>\n</div>`; }
        }
        this.contextMenu.innerHTML = menuHTML;
        const menuItems = this.contextMenu.querySelectorAll('.context-menu-item');
        menuItems.forEach((item, index) => { const option = menuOptions.filter(opt => opt.type !== 'header' && opt.type !== 'divider')[index]; if (option && option.handler) { item.addEventListener('click', () => { option.handler(); this.hideContextMenu(); }); } });
        let menuX = event.clientX; let menuY = event.clientY;
        if (menuX + 200 > window.innerWidth) menuX = window.innerWidth - 200;
        if (menuY + 200 > window.innerHeight) menuY = window.innerHeight - 200;
        this.contextMenu.style.left = menuX + 'px';
        this.contextMenu.style.top = menuY + 'px';
        this.contextMenu.classList.add('visible');
    }

    hideContextMenu() { this.contextMenu.classList.remove('visible'); this.currentClickedElement = null; }

    handleMouseMove(event) {
        if (!this.pdfDoc) return;
        const rect = this.overlayCanvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) * (this.overlayCanvas.width / rect.width);
        const y = (event.clientY - rect.top) * (this.overlayCanvas.height / rect.height);

        // Clear previous dynamic highlights
        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

        // Draw persistent overlays first (e.g., line spacing mismatches)
        if (this.lineSpacingEnabled) this.drawLineSpacingOverlay();

        // Debug mouse movement less frequently
        if (x % 100 < 5 && y % 100 < 5) {
            console.log(`Mouse at Canvas(${x.toFixed(0)}, ${y.toFixed(0)}), checking for images...`);
        }

        const wordInfo = this.getWordAtPosition(x, y);
        const imageInfo = this.getImageAtPosition(x, y);
        const tableInfo = this.getTableAtPosition(x, y);
        
        let foundElement = null;
        if (this.geometryData) {
            const pageIndex = this.currentPage - 1;
            const pageGeometry = this.geometryData.pages.find(p => p.index === pageIndex);
            if (pageGeometry) {
                for (const element of pageGeometry.elements) {
                    if (this.isPointInElement(x, y, element)) { foundElement = element; break; }
                }
            }
        }

        if (tableInfo) { 
            console.log('=== HIGHLIGHTING TABLE ===');
            this.highlightTable(tableInfo); 
            this.overlayCanvas.style.cursor = 'crosshair'; 
            console.log('Hovering over table:', tableInfo.tableNumber);
        }
        else if (imageInfo) { 
            console.log('=== HIGHLIGHTING IMAGE ===');
            console.log('Image info:', imageInfo);
            this.highlightImage(imageInfo); 
            this.overlayCanvas.style.cursor = 'crosshair'; 
            console.log('Hovering over image:', imageInfo.imageNumber, imageInfo);
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

        // Hover tooltips disabled for coordinates per new requirement (retain highlight only)
        if (this.tooltipMode === 'hover' && !this.tooltipPinned) {
            // Line spacing hover tooltip (supersedes other types if lineSpacing enabled)
            let showed = false;
            if (this.lineSpacingEnabled) {
                const line = this.getLineAtCanvasPosition(x, y);
                if (line) {
                    const median = this.lineSpacingMedian || 0;
                    const spacing = line.spacingAbove || 0;
                    const deviation = median ? Math.abs(spacing - median)/median : 0;
                    const tooltip = document.getElementById('tooltip');
                    let html = `<strong>Line ${line.number}</strong><br>`;
                    if (line.spacingAbove) {
                        html += `Spacing: ${spacing.toFixed(2)}`;
                        if (median) html += ` (Δ ${Math.round(deviation*100)}%)`;
                        html += '<br>';
                    } else {
                        html += 'First line (no spacing above)<br>';
                    }
                    html += `Words: ${line.fragments ? line.fragments.map(f=>f.text).join(' | ') : ''}`;
                    tooltip.innerHTML = html;
                    // position
                    let tooltipX = event.clientX + 12;
                    let tooltipY = event.clientY + 12;
                    if (tooltipX + 260 > window.innerWidth) tooltipX = window.innerWidth - 270;
                    if (tooltipY + 140 > window.innerHeight) tooltipY = window.innerHeight - 150;
                    tooltip.className = 'info-tooltip visible';
                    tooltip.style.left = tooltipX + 'px';
                    tooltip.style.top = tooltipY + 'px';
                    showed = true;
                }
            }
            if (!showed) this.hideTooltip();
        }
    }

    handleMouseLeave() {
        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        this.currentWord = null;
        if (!this.tooltipPinned && this.tooltipMode === 'hover') { this.hideTooltip(); }
        this.overlayCanvas.style.cursor = 'default';
    }

    isPointInElement(x, y, element) {
        if (!element.quads) return false;
        for (const quad of element.quads) { if (this.isPointInQuad(x, y, quad)) return true; }
        return false;
    }

    isPointInQuad(x, y, quad) {
        const points = [];
        for (let i = 0; i < 8; i += 2) { points.push({ x: quad[i] * this.scale, y: (this.canvas.height - quad[i + 1] * this.scale) }); }
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
        if (!imageInfo) {
            console.log('highlightImage called with null imageInfo');
            return;
        }
        
        console.log('Highlighting image:', imageInfo.imageNumber, 'with canvas bounds:', imageInfo.canvasBounds);
        
        // Ensure canvasBounds exist and are valid
        if (!imageInfo.canvasBounds) {
            console.error('Image canvasBounds not available, recalculating...');
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
        
        console.log(`Drawing image highlight: x=${cb.left.toFixed(0)}, y=${cb.top.toFixed(0)}, w=${width.toFixed(0)}, h=${height.toFixed(0)}`);
        
        // Draw the highlight rectangle
        this.overlayCtx.fillStyle = 'rgba(40, 167, 69, 0.2)';
        this.overlayCtx.strokeStyle = 'rgba(40, 167, 69, 0.8)';
        this.overlayCtx.lineWidth = 3;
        this.overlayCtx.beginPath();
        this.overlayCtx.rect(cb.left, cb.top, width, height);
        this.overlayCtx.fill();
        this.overlayCtx.stroke();
        
        // Draw the center circle with image number
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

    // Removed highlightTable / highlightReference and related label helpers
    highlightTable(tableInfo) {
        if (!tableInfo || !tableInfo.bounds) return;
        const b = tableInfo.bounds; // pdf units
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
        // label
        const label = `Table #${tableInfo.tableNumber}`;
        this.overlayCtx.font = 'bold 12px Arial';
        const metrics = this.overlayCtx.measureText(label);
        const padX = 6, padY = 3;
        const labelW = metrics.width + padX*2; const labelH = 18;
        let lx = left; let ly = top - labelH - 4; if (ly < 0) ly = top + 4;
        this.overlayCtx.fillStyle = 'rgba(155,89,182,0.9)';
        this.overlayCtx.beginPath();
        this.overlayCtx.roundRect(lx, ly, labelW, labelH, 6);
        this.overlayCtx.fill();
        this.overlayCtx.fillStyle = '#fff';
        this.overlayCtx.textBaseline = 'middle';
        this.overlayCtx.fillText(label, lx + padX, ly + labelH/2 + 1);
    }

    showTooltip(event, element) {
        const tooltip = document.getElementById('tooltip');
        tooltip.innerHTML = `\n<strong>Page:</strong> ${this.currentPage}<br>\n<strong>ID:</strong> ${element.id || 'N/A'}<br>\n<strong>Role:</strong> ${element.role || 'N/A'}\n${element.lang ? `<br><strong>Language:</strong> ${element.lang}` : ''}\n`;
        let tooltipX = event.clientX - 100;
        let tooltipY = event.clientY - 80;
        let isAbove = true;
        if (tooltipX + 200 > window.innerWidth) tooltipX = window.innerWidth - 200;
        if (tooltipX < 10) tooltipX = 10;
        if (tooltipY < 10) { tooltipY = event.clientY + 15; isAbove = false; } else if (tooltipY + 100 > window.innerHeight) { tooltipY = window.innerHeight - 110; }
        tooltip.className = `info-tooltip visible ${isAbove ? '' : 'above'}`;
        tooltip.style.left = tooltipX + 'px';
        tooltip.style.top = tooltipY + 'px';
    }

    showWordTooltip(event, wordInfo, element) {
        const tooltip = document.getElementById('tooltip');
        let tooltipContent = `\n<strong>Page:</strong> ${this.currentPage}<br>\n<strong>Word:</strong> "${wordInfo.word}"<br>\n<strong>Character:</strong> "${wordInfo.word[wordInfo.charIndex]}" (${wordInfo.charIndex + 1}/${wordInfo.word.length})<br>\n<strong>Coordinates:</strong><br>\n&nbsp;&nbsp;PDF: (${wordInfo.coordinates.pdfX.toFixed(1)}, ${wordInfo.coordinates.pdfY.toFixed(1)})<br>\n&nbsp;&nbsp;Canvas: (${wordInfo.coordinates.canvasX.toFixed(0)}, ${wordInfo.coordinates.canvasY.toFixed(0)})<br>\n<strong>Font Size:</strong> ${wordInfo.fontSize.toFixed(1)}px\n`;
        if (element) { tooltipContent += `<br><br><strong>Element ID:</strong> ${element.id || 'N/A'}<br>\n<strong>Role:</strong> ${element.role || 'N/A'}`; }
        tooltip.innerHTML = tooltipContent;
        let tooltipX = event.clientX - 125; let tooltipY = event.clientY - 100; let isAbove = true;
        if (tooltipX < 10) tooltipX = 10; else if (tooltipX + 250 > window.innerWidth) tooltipX = window.innerWidth - 260;
        if (tooltipY < 10) { tooltipY = event.clientY + 15; isAbove = false; } else if (tooltipY + 150 > window.innerHeight) tooltipY = window.innerHeight - 160;
        tooltip.className = `info-tooltip visible ${isAbove ? '' : 'above'}`;
        tooltip.style.left = tooltipX + 'px'; tooltip.style.top = tooltipY + 'px';
    }

    showImageTooltip(event, imageInfo, element) {
        const tooltip = document.getElementById('tooltip');
        let tooltipContent = `\n<strong>Page:</strong> ${this.currentPage}<br>\n<strong>Type:</strong> Image #${imageInfo.imageNumber}<br>\n<strong>Coordinates:</strong><br>\n&nbsp;&nbsp;PDF: (${imageInfo.coordinates.pdfX.toFixed(1)}, ${imageInfo.coordinates.pdfY.toFixed(1)})<br>\n&nbsp;&nbsp;Canvas: (${imageInfo.coordinates.canvasX.toFixed(0)}, ${imageInfo.coordinates.canvasY.toFixed(0)})<br>\n<strong>Dimensions:</strong><br>\n&nbsp;&nbsp;Width: ${imageInfo.bounds.width.toFixed(1)} units<br>\n&nbsp;&nbsp;Height: ${imageInfo.bounds.height.toFixed(1)} units\n`;
        if (element) { tooltipContent += `<br><br><strong>Element ID:</strong> ${element.id || 'N/A'}<br>\n<strong>Role:</strong> ${element.role || 'N/A'}`; }
        tooltip.innerHTML = tooltipContent;
        let tooltipX = event.clientX - 140; let tooltipY = event.clientY - 110; let isAbove = true;
        if (tooltipX < 10) tooltipX = 10; else if (tooltipX + 280 > window.innerWidth) tooltipX = window.innerWidth - 290;
        if (tooltipY < 10) { tooltipY = event.clientY + 15; isAbove = false; } else if (tooltipY + 180 > window.innerHeight) tooltipY = window.innerHeight - 190;
        tooltip.className = `info-tooltip visible ${isAbove ? '' : 'above'}`;
        tooltip.style.left = tooltipX + 'px'; tooltip.style.top = tooltipY + 'px';
    }

    showTableTooltip(event, tableInfo, element) {
        // Deprecated (table tooltips removed)
    }

    showReferenceTooltip(event, referenceInfo, element) {
        // Deprecated (reference tooltips removed)
    }

    hideTooltip() {
        const tooltip = document.getElementById('tooltip');
        tooltip.className = 'info-tooltip';
        // When explicitly hiding (outside click / ESC), unpin
        if (this.tooltipPinned && this.tooltipMode === 'click') this.tooltipPinned = false;
    }

    /* ================= Line Spacing Analysis ================= */
    computeLineSpacingMetrics() {
        if (!this.textItems.length) return;
        // Group items by baseline (y) with tolerance
        const tolerance = 4; // PDF units
        const lines = [];
        for (const item of this.textItems) {
            let line = lines.find(l => Math.abs(l.y - item.y) <= tolerance);
            if (!line) { line = { y: item.y, items: [] }; lines.push(line); }
            line.items.push(item);
        }
        // Sort baseline descending (PDF y increases upward)
        lines.sort((a,b)=> b.y - a.y);
        // Compute spacing and boxes
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
        const threshold = this.lineSpacingThresholdPct / 100;
        // Determine boxes
        for (const line of lines) {
            line.items.sort((a,b)=> a.x - b.x);
            const left = Math.min(...line.items.map(i=>i.x));
            const right = Math.max(...line.items.map(i=>i.x + i.width));
            const maxFont = Math.max(...line.items.map(i=>i.fontSize));
            const top = line.y + maxFont * 0.8;
            const bottom = line.y - maxFont * 0.2;
            line.box = { left, right, top, bottom, fontSize:maxFont };
            if (!line.spacingAbove) { line.mismatch = false; continue; }
            const deviation = median ? Math.abs(line.spacingAbove - median)/median : 0;
            line.mismatch = deviation > threshold;
        }
        this.lineGroups = lines;
        this.lineMismatches = lines.filter(l=> l.mismatch);
        this.drawLineSpacingOverlay();
    }

    drawLineSpacingOverlay() {
        if (!this.lineSpacingEnabled || !this.lineGroups.length) return;
        const median = this.lineSpacingMedian || 0;
        // Draw all lines with lighter background; emphasize mismatches
        for (const line of this.lineGroups) {
            const box = line.box;
            if (!box) continue;
            const canvasLeft = box.left * this.scale;
            const canvasRight = box.right * this.scale;
            const canvasTop = (this.canvas.height / this.scale - box.top) * this.scale;
            const canvasBottom = (this.canvas.height / this.scale - box.bottom) * this.scale;
            const height = canvasBottom - canvasTop;
            const spacing = line.spacingAbove || 0;
            const deviation = median ? Math.abs(spacing - median)/median : 0;
            const isMismatch = line.mismatch;
            // Background color scales with mismatch
            if (spacing) {
                if (isMismatch) {
                    this.overlayCtx.fillStyle = 'rgba(231,76,60,0.30)';
                    this.overlayCtx.strokeStyle = 'rgba(231,76,60,0.85)';
                } else {
                    this.overlayCtx.fillStyle = 'rgba(52,152,219,0.12)';
                    this.overlayCtx.strokeStyle = 'rgba(52,152,219,0.45)';
                }
                this.overlayCtx.lineWidth = isMismatch ? 2 : 1;
                this.overlayCtx.beginPath();
                this.overlayCtx.rect(canvasLeft, canvasTop, canvasRight - canvasLeft, height);
                this.overlayCtx.fill();
                this.overlayCtx.stroke();
            }
            // Removed always-on labels; now shown via hover tooltip
        }
        // Draw median reference pill
        if (median) {
            const text = `Median: ${median.toFixed(1)}`;
            this.overlayCtx.font = '11px Arial';
            const paddingX = 8; const paddingY = 4;
            const metrics = this.overlayCtx.measureText(text);
            const w = metrics.width + paddingX*2;
            const h = 18;
            const x = 10; const y = 10;
            this.overlayCtx.fillStyle = 'rgba(0,0,0,0.55)';
            this.overlayCtx.strokeStyle = 'rgba(255,255,255,0.35)';
            this.overlayCtx.lineWidth = 1;
            this.overlayCtx.beginPath();
            this.overlayCtx.roundRect(x, y, w, h, 9);
            this.overlayCtx.fill();
            this.overlayCtx.stroke();
            this.overlayCtx.fillStyle = '#ecf0f1';
            this.overlayCtx.textBaseline = 'middle';
            this.overlayCtx.fillText(text, x + paddingX, y + h/2 + 1);
        }
    }

    getLineAtCanvasPosition(canvasX, canvasY) {
        if (!this.lineSpacingEnabled || !this.lineGroups.length) return null;
        // Convert canvasY back to PDF y for baseline comparison
        const pdfY = (this.canvas.height - canvasY) / this.scale;
        // Find line whose vertical box contains the canvas point
        for (const line of this.lineGroups) {
            const box = line.box; if (!box) continue;
            const topPDF = box.top; // higher value
            const bottomPDF = box.bottom; // lower value
            if (pdfY <= topPDF && pdfY >= bottomPDF) return line;
        }
        return null;
    }

    redrawCurrentOverlay() {
        this.overlayCtx.clearRect(0,0,this.overlayCanvas.width,this.overlayCanvas.height);
        if (this.lineSpacingEnabled) this.drawLineSpacingOverlay();
    }

    median(arr) {
        if (!arr || !arr.length) return 0;
        const sorted = [...arr].sort((a,b)=>a-b);
        const mid = Math.floor(sorted.length/2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
    }

    /* ================= Lightweight Table Detection ================= */
    detectTablesForCurrentPage() {
        console.log(`Starting table detection for page ${this.currentPage}`);
        
        if (!this.textItems.length) { 
            console.log('No text items found, skipping table detection');
            this.tablesByPage[this.currentPage] = []; 
            return; 
        }
        
        const lines = this.getOrBuildLineGroups();
        if (!lines.length) { 
            console.log('No line groups found, skipping table detection');
            this.tablesByPage[this.currentPage] = []; 
            return; 
        }
        
        console.log(`Found ${lines.length} lines for table detection`);
        
        const usedLineNumbers = new Set();
        const tables = [];
        let tableCounter = 1;
        const alignmentTolerance = 50; // Increased tolerance for column center alignment
        
        for (let i=0; i<lines.length; i++) {
            const line = lines[i];
            if (usedLineNumbers.has(line.number)) continue;
            if (!line.fragments || line.fragments.length < 2) continue; // need at least 2 columns
            
            console.log(`Evaluating line ${line.number} with ${line.fragments.length} fragments:`, 
                        line.fragments.map(f => f.text).join(' | '));
            
            // Attempt to expand downward (subsequent lines visually lower -> higher index in array after sorting top->bottom)
            const baseCenters = line.fragments.map(f => (f.left + f.right)/2);
            console.log(`Base centers for line ${line.number}:`, baseCenters);
            
            let j = i + 1;
            const candidate = [line];
            
            while (j < lines.length) {
                const nxt = lines[j];
                if (!nxt.fragments || nxt.fragments.length < 2) {
                    console.log(`Line ${nxt.number} has insufficient fragments (${nxt.fragments ? nxt.fragments.length : 0}), breaking`);
                    break;
                }
                
                // Be more lenient with fragment count similarity
                if (Math.abs(nxt.fragments.length - baseCenters.length) > 2) {
                    console.log(`Line ${nxt.number} fragment count mismatch: ${nxt.fragments.length} vs ${baseCenters.length}, breaking`);
                    break;
                }
                
                const centers = nxt.fragments.map(f => (f.left + f.right)/2);
                console.log(`Centers for line ${nxt.number}:`, centers);
                
                // Compare each center to nearest base center
                let alignedCount = 0;
                const alignments = [];
                for (const c of centers) {
                    let best = Infinity;
                    let bestIndex = -1;
                    for (let k = 0; k < baseCenters.length; k++) {
                        const d = Math.abs(c - baseCenters[k]);
                        if (d < best) {
                            best = d;
                            bestIndex = k;
                        }
                    }
                    const aligned = best <= alignmentTolerance;
                    if (aligned) alignedCount++;
                    alignments.push({ center: c, bestDistance: best, aligned, baseIndex: bestIndex });
                }
                
                console.log(`Line ${nxt.number} alignment analysis:`, alignments);
                
                // Be more lenient with alignment requirements
                const minRequired = Math.max(1, Math.min(baseCenters.length, centers.length) - 2);
                console.log(`Line ${nxt.number}: ${alignedCount} aligned columns, ${minRequired} required`);
                
                if (alignedCount < minRequired) {
                    console.log(`Line ${nxt.number} insufficient alignment, breaking`);
                    break;
                }
                
                candidate.push(nxt);
                console.log(`Added line ${nxt.number} to table candidate (${candidate.length} rows so far)`);
                j++;
            }
            
            // Lower the threshold for table detection
            if (candidate.length >= 2) { // treat as table with just 2 rows
                console.log(`Found table candidate with ${candidate.length} rows starting at line ${line.number}`);
                
                // Mark lines as used
                candidate.forEach(l => usedLineNumbers.add(l.number));
                
                const left = Math.min(...candidate.map(l => l.bounds.left));
                const right = Math.max(...candidate.map(l => l.bounds.right));
                const top = Math.max(...candidate.map(l => l.bounds.top));
                const bottom = Math.min(...candidate.map(l => l.bounds.bottom));
                const rows = candidate.length;
                
                // Approx columns: modal of fragment counts among candidate lines
                const counts = candidate.map(l => l.fragments.length);
                let columns = 0; let bestFreq = 0;
                const freq = {};
                for (const c of counts) { 
                    freq[c] = (freq[c]||0)+1; 
                    if (freq[c] > bestFreq) { 
                        bestFreq = freq[c]; 
                        columns = c; 
                    } 
                }
                
                const bounds = { left, right, top, bottom, width: right-left, height: top-bottom };
                const table = { tableNumber: tableCounter++, pageNumber: this.currentPage, bounds, rows, columns, cellCount: rows * columns, lines: candidate };
                
                console.log(`Created table ${table.tableNumber}: ${rows}x${columns} with bounds:`, bounds);
                console.log(`Table content:`, candidate.map(l => l.fragments.map(f => f.text).join(' | ')));
                
                tables.push(table);
            } else {
                console.log(`Candidate with ${candidate.length} rows too small, skipping`);
            }
        }
        
        console.log(`Table detection complete for page ${this.currentPage}: Found ${tables.length} tables`);
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

    // Removed attachModalQuickActions; operations now selected and sent backend only for images
}

document.addEventListener('DOMContentLoaded', () => { new PDFHighlightViewer(); });
