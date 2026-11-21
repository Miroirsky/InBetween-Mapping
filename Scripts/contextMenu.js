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
        this.activeTargetBubbleId = null;
        this.isOpen = false;

        this.createMenuDOM();
        this.createModalDOM();
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
    }

    /**
     * Reusable in-app prompt for connection naming/renaming
     */
    showPrompt({ title, placeholder, defaultValue, confirmText, onSubmit }) {
        this.close(); // Close any open context menu
        this.modalTitle.textContent = title || 'Name Connection';
        this.modalInput.placeholder = placeholder || 'Enter connection name...';
        this.modalInput.value = defaultValue || '';
        this.modalConfirmBtn.textContent = confirmText || 'Save';

        this.modalElement.classList.add('visible');

        // Clean up previous event listeners by cloning
        const newConfirmBtn = this.modalConfirmBtn.cloneNode(true);
        this.modalConfirmBtn.parentNode.replaceChild(newConfirmBtn, this.modalConfirmBtn);
        this.modalConfirmBtn = newConfirmBtn;

        this.modalConfirmBtn.addEventListener('click', () => {
            const val = this.modalInput.value.trim();
            if (val.length > 0) {
                this.closeModal();
                if (onSubmit) onSubmit(val);
            } else {
                this.modalInput.focus();
                this.modalInput.classList.add('input-error');
                setTimeout(() => this.modalInput.classList.remove('input-error'), 400);
            }
        });

        setTimeout(() => {
            this.modalInput.focus();
            this.modalInput.select();
        }, 50);
    }

    closeModal() {
        this.modalElement.classList.remove('visible');
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
                if (this.modalElement.classList.contains('visible')) this.closeModal();
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
    showVoidMenu(x, y) {
        this.activeTargetBubbleId = null;

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
                    this.manager.createBubble(x, y);
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

        this.renderMenu(items, x, y);
    }

    /**
     * Show menu for bubble right-click
     */
    showBubbleMenu(x, y, bubbleId) {
        const bubble = this.manager.getBubbleById(bubbleId);
        if (!bubble) return;

        this.activeTargetBubbleId = bubbleId;
        const isLocked = bubble.isLocked;

        const items = [
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
            },
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
                    this.manager.removeBubble(bubbleId);
                }
            }
        ];

        this.renderMenu(items, x, y);
    }

    /**
     * Show menu for connection right-click
     */
    showConnectionMenu(x, y, connectionId) {
        if (!this.connectionManager) return;
        const conn = this.connectionManager.getConnectionById(connectionId);
        if (!conn) return;

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
        ];

        this.renderMenu(items, x, y);
    }

    renderMenu(items, x, y) {
        this.menuElement.innerHTML = '';

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
    }
}

if (typeof window !== 'undefined') {
    window.ContextMenu = ContextMenu;
}
