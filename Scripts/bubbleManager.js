/**
 * Bubble Manager
 * ------------------------------------------------------------------
 * Handles bubble lifecycle (creation, deletion, locking, resetting)
 * and manages DOM representations scaled dynamically to window percentage.
 */

class BubbleManager {
    constructor(container, config) {
        this.container = container;
        this.config = config;
        this.connectionManager = null;
        this.bubbles = [];
        this.nextId = 1;

        this.currentDiameter = 0;
        this.currentOutlineWidth = 0;
        this.currentRadius = 0;

        this.calculateDimensions();
        window.addEventListener('resize', () => this.handleResize());
    }

    setConnectionManager(connectionManager) {
        this.connectionManager = connectionManager;
    }

    /**
     * Compute pixel sizes based on window percentage from config.
     */
    calculateDimensions() {
        const minDimension = Math.min(window.innerWidth, window.innerHeight);
        this.currentDiameter = Math.max(20, (minDimension * (this.config.bubbleSizePercent / 100)));
        this.currentRadius = this.currentDiameter / 2;
        this.currentOutlineWidth = Math.max(1, (this.currentDiameter * (this.config.outlineSizePercent / 100)));
    }

    handleResize() {
        this.calculateDimensions();
        for (const bubble of this.bubbles) {
            this.applyBubbleStyle(bubble);
        }
    }

    applyBubbleStyle(bubble) {
        const el = bubble.element;
        el.style.width = `${this.currentDiameter}px`;
        el.style.height = `${this.currentDiameter}px`;
        el.style.borderWidth = `${this.currentOutlineWidth}px`;
        el.style.borderColor = bubble.isLocked ? this.config.lockedOutlineColor : this.config.outlineColor;
        el.style.backgroundColor = this.config.bubbleColor;
    }

    /**
     * Creates and adds a new universe bubble.
     */
    createBubble(x, y) {
        this.calculateDimensions();

        // Clamp initial position to be inside window
        const clampedX = Math.max(this.currentRadius, Math.min(window.innerWidth - this.currentRadius, x));
        const clampedY = Math.max(this.currentRadius, Math.min(window.innerHeight - this.currentRadius, y));

        const id = this.nextId++;
        const el = document.createElement('div');
        el.className = 'universe-bubble';
        el.dataset.id = id;

        // Lock indicator icon (SVG)
        const lockIcon = document.createElement('div');
        lockIcon.className = 'bubble-lock-badge';
        lockIcon.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
        `;
        el.appendChild(lockIcon);

        const bubble = {
            id,
            x: clampedX,
            y: clampedY,
            vx: 0,
            vy: 0,
            isLocked: false,
            isDragging: false,
            element: el,
            lockBadge: lockIcon
        };

        this.applyBubbleStyle(bubble);
        this.updateElementPosition(bubble);

        this.container.appendChild(el);
        this.bubbles.push(bubble);

        return bubble;
    }

    /**
     * Remove a single bubble.
     */
    removeBubble(id) {
        const index = this.bubbles.findIndex(b => b.id === id);
        if (index !== -1) {
            const bubble = this.bubbles[index];
            bubble.element.classList.add('bubble-destroying');

            if (this.connectionManager) {
                this.connectionManager.removeConnectionsForBubble(id);
            }

            setTimeout(() => {
                if (bubble.element.parentNode) {
                    bubble.element.parentNode.removeChild(bubble.element);
                }
            }, 180);
            this.bubbles.splice(index, 1);
        }
    }

    /**
     * Toggles lock state on a bubble.
     */
    toggleLock(id) {
        const bubble = this.getBubbleById(id);
        if (!bubble) return;

        bubble.isLocked = !bubble.isLocked;
        bubble.vx = 0;
        bubble.vy = 0;

        if (bubble.isLocked) {
            bubble.element.classList.add('is-locked');
            bubble.element.style.borderColor = this.config.lockedOutlineColor;
        } else {
            bubble.element.classList.remove('is-locked');
            bubble.element.style.borderColor = this.config.outlineColor;
        }
    }

    /**
     * Deletes all bubbles on board.
     */
    resetBoard() {
        for (const bubble of this.bubbles) {
            bubble.element.classList.add('bubble-destroying');
        }
        if (this.connectionManager) {
            this.connectionManager.reset();
        }
        setTimeout(() => {
            this.container.innerHTML = '';
            this.bubbles = [];
        }, 180);
    }

    getBubbleById(id) {
        return this.bubbles.find(b => b.id === Number(id));
    }

    /**
     * Update DOM element transform.
     */
    updateElementPosition(bubble) {
        const r = this.currentRadius;
        bubble.element.style.transform = `translate3d(${bubble.x - r}px, ${bubble.y - r}px, 0)`;
    }
}

if (typeof window !== 'undefined') {
    window.BubbleManager = BubbleManager;
}
