/**
 * Saving Manager
 * ------------------------------------------------------------------
 * Handles local board persistence (add, remove, and open saved boards)
 * via browser localStorage, session restoration across refreshes,
 * bottom-left active board indicator, and Ctrl+S quick-save updating.
 */

class SavingManager {
    constructor(bubbleManager, connectionManager, noiseConfig, windowConfig, onNoiseConfigLoaded = null) {
        this.bubbleManager = bubbleManager;
        this.connectionManager = connectionManager;
        this.noiseConfig = noiseConfig;
        this.config = windowConfig || window.WindowConfig;
        this.onNoiseConfigLoaded = onNoiseConfigLoaded;

        this.storageKey = (this.config && this.config.storageKey) || 'inbetween_mapping_saved_boards';
        this.activeBoardKey = (this.config && this.config.activeBoardKey) || 'inbetween_mapping_active_board_id';
        this.sessionKey = (this.config && this.config.sessionKey) || 'inbetween_mapping_session_state';

        this.activeBoardId = null;
        this.activeBoardName = null;
        this.contextMenu = null;
        this.exportManager = null;

        this.window = null;
        this.activeBoardWidget = null;
        this.activeBoardNameEl = null;
        this.activeBoardSaveBtn = null;
        this.saveResetTimer = null;

        this.initWindow();
        this.initActiveBoardWidget();
        this.bindGlobalShortcuts();
    }

    setOnNoiseConfigLoaded(callback) {
        this.onNoiseConfigLoaded = callback;
    }

    setContextMenu(contextMenu) {
        this.contextMenu = contextMenu;
    }

    setExportManager(exportManager) {
        this.exportManager = exportManager;
    }

    /**
     * Prompts user with an in-app dialog to rename a saved board.
     */
    promptRenameBoard(boardId) {
        const saves = this.getAllSaves();
        const record = saves.find(s => s.id === boardId);
        if (!record) return;

        if (this.contextMenu && typeof this.contextMenu.showPrompt === 'function') {
            this.contextMenu.showPrompt({
                title: 'Rename Saved Board',
                placeholder: 'Enter new board name...',
                defaultValue: record.name,
                confirmText: 'Rename',
                onSubmit: (newName) => {
                    this.renameBoard(boardId, newName);
                }
            });
        } else {
            const entered = prompt('Enter new board name:', record.name);
            if (entered !== null && entered.trim().length > 0) {
                this.renameBoard(boardId, entered.trim());
            }
        }
    }

    /**
     * Renames a saved board and updates localStorage and UI indicators.
     */
    renameBoard(boardId, newName) {
        const trimmed = (newName || '').trim();
        if (!trimmed) return false;

        const saves = this.getAllSaves();
        const record = saves.find(s => s.id === boardId);
        if (!record) return false;

        record.name = trimmed;
        record.updatedAt = Date.now();
        this.setAllSaves(saves);

        if (this.activeBoardId === boardId) {
            this.activeBoardName = trimmed;
            if (this.activeBoardNameEl) {
                this.activeBoardNameEl.textContent = trimmed;
                this.activeBoardNameEl.title = `Current Board: ${trimmed} (double-click to rename)`;
            }
            this.saveSessionSnapshot();
        }

        this.renderSavedList();
        this.showFeedback(`Renamed to "${trimmed}"`, 'success');
        return true;
    }

    initWindow() {
        const winConfig = (this.config && this.config.savingWindow) || { width: 330, defaultTop: 60, defaultLeft: 20 };

        this.window = new window.FloatingWindow({
            id: 'saving-window',
            title: 'Saved Boards',
            width: winConfig.width || 330,
            defaultTop: winConfig.defaultTop || 60,
            defaultLeft: winConfig.defaultLeft || 20,
            contentHTML: `
                <div class="saving-controls">
                    <div class="save-input-row">
                        <input type="text" id="save-board-name-input" class="save-name-input" placeholder="New board name..." maxlength="40" autocomplete="off" spellcheck="false">
                        <button type="button" id="btn-save-current-board" class="save-action-btn primary">Save</button>
                    </div>
                    <div id="save-feedback-msg" class="save-feedback"></div>
                    <div class="saving-divider"></div>
                    <div class="saved-boards-header-row">
                        <span class="saved-boards-title">Saved List</span>
                        <div class="saved-header-meta">
                            <button type="button" id="btn-saving-open-export" class="saved-header-link" title="Open Export & Import Window">
                                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="7 10 12 15 17 10"></polyline>
                                    <line x1="12" y1="15" x2="12" y2="3"></line>
                                </svg>
                                <span>Export / Import</span>
                            </button>
                            <span id="saved-boards-count" class="saved-boards-count">0 boards</span>
                        </div>
                    </div>
                    <div id="saved-boards-list" class="saved-boards-list"></div>
                </div>
            `
        });

        this.bindWindowEvents();
        this.renderSavedList();
    }

    initActiveBoardWidget() {
        const widget = document.createElement('div');
        widget.id = 'active-board-widget';
        widget.className = 'active-board-widget';
        widget.innerHTML = `
            <div class="active-board-info" title="Current Board (click to view all saved boards)">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="active-board-icon">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                    <polyline points="17 21 17 13 7 13 7 21"></polyline>
                    <polyline points="7 3 7 8 15 8"></polyline>
                </svg>
                <span id="active-board-name" class="active-board-name">Board</span>
            </div>
            <button type="button" id="btn-active-board-rename" class="active-board-icon-btn" title="Rename this board">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 20h9"></path>
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                </svg>
            </button>
            <div class="active-board-divider"></div>
            <button type="button" id="btn-active-board-save" class="active-board-save-btn" title="Save changes to this board (Ctrl+S)">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="save-icon">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                    <polyline points="17 21 17 13 7 13 7 21"></polyline>
                    <polyline points="7 3 7 8 15 8"></polyline>
                </svg>
                <span class="save-text">Save</span>
            </button>
        `;

        document.body.appendChild(widget);

        this.activeBoardWidget = widget;
        this.activeBoardNameEl = widget.querySelector('#active-board-name');
        this.activeBoardSaveBtn = widget.querySelector('#btn-active-board-save');

        // Click on info area opens the Saving window
        widget.querySelector('.active-board-info').addEventListener('click', () => {
            this.open();
        });

        // Click on Rename button prompts rename
        const renameBtn = widget.querySelector('#btn-active-board-rename');
        if (renameBtn) {
            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.activeBoardId) {
                    this.promptRenameBoard(this.activeBoardId);
                } else {
                    this.updateActiveBoard();
                }
            });
        }

        // Double-click on active board name prompts rename
        if (this.activeBoardNameEl) {
            this.activeBoardNameEl.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                if (this.activeBoardId) {
                    this.promptRenameBoard(this.activeBoardId);
                }
            });
        }

        // Click on Save button triggers quick update
        this.activeBoardSaveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.updateActiveBoard();
        });
    }

    bindWindowEvents() {
        const body = this.window.getBodyElement();
        const saveBtn = body.querySelector('#btn-save-current-board');
        const nameInput = body.querySelector('#save-board-name-input');

        const handleSave = () => {
            const rawName = nameInput.value.trim();
            const defaultName = `Board ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            const boardName = rawName.length > 0 ? rawName : defaultName;

            this.saveCurrentBoard(boardName);
            nameInput.value = '';
            this.showFeedback('Board saved successfully!', 'success');
        };

        saveBtn.addEventListener('click', handleSave);

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSave();
            }
        });

        const openExportBtn = body.querySelector('#btn-saving-open-export');
        if (openExportBtn) {
            openExportBtn.addEventListener('click', () => {
                if (this.exportManager) {
                    this.exportManager.open();
                }
            });
        }
    }

    bindGlobalShortcuts() {
        // Ctrl+S / Cmd+S shortcut to save / update current board
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                this.updateActiveBoard();
            }
        });

        // Auto-save session state before page refresh / unload so board is not reset
        window.addEventListener('beforeunload', () => {
            this.saveSessionSnapshot();
        });
    }

    /**
     * Serializes current board elements (bubbles, connections, noiseConfig).
     */
    serializeCurrentState() {
        const bubbles = this.bubbleManager.bubbles
            .filter(b => b && Number.isFinite(Number(b.id)) && Number(b.id) > 0 && Number.isFinite(Number(b.x)) && Number.isFinite(Number(b.y)))
            .map(b => ({
                id: Math.floor(Number(b.id)),
                name: b.name || `Universe ${Math.floor(Number(b.id))}`,
                color: b.color || '#000000',
                x: Math.round(b.x * 100) / 100,
                y: Math.round(b.y * 100) / 100,
                isLocked: !!b.isLocked
            }));

        const connections = (this.connectionManager ? this.connectionManager.connections : [])
            .filter(c => c && Number.isFinite(Number(c.id)) && Number.isFinite(Number(c.fromId)) && Number.isFinite(Number(c.toId)))
            .map(c => ({
                id: Math.floor(Number(c.id)),
                fromId: Math.floor(Number(c.fromId)),
                toId: Math.floor(Number(c.toId)),
                name: c.name || `Connection ${Math.floor(Number(c.id))}`
            }));

        const noiseData = this.noiseConfig ? {
            noiseSize: this.noiseConfig.noiseSize,
            noiseSpeed: this.noiseConfig.noiseSpeed,
            steps: this.noiseConfig.steps,
            octaves: this.noiseConfig.octaves,
            invert: !!this.noiseConfig.invert,
            maintainAspectRatio: !!this.noiseConfig.maintainAspectRatio
        } : null;

        return { bubbles, connections, noiseData };
    }

    /**
     * Saves a snapshot of current session to localStorage to persist across refreshes.
     */
    saveSessionSnapshot() {
        // In online mode, preserve the local solo session intact and do not overwrite with room state
        if (this.bubbleManager && this.bubbleManager.onlineManager && this.bubbleManager.onlineManager.isOnline) {
            return;
        }

        const { bubbles, connections, noiseData } = this.serializeCurrentState();
        const sessionData = {
            activeBoardId: this.activeBoardId,
            activeBoardName: this.activeBoardName,
            timestamp: Date.now(),
            bubbles,
            connections,
            noiseConfig: noiseData
        };

        try {
            localStorage.setItem(this.sessionKey, JSON.stringify(sessionData));
            if (this.activeBoardId) {
                localStorage.setItem(this.activeBoardKey, this.activeBoardId);
            }
        } catch (err) {
            console.error('Error saving session snapshot:', err);
        }
    }

    /**
     * Automatically called on page load to restore board state after a screen refresh.
     */
    initAutoRestore() {
        let restored = false;

        try {
            const rawSession = localStorage.getItem(this.sessionKey);
            const activeId = localStorage.getItem(this.activeBoardKey);
            const saves = this.getAllSaves();

            if (rawSession) {
                const session = JSON.parse(rawSession);
                if (session && Array.isArray(session.bubbles) && session.bubbles.length > 0) {
                    // Restore from session snapshot
                    this.bubbleManager.clearBoard();

                    session.bubbles.forEach(b => {
                        this.bubbleManager.createBubble(b.x, b.y, b.name, b.color, b.id, b.isLocked);
                    });

                    if (this.connectionManager && Array.isArray(session.connections)) {
                        session.connections.forEach(c => {
                            this.connectionManager.createConnection(c.fromId, c.toId, c.name);
                        });
                    }

                    if (session.noiseConfig && this.noiseConfig) {
                        Object.assign(this.noiseConfig, session.noiseConfig);
                        if (typeof this.onNoiseConfigLoaded === 'function') {
                            this.onNoiseConfigLoaded(this.noiseConfig);
                        }
                    }

                    // Restore active board name/id if associated
                    const targetId = activeId || session.activeBoardId;
                    if (targetId) {
                        const savedRec = saves.find(s => s.id === targetId);
                        const name = savedRec ? savedRec.name : (session.activeBoardName || 'Current Board');
                        this.setActiveBoard(targetId, name);
                    } else if (session.activeBoardName) {
                        this.setActiveBoard(null, session.activeBoardName);
                    }

                    restored = true;
                }
            }

            // Fallback: if session was empty or missing but an active board was saved
            if (!restored && activeId) {
                restored = this.openBoard(activeId, false);
            }
        } catch (err) {
            console.error('Error during auto-restore:', err);
        }

        return restored;
    }

    /**
     * Sets the active board and displays its name on the bottom left.
     */
    setActiveBoard(boardId, boardName) {
        this.activeBoardId = boardId;
        this.activeBoardName = boardName;

        try {
            if (boardId) {
                localStorage.setItem(this.activeBoardKey, boardId);
            } else {
                localStorage.removeItem(this.activeBoardKey);
            }
        } catch (err) {
            console.error('Error updating active board key:', err);
        }

        if (this.activeBoardWidget && this.activeBoardNameEl) {
            this.activeBoardNameEl.textContent = boardName || 'Board';
            this.activeBoardNameEl.title = `Current Board: ${boardName || ''}`;
            this.activeBoardWidget.classList.add('is-visible');
        }

        this.renderSavedList();
    }

    /**
     * Clears the active board and hides the bottom-left indicator.
     */
    clearActiveBoard() {
        this.activeBoardId = null;
        this.activeBoardName = null;

        try {
            localStorage.removeItem(this.activeBoardKey);
            localStorage.removeItem(this.sessionKey);
        } catch (err) {
            console.error('Error clearing active board:', err);
        }

        if (this.activeBoardWidget) {
            this.activeBoardWidget.classList.remove('is-visible');
        }

        this.renderSavedList();
    }

    /**
     * Updates the currently open board with the latest state (or creates one if none is active).
     * Triggered by clicking "Save" on bottom-left or pressing Ctrl+S.
     */
    updateActiveBoard() {
        // If in online room mode, save snapshot to Cloud Firestore
        if (this.bubbleManager && this.bubbleManager.onlineManager && this.bubbleManager.onlineManager.isOnline) {
            const om = this.bubbleManager.onlineManager;
            const state = this.serializeCurrentState();
            om.firebaseService.saveFirestoreSnapshot(om.roomId, state, 'manual_snapshot', om.user);
            om.lastFirestoreSnapshotInfo = {
                action: 'manual',
                timestamp: new Date().toLocaleTimeString(),
                user: om.user.name
            };
            om.updateFirestoreCardUI();
            this.flashSaveFeedback();
            this.showFeedback('Archived Room Snapshot to Firestore! ✓', 'success');
            return true;
        }

        const { bubbles, connections, noiseData } = this.serializeCurrentState();

        if (this.activeBoardId) {
            const saves = this.getAllSaves();
            const record = saves.find(s => s.id === this.activeBoardId);

            if (record) {
                record.bubbles = bubbles;
                record.connections = connections;
                record.noiseConfig = noiseData;
                record.updatedAt = Date.now();

                this.setAllSaves(saves);
                this.renderSavedList();
                this.saveSessionSnapshot();

                this.flashSaveFeedback();
                this.showFeedback(`Updated "${record.name}"`, 'success');
                return true;
            }
        }

        // If no active board is selected yet, create a new saved board
        const defaultName = `Board ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        this.saveCurrentBoard(defaultName);
        this.flashSaveFeedback();
        return true;
    }

    flashSaveFeedback() {
        if (!this.activeBoardSaveBtn) return;

        if (this.saveResetTimer) {
            clearTimeout(this.saveResetTimer);
        }

        this.activeBoardSaveBtn.classList.add('is-saved');
        const saveTextEl = this.activeBoardSaveBtn.querySelector('.save-text');
        if (saveTextEl) {
            saveTextEl.textContent = 'Saved! ✓';
        }

        this.saveResetTimer = setTimeout(() => {
            this.activeBoardSaveBtn.classList.remove('is-saved');
            if (saveTextEl) {
                saveTextEl.textContent = 'Save';
            }
        }, 1800);
    }

    showFeedback(message, type = 'info') {
        const body = this.window.getBodyElement();
        const feedbackEl = body.querySelector('#save-feedback-msg');
        if (!feedbackEl) return;

        feedbackEl.textContent = message;
        feedbackEl.className = `save-feedback is-visible ${type}`;

        setTimeout(() => {
            feedbackEl.classList.remove('is-visible');
        }, 2500);
    }

    getAllSaves() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (err) {
            console.error('Error loading saved boards from localStorage:', err);
            return [];
        }
    }

    setAllSaves(saves) {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(saves));
        } catch (err) {
            console.error('Error saving boards to localStorage:', err);
            this.showFeedback('Failed to save to local storage.', 'error');
        }
    }

    saveCurrentBoard(name) {
        const { bubbles, connections, noiseData } = this.serializeCurrentState();

        const boardRecord = {
            id: `board_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            name,
            createdAt: Date.now(),
            bubbles,
            connections,
            noiseConfig: noiseData
        };

        const currentSaves = this.getAllSaves();
        currentSaves.unshift(boardRecord);
        this.setAllSaves(currentSaves);

        this.setActiveBoard(boardRecord.id, boardRecord.name);
        this.saveSessionSnapshot();

        this.renderSavedList();
        return boardRecord;
    }

    openBoard(boardId, showNotification = true) {
        const saves = this.getAllSaves();
        const record = saves.find(s => s.id === boardId);
        if (!record) {
            if (showNotification) this.showFeedback('Board record not found.', 'error');
            return false;
        }

        // 1. Clear current board
        this.bubbleManager.clearBoard();

        // 2. Recreate bubbles
        if (Array.isArray(record.bubbles)) {
            record.bubbles.forEach(b => {
                this.bubbleManager.createBubble(b.x, b.y, b.name, b.color, b.id, b.isLocked);
            });
        }

        // 3. Recreate connections
        if (this.connectionManager && Array.isArray(record.connections)) {
            record.connections.forEach(c => {
                this.connectionManager.createConnection(c.fromId, c.toId, c.name);
            });
        }

        // 4. Restore noise settings if present
        if (record.noiseConfig && this.noiseConfig) {
            Object.assign(this.noiseConfig, record.noiseConfig);
            if (typeof this.onNoiseConfigLoaded === 'function') {
                this.onNoiseConfigLoaded(this.noiseConfig);
            }
        }

        // 5. Update active board indicator on the bottom left
        this.setActiveBoard(record.id, record.name);
        this.saveSessionSnapshot();

        if (showNotification) {
            this.showFeedback(`Loaded "${record.name}"`, 'success');
        }
        return true;
    }

    removeBoard(boardId) {
        let saves = this.getAllSaves();
        const target = saves.find(s => s.id === boardId);
        saves = saves.filter(s => s.id !== boardId);
        this.setAllSaves(saves);

        if (this.activeBoardId === boardId) {
            this.clearActiveBoard();
        }

        this.renderSavedList();
        this.showFeedback(`Removed "${target ? target.name : 'board'}"`, 'info');
    }

    renderSavedList() {
        const body = this.window.getBodyElement();
        const listContainer = body.querySelector('#saved-boards-list');
        const countEl = body.querySelector('#saved-boards-count');
        if (!listContainer) return;

        const saves = this.getAllSaves();
        if (countEl) {
            countEl.textContent = `${saves.length} ${saves.length === 1 ? 'board' : 'boards'}`;
        }

        if (saves.length === 0) {
            listContainer.innerHTML = `
                <div class="saved-boards-empty">
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                        <polyline points="17 21 17 13 7 13 7 21"></polyline>
                        <polyline points="7 3 7 8 15 8"></polyline>
                    </svg>
                    <span>No saved boards yet</span>
                    <span class="empty-subtext">Save your current setup using the form above.</span>
                </div>
            `;
            return;
        }

        listContainer.innerHTML = '';
        saves.forEach(record => {
            const card = document.createElement('div');
            const isActive = record.id === this.activeBoardId;
            card.className = `saved-board-card ${isActive ? 'is-active-board' : ''}`;
            card.dataset.id = record.id;

            const dateStr = record.createdAt ? new Date(record.createdAt).toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }) : '';

            const numBubbles = (record.bubbles && record.bubbles.length) || 0;
            const numConns = (record.connections && record.connections.length) || 0;

            const safeName = (record.name || 'Untitled Board')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            card.innerHTML = `
                <div class="board-card-info">
                    <div class="board-card-title-row">
                        <span class="board-card-name" title="${safeName}">${safeName}</span>
                        ${isActive ? '<span class="active-tag">Active</span>' : ''}
                    </div>
                    <span class="board-card-meta">${dateStr} • ${numBubbles} ${numBubbles === 1 ? 'universe' : 'universes'}, ${numConns} ${numConns === 1 ? 'conn' : 'conns'}</span>
                </div>
                <div class="board-card-actions">
                    <button type="button" class="board-action-btn btn-open" title="${isActive ? 'Reload this board' : 'Open this board'}">${isActive ? 'Reload' : 'Open'}</button>
                    <button type="button" class="board-action-btn btn-rename" title="Rename this board">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 20h9"></path>
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                        </svg>
                    </button>
                    <button type="button" class="board-action-btn btn-export" title="Export this board as a .json file">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                    </button>
                    <button type="button" class="board-action-btn btn-delete" title="Delete this saved board">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            `;

            card.querySelector('.btn-open').addEventListener('click', () => {
                this.openBoard(record.id);
            });

            card.querySelector('.btn-rename').addEventListener('click', (e) => {
                e.stopPropagation();
                this.promptRenameBoard(record.id);
            });

            const exportBtn = card.querySelector('.btn-export');
            if (exportBtn) {
                exportBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.exportManager) {
                        this.exportManager.exportSavedBoardRecord(record);
                    } else {
                        // Direct download fallback
                        const payload = {
                            app: 'InBetween Mapping',
                            version: '1.0',
                            type: 'board',
                            exportedAt: new Date().toISOString(),
                            board: record
                        };
                        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${(record.name || 'board').toLowerCase().replace(/[^a-z0-9_\-\s]/g, '').replace(/\s+/g, '-')}.json`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    }
                });
            }

            const cardNameEl = card.querySelector('.board-card-name');
            if (cardNameEl) {
                cardNameEl.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    this.promptRenameBoard(record.id);
                });
            }

            card.querySelector('.btn-delete').addEventListener('click', () => {
                this.removeBoard(record.id);
            });

            listContainer.appendChild(card);
        });
    }

    open() {
        this.window.open();
        this.renderSavedList();
    }

    close() {
        this.window.close();
    }

    toggle() {
        if (this.window.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }
}

if (typeof window !== 'undefined') {
    window.SavingManager = SavingManager;
}
