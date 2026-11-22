/**
 * View Menu (Top-Left Application Navigation)
 * ------------------------------------------------------------------
 * Provides a sleek top-left dropdown menu to open the movable,
 * closable, and reducible Saving and Params windows.
 */

class ViewMenu {
    constructor(savingManager, paramsManager, interactionManager = null, exportManager = null, onlineManager = null, connectionManager = null) {
        this.savingManager = savingManager;
        this.paramsManager = paramsManager;
        this.interactionManager = interactionManager;
        this.exportManager = exportManager;
        this.onlineManager = onlineManager;
        this.connectionManager = connectionManager;
        this.isOpen = false;
        this.isDisplayOpen = false;
        this.connectionViewActive = false;

        this.container = null;
        this.btnTrigger = null;
        this.dropdown = null;
        this.btnDisplay = null;
        this.displayDropdown = null;
        this.btnConnectionView = null;
        this.btnOnline = null;

        this.initDOM();
        this.bindEvents();
    }

    setConnectionManager(connectionManager) {
        this.connectionManager = connectionManager;
        if (this.connectionManager) {
            this.connectionManager.setConnectionView(this.connectionViewActive);
        }
    }

    setOnlineManager(onlineManager) {
        this.onlineManager = onlineManager;
        if (this.onlineManager && this.btnOnline) {
            const statusDot = this.btnOnline.querySelector('.online-status-dot');
            const userBadge = this.btnOnline.querySelector('#online-user-count-badge');
            this.onlineManager.setTopNavElements(this.btnOnline, statusDot, userBadge);
        }
    }

    setExportManager(exportManager) {
        this.exportManager = exportManager;
    }

    initDOM() {
        const container = document.createElement('div');
        container.id = 'view-menu-container';
        container.className = 'view-menu-container';

        container.innerHTML = `
            <div class="top-nav-group">
                <button type="button" id="view-menu-btn" class="view-menu-btn" aria-haspopup="true" aria-expanded="false" title="View Windows">
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="menu-icon">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="3" y1="9" x2="21" y2="9"></line>
                        <line x1="9" y1="21" x2="9" y2="9"></line>
                    </svg>
                    <span class="menu-label">View</span>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="chevron-icon">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </button>
                <div id="view-menu-dropdown" class="view-menu-dropdown" role="menu">
                    <button type="button" class="view-menu-item" data-action="online" role="menuitem">
                        <span class="view-item-icon">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="2" y1="12" x2="22" y2="12"></line>
                                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                            </svg>
                        </span>
                        <div class="view-item-text">
                            <span class="view-item-title">Online Room</span>
                            <span class="view-item-subtitle">Realtime shared room</span>
                        </div>
                    </button>
                    <button type="button" class="view-menu-item" data-action="saving" role="menuitem">
                        <span class="view-item-icon">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                                <polyline points="17 21 17 13 7 13 7 21"></polyline>
                                <polyline points="7 3 7 8 15 8"></polyline>
                            </svg>
                        </span>
                        <div class="view-item-text">
                            <span class="view-item-title">Saving</span>
                            <span class="view-item-subtitle">Manage saved boards</span>
                        </div>
                    </button>
                    <button type="button" class="view-menu-item" data-action="export" role="menuitem">
                        <span class="view-item-icon">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                        </span>
                        <div class="view-item-text">
                            <span class="view-item-title">Export / Import</span>
                            <span class="view-item-subtitle">Share boards as files</span>
                        </div>
                    </button>
                    <button type="button" class="view-menu-item" data-action="params" role="menuitem">
                        <span class="view-item-icon">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="3"></circle>
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                            </svg>
                        </span>
                        <div class="view-item-text">
                            <span class="view-item-title">Params</span>
                            <span class="view-item-subtitle">Noise parameters</span>
                        </div>
                    </button>
                    <div class="view-menu-divider"></div>
                    <button type="button" class="view-menu-item" data-action="reset-view" role="menuitem">
                        <span class="view-item-icon">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                                <polyline points="3 3 3 8 8 8"></polyline>
                            </svg>
                        </span>
                        <div class="view-item-text">
                            <span class="view-item-title">Reset View</span>
                            <span class="view-item-subtitle">Center & 100% zoom</span>
                        </div>
                    </button>
                </div>
            </div>

            <div class="top-nav-group">
                <button type="button" id="display-menu-btn" class="view-menu-btn display-menu-btn" aria-haspopup="true" aria-expanded="false" title="Display Options">
                    <span class="display-active-dot"></span>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="menu-icon">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                    <span class="menu-label">Display</span>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="chevron-icon">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </button>
                <div id="display-menu-dropdown" class="view-menu-dropdown display-menu-dropdown" role="menu">
                    <button type="button" id="display-connection-view-btn" class="view-menu-item display-toggle-item" role="menuitemcheckbox" aria-checked="false">
                        <span class="view-item-icon">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="5" cy="12" r="3"></circle>
                                <circle cx="19" cy="12" r="3"></circle>
                                <line x1="8" y1="12" x2="16" y2="12"></line>
                            </svg>
                        </span>
                        <div class="view-item-text">
                            <span class="view-item-title">Connection View</span>
                            <span class="view-item-subtitle">Length color gradient</span>
                        </div>
                        <span class="display-toggle-pill" id="connection-view-toggle-pill">OFF</span>
                    </button>
                    <div class="display-legend-card">
                        <div class="display-legend-gradient"></div>
                        <div class="display-legend-labels">
                            <span class="legend-blue">0.5× Short</span>
                            <span class="legend-white">1.0× Normal</span>
                            <span class="legend-red">2.0× Long</span>
                        </div>
                    </div>
                </div>
            </div>

            <button type="button" id="online-menu-btn" class="online-menu-btn" title="Online Room (Multiplayer)">
                <span class="online-status-dot"></span>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="online-icon">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                </svg>
                <span class="online-btn-label">Online</span>
                <span id="online-user-count-badge" class="online-user-count-badge" style="display: none;">1</span>
            </button>
        `;

        document.body.appendChild(container);

        this.container = container;
        this.btnTrigger = container.querySelector('#view-menu-btn');
        this.dropdown = container.querySelector('#view-menu-dropdown');
        this.btnDisplay = container.querySelector('#display-menu-btn');
        this.displayDropdown = container.querySelector('#display-menu-dropdown');
        this.btnConnectionView = container.querySelector('#display-connection-view-btn');
        this.togglePill = container.querySelector('#connection-view-toggle-pill');
        this.btnOnline = container.querySelector('#online-menu-btn');
    }

    bindEvents() {
        // Toggle View menu on button click
        this.btnTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.isDisplayOpen) this.closeDisplay();
            this.toggle();
        });

        // Toggle Display menu on button click
        if (this.btnDisplay) {
            this.btnDisplay.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.isOpen) this.close();
                this.toggleDisplay();
            });
        }

        // Toggle Connection View mode
        if (this.btnConnectionView) {
            this.btnConnectionView.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setConnectionView(!this.connectionViewActive);
            });
        }

        // Online Room button click
        if (this.btnOnline) {
            this.btnOnline.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.onlineManager) {
                    this.onlineManager.toggle();
                }
            });
        }

        // View Menu item click handlers
        const items = this.dropdown.querySelectorAll('.view-menu-item');
        items.forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                this.close();

                if (action === 'online' && this.onlineManager) {
                    this.onlineManager.open();
                } else if (action === 'saving' && this.savingManager) {
                    this.savingManager.open();
                } else if (action === 'export' && this.exportManager) {
                    this.exportManager.open();
                } else if (action === 'params' && this.paramsManager) {
                    this.paramsManager.open();
                } else if (action === 'reset-view' && this.interactionManager) {
                    this.interactionManager.resetView();
                }
            });
        });

        // Close on click outside
        window.addEventListener('click', (e) => {
            if (this.isOpen && !this.container.contains(e.target)) {
                this.close();
            }
            if (this.isDisplayOpen && !this.container.contains(e.target)) {
                this.closeDisplay();
            }
        });

        // Close on Escape key
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.isOpen) this.close();
                if (this.isDisplayOpen) this.closeDisplay();
            }
        });
    }

    setConnectionView(enabled) {
        this.connectionViewActive = !!enabled;
        if (this.connectionManager) {
            this.connectionManager.setConnectionView(this.connectionViewActive);
        }
        if (this.btnConnectionView) {
            this.btnConnectionView.classList.toggle('is-selected', this.connectionViewActive);
            this.btnConnectionView.setAttribute('aria-checked', String(this.connectionViewActive));
        }
        if (this.togglePill) {
            this.togglePill.textContent = this.connectionViewActive ? 'ON' : 'OFF';
            this.togglePill.classList.toggle('is-on', this.connectionViewActive);
        }
        if (this.btnDisplay) {
            this.btnDisplay.classList.toggle('has-active-mode', this.connectionViewActive);
        }
    }

    open() {
        this.isOpen = true;
        this.dropdown.classList.add('is-open');
        this.btnTrigger.classList.add('is-active');
        this.btnTrigger.setAttribute('aria-expanded', 'true');
    }

    close() {
        this.isOpen = false;
        this.dropdown.classList.remove('is-open');
        this.btnTrigger.classList.remove('is-active');
        this.btnTrigger.setAttribute('aria-expanded', 'false');
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    openDisplay() {
        this.isDisplayOpen = true;
        if (this.displayDropdown) this.displayDropdown.classList.add('is-open');
        if (this.btnDisplay) {
            this.btnDisplay.classList.add('is-active');
            this.btnDisplay.setAttribute('aria-expanded', 'true');
        }
    }

    closeDisplay() {
        this.isDisplayOpen = false;
        if (this.displayDropdown) this.displayDropdown.classList.remove('is-open');
        if (this.btnDisplay) {
            this.btnDisplay.classList.remove('is-active');
            this.btnDisplay.setAttribute('aria-expanded', 'false');
        }
    }

    toggleDisplay() {
        if (this.isDisplayOpen) {
            this.closeDisplay();
        } else {
            this.openDisplay();
        }
    }
}

if (typeof window !== 'undefined') {
    window.ViewMenu = ViewMenu;
}
