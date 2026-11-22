/**
 * Context Menu Manager
 * ------------------------------------------------------------------
 * Handles right-click menus for the void, individual bubbles,
 * and connections, plus in-app prompt dialogs for connection naming.
 */

class ContextMenu {
    constructor(bubbleManager, connectionManager) {
        this.manager = bubbleManager;
        this.connectionManager = connectionManager || null;
        this.menuElement = null;
        this.modalElement = null;
        this.colorModalElement = null;
        this.confirmModalElement = null;
        this.activeTargetBubbleId = null;
        this.isOpen = false;

        this.createMenuDOM();
        this.createModalDOM();
        this.createColorModalDOM();
        this.createConfirmModalDOM();
        this.bindGlobalEvents();
    }

    setConnectionManager(connectionManager) {
        this.connectionManager = connectionManager;
    }

    createMenuDOM() {
        const menu = document.createElement('div');
        menu.id = 'custom-context-menu';
        menu.className = 'custom-context-menu';
        document.body.appendChild(menu);
        this.menuElement = menu;
    }

    createModalDOM() {
        const modal = document.createElement('div');
        modal.id = 'custom-input-modal';
        modal.className = 'custom-input-modal-backdrop';
        modal.innerHTML = `
            <div class="custom-modal-card">
                <div class="modal-header">
                    <h3 id="modal-title" class="modal-title">Connection Name</h3>
                </div>
                <div class="modal-body">
                    <input type="text" id="modal-input" class="modal-input" maxlength="50" autocomplete="off" spellcheck="false" placeholder="Enter name...">
                    <textarea id="modal-textarea" class="modal-input modal-textarea" rows="4" maxlength="500" placeholder="Enter description..." style="display: none;"></textarea>
                </div>
                <div class="modal-footer">
                    <button id="modal-cancel-btn" class="modal-btn secondary">Cancel</button>
                    <button id="modal-confirm-btn" class="modal-btn primary">Save</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        this.modalElement = modal;

        this.modalInput = modal.querySelector('#modal-input');
        this.modalTextarea = modal.querySelector('#modal-textarea');
        this.modalTitle = modal.querySelector('#modal-title');
        this.modalConfirmBtn = modal.querySelector('#modal-confirm-btn');
        this.modalCancelBtn = modal.querySelector('#modal-cancel-btn');

        this.modalCancelBtn.addEventListener('click', () => this.closeModal());

        this.modalInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.modalConfirmBtn.click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.closeModal();
            }
        });

        if (this.modalTextarea) {
            this.modalTextarea.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    this.modalConfirmBtn.click();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    this.closeModal();
                }
            });
        }
    }

    /**
     * Reusable in-app prompt for connection naming, universe renaming, and descriptions
     */
    showPrompt({ title, placeholder, defaultValue, confirmText, allowEmpty = false, isMultiline = false, onSubmit }) {
        this.close(); // Close any open context menu
        this.modalTitle.textContent = title || 'Name Connection';

        const useMultiline = !!(isMultiline && this.modalTextarea);
        const activeInput = useMultiline ? this.modalTextarea : this.modalInput;

        if (useMultiline) {
            this.modalInput.style.display = 'none';
            this.modalTextarea.style.display = 'block';
            this.modalTextarea.placeholder = placeholder || 'Enter description...';
            this.modalTextarea.value = defaultValue || '';
        } else {
            this.modalInput.style.display = 'block';
            if (this.modalTextarea) this.modalTextarea.style.display = 'none';
            this.modalInput.placeholder = placeholder || 'Enter name...';
            this.modalInput.value = defaultValue || '';
        }

        this.modalConfirmBtn.textContent = confirmText || 'Save';
        this.modalElement.classList.add('visible');

        // Clean up previous event listeners by cloning
        const newConfirmBtn = this.modalConfirmBtn.cloneNode(true);
        this.modalConfirmBtn.parentNode.replaceChild(newConfirmBtn, this.modalConfirmBtn);
        this.modalConfirmBtn = newConfirmBtn;

        this.modalConfirmBtn.addEventListener('click', () => {
            const val = activeInput.value.trim();
            if (val.length > 0 || allowEmpty) {
                this.closeModal();
                if (onSubmit) onSubmit(val);
            } else {
                activeInput.focus();
                activeInput.classList.add('input-error');
                setTimeout(() => activeInput.classList.remove('input-error'), 400);
            }
        });

        setTimeout(() => {
            activeInput.focus();
            activeInput.select();
        }, 50);
    }

    closeModal() {
        this.modalElement.classList.remove('visible');
    }

    createColorModalDOM() {
        const modal = document.createElement('div');
        modal.id = 'custom-color-modal';
        modal.className = 'custom-input-modal-backdrop';
        modal.innerHTML = `
            <div class="custom-modal-card color-modal-card">
                <div class="modal-header">
                    <h3 class="modal-title">Universe Color</h3>
                </div>
                <div class="modal-body color-picker-body">
                    <div class="color-preview-container">
                        <div id="modal-color-preview" class="color-preview-sphere"></div>
                    </div>
                    <div class="color-swatches-grid" id="modal-swatches-grid"></div>
                    <div class="color-custom-row">
                        <input type="color" id="modal-color-picker" class="modal-color-input" value="#000000">
                        <input type="text" id="modal-hex-input" class="modal-hex-text" value="#000000" maxlength="7" spellcheck="false" placeholder="#000000">
                    </div>
                </div>
                <div class="modal-footer">
                    <button id="modal-color-cancel-btn" class="modal-btn secondary">Cancel</button>
                    <button id="modal-color-confirm-btn" class="modal-btn primary">Apply</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        this.colorModalElement = modal;

        this.colorPreview = modal.querySelector('#modal-color-preview');
        this.colorPickerInput = modal.querySelector('#modal-color-picker');
        this.hexInput = modal.querySelector('#modal-hex-input');
        this.colorConfirmBtn = modal.querySelector('#modal-color-confirm-btn');
        this.colorCancelBtn = modal.querySelector('#modal-color-cancel-btn');
        this.swatchesGrid = modal.querySelector('#modal-swatches-grid');

        this.colorCancelBtn.addEventListener('click', () => this.closeColorModal());
    }

    updateColorPreview(hex) {
        const c100 = this.manager.hexToRgba(hex, 1);
        const c0 = this.manager.hexToRgba(hex, 0);
        this.colorPreview.style.background = `radial-gradient(circle closest-side, ${c100} 0%, ${c0} 100%)`;
        this.colorPickerInput.value = hex;
        this.hexInput.value = hex.toUpperCase();
    }

    showColorPrompt({ currentColor, onSubmit }) {
        this.close(); // Close any context menu

        const presets = [
            '#000000', '#1e1b4b', '#4338ca', '#0284c7', '#059669',
            '#d97706', '#dc2626', '#9333ea', '#db2777', '#475569'
        ];

        let selectedColor = currentColor || '#000000';
        this.updateColorPreview(selectedColor);

        // Populate preset swatches
        this.swatchesGrid.innerHTML = '';
        presets.forEach(hex => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `color-swatch-btn ${hex.toLowerCase() === selectedColor.toLowerCase() ? 'is-active' : ''}`;
            btn.style.backgroundColor = hex;
            btn.title = hex;
            btn.addEventListener('click', () => {
                selectedColor = hex;
                this.updateColorPreview(selectedColor);
                this.swatchesGrid.querySelectorAll('.color-swatch-btn').forEach(b => b.classList.remove('is-active'));
                btn.classList.add('is-active');
            });
            this.swatchesGrid.appendChild(btn);
        });

        // Color picker change handler
        this.colorPickerInput.oninput = (e) => {
            selectedColor = e.target.value;
            this.updateColorPreview(selectedColor);
            this.swatchesGrid.querySelectorAll('.color-swatch-btn').forEach(b => b.classList.remove('is-active'));
        };

        // Hex text change handler
        this.hexInput.oninput = (e) => {
            let val = e.target.value.trim();
            if (!val.startsWith('#')) val = '#' + val;
            if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                selectedColor = val;
                this.updateColorPreview(selectedColor);
                this.swatchesGrid.querySelectorAll('.color-swatch-btn').forEach(b => b.classList.remove('is-active'));
            }
        };

        // Confirm button
        const newConfirmBtn = this.colorConfirmBtn.cloneNode(true);
        this.colorConfirmBtn.parentNode.replaceChild(newConfirmBtn, this.colorConfirmBtn);
        this.colorConfirmBtn = newConfirmBtn;

        this.colorConfirmBtn.addEventListener('click', () => {
            this.closeColorModal();
            if (onSubmit) onSubmit(selectedColor);
        });

        this.colorModalElement.classList.add('visible');
    }

    closeColorModal() {
        if (this.colorModalElement) {
            this.colorModalElement.classList.remove('visible');
        }
    }

    createConfirmModalDOM() {
        const modal = document.createElement('div');
        modal.id = 'custom-confirm-modal';
        modal.className = 'custom-input-modal-backdrop';
        modal.innerHTML = `
            <div class="custom-modal-card confirm-modal-card">
                <div class="modal-header">
                    <h3 id="confirm-modal-title" class="modal-title">Remove Universe</h3>
                </div>
                <div class="modal-body confirm-modal-body">
                    <p id="confirm-modal-message" class="confirm-modal-message"></p>
                    <p id="confirm-modal-subtext" class="confirm-modal-subtext"></p>
                </div>
                <div class="modal-footer">
                    <button id="confirm-modal-cancel-btn" class="modal-btn secondary">Cancel</button>
                    <button id="confirm-modal-confirm-btn" class="modal-btn danger">Delete Universe</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        this.confirmModalElement = modal;

        this.confirmModalTitle = modal.querySelector('#confirm-modal-title');
        this.confirmModalMessage = modal.querySelector('#confirm-modal-message');
        this.confirmModalSubtext = modal.querySelector('#confirm-modal-subtext');
        this.confirmModalCancelBtn = modal.querySelector('#confirm-modal-cancel-btn');
        this.confirmModalConfirmBtn = modal.querySelector('#confirm-modal-confirm-btn');

        this.confirmModalCancelBtn.addEventListener('click', () => this.closeConfirmModal());

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeConfirmModal();
            }
        });
    }

    /**
     * Reusable in-app confirmation modal for destructive actions (e.g., bubble deletion)
     */
    showConfirm({ title, message, subtext = '', confirmText = 'Delete', cancelText = 'Cancel', danger = true, onConfirm }) {
        this.close();
        this.confirmModalTitle.textContent = title || 'Confirm Action';
        this.confirmModalMessage.textContent = message || 'Are you sure?';

        if (subtext) {
            this.confirmModalSubtext.textContent = subtext;
            this.confirmModalSubtext.style.display = 'block';
        } else {
            this.confirmModalSubtext.textContent = '';
            this.confirmModalSubtext.style.display = 'none';
        }

        this.confirmModalCancelBtn.textContent = cancelText;
        this.confirmModalConfirmBtn.textContent = confirmText;
        this.confirmModalConfirmBtn.className = `modal-btn ${danger ? 'danger' : 'primary'}`;

        const newConfirmBtn = this.confirmModalConfirmBtn.cloneNode(true);
        this.confirmModalConfirmBtn.parentNode.replaceChild(newConfirmBtn, this.confirmModalConfirmBtn);
        this.confirmModalConfirmBtn = newConfirmBtn;

        this.confirmModalConfirmBtn.addEventListener('click', () => {
            this.closeConfirmModal();
            if (onConfirm) onConfirm();
        });

        this.confirmModalElement.classList.add('visible');

        setTimeout(() => {
            this.confirmModalConfirmBtn.focus();
        }, 50);
    }

    closeConfirmModal() {
        if (this.confirmModalElement) {
            this.confirmModalElement.classList.remove('visible');
        }
    }

    bindGlobalEvents() {
        // Dismiss on left click outside
        window.addEventListener('click', (e) => {
            if (this.isOpen && !this.menuElement.contains(e.target)) {
                this.close();
            }
        });

        // Dismiss on Escape key
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.isOpen) this.close();
                if (this.modalElement && this.modalElement.classList.contains('visible')) this.closeModal();
                if (this.colorModalElement && this.colorModalElement.classList.contains('visible')) this.closeColorModal();
                if (this.confirmModalElement && this.confirmModalElement.classList.contains('visible')) this.closeConfirmModal();
            }
        });

        // Dismiss on window resize
        window.addEventListener('resize', () => {
            if (this.isOpen) this.close();
        });
    }

    /**
     * Show menu for void right-click
     */
    showVoidMenu(boardX, boardY, screenX, screenY) {
        this.activeTargetBubbleId = null;

        const posX = screenX !== undefined ? screenX : boardX;
        const posY = screenY !== undefined ? screenY : boardY;

        const items = [
            {
                label: 'Create a new Universe',
                icon: `
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="9"></circle>
                        <line x1="12" y1="8" x2="12" y2="16"></line>
                        <line x1="8" y1="12" x2="16" y2="12"></line>
                    </svg>
                `,
                action: () => {
                    const nextNum = typeof this.manager.syncNextId === 'function'
                        ? this.manager.syncNextId()
                        : (Number.isFinite(this.manager.nextId) ? this.manager.nextId : 1);
                    this.showPrompt({
                        title: 'Create Universe',
                        placeholder: 'Enter universe name...',
                        defaultValue: `Universe ${nextNum}`,
                        confirmText: 'Create',
                        onSubmit: (name) => {
                            this.manager.createBubble(boardX, boardY, name);
                        }
                    });
                }
            },
            {
                label: 'Reset Board',
                danger: true,
                icon: `
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                `,
                action: () => {
                    this.manager.resetBoard();
                }
            }
        ];

        this.renderMenu('Board', items, posX, posY);
    }

    /**
     * Show menu for bubble right-click (supports single bubble or multi-selection group)
     */
    showBubbleMenu(x, y, bubbleId, selectedBubbles = [], onClearSelection = null) {
        const bubble = this.manager.getBubbleById(bubbleId);
        if (!bubble) return;

        this.activeTargetBubbleId = bubbleId;
        const isMulti = Array.isArray(selectedBubbles) && selectedBubbles.length > 1;

        if (isMulti) {
            const count = selectedBubbles.length;
            const allLocked = selectedBubbles.every(b => b.isLocked);
            const targetIds = selectedBubbles.map(b => b.id);

            const internalConns = this.connectionManager
                ? this.connectionManager.getConnectionsForBubbleIds(targetIds, true)
                : [];
            const targetConns = internalConns.length > 0
                ? internalConns
                : (this.connectionManager ? this.connectionManager.getConnectionsForBubbleIds(targetIds, false) : []);

            const items = [
                {
                    label: `Change Color (${count})`,
                    icon: `
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="9"></circle>
                            <path d="M12 3a9 9 0 0 1 9 9c0 2.5-2 4.5-4.5 4.5h-1.5a2 2 0 0 0-2 2v.5a2 2 0 0 1-2 2c-.5 0-1-.2-1.5-.5"></path>
                        </svg>
                    `,
                    action: () => {
                        this.showColorPrompt({
                            currentColor: bubble.color || this.manager.config.bubbleColor || '#000000',
                            onSubmit: (newColor) => {
                                targetIds.forEach(id => this.manager.setBubbleColor(id, newColor));
                            }
                        });
                    }
                },
                {
                    label: `Set Description (${count})`,
                    icon: `
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="16" y1="13" x2="8" y2="13"></line>
                            <line x1="16" y1="17" x2="8" y2="17"></line>
                        </svg>
                    `,
                    action: () => {
                        this.showPrompt({
                            title: `Set Description (${count} Universes)`,
                            placeholder: 'Enter description for all selected universes...',
                            defaultValue: bubble.description || '',
                            confirmText: 'Apply',
                            allowEmpty: true,
                            isMultiline: true,
                            onSubmit: (newDesc) => {
                                targetIds.forEach(id => this.manager.setBubbleDescription(id, newDesc));
                            }
                        });
                    }
                },
                {
                    label: allLocked ? `Unlock Selected (${count})` : `Lock Selected (${count})`,
                    icon: allLocked ? `
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
                        </svg>
                    ` : `
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                    `,
                    action: () => {
                        const shouldLock = !allLocked;
                        targetIds.forEach(id => {
                            const b = this.manager.getBubbleById(id);
                            if (b && b.isLocked !== shouldLock) {
                                this.manager.toggleLock(id);
                            }
                        });
                    }
                }
            ];

            if (targetConns.length > 0) {
                items.push({
                    label: `Set to Perfect Length (${targetConns.length})`,
                    icon: `
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <circle cx="12" cy="12" r="6"></circle>
                            <circle cx="12" cy="12" r="2"></circle>
                        </svg>
                    `,
                    action: () => {
                        if (this.connectionManager) {
                            this.connectionManager.setSelectionConnectionsToOptimalLength(targetIds);
                            if (window.app && window.app.savingManager) {
                                window.app.savingManager.saveSessionSnapshot();
                            }
                            if (window.app && window.app.displayManager) {
                                window.app.displayManager.syncUI();
                            }
                        }
                    }
                });
            }

            items.push(
                {
                    label: 'Clear Selection',
                    icon: `
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="4 4"></rect>
                        </svg>
                    `,
                    action: () => {
                        if (onClearSelection) onClearSelection();
                    }
                },
                {
                    label: `Remove Selected (${count})`,
                    danger: true,
                    icon: `
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    `,
                    action: () => {
                        this.showConfirm({
                            title: `Remove ${count} Universes`,
                            message: `Are you sure you want to delete the ${count} selected universes?`,
                            subtext: 'All selected universes and their attached connections will be permanently removed.',
                            confirmText: `Remove (${count})`,
                            cancelText: 'Cancel',
                            danger: true,
                            onConfirm: () => {
                                targetIds.forEach(id => this.manager.removeBubble(id));
                                if (onClearSelection) onClearSelection();
                            }
                        });
                    }
                }
            );

            this.renderMenu(`${count} Universes Selected`, items, x, y);
            return;
        }

        const isLocked = bubble.isLocked;

        const items = [
            {
                label: 'Edit Name',
                icon: `
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 20h9"></path>
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                    </svg>
                `,
                action: () => {
                    this.showPrompt({
                        title: 'Edit Universe Name',
                        placeholder: 'Enter universe name...',
                        defaultValue: bubble.name,
                        confirmText: 'Update',
                        onSubmit: (newName) => {
                            this.manager.renameBubble(bubbleId, newName);
                        }
                    });
                }
            },
            {
                label: bubble.description ? 'Edit Description' : 'Add Description',
                icon: `
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                    </svg>
                `,
                action: () => {
                    this.showPrompt({
                        title: `${bubble.name} Description`,
                        placeholder: 'Enter universe description...',
                        defaultValue: bubble.description || '',
                        confirmText: 'Save',
                        allowEmpty: true,
                        isMultiline: true,
                        onSubmit: (newDesc) => {
                            this.manager.setBubbleDescription(bubbleId, newDesc);
                        }
                    });
                }
            },
            {
                label: 'Change Color',
                icon: `
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="9"></circle>
                        <path d="M12 3a9 9 0 0 1 9 9c0 2.5-2 4.5-4.5 4.5h-1.5a2 2 0 0 0-2 2v.5a2 2 0 0 1-2 2c-.5 0-1-.2-1.5-.5"></path>
                    </svg>
                `,
                action: () => {
                    this.showColorPrompt({
                        currentColor: bubble.color || this.manager.config.bubbleColor || '#000000',
                        onSubmit: (newColor) => {
                            this.manager.setBubbleColor(bubbleId, newColor);
                        }
                    });
                }
            },
            {
                label: 'Add Connection',
                icon: `
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                        <polyline points="12 5 19 12 12 19"></polyline>
                    </svg>
                `,
                action: () => {
                    if (this.connectionManager) {
                        this.connectionManager.startConnecting(bubbleId);
                    }
                }
            }
        ];

        const attachedConns = this.connectionManager
            ? this.connectionManager.getConnectionsForBubbleIds([bubbleId], false)
            : [];
        if (attachedConns.length > 0) {
            items.push({
                label: `Set Arrows to Perfect Length (${attachedConns.length})`,
                icon: `
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <circle cx="12" cy="12" r="6"></circle>
                        <circle cx="12" cy="12" r="2"></circle>
                    </svg>
                `,
                action: () => {
                    this.connectionManager.setMultipleConnectionsToOptimalLength(attachedConns);
                    if (window.app && window.app.savingManager) {
                        window.app.savingManager.saveSessionSnapshot();
                    }
                    if (window.app && window.app.displayManager) {
                        window.app.displayManager.syncUI();
                    }
                }
            });
        }

        items.push(
            {
                label: isLocked ? 'Unlock Bubble' : 'Lock Bubble',
                icon: isLocked ? `
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                        <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
                    </svg>
                ` : `
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                `,
                action: () => {
                    this.manager.toggleLock(bubbleId);
                }
            },
            {
                label: 'Remove Universe',
                danger: true,
                icon: `
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
                `,
                action: () => {
                    const currentBubble = this.manager.getBubbleById(bubbleId);
                    const bName = (currentBubble && currentBubble.name) ? currentBubble.name : 'this universe';
                    const connCount = this.connectionManager
                        ? this.connectionManager.connections.filter(c => Number(c.fromId) === Number(bubbleId) || Number(c.toId) === Number(bubbleId)).length
                        : 0;
                    const subtext = connCount > 0
                        ? `This will also remove ${connCount} attached connection${connCount > 1 ? 's' : ''}.`
                        : 'This universe will be permanently removed from the board.';

                    this.showConfirm({
                        title: 'Remove Universe',
                        message: `Are you sure you want to delete "${bName}"?`,
                        subtext,
                        confirmText: 'Remove',
                        cancelText: 'Cancel',
                        danger: true,
                        onConfirm: () => {
                            this.manager.removeBubble(bubbleId);
                        }
                    });
                }
            }
        );

        this.renderMenu(bubble.name || 'Universe', items, x, y);
    }

    /**
     * Show menu for connection right-click
     */
    showConnectionMenu(x, y, connectionId) {
        if (!this.connectionManager) return;
        const conn = this.connectionManager.getConnectionById(connectionId);
        if (!conn) return;

        // Keep label and arrow visible/highlighted while context menu is open
        const connEls = document.querySelectorAll(`.universe-connection[data-id="${connectionId}"], .universe-connection-label[data-id="${connectionId}"]`);
        connEls.forEach(el => el.classList.add('is-active-context'));

        const items = [
            {
                label: 'Edit Name',
                icon: `
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 20h9"></path>
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                    </svg>
                `,
                action: () => {
                    this.showPrompt({
                        title: 'Edit Connection Name',
                        placeholder: 'Enter connection name...',
                        defaultValue: conn.name,
                        confirmText: 'Update',
                        onSubmit: (newName) => {
                            this.connectionManager.renameConnection(connectionId, newName);
                        }
                    });
                }
            },
            {
                label: 'Set to Perfect Length',
                icon: `
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <circle cx="12" cy="12" r="6"></circle>
                        <circle cx="12" cy="12" r="2"></circle>
                    </svg>
                `,
                action: () => {
                    this.connectionManager.setConnectionToOptimalLength(connectionId);
                    if (window.app && window.app.savingManager) {
                        window.app.savingManager.saveSessionSnapshot();
                    }
                    if (window.app && window.app.displayManager) {
                        window.app.displayManager.syncUI();
                    }
                }
            }
        ];

        const interaction = window.app && window.app.interactionManager;
        const selectedIds = (interaction && interaction.selectedBubbleIds && interaction.selectedBubbleIds.size > 1)
            ? Array.from(interaction.selectedBubbleIds)
            : null;
        let selectionConns = [];
        if (selectedIds && this.connectionManager) {
            selectionConns = this.connectionManager.getConnectionsForBubbleIds(selectedIds, true);
            if (selectionConns.length === 0) {
                selectionConns = this.connectionManager.getConnectionsForBubbleIds(selectedIds, false);
            }
        }

        if (selectionConns.length > 1) {
            items.push({
                label: `Set Perfect Length of Selection (${selectionConns.length})`,
                icon: `
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <circle cx="12" cy="12" r="6"></circle>
                        <circle cx="12" cy="12" r="2"></circle>
                    </svg>
                `,
                action: () => {
                    this.connectionManager.setMultipleConnectionsToOptimalLength(selectionConns);
                    if (window.app && window.app.savingManager) {
                        window.app.savingManager.saveSessionSnapshot();
                    }
                    if (window.app && window.app.displayManager) {
                        window.app.displayManager.syncUI();
                    }
                }
            });
        }

        items.push(
            {
                label: 'Reset Arrow Length',
                icon: `
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                        <polyline points="3 3 3 8 8 8"></polyline>
                    </svg>
                `,
                action: () => {
                    this.connectionManager.setConnectionTargetLength(connectionId, null);
                    if (window.app && window.app.savingManager) {
                        window.app.savingManager.saveSessionSnapshot();
                    }
                }
            },
            {
                label: 'Remove Connection',
                danger: true,
                icon: `
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                `,
                action: () => {
                    this.connectionManager.removeConnection(connectionId);
                }
            }
        );

        this.renderMenu(conn.name || 'Connection', items, x, y);
    }

    renderMenu(title, items, x, y) {
        this.menuElement.innerHTML = '';

        if (title) {
            const header = document.createElement('div');
            header.className = 'context-menu-header';
            header.textContent = title;
            header.title = title;
            this.menuElement.appendChild(header);

            const divider = document.createElement('div');
            divider.className = 'context-menu-divider';
            this.menuElement.appendChild(divider);
        }

        items.forEach(item => {
            const btn = document.createElement('button');
            btn.className = `context-menu-item ${item.danger ? 'danger' : ''}`;
            btn.innerHTML = `
                <span class="item-icon">${item.icon}</span>
                <span class="item-label">${item.label}</span>
            `;

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.close();
                item.action();
            });

            this.menuElement.appendChild(btn);
        });

        this.positionMenu(x, y);
        this.menuElement.classList.add('visible');
        this.isOpen = true;
    }

    positionMenu(x, y) {
        this.menuElement.style.display = 'block';
        this.menuElement.style.visibility = 'hidden';

        const rect = this.menuElement.getBoundingClientRect();
        const winW = window.innerWidth;
        const winH = window.innerHeight;

        let posX = x + 4;
        let posY = y + 4;

        if (posX + rect.width > winW - 10) {
            posX = x - rect.width - 4;
        }
        if (posY + rect.height > winH - 10) {
            posY = y - rect.height - 4;
        }

        this.menuElement.style.left = `${Math.max(10, posX)}px`;
        this.menuElement.style.top = `${Math.max(10, posY)}px`;
        this.menuElement.style.visibility = 'visible';
    }

    close() {
        if (!this.isOpen) return;
        this.menuElement.classList.remove('visible');
        this.menuElement.style.display = 'none';
        this.isOpen = false;
        this.activeTargetBubbleId = null;
        document.querySelectorAll('.universe-connection.is-active-context').forEach(el => el.classList.remove('is-active-context'));
    }
}

if (typeof window !== 'undefined') {
    window.ContextMenu = ContextMenu;
}
