/**
 * Floating Window Manager
 * ------------------------------------------------------------------
 * Reusable, draggable, closable, and reducible glassmorphic window
 * with dynamic z-index stacking and viewport boundary clamping.
 */

class FloatingWindow {
    static topZIndex = 200;

    constructor(options = {}) {
        this.id = options.id || `window-${Math.random().toString(36).substr(2, 9)}`;
        this.title = options.title || 'Window';
        this.width = options.width || 300;
        this.defaultTop = options.defaultTop !== undefined ? options.defaultTop : 60;
        this.defaultLeft = options.defaultLeft !== undefined ? options.defaultLeft : 20;
        this.contentHTML = options.contentHTML || '';
        this.onClose = options.onClose || null;

        this.isOpen = false;
        this.isReduced = false;

        this.element = null;
        this.header = null;
        this.body = null;
        this.titleEl = null;
        this.btnMinimize = null;
        this.btnClose = null;

        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.initialWindowX = 0;
        this.initialWindowY = 0;

        this.initDOM();
        this.initDrag();
    }

    initDOM() {
        const win = document.createElement('div');
        win.id = this.id;
        win.className = 'floating-window';
        win.style.width = `${this.width}px`;
        win.style.top = `${this.defaultTop}px`;
        win.style.left = `${this.defaultLeft}px`;
        win.style.display = 'none';

        win.innerHTML = `
            <div class="panel-header window-drag-handle">
                <span class="panel-title">${this.title}</span>
                <div class="window-header-actions">
                    <button class="panel-action-btn panel-btn-minimize" title="Minimize / Expand">—</button>
                    <button class="panel-action-btn panel-btn-close" title="Close">×</button>
                </div>
            </div>
            <div class="panel-body window-content-body">
                ${this.contentHTML}
            </div>
        `;

        document.body.appendChild(win);

        this.element = win;
        this.header = win.querySelector('.window-drag-handle');
        this.body = win.querySelector('.window-content-body');
        this.titleEl = win.querySelector('.panel-title');
        this.btnMinimize = win.querySelector('.panel-btn-minimize');
        this.btnClose = win.querySelector('.panel-btn-close');

        // Minimize / Expand button
        this.btnMinimize.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleReduce();
        });

        // Close button
        this.btnClose.addEventListener('click', (e) => {
            e.stopPropagation();
            this.close();
        });

        // Bring to front on click
        win.addEventListener('mousedown', () => {
            this.bringToFront();
        });
    }

    initDrag() {
        const onMouseMove = (e) => {
            if (!this.isDragging) return;

            const dx = e.clientX - this.dragStartX;
            const dy = e.clientY - this.dragStartY;

            let newX = this.initialWindowX + dx;
            let newY = this.initialWindowY + dy;

            // Clamping so window doesn't get dragged off-screen
            const winW = window.innerWidth;
            const winH = window.innerHeight;
            const elRect = this.element.getBoundingClientRect();

            const minX = 0;
            const maxX = Math.max(0, winW - 60);
            const minY = 0;
            const maxY = Math.max(0, winH - 35);

            newX = Math.max(minX, Math.min(maxX, newX));
            newY = Math.max(minY, Math.min(maxY, newY));

            this.element.style.left = `${newX}px`;
            this.element.style.top = `${newY}px`;
            this.element.style.right = 'auto';
            this.element.style.bottom = 'auto';
        };

        const onMouseUp = () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.header.classList.remove('is-dragging');
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            }
        };

        this.header.addEventListener('mousedown', (e) => {
            // Only left mouse button and not on action buttons
            if (e.button !== 0 || e.target.closest('.panel-action-btn')) return;

            this.bringToFront();
            this.isDragging = true;
            this.header.classList.add('is-dragging');

            const rect = this.element.getBoundingClientRect();
            this.dragStartX = e.clientX;
            this.dragStartY = e.clientY;
            this.initialWindowX = rect.left;
            this.initialWindowY = rect.top;

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    bringToFront() {
        FloatingWindow.topZIndex += 1;
        this.element.style.zIndex = FloatingWindow.topZIndex;
    }

    open() {
        this.bringToFront();
        this.element.style.display = 'block';
        this.isOpen = true;
        this.element.classList.add('is-visible');

        // Check if window is partially off-screen (e.g. after window resize)
        const rect = this.element.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            this.element.style.left = `${Math.max(10, window.innerWidth - rect.width - 20)}px`;
        }
        if (rect.bottom > window.innerHeight && !this.isReduced) {
            this.element.style.top = `${Math.max(10, window.innerHeight - rect.height - 20)}px`;
        }
    }

    close() {
        this.element.style.display = 'none';
        this.isOpen = false;
        this.element.classList.remove('is-visible');
        if (typeof this.onClose === 'function') {
            this.onClose();
        }
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    toggleReduce() {
        this.isReduced = !this.isReduced;
        if (this.isReduced) {
            this.body.style.display = 'none';
            this.btnMinimize.textContent = '+';
            this.btnMinimize.title = 'Expand';
            this.element.classList.add('is-reduced');
        } else {
            this.body.style.display = 'block';
            this.btnMinimize.textContent = '—';
            this.btnMinimize.title = 'Minimize';
            this.element.classList.remove('is-reduced');
        }
    }

    getBodyElement() {
        return this.body;
    }

    setBodyHTML(html) {
        this.body.innerHTML = html;
    }
}

if (typeof window !== 'undefined') {
    window.FloatingWindow = FloatingWindow;
}
