/**
 * Export & Import Manager
 * ------------------------------------------------------------------
 * Handles exporting current and saved boards to JSON files for sharing,
 * full workspace backup bundles, drag-and-drop or file picker importing,
 * JSON validation, pre-import preview, and loading/saving imported boards.
 */

class ExportManager {
    constructor(bubbleManager, connectionManager, noiseConfig, savingManager, windowConfig, exportConfig, onNoiseConfigLoaded = null) {
        this.bubbleManager = bubbleManager;
        this.connectionManager = connectionManager;
        this.noiseConfig = noiseConfig;
        this.savingManager = savingManager;
        this.windowConfig = windowConfig || window.WindowConfig;
        this.config = exportConfig || window.ExportConfig;
        this.onNoiseConfigLoaded = onNoiseConfigLoaded;

        this.window = null;
        this.activeTab = 'export'; // 'export' or 'import'
        this.pendingImportData = null; // Parsed board data waiting for user action

        this.initWindow();
    }

    setOnNoiseConfigLoaded(callback) {
        this.onNoiseConfigLoaded = callback;
    }

    initWindow() {
        const winConfig = (this.config && this.config.exportWindow)
            || (this.windowConfig && this.windowConfig.exportWindow)
            || { width: 360, defaultTop: 60, defaultLeft: 360 };

        this.window = new window.FloatingWindow({
            id: 'export-window',
            title: 'Export / Import',
            width: winConfig.width || 360,
            defaultTop: winConfig.defaultTop || 60,
            defaultLeft: winConfig.defaultLeft || 360,
            contentHTML: `
                <div class="export-container">
                    <!-- Navigation Tabs -->
                    <div class="export-tabs-nav">
                        <button type="button" class="export-tab-btn active" data-tab="export">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                            Export
                        </button>
                        <button type="button" class="export-tab-btn" data-tab="import">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="17 8 12 3 7 8"></polyline>
                                <line x1="12" y1="3" x2="12" y2="15"></line>
                            </svg>
                            Import
                        </button>
                    </div>

                    <!-- Feedback message container -->
                    <div id="export-feedback-msg" class="export-feedback"></div>

                    <!-- 1. EXPORT VIEW -->
                    <div id="export-pane" class="export-pane active">
                        <!-- Current Canvas Board Export -->
                        <div class="export-section">
                            <span class="export-section-title">Current Canvas Board</span>
                            <div class="export-field-row">
                                <label for="export-filename-input" class="export-field-label">File / Board Name</label>
                                <input type="text" id="export-filename-input" class="export-text-input" placeholder="Board name..." maxlength="50" autocomplete="off" spellcheck="false">
                            </div>
                            <div class="export-options-row">
                                <label class="export-checkbox-label">
                                    <input type="checkbox" id="export-include-noise" checked>
                                    <span>Include Noise Settings</span>
                                </label>
                                <span id="export-current-summary" class="export-summary-badge">0 universes</span>
                            </div>
                            <div class="export-buttons-row">
                                <button type="button" id="btn-export-download-current" class="export-primary-btn">
                                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                        <polyline points="7 10 12 15 17 10"></polyline>
                                        <line x1="12" y1="15" x2="12" y2="3"></line>
                                    </svg>
                                    Download File (.json)
                                </button>
                                <button type="button" id="btn-export-copy-current" class="export-secondary-btn" title="Copy raw JSON to clipboard">
                                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                    </svg>
                                    Copy
                                </button>
                            </div>
                        </div>

                        <div class="export-divider"></div>

                        <!-- Saved Board Quick Export -->
                        <div class="export-section">
                            <span class="export-section-title">Export from Saved Boards</span>
                            <div class="export-field-row">
                                <select id="export-saved-select" class="export-select-input">
                                    <option value="" disabled selected>Select a saved board...</option>
                                </select>
                            </div>
                            <button type="button" id="btn-export-saved-download" class="export-secondary-btn full-width" disabled>
                                Download Selected Board (.json)
                            </button>
                        </div>

                        <div class="export-divider"></div>

                        <!-- All Boards Backup -->
                        <div class="export-section backup-section">
                            <div class="backup-info">
                                <span class="export-section-title">Full Backup</span>
                                <span class="backup-subtext">Archive all your saved boards in one file</span>
                            </div>
                            <button type="button" id="btn-export-all-boards" class="export-outline-btn">
                                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                                </svg>
                                Backup All Boards
                            </button>
                        </div>
                    </div>

                    <!-- 2. IMPORT VIEW -->
                    <div id="import-pane" class="export-pane">
                        <!-- Dropzone area -->
                        <div id="import-dropzone" class="import-dropzone">
                            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="dropzone-icon">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="17 8 12 3 7 8"></polyline>
                                <line x1="12" y1="3" x2="12" y2="15"></line>
                            </svg>
                            <span class="dropzone-text">Click or drag a <strong>.json</strong> board file here</span>
                            <span class="dropzone-subtext">Supports single board files or full backup archives</span>
                            <input type="file" id="import-file-input" class="import-file-hidden" accept=".json,application/json">
                        </div>

                        <!-- Alternative: Paste JSON directly -->
                        <div class="import-paste-toggle-row">
                            <button type="button" id="btn-toggle-paste" class="import-text-toggle-btn">
                                <span>Or paste JSON directly</span>
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="paste-chevron">
                                    <polyline points="6 9 12 15 18 9"></polyline>
                                </svg>
                            </button>
                        </div>
                        <div id="import-paste-area" class="import-paste-area" style="display: none;">
                            <textarea id="import-paste-textarea" class="import-textarea" placeholder="Paste InBetween Mapping JSON here..." rows="4"></textarea>
                            <button type="button" id="btn-parse-paste" class="export-secondary-btn full-width">Inspect JSON</button>
                        </div>

                        <!-- Preview & Action Container (Shown when a file/JSON is loaded) -->
                        <div id="import-preview-card" class="import-preview-card" style="display: none;">
                            <div class="preview-header">
                                <span class="preview-badge success">Valid Board File</span>
                                <span id="preview-type-badge" class="preview-type-badge">Single Board</span>
                            </div>
                            <div class="preview-info-body">
                                <span id="preview-board-name" class="preview-board-title">Untitled Board</span>
                                <div class="preview-meta-row">
                                    <span id="preview-universes-count">0 universes</span>
                                    <span>•</span>
                                    <span id="preview-connections-count">0 connections</span>
                                    <span>•</span>
                                    <span id="preview-noise-status">With noise settings</span>
                                </div>
                            </div>
                            <div class="preview-actions-row">
                                <button type="button" id="btn-import-load-now" class="export-secondary-btn" title="Load onto current canvas immediately">
                                    Load on Canvas
                                </button>
                                <button type="button" id="btn-import-save-list" class="export-secondary-btn" title="Add to Saved Boards list without clearing canvas">
                                    Save to List
                                </button>
                                <button type="button" id="btn-import-load-and-save" class="export-primary-btn" title="Load onto canvas and add to Saved Boards list">
                                    Load & Save
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `
        });

        this.bindEvents();
    }

