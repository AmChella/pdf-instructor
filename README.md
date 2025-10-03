# PDF Instructor Chrome Extension

An interactive PDF analysis tool with advanced image detection, table recognition, text highlighting, and coordinate submission capabilities.

## Features

🖼️ **Image Detection & Highlighting**
- Detects images embedded in PDF documents using multiple methods
- Visual highlighting with hover and click interactions
- Coordinate extraction for precise positioning

📊 **Table Detection & Analysis** 
- Lightweight table detection based on text alignment
- Visual table boundaries and structure recognition
- Interactive table exploration

📝 **Interactive Text Selection**
- Word-level text highlighting and selection
- Character-level precision with click positioning
- Font size and coordinate information

📍 **Coordinate Submission**
- Modal form for submitting element coordinates
- Supports words, images, tables, and PDF elements
- Configurable operations for different element types

📏 **Line Spacing Analysis**
- Visual line spacing analysis and deviation detection
- Median spacing calculation and mismatch highlighting
- Helpful for document structure analysis

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the project directory
5. The PDF Instructor extension should now be installed

### Files Structure

```
pdf-instructor/
├── manifest.json          # Extension configuration
├── popup.html             # Extension popup interface
├── popup.js               # Popup functionality
├── popup.css              # Popup styling
├── viewer.html            # PDF viewer interface
├── viewer.js              # Main PDF processing logic
├── viewer.css             # Viewer styling
├── background.js          # Background service worker
├── icons/                 # Extension icons
│   ├── icon16.svg
│   ├── icon32.svg
│   ├── icon48.svg
│   └── icon128.svg
└── README.md              # This file
```

## Usage

### Loading PDFs

1. **Via Extension Popup:**
   - Click the PDF Instructor extension icon
   - Select a PDF file and optionally a JSON geometry file
   - Click "Open PDF Viewer" to launch the viewer

2. **Direct File Loading:**
   - In the viewer, click "Load New PDF"
   - Select files directly in the viewer interface

### Navigation & Controls

- **Previous/Next:** Navigate between PDF pages
- **Line Spacing:** Toggle line spacing analysis overlay
- **Show All:** Display all detected images and tables
- **Keyboard Shortcuts:**
  - `Ctrl+Shift+D`: Run PDF diagnostics
  - `Ctrl+Shift+T`: Test overlay canvas
  - `Escape`: Close modals and menus

### Interaction Modes

- **Hover:** Highlight elements under mouse cursor
- **Left Click:** Open coordinate submission modal
- **Right Click:** Show context menu with element options

### Coordinate Submission

When clicking on elements, a modal opens with:
- Element type (word, image, table, element)
- PDF and canvas coordinates
- Page number and reference text
- Line number and context
- Optional notes and operations

## Technical Details

### PDF Processing
- Uses PDF.js library (v3.11.174) for PDF rendering
- Multiple image detection methods for compatibility
- Canvas-based overlay system for highlighting
- Text extraction with word-level precision

### Chrome Extension APIs
- Manifest V3 service worker architecture
- Chrome Storage API for PDF data persistence
- Tabs API for viewer window management
- Proper CSP for PDF.js integration

### Coordinate System
- PDF coordinate space (bottom-left origin)
- Canvas coordinate space (top-left origin)
- Automatic coordinate transformation
- Sub-pixel precision for accurate positioning

## Development

### Dependencies
- PDF.js (loaded from CDN)
- Chrome Extensions API (Manifest V3)
- Modern browser with Canvas support

### Debugging
- Open Chrome DevTools on extension pages
- Use `Ctrl+Shift+D` for PDF diagnostics
- Check console for detailed detection logs
- Background script logs available in extension service worker

### Customization
- Modify detection thresholds in `viewer.js`
- Customize highlighting colors in `viewer.css`
- Add new coordinate submission fields in `viewer.html`
- Extend context menu options in menu handlers

## Browser Compatibility

- **Chrome 88+** (Manifest V3 support)
- **Edge 88+** (Chromium-based)
- Other Chromium-based browsers with extension support

## Security

- Content Security Policy restricts script execution
- PDF.js loaded from trusted CDN
- Local storage for PDF data (no external transmission)
- Service worker isolation for background processes

## Troubleshooting

### PDF Not Loading
- Check file format (must be valid PDF)
- Verify PDF.js library loads successfully
- Check console for error messages

### Images Not Detected
- Some PDFs embed images as vector graphics
- Try the diagnostic mode (`Ctrl+Shift+D`)
- Check if images are in Form XObjects

### Extension Issues
- Reload the extension in `chrome://extensions/`
- Check that all files are present
- Verify manifest.json syntax

## Version History

- **v1.0.0**: Initial release with full PDF analysis capabilities

## License

This project is open source. Please check the license file for details.

## Contributing

Contributions welcome! Please ensure:
- Code follows existing style
- Test with various PDF types
- Update documentation as needed

---

**PDF Instructor** - Making PDF analysis interactive and precise.