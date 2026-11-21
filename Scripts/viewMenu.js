/**
 * View Menu (Top-Left Application Navigation)
 * ------------------------------------------------------------------
 * Provides a sleek top-left dropdown menu to open the movable,
 * closable, and reducible Saving and Params windows.
 */

class ViewMenu {
    constructor(savingManager, paramsManager, interactionManager = null, exportManager = null) {
        this.savingManager = savingManager;
        this.paramsManager = paramsManager;
        this.interactionManager = interactionManager;
        this.exportManager = exportManager;
        this.isOpen = false;

        this.container = null;
        this.btnTrigger = null;
        this.dropdown = null;

        this.initDOM();
        this.bindEvents();
    }

    setExportManager(exportManager) {
        this.exportManager = exportManager;
    }

    initDOM() {
        const container = document.createElement('div');
        container.id = 'view-menu-container';
        container.className = 'view-menu-container';

        container.innerHTML = `
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
        `;

        document.body.appendChild(container);

        this.container = container;
        this.btnTrigger = container.querySelector('#view-menu-btn');
        this.dropdown = container.querySelector('#view-menu-dropdown');
    }

    bindEvents() {
        // Toggle menu on button click
        this.btnTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        // Menu item click handlers
        const items = this.dropdown.querySelectorAll('.view-menu-item');
        items.forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                this.close();

                if (action === 'saving' && this.savingManager) {
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
        });

        // Close on Escape key
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.close();
            }
        });
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
}

if (typeof window !== 'undefined') {
    window.ViewMenu = ViewMenu;
}