    bindEvents() {
        const body = this.window.getBodyElement();

        // 1. Tab Navigation
        const tabBtns = body.querySelectorAll('.export-tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.tab;
                this.switchTab(target);
            });
        });

        // 2. Export Current Board
        const btnDownloadCurrent = body.querySelector('#btn-export-download-current');
        const btnCopyCurrent = body.querySelector('#btn-export-copy-current');
        const nameInput = body.querySelector('#export-filename-input');
        const noiseCheckbox = body.querySelector('#export-include-noise');

        if (btnDownloadCurrent) {
            btnDownloadCurrent.addEventListener('click', () => {
                const name = nameInput.value.trim() || this.getCurrentBoardDefaultName();
                const includeNoise = noiseCheckbox.checked;
                this.exportCurrentBoard(name, includeNoise);
            });
        }

        if (btnCopyCurrent) {
            btnCopyCurrent.addEventListener('click', () => {
                const name = nameInput.value.trim() || this.getCurrentBoardDefaultName();
                const includeNoise = noiseCheckbox.checked;
                this.copyCurrentBoardJSON(name, includeNoise);
            });
        }

        // 3. Export Saved Board Select
        const savedSelect = body.querySelector('#export-saved-select');
        const btnDownloadSaved = body.querySelector('#btn-export-saved-download');

        if (savedSelect && btnDownloadSaved) {
            savedSelect.addEventListener('change', () => {
                btnDownloadSaved.disabled = !savedSelect.value;
            });

            btnDownloadSaved.addEventListener('click', () => {
                const boardId = savedSelect.value;
                if (!boardId) return;
                const saves = this.savingManager ? this.savingManager.getAllSaves() : [];
                const record = saves.find(s => s.id === boardId);
                if (record) {
                    this.exportSavedBoardRecord(record);
                }
            });
        }

        // 4. Backup All Boards
        const btnBackupAll = body.querySelector('#btn-export-all-boards');
        if (btnBackupAll) {
            btnBackupAll.addEventListener('click', () => {
                this.exportAllBoards();
            });
        }

        // 5. File Import Dropzone & File Input
        const dropzone = body.querySelector('#import-dropzone');
        const fileInput = body.querySelector('#import-file-input');

        if (dropzone && fileInput) {
            dropzone.addEventListener('click', () => {
                fileInput.click();
            });

            fileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    this.handleFile(e.target.files[0]);
                    fileInput.value = ''; // Reset input
                }
            });

            // Drag and drop events
            ['dragenter', 'dragover'].forEach(eventName => {
                dropzone.addEventListener(eventName, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropzone.classList.add('drag-over');
                }, false);
            });

            ['dragleave', 'drop'].forEach(eventName => {
                dropzone.addEventListener(eventName, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropzone.classList.remove('drag-over');
                }, false);
            });

            dropzone.addEventListener('drop', (e) => {
                const dt = e.dataTransfer;
                if (dt && dt.files && dt.files[0]) {
                    this.handleFile(dt.files[0]);
                }
            }, false);
        }

        // 6. Direct Paste Toggle & Parse
        const btnTogglePaste = body.querySelector('#btn-toggle-paste');
        const pasteArea = body.querySelector('#import-paste-area');
        const btnParsePaste = body.querySelector('#btn-parse-paste');
        const pasteTextarea = body.querySelector('#import-paste-textarea');

        if (btnTogglePaste && pasteArea) {
            btnTogglePaste.addEventListener('click', () => {
                const isHidden = pasteArea.style.display === 'none';
                pasteArea.style.display = isHidden ? 'flex' : 'none';
                btnTogglePaste.classList.toggle('active', isHidden);
            });
        }

        if (btnParsePaste && pasteTextarea) {
            btnParsePaste.addEventListener('click', () => {
                const text = pasteTextarea.value.trim();
                if (!text) {
                    this.showFeedback('Please paste JSON board text first.', 'error');
                    return;
                }
                this.parseImportData(text, 'Pasted Board');
            });
        }

        // 7. Preview Action Buttons (Load, Save, Load & Save)
        const btnLoadNow = body.querySelector('#btn-import-load-now');
        const btnSaveList = body.querySelector('#btn-import-save-list');
        const btnLoadAndSave = body.querySelector('#btn-import-load-and-save');

        if (btnLoadNow) {
            btnLoadNow.addEventListener('click', () => {
                this.executeImportAction('load');
            });
        }

        if (btnSaveList) {
            btnSaveList.addEventListener('click', () => {
                this.executeImportAction('save');
            });
        }

        if (btnLoadAndSave) {
            btnLoadAndSave.addEventListener('click', () => {
                this.executeImportAction('load_and_save');
            });
        }
    }

    switchTab(tab) {
        this.activeTab = tab;
        const body = this.window.getBodyElement();

        const tabBtns = body.querySelectorAll('.export-tab-btn');
        tabBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        const exportPane = body.querySelector('#export-pane');
        const importPane = body.querySelector('#import-pane');

        if (exportPane) exportPane.classList.toggle('active', tab === 'export');
        if (importPane) importPane.classList.toggle('active', tab === 'import');

        if (tab === 'export') {
            this.refreshExportView();
        }
    }

    getCurrentBoardDefaultName() {
        if (this.savingManager && this.savingManager.activeBoardName) {
            return this.savingManager.activeBoardName;
        }
        const now = new Date();
        return `Board ${now.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    refreshExportView() {
        const body = this.window.getBodyElement();
        if (!body) return;

        // 1. Update current board name input placeholder & current value if empty
        const nameInput = body.querySelector('#export-filename-input');
        if (nameInput) {
            const currentName = (this.savingManager && this.savingManager.activeBoardName) || '';
            if (currentName) {
                nameInput.value = currentName;
            } else if (!nameInput.value) {
                nameInput.placeholder = this.getCurrentBoardDefaultName();
            }
        }

        // 2. Update universe and connection count badge
        const summaryBadge = body.querySelector('#export-current-summary');
        if (summaryBadge && this.bubbleManager) {
            const numBubbles = this.bubbleManager.bubbles.length;
            const numConns = (this.connectionManager && this.connectionManager.connections.length) || 0;
            summaryBadge.textContent = `${numBubbles} ${numBubbles === 1 ? 'universe' : 'universes'}, ${numConns} ${numConns === 1 ? 'conn' : 'conns'}`;
        }

        // 3. Refresh saved boards select dropdown
        const savedSelect = body.querySelector('#export-saved-select');
        const btnDownloadSaved = body.querySelector('#btn-export-saved-download');
        if (savedSelect && this.savingManager) {
            const saves = this.savingManager.getAllSaves();
            savedSelect.innerHTML = '<option value="" disabled selected>Select a saved board...</option>';
            if (saves.length === 0) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = 'No saved boards available';
                opt.disabled = true;
                savedSelect.appendChild(opt);
                if (btnDownloadSaved) btnDownloadSaved.disabled = true;
            } else {
                saves.forEach(rec => {
                    const opt = document.createElement('option');
                    opt.value = rec.id;
                    const dateStr = rec.createdAt ? new Date(rec.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
                    opt.textContent = `${rec.name} (${dateStr})`;
                    savedSelect.appendChild(opt);
                });
                if (btnDownloadSaved) btnDownloadSaved.disabled = !savedSelect.value;
            }
        }
    }

    /**
     * Packages current board state into standard JSON export object.
     */
    serializeCurrentBoard(boardName, includeNoise = true) {
        const bubbles = this.bubbleManager.bubbles.map(b => ({
            id: b.id,
            name: b.name,
            color: b.color,
            x: Math.round(b.x * 100) / 100,
            y: Math.round(b.y * 100) / 100,
            scale: Number.isFinite(Number(b.scale)) ? Number(b.scale) : 1.0,
            isLocked: !!b.isLocked
        }));

        const connections = (this.connectionManager ? this.connectionManager.connections : []).map(c => ({
            id: c.id,
            fromId: c.fromId,
            toId: c.toId,
            name: c.name
        }));

        const noiseData = (includeNoise && this.noiseConfig) ? {
            noiseSize: this.noiseConfig.noiseSize,
            noiseSpeed: this.noiseConfig.noiseSpeed,
            steps: this.noiseConfig.steps,
            octaves: this.noiseConfig.octaves,
            invert: !!this.noiseConfig.invert,
            maintainAspectRatio: !!this.noiseConfig.maintainAspectRatio
        } : null;

        return {
            app: this.config.appSignature || 'InBetween Mapping',
            version: this.config.schemaVersion || '1.0',
            type: 'board',
            exportedAt: new Date().toISOString(),
            board: {
                id: (this.savingManager && this.savingManager.activeBoardId) || `board_${Date.now()}`,
                name: boardName || this.getCurrentBoardDefaultName(),
                createdAt: Date.now(),
                bubbles,
                connections,
                noiseConfig: noiseData
            }
        };
    }

    /**
     * Download current canvas board as a JSON file.
     */
    exportCurrentBoard(boardName, includeNoise = true) {
        const payload = this.serializeCurrentBoard(boardName, includeNoise);
        const filename = this.formatFilename(payload.board.name);
        this.downloadJSON(payload, filename);
        this.showFeedback(`Exported "${payload.board.name}" as ${filename}`, 'success');
    }

    /**
     * Copy current board JSON directly to clipboard.
     */
    copyCurrentBoardJSON(boardName, includeNoise = true) {
        const payload = this.serializeCurrentBoard(boardName, includeNoise);
        const jsonStr = JSON.stringify(payload, null, 2);

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(jsonStr).then(() => {
                this.showFeedback('Board JSON copied to clipboard!', 'success');
            }).catch(err => {
                console.error('Failed to copy to clipboard:', err);
                this.showFeedback('Failed to copy to clipboard.', 'error');
            });
        } else {
            this.showFeedback('Clipboard API not supported in this browser.', 'error');
        }
    }

    /**
     * Export a saved board record by object.
     */
    exportSavedBoardRecord(record) {
        if (!record) return;

        const payload = {
            app: this.config.appSignature || 'InBetween Mapping',
            version: this.config.schemaVersion || '1.0',
            type: 'board',
            exportedAt: new Date().toISOString(),
            board: {
                id: record.id,
                name: record.name,
                createdAt: record.createdAt || Date.now(),
                bubbles: record.bubbles || [],
                connections: record.connections || [],
                noiseConfig: record.noiseConfig || null
            }
        };

        const filename = this.formatFilename(record.name);
        this.downloadJSON(payload, filename);
        this.showFeedback(`Exported "${record.name}"`, 'success');
    }

    /**
     * Full workspace backup of all saved boards in a single bundle file.
     */
    exportAllBoards() {
        if (!this.savingManager) return;
        const saves = this.savingManager.getAllSaves();
        if (saves.length === 0) {
            this.showFeedback('No saved boards found to backup.', 'info');
            return;
        }

        const payload = {
            app: this.config.appSignature || 'InBetween Mapping',
            version: this.config.schemaVersion || '1.0',
            type: 'bundle',
            exportedAt: new Date().toISOString(),
            totalBoards: saves.length,
            boards: saves
        };

        const dateStr = new Date().toISOString().split('T')[0];
        const filename = `inbetween-mapping-backup-${dateStr}.json`;
        this.downloadJSON(payload, filename);
        this.showFeedback(`Full backup exported (${saves.length} boards)`, 'success');
    }

    /**
     * Initiates browser file download for a JSON object.
     */
    downloadJSON(dataObject, filename) {
        try {
            const jsonString = JSON.stringify(dataObject, null, 2);
            const blob = new Blob([jsonString], { type: this.config.mimeType || 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = filename;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Error downloading JSON:', err);
            this.showFeedback('Failed to download file.', 'error');
        }
    }

    /**
     * Formats a board name into a clean, safe filename.
     */
    formatFilename(name) {
        const base = (name || 'inbetween-board')
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9_\-\s]/g, '')
            .replace(/\s+/g, '-');
        const ext = this.config.fileExtension || '.json';
        return `${base || 'inbetween-board'}${ext}`;
    }

    /**
     * Handles file selected via drop or file input.
     */
    handleFile(file) {
        if (!file) return;

        // Check size limit (e.g. 10MB)
        const maxSize = this.config.maxImportSizeBytes || 10485760;
        if (file.size > maxSize) {
            this.showFeedback(`File exceeds maximum size limit of ${Math.round(maxSize / 1024 / 1024)}MB.`, 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            this.parseImportData(content, file.name);
        };
        reader.onerror = () => {
            this.showFeedback('Failed to read file.', 'error');
        };
        reader.readAsText(file);
    }

    /**
     * Parses and validates raw JSON board string.
     */
    parseImportData(jsonString, sourceName = 'File') {
        let parsed = null;
        try {
            parsed = JSON.parse(jsonString);
        } catch (err) {
            this.showFeedback('Invalid JSON format: file could not be parsed.', 'error');
            this.hideImportPreview();
            return false;
        }

        // Validate structure
        const validated = this.validateBoardSchema(parsed, sourceName);
        if (!validated) {
            this.showFeedback('Unrecognized format: not a valid InBetween Mapping board file.', 'error');
            this.hideImportPreview();
            return false;
        }

        this.pendingImportData = validated;
        this.showImportPreview(validated);
        this.showFeedback('File parsed successfully! Review details below.', 'success');
        return true;
    }

    /**
     * Validates different variations of board JSON (standard wrapper, raw record, or bundle).
     */
    validateBoardSchema(data, fallbackName) {
        if (!data || typeof data !== 'object') return null;

        // Case 1: Standard Wrapper with type === 'bundle' or 'boards' array
        if (data.type === 'bundle' || Array.isArray(data.boards)) {
            const boards = Array.isArray(data.boards) ? data.boards : [];
            if (boards.length === 0) return null;
            return {
                isBundle: true,
                boards,
                total: boards.length,
                fallbackName: fallbackName || 'Backup Bundle'
            };
        }

        // Case 2: Standard Single Board Wrapper { app, type: 'board', board: { bubbles, ... } }
        if (data.board && typeof data.board === 'object' && Array.isArray(data.board.bubbles)) {
            const b = data.board;
            return {
                isBundle: false,
                name: b.name || fallbackName.replace(/\.[^/.]+$/, '') || 'Imported Board',
                createdAt: b.createdAt || Date.now(),
                bubbles: b.bubbles,
                connections: Array.isArray(b.connections) ? b.connections : [],
                noiseConfig: b.noiseConfig || null
            };
        }

        // Case 3: Raw Saved Board Record { name, bubbles, connections }
        if (Array.isArray(data.bubbles)) {
            return {
                isBundle: false,
                name: data.name || fallbackName.replace(/\.[^/.]+$/, '') || 'Imported Board',
                createdAt: data.createdAt || Date.now(),
                bubbles: data.bubbles,
                connections: Array.isArray(data.connections) ? data.connections : [],
                noiseConfig: data.noiseConfig || null
            };
        }

        // Case 4: Array of board records directly [ { bubbles: [...] }, ... ]
        if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0].bubbles)) {
            return {
                isBundle: true,
                boards: data,
                total: data.length,
                fallbackName: fallbackName || 'Board Collection'
            };
        }

        return null;
    }

    /**
     * Displays the parsed preview card before user commits to loading or saving.
     */
    showImportPreview(validated) {
        const body = this.window.getBodyElement();
        const card = body.querySelector('#import-preview-card');
        if (!card) return;

        const titleEl = card.querySelector('#preview-board-name');
        const universesEl = card.querySelector('#preview-universes-count');
        const connectionsEl = card.querySelector('#preview-connections-count');
        const noiseStatusEl = card.querySelector('#preview-noise-status');
        const typeBadge = card.querySelector('#preview-type-badge');
        const btnLoadNow = card.querySelector('#btn-import-load-now');
        const btnSaveList = card.querySelector('#btn-import-save-list');
        const btnLoadAndSave = card.querySelector('#btn-import-load-and-save');

        if (validated.isBundle) {
            typeBadge.textContent = 'Backup Bundle';
            titleEl.textContent = `${validated.total} Boards in Archive`;
            universesEl.textContent = `${validated.total} boards`;
            connectionsEl.textContent = 'Multiple archives';
            noiseStatusEl.textContent = 'Noise settings included per board';

            // For bundles, disable single canvas load, enable Save to List
            if (btnLoadNow) btnLoadNow.style.display = 'none';
            if (btnSaveList) {
                btnSaveList.textContent = `Import All ${validated.total} Boards`;
                btnSaveList.className = 'export-primary-btn full-width';
            }
            if (btnLoadAndSave) btnLoadAndSave.style.display = 'none';
        } else {
            typeBadge.textContent = 'Single Board';
            titleEl.textContent = validated.name || 'Untitled Board';
            universesEl.textContent = `${validated.bubbles.length} ${validated.bubbles.length === 1 ? 'universe' : 'universes'}`;
            connectionsEl.textContent = `${validated.connections.length} ${validated.connections.length === 1 ? 'connection' : 'connections'}`;
            noiseStatusEl.textContent = validated.noiseConfig ? 'With noise settings' : 'Default noise';

            if (btnLoadNow) {
                btnLoadNow.style.display = 'inline-flex';
                btnLoadNow.textContent = 'Load on Canvas';
            }
            if (btnSaveList) {
                btnSaveList.style.display = 'inline-flex';
                btnSaveList.textContent = 'Save to List';
                btnSaveList.className = 'export-secondary-btn';
            }
            if (btnLoadAndSave) {
                btnLoadAndSave.style.display = 'inline-flex';
            }
        }

        card.style.display = 'flex';
    }

    hideImportPreview() {
        const body = this.window.getBodyElement();
        const card = body.querySelector('#import-preview-card');
        if (card) {
            card.style.display = 'none';
        }
        this.pendingImportData = null;
    }

    /**
     * Executes the chosen import action on the pending imported data.
     */
    executeImportAction(action) {
        if (!this.pendingImportData) {
            this.showFeedback('No pending board data to import.', 'error');
            return;
        }

        const data = this.pendingImportData;

        // 1. If it's a bundle archive
        if (data.isBundle) {
            this.importBundleToSaves(data.boards);
            return;
        }

        // 2. Single Board Actions
        if (action === 'load') {
            this.loadBoardOntoCanvas(data);
            this.showFeedback(`Loaded "${data.name}" onto canvas.`, 'success');
        } else if (action === 'save') {
            this.saveBoardToSaves(data);
            this.showFeedback(`Saved "${data.name}" to your Saved Boards list.`, 'success');
        } else if (action === 'load_and_save') {
            const savedRecord = this.saveBoardToSaves(data);
            this.loadBoardOntoCanvas(data, savedRecord ? savedRecord.id : null);
            this.showFeedback(`Loaded and saved "${data.name}"!`, 'success');
        }

        this.hideImportPreview();
    }

    /**
     * Loads board universes, connections, and noise config onto the live canvas.
     */
    loadBoardOntoCanvas(data, customBoardId = null) {
        if (!this.bubbleManager) return;

        // 1. Clear current canvas
        this.bubbleManager.clearBoard();

        // 2. Recreate universes
        if (Array.isArray(data.bubbles)) {
            data.bubbles.forEach(b => {
                this.bubbleManager.createBubble(b.x, b.y, b.name, b.color, b.id, b.isLocked, b.scale);
            });
        }

        // 3. Recreate connections
        if (this.connectionManager && Array.isArray(data.connections)) {
            data.connections.forEach(c => {
                this.connectionManager.createConnection(c.fromId, c.toId, c.name);
            });
        }

        // 4. Restore noise parameters
        if (data.noiseConfig && this.noiseConfig) {
            Object.assign(this.noiseConfig, data.noiseConfig);
            if (typeof this.onNoiseConfigLoaded === 'function') {
                this.onNoiseConfigLoaded(this.noiseConfig);
            }
        }

        // 5. Update bottom-left indicator and session
        if (this.savingManager) {
            const boardId = customBoardId || `board_${Date.now()}_imported`;
            this.savingManager.setActiveBoard(boardId, data.name);
            this.savingManager.saveSessionSnapshot();
        }
    }

    /**
     * Saves an imported board directly to localStorage via savingManager.
     */
    saveBoardToSaves(data) {
        if (!this.savingManager) return null;

        const saves = this.savingManager.getAllSaves();
        const record = {
            id: `board_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            name: data.name || 'Imported Board',
            createdAt: data.createdAt || Date.now(),
            bubbles: data.bubbles || [],
            connections: data.connections || [],
            noiseConfig: data.noiseConfig || null
        };

        saves.unshift(record);
        this.savingManager.setAllSaves(saves);
        this.savingManager.renderSavedList();
        this.refreshExportView();
        return record;
    }

    /**
     * Merges a bundle of boards into saved boards list.
     */
    importBundleToSaves(boards) {
        if (!this.savingManager || !Array.isArray(boards)) return;

        const currentSaves = this.savingManager.getAllSaves();
        let importedCount = 0;

        boards.forEach(b => {
            if (Array.isArray(b.bubbles)) {
                currentSaves.unshift({
                    id: b.id || `board_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    name: b.name || 'Imported Board',
                    createdAt: b.createdAt || Date.now(),
                    bubbles: b.bubbles,
                    connections: Array.isArray(b.connections) ? b.connections : [],
                    noiseConfig: b.noiseConfig || null
                });
                importedCount += 1;
            }
        });

        this.savingManager.setAllSaves(currentSaves);
        this.savingManager.renderSavedList();
        this.refreshExportView();
        this.hideImportPreview();
        this.showFeedback(`Successfully imported ${importedCount} boards to your Saved List!`, 'success');
    }

    showFeedback(message, type = 'info') {
        const body = this.window.getBodyElement();
        const feedbackEl = body.querySelector('#export-feedback-msg');
        if (!feedbackEl) return;

        feedbackEl.textContent = message;
        feedbackEl.className = `export-feedback is-visible ${type}`;

        setTimeout(() => {
            feedbackEl.classList.remove('is-visible');
        }, 3000);
    }

    open(targetTab = null) {
        this.window.open();
        if (targetTab) {
            this.switchTab(targetTab);
        } else {
            this.refreshExportView();
        }
    }

    close() {
        this.window.close();
    }

    toggle(targetTab = null) {
        if (this.window.isOpen) {
            this.close();
        } else {
            this.open(targetTab);
        }
    }
}

if (typeof window !== 'undefined') {
    window.ExportManager = ExportManager;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExportManager;
}
