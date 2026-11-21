/**
 * UI Controls Overlay
 * ------------------------------------------------------------------
 * Provides an interactive floating control panel to tweak noiseSize,
 * noiseSpeed, and steps live in real-time.
 */

class NoiseUI {
    constructor(config) {
        this.config = config;
        this.panel = null;
        this.visible = false;
        this.createPanel();
        this.bindKeyboardShortcut();
    }

    createPanel() {
        const panel = document.createElement('div');
        panel.id = 'noise-controls-panel';
        panel.innerHTML = `
            <div class="panel-header">
                <span class="panel-title">Noise Settings</span>
                <button id="toggle-panel-btn" title="Minimize / Expand">—</button>
            </div>
            <div class="panel-body" id="panel-body">
                <div class="control-group">
                    <div class="label-row">
                        <label for="input-noise-size">Noise Size</label>
                        <span id="val-noise-size" class="value-display">${this.config.noiseSize.toFixed(2)}</span>
                    </div>
                    <input type="range" id="input-noise-size" min="0.5" max="15.0" step="0.1" value="${this.config.noiseSize}">
                </div>

                <div class="control-group">
                    <div class="label-row">
                        <label for="input-noise-speed">Noise Speed</label>
                        <span id="val-noise-speed" class="value-display">${this.config.noiseSpeed.toFixed(2)}</span>
                    </div>
                    <input type="range" id="input-noise-speed" min="0.0" max="2.0" step="0.01" value="${this.config.noiseSpeed}">
                </div>

                <div class="control-group">
                    <div class="label-row">
                        <label for="input-steps">Shade Steps</label>
                        <span id="val-steps" class="value-display">${this.config.steps}</span>
                    </div>
                    <input type="range" id="input-steps" min="2" max="32" step="1" value="${this.config.steps}">
                </div>

                <div class="control-group">
                    <div class="label-row">
                        <label for="input-octaves">Octaves</label>
                        <span id="val-octaves" class="value-display">${this.config.octaves}</span>
                    </div>
                    <input type="range" id="input-octaves" min="1" max="4" step="1" value="${this.config.octaves}">
                </div>

                <div class="control-group checkbox-row">
                    <label>
                        <input type="checkbox" id="input-invert" ${this.config.invert ? 'checked' : ''}>
                        Invert Colors
                    </label>
                    <label>
                        <input type="checkbox" id="input-aspect" ${this.config.maintainAspectRatio ? 'checked' : ''}>
                        Keep Aspect
                    </label>
                </div>

                <div class="panel-hint">
                    Default values defined in: <br>
                    <code>Values/noiseConfig.js</code>
                </div>
            </div>
        `;

        document.body.appendChild(panel);
        this.panel = panel;
        this.bindEvents();
    }

    bindEvents() {
        const sizeInput = document.getElementById('input-noise-size');
        const sizeVal = document.getElementById('val-noise-size');
        sizeInput.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.config.noiseSize = val;
            sizeVal.textContent = val.toFixed(2);
        });

        const speedInput = document.getElementById('input-noise-speed');
        const speedVal = document.getElementById('val-noise-speed');
        speedInput.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.config.noiseSpeed = val;
            speedVal.textContent = val.toFixed(2);
        });

        const stepsInput = document.getElementById('input-steps');
        const stepsVal = document.getElementById('val-steps');
        stepsInput.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            this.config.steps = val;
            stepsVal.textContent = val;
        });

        const octavesInput = document.getElementById('input-octaves');
        const octavesVal = document.getElementById('val-octaves');
        octavesInput.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            this.config.octaves = val;
            octavesVal.textContent = val;
        });

        const invertInput = document.getElementById('input-invert');
        invertInput.addEventListener('change', (e) => {
            this.config.invert = e.target.checked;
        });

        const aspectInput = document.getElementById('input-aspect');
        aspectInput.addEventListener('change', (e) => {
            this.config.maintainAspectRatio = e.target.checked;
        });

        const toggleBtn = document.getElementById('toggle-panel-btn');
        const body = document.getElementById('panel-body');
        toggleBtn.addEventListener('click', () => {
            const isHidden = body.style.display === 'none';
            body.style.display = isHidden ? 'block' : 'none';
            toggleBtn.textContent = isHidden ? '—' : '+';
        });
    }

    bindKeyboardShortcut() {
        window.addEventListener('keydown', (e) => {
            if (e.key === 'h' || e.key === 'H') {
                const currentDisplay = window.getComputedStyle(this.panel).display;
                this.panel.style.display = (currentDisplay === 'none') ? 'block' : 'none';
            }
        });
    }
}

if (typeof window !== 'undefined') {
    window.NoiseUI = NoiseUI;
}
