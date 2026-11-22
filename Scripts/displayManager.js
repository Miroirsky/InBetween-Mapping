/**
 * Display Manager (Display Settings & View Modes Window)
 * ------------------------------------------------------------------
 * Provides a floating, movable, closable, and reducible Display window
 * accessible from the View menu.
 * 
 * Features:
 * - Connection View toggle (colors connections smoothly from blue to white to red based on length)
 * - Color spectrum legend (0.5x short -> 1.0x normal -> 2.0x long)
 * - Information on scaling arrows by dragging
 * - Reset all arrow lengths to default base size
 */

class DisplayManager {
    constructor(connectionManager, windowConfig, savingManager = null) {
        this.connectionManager = connectionManager;
        this.windowConfig = windowConfig || window.WindowConfig;
        this.savingManager = savingManager;

        this.window = null;
        this.btnToggle = null;
        this.statusText = null;
        this.indicator = null;
        this.baseLengthDisplay = null;
        this.snapStepDisplay = null;
        this.btnResetAll = null;

        this.initWindow();
    }

    setSavingManager(savingManager) {
        this.savingManager = savingManager;
    }

    initWindow() {
        const winConfig = (this.windowConfig && this.windowConfig.displayWindow) || {
            width: 320,
            defaultTop: 60,
            defaultLeft: 360
        };

        this.window = new window.FloatingWindow({
            id: 'display-window',
            title: 'Display Options',
            width: winConfig.width || 320,
            defaultTop: winConfig.defaultTop || 60,
            defaultLeft: winConfig.defaultLeft || 360,
            contentHTML: `
                <div class="display-window-content">
                    <!-- Connection View Section -->
                    <div class="display-section">
                        <div class="display-section-header">
                            <div class="display-title-group">
                                <span class="display-section-title">Connection View</span>
                                <span class="display-section-subtitle">Length-based color spectrum</span>
                            </div>
                            <button type="button" id="display-window-toggle-btn" class="display-toggle-btn" role="switch" aria-checked="false">
                                <span class="display-toggle-indicator"></span>
                                <span id="display-window-status-text" class="display-status-text">OFF</span>
                            </button>
                        </div>
                        <p class="display-section-desc">
                            Visualizes arrow lengths relative to their default length. Connections dynamically shift from blue (compressed) to white (default) to red (stretched).
                        </p>

                        <!-- Color Spectrum Legend Card -->
                        <div class="display-legend-card">
                            <div class="display-legend-gradient"></div>
                            <div class="display-legend-labels">
                                <span class="legend-blue">0.5× Short</span>
                                <span class="legend-white">1.0× Normal</span>
                                <span class="legend-red">2.0× Long</span>
                            </div>
                        </div>
                    </div>

                    <div class="display-divider"></div>

                    <!-- Arrow Sizing Info & Reset Section -->
                    <div class="display-section">
                        <div class="display-title-group">
                            <span class="display-section-title">Arrow Sizing</span>
                            <span class="display-section-subtitle">Click & drag arrow to scale</span>
                        </div>
                        <p class="display-section-desc">
                            Click on any arrow and drag outward to change its default length. A circle scales from your click point and snaps the arrow length to 10% of base size.
                        </p>
                        <div class="display-metrics-card">
                            <div class="display-metric-row">
                                <span class="metric-label">Base Arrow Size:</span>
                                <span id="display-metric-base-length" class="metric-val">200px</span>
                            </div>
                            <div class="display-metric-row">
                                <span class="metric-label">Snap Increment (10%):</span>
                                <span id="display-metric-snap-step" class="metric-val">20px</span>
                            </div>
                        </div>
                        <div class="display-actions-group">
                            <button type="button" id="btn-perfect-selection-arrow-lengths" class="display-action-btn" style="display: none;" title="Set connections in the current selection to their perfect equilibrium length">
                                Set Selection to Perfect Length
                            </button>
                            <button type="button" id="btn-perfect-all-arrow-lengths" class="display-action-btn" title="Set all arrow lengths on the board to their perfect equilibrium length">
                                Set All to Perfect Length
                            </button>
                            <button type="button" id="btn-reset-all-arrow-lengths" class="display-reset-btn" title="Reset all custom arrow lengths back to default base length">
                                Reset All Arrow Lengths
                            </button>
                        </div>
                    </div>
                </div>
            `
        });

        this.bindEvents();
        this.syncUI();
    }

