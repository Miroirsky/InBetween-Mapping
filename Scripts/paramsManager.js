/**
 * Params Manager (Noise Parameters Window)
 * ------------------------------------------------------------------
 * Provides a floating, movable, closable, and reducible parameters window
 * allowing noise settings to be scaled from 10% to 1000% of default values.
 */

class ParamsManager {
    constructor(noiseConfig, windowConfig) {
        this.config = noiseConfig;
        this.windowConfig = windowConfig || window.WindowConfig;

        // Baseline reference values from default configuration
        this.defaults = {
            noiseSize: 1.0,
            noiseSpeed: 0.01,
            steps: 15,
            octaves: 2,
            invert: false,
            maintainAspectRatio: true,
            colorLow: '#000000',
            colorHigh: '#ffffff'
        };

        this.window = null;
        this.initWindow();
        this.bindKeyboardShortcut();
    }

    initWindow() {
        const winConfig = (this.windowConfig && this.windowConfig.paramsWindow) || { width: 300, defaultTop: 60, defaultLeft: 360 };
        const minPct = (this.windowConfig && this.windowConfig.paramScaleMinPercent) || 10;
        const maxPct = (this.windowConfig && this.windowConfig.paramScaleMaxPercent) || 1000;
        const stepPct = (this.windowConfig && this.windowConfig.paramScaleStepPercent) || 5;

        this.window = new window.FloatingWindow({
            id: 'params-window',
            title: 'Noise Parameters',
            width: winConfig.width || 300,
            defaultTop: winConfig.defaultTop || 60,
            defaultLeft: winConfig.defaultLeft || 360,
            contentHTML: `
                <div class="params-controls">
                    <!-- Noise Size Slider -->
                    <div class="control-group">
                        <div class="label-row">
                            <label for="param-noise-size">Noise Size</label>
                            <span id="val-display-size" class="value-display">100% (1.00)</span>
                        </div>
                        <input type="range" id="param-noise-size" min="${minPct}" max="${maxPct}" step="${stepPct}" value="100">
                    </div>

                    <!-- Noise Speed Slider -->
                    <div class="control-group">
                        <div class="label-row">
                            <label for="param-noise-speed">Noise Speed</label>
                            <span id="val-display-speed" class="value-display">100% (0.010)</span>
                        </div>
                        <input type="range" id="param-noise-speed" min="${minPct}" max="${maxPct}" step="${stepPct}" value="100">
                    </div>

                    <!-- Shade Steps Slider -->
                    <div class="control-group">
                        <div class="label-row">
                            <label for="param-steps">Shade Steps</label>
                            <span id="val-display-steps" class="value-display">100% (15)</span>
                        </div>
                        <input type="range" id="param-steps" min="${minPct}" max="${maxPct}" step="${stepPct}" value="100">
                    </div>

                    <!-- Octaves Slider -->
                    <div class="control-group">
                        <div class="label-row">
                            <label for="param-octaves">Octaves</label>
                            <span id="val-display-octaves" class="value-display">100% (2)</span>
                        </div>
                        <input type="range" id="param-octaves" min="${minPct}" max="${maxPct}" step="${stepPct}" value="100">
                    </div>

                    <!-- Noise Colors -->
                    <div class="control-group noise-colors-group">
                        <div class="label-row">
                            <label>Noise Colors</label>
                            <span class="value-display">Low / High</span>
                        </div>
                        <div class="noise-color-pickers-row">
                            <label class="noise-color-item" title="Low / dark noise color">
                                <input type="color" id="param-color-low" class="noise-color-input" value="${this.config.colorLow || '#000000'}">
                                <span id="val-display-color-low" class="noise-color-hex">${(this.config.colorLow || '#000000').toUpperCase()}</span>
                            </label>
                            <label class="noise-color-item" title="High / light noise color">
                                <input type="color" id="param-color-high" class="noise-color-input" value="${this.config.colorHigh || '#ffffff'}">
                                <span id="val-display-color-high" class="noise-color-hex">${(this.config.colorHigh || '#ffffff').toUpperCase()}</span>
                            </label>
                        </div>
                        <div class="noise-color-presets">
                            <button type="button" class="noise-preset-btn" data-low="#000000" data-high="#ffffff" title="Classic B&amp;W" style="background: linear-gradient(135deg, #000000 50%, #ffffff 50%);"></button>
                            <button type="button" class="noise-preset-btn" data-low="#0a1628" data-high="#38bdf8" title="Deep Ocean" style="background: linear-gradient(135deg, #0a1628 50%, #38bdf8 50%);"></button>
                            <button type="button" class="noise-preset-btn" data-low="#1a0b2e" data-high="#c084fc" title="Cosmic Violet" style="background: linear-gradient(135deg, #1a0b2e 50%, #c084fc 50%);"></button>
                            <button type="button" class="noise-preset-btn" data-low="#052e16" data-high="#4ade80" title="Forest Mist" style="background: linear-gradient(135deg, #052e16 50%, #4ade80 50%);"></button>
                            <button type="button" class="noise-preset-btn" data-low="#270909" data-high="#fb923c" title="Ember Glow" style="background: linear-gradient(135deg, #270909 50%, #fb923c 50%);"></button>
                            <button type="button" class="noise-preset-btn" data-low="#1c1917" data-high="#e7d3b0" title="Warm Sepia" style="background: linear-gradient(135deg, #1c1917 50%, #e7d3b0 50%);"></button>
                        </div>
                    </div>

                    <!-- Toggles -->
                    <div class="control-group checkbox-row">
                        <label>
                            <input type="checkbox" id="param-invert" ${this.config.invert ? 'checked' : ''}>
                            Invert Colors
                        </label>
                        <label>
                            <input type="checkbox" id="param-aspect" ${this.config.maintainAspectRatio ? 'checked' : ''}>
                            Keep Aspect
                        </label>
                    </div>

                    <!-- Actions -->
                    <div class="params-footer-row">
                        <button type="button" id="btn-reset-params-default" class="params-reset-btn" title="Reset all noise parameters to 100% of defaults">
                            Reset to Default (100%)
                        </button>
                    </div>
                </div>
            `
        });

        this.bindEvents();
        this.syncFromConfig();
    }