    bindEvents() {
        const body = this.window.getBodyElement();
        if (!body) return;

        this.btnToggle = body.querySelector('#display-window-toggle-btn');
        this.statusText = body.querySelector('#display-window-status-text');
        this.baseLengthDisplay = body.querySelector('#display-metric-base-length');
        this.snapStepDisplay = body.querySelector('#display-metric-snap-step');
        this.btnPerfectSelection = body.querySelector('#btn-perfect-selection-arrow-lengths');
        this.btnPerfectAll = body.querySelector('#btn-perfect-all-arrow-lengths');
        this.btnResetAll = body.querySelector('#btn-reset-all-arrow-lengths');

        if (this.btnToggle) {
            this.btnToggle.addEventListener('click', () => {
                const isCurrentlyOn = this.connectionManager ? this.connectionManager.connectionViewEnabled : false;
                this.setConnectionView(!isCurrentlyOn);
            });
        }

        if (this.btnPerfectSelection) {
            this.btnPerfectSelection.addEventListener('click', () => {
                const interaction = window.app && window.app.interactionManager;
                if (interaction && interaction.selectedBubbleIds && interaction.selectedBubbleIds.size > 0 && this.connectionManager) {
                    this.connectionManager.setSelectionConnectionsToOptimalLength(interaction.selectedBubbleIds);
                    if (this.savingManager) {
                        this.savingManager.saveSessionSnapshot();
                    }
                    this.syncUI();
                }
            });
        }

        if (this.btnPerfectAll) {
            this.btnPerfectAll.addEventListener('click', () => {
                if (this.connectionManager) {
                    this.connectionManager.setAllConnectionsToOptimalLength();
                    if (this.savingManager) {
                        this.savingManager.saveSessionSnapshot();
                    }
                    this.syncUI();
                }
            });
        }

        if (this.btnResetAll) {
            this.btnResetAll.addEventListener('click', () => {
                if (this.connectionManager) {
                    this.connectionManager.resetAllConnectionLengths();
                    if (this.savingManager) {
                        this.savingManager.saveSessionSnapshot();
                    }
                    this.syncUI();
                }
            });
        }
    }

    setConnectionView(enabled) {
        if (this.connectionManager) {
            this.connectionManager.setConnectionView(enabled);
        }
        this.syncUI();
    }

    syncUI() {
        const isEnabled = this.connectionManager ? this.connectionManager.connectionViewEnabled : false;

        if (this.btnToggle) {
            this.btnToggle.classList.toggle('is-on', isEnabled);
            this.btnToggle.setAttribute('aria-checked', String(isEnabled));
        }

        if (this.statusText) {
            this.statusText.textContent = isEnabled ? 'ON' : 'OFF';
        }

        if (this.connectionManager) {
            const baseLen = Math.round(this.connectionManager.getBaseArrowLength());
            const snapStep = Math.round(baseLen * 0.1);

            if (this.baseLengthDisplay) {
                this.baseLengthDisplay.textContent = `${baseLen}px`;
            }
            if (this.snapStepDisplay) {
                this.snapStepDisplay.textContent = `${snapStep}px`;
            }

            const interaction = window.app && window.app.interactionManager;
            const selectedCount = (interaction && interaction.selectedBubbleIds) ? interaction.selectedBubbleIds.size : 0;
            if (this.btnPerfectSelection) {
                if (selectedCount > 1) {
                    const conns = this.connectionManager.getConnectionsForBubbleIds(interaction.selectedBubbleIds, true);
                    const targetCount = conns.length > 0
                        ? conns.length
                        : this.connectionManager.getConnectionsForBubbleIds(interaction.selectedBubbleIds, false).length;
                    if (targetCount > 0) {
                        this.btnPerfectSelection.style.display = 'block';
                        this.btnPerfectSelection.textContent = `Set Selection to Perfect Length (${targetCount})`;
                    } else {
                        this.btnPerfectSelection.style.display = 'none';
                    }
                } else {
                    this.btnPerfectSelection.style.display = 'none';
                }
            }
        }
    }

    open() {
        this.syncUI();
        this.window.open();
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
    window.DisplayManager = DisplayManager;
}