    bindEvents() {
        const body = this.window.getBodyElement();

        // Noise Size
        const sizeInput = body.querySelector('#param-noise-size');
        const sizeDisplay = body.querySelector('#val-display-size');
        sizeInput.addEventListener('input', (e) => {
            const pct = parseFloat(e.target.value);
            const val = this.defaults.noiseSize * (pct / 100);
            this.config.noiseSize = val;
            sizeDisplay.textContent = `${Math.round(pct)}% (${val.toFixed(2)})`;
        });

        // Noise Speed
        const speedInput = body.querySelector('#param-noise-speed');
        const speedDisplay = body.querySelector('#val-display-speed');
        speedInput.addEventListener('input', (e) => {
            const pct = parseFloat(e.target.value);
            const val = this.defaults.noiseSpeed * (pct / 100);
            this.config.noiseSpeed = val;
            speedDisplay.textContent = `${Math.round(pct)}% (${val.toFixed(3)})`;
        });

        // Steps
        const stepsInput = body.querySelector('#param-steps');
        const stepsDisplay = body.querySelector('#val-display-steps');
        stepsInput.addEventListener('input', (e) => {
            const pct = parseFloat(e.target.value);
            const val = Math.max(2, Math.round(this.defaults.steps * (pct / 100)));
            this.config.steps = val;
            stepsDisplay.textContent = `${Math.round(pct)}% (${val})`;
        });

        // Octaves
        const octavesInput = body.querySelector('#param-octaves');
        const octavesDisplay = body.querySelector('#val-display-octaves');
        octavesInput.addEventListener('input', (e) => {
            const pct = parseFloat(e.target.value);
            const val = Math.min(4, Math.max(1, Math.round(this.defaults.octaves * (pct / 100))));
            this.config.octaves = val;
            octavesDisplay.textContent = `${Math.round(pct)}% (${val})`;
        });

        // Noise Colors
        const colorLowInput = body.querySelector('#param-color-low');
        const colorLowHex = body.querySelector('#val-display-color-low');
        const colorHighInput = body.querySelector('#param-color-high');
        const colorHighHex = body.querySelector('#val-display-color-high');

        if (colorLowInput) {
            colorLowInput.addEventListener('input', (e) => {
                this.config.colorLow = e.target.value;
                if (colorLowHex) colorLowHex.textContent = e.target.value.toUpperCase();
            });
        }

        if (colorHighInput) {
            colorHighInput.addEventListener('input', (e) => {
                this.config.colorHigh = e.target.value;
                if (colorHighHex) colorHighHex.textContent = e.target.value.toUpperCase();
            });
        }

        const presetBtns = body.querySelectorAll('.noise-preset-btn');
        presetBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const low = btn.dataset.low || '#000000';
                const high = btn.dataset.high || '#ffffff';
                this.config.colorLow = low;
                this.config.colorHigh = high;
                this.syncFromConfig();
            });
        });

        // Checkboxes
        const invertInput = body.querySelector('#param-invert');
        invertInput.addEventListener('change', (e) => {
            this.config.invert = e.target.checked;
        });

        const aspectInput = body.querySelector('#param-aspect');
        aspectInput.addEventListener('change', (e) => {
            this.config.maintainAspectRatio = e.target.checked;
        });

        // Reset button
        const resetBtn = body.querySelector('#btn-reset-params-default');
        resetBtn.addEventListener('click', () => {
            this.resetToDefaults();
        });
    }

    /**
     * Resets all noise parameters to 100% of default values.
     */
    resetToDefaults() {
        this.config.noiseSize = this.defaults.noiseSize;
        this.config.noiseSpeed = this.defaults.noiseSpeed;
        this.config.steps = this.defaults.steps;
        this.config.octaves = this.defaults.octaves;
        this.config.invert = this.defaults.invert;
        this.config.maintainAspectRatio = this.defaults.maintainAspectRatio;
        this.config.colorLow = this.defaults.colorLow;
        this.config.colorHigh = this.defaults.colorHigh;

        this.syncFromConfig();
    }

    /**
     * Synchronizes slider and checkbox controls from the current NoiseConfig.
     */
    syncFromConfig() {
        const body = this.window.getBodyElement();
        if (!body) return;

        // Calculate percentages from config vs defaults
        const sizePct = Math.round((this.config.noiseSize / this.defaults.noiseSize) * 100);
        const speedPct = Math.round((this.config.noiseSpeed / this.defaults.noiseSpeed) * 100);
        const stepsPct = Math.round((this.config.steps / this.defaults.steps) * 100);
        const octavesPct = Math.round((this.config.octaves / this.defaults.octaves) * 100);

        const sizeInput = body.querySelector('#param-noise-size');
        const sizeDisplay = body.querySelector('#val-display-size');
        if (sizeInput && sizeDisplay) {
            sizeInput.value = sizePct;
            sizeDisplay.textContent = `${sizePct}% (${this.config.noiseSize.toFixed(2)})`;
        }

        const speedInput = body.querySelector('#param-noise-speed');
        const speedDisplay = body.querySelector('#val-display-speed');
        if (speedInput && speedDisplay) {
            speedInput.value = speedPct;
            speedDisplay.textContent = `${speedPct}% (${this.config.noiseSpeed.toFixed(3)})`;
        }

        const stepsInput = body.querySelector('#param-steps');
        const stepsDisplay = body.querySelector('#val-display-steps');
        if (stepsInput && stepsDisplay) {
            stepsInput.value = stepsPct;
            stepsDisplay.textContent = `${stepsPct}% (${this.config.steps})`;
        }

        const octavesInput = body.querySelector('#param-octaves');
        const octavesDisplay = body.querySelector('#val-display-octaves');
        if (octavesInput && octavesDisplay) {
            octavesInput.value = octavesPct;
            octavesDisplay.textContent = `${octavesPct}% (${this.config.octaves})`;
        }

        const invertInput = body.querySelector('#param-invert');
        if (invertInput) {
            invertInput.checked = !!this.config.invert;
        }

        const aspectInput = body.querySelector('#param-aspect');
        if (aspectInput) {
            aspectInput.checked = !!this.config.maintainAspectRatio;
        }

        const colorLow = this.config.colorLow || this.defaults.colorLow;
        const colorHigh = this.config.colorHigh || this.defaults.colorHigh;

        const colorLowInput = body.querySelector('#param-color-low');
        const colorLowHex = body.querySelector('#val-display-color-low');
        if (colorLowInput) colorLowInput.value = colorLow;
        if (colorLowHex) colorLowHex.textContent = colorLow.toUpperCase();

        const colorHighInput = body.querySelector('#param-color-high');
        const colorHighHex = body.querySelector('#val-display-color-high');
        if (colorHighInput) colorHighInput.value = colorHigh;
        if (colorHighHex) colorHighHex.textContent = colorHigh.toUpperCase();
    }

    bindKeyboardShortcut() {
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            // Never toggle the params window while typing in inputs, textareas, or open modals
            const target = e.target;
            if (target) {
                const tag = target.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
                    return;
                }
                if (typeof target.closest === 'function' && target.closest('.custom-input-modal-backdrop.visible')) {
                    return;
                }
            }
            if (document.querySelector('.custom-input-modal-backdrop.visible')) {
                return;
            }

            if (e.key === 'h' || e.key === 'H') {
                this.toggle();
            }
        });
    }

    open() {
        this.syncFromConfig();
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
    window.ParamsManager = ParamsManager;
}
