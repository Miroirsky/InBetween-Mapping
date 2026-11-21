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
        this.savingManager = null;
        this.onlineManager = null;
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

    setSavingManager(savingManager) {
        this.savingManager = savingManager;
    }

    setOnlineManager(onlineManager) {
        this.onlineManager = onlineManager;
    }

    /**
     * Compute pixel sizes based on square board size (1000x1000 coordinate space).
     */
    calculateDimensions() {
        const boardSize = 1000;
        this.currentDiameter = Math.max(20, (boardSize * (this.config.bubbleSizePercent / 100)));
        this.currentRadius = this.currentDiameter / 2;
        this.currentOutlineWidth = Math.max(1, (this.currentDiameter * (this.config.outlineSizePercent / 100)));
    }

    handleResize() {
        // Dimensions inside the 1000x1000 coordinate space remain constant;
        // visual scaling is handled by CSS transform on the board frame.
        this.calculateDimensions();
    }

    /**
     * Calculates visible window viewport boundaries in 1000x1000 board coordinate space.
     * Allows elements to be placed and moved outside the main square while staying on-screen.
     */
    getViewportBounds(padding = 0) {
        const board = document.getElementById('board-frame');
        if (!board) {
            return { minX: 0 + padding, maxX: 1000 - padding, minY: 0 + padding, maxY: 1000 - padding };
        }
        const rect = board.getBoundingClientRect();
        const scale = rect.width / 1000 || 1;
        return {
            minX: (0 - rect.left) / scale + padding,
            maxX: (window.innerWidth - rect.left) / scale - padding,
            minY: (0 - rect.top) / scale + padding,
            maxY: (window.innerHeight - rect.top) / scale - padding
        };
    }

    hexToRgba(hex, alpha) {
        if (!hex || typeof hex !== 'string') return `rgba(0, 0, 0, ${alpha})`;
        let c = hex.replace('#', '').trim();
        if (c.length === 3) {
            c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
        }
        if (c.length !== 6) return `rgba(0, 0, 0, ${alpha})`;
        const num = parseInt(c, 16);
        if (isNaN(num)) return `rgba(0, 0, 0, ${alpha})`;
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    applyBubbleStyle(bubble) {
        const el = bubble.element;
        el.style.width = `${this.currentDiameter}px`;
        el.style.height = `${this.currentDiameter}px`;
        el.style.border = 'none';
        el.style.outline = 'none';

        const color = bubble.color || this.config.bubbleColor || '#000000';
        const c100 = this.hexToRgba(color, 1);
        const c0 = this.hexToRgba(color, 0);

        el.style.background = `radial-gradient(circle closest-side, ${c100} 0%, ${c0} 100%)`;

        if (bubble.nameElement) {
            const fontSize = Math.max(10, Math.min(18, Math.round(this.currentDiameter * 0.13)));
            bubble.nameElement.style.fontSize = `${fontSize}px`;
        }
    }

    /**
     * Creates and adds a new universe bubble.
     */
    createBubble(x, y, name = '', color = null, customId = null, isLocked = false) {
        this.calculateDimensions();

        // Clamp initial position to be inside the visible window viewport (allowing placement outside the main square)
        const bounds = this.getViewportBounds();
        let targetX = x;
        let targetY = y;

        if (bounds.maxX > bounds.minX + 2 * this.currentRadius) {
            targetX = Math.max(bounds.minX + this.currentRadius, Math.min(bounds.maxX - this.currentRadius, x));
        }
        if (bounds.maxY > bounds.minY + 2 * this.currentRadius) {
            targetY = Math.max(bounds.minY + this.currentRadius, Math.min(bounds.maxY - this.currentRadius, y));
        }

        const id = customId !== null ? Number(customId) : this.nextId++;
        if (customId !== null) {
            this.nextId = Math.max(this.nextId, id + 1);
        }

        const bubbleName = (name && typeof name === 'string' && name.trim().length > 0) ? name.trim() : `Universe ${id}`;
        const bubbleColor = color || this.config.bubbleColor || '#000000';

        const el = document.createElement('div');
        el.className = 'universe-bubble';
        el.dataset.id = id;

        // Name label
        const nameEl = document.createElement('span');
        nameEl.className = 'bubble-name';
        nameEl.textContent = bubbleName;
        nameEl.title = bubbleName;
        el.appendChild(nameEl);

        // Lock indicator icon (SVG)
        const lockIcon = document.createElement('div');
        lockIcon.className = 'bubble-lock-badge';
        lockIcon.innerHTML = `
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
        `;
        el.appendChild(lockIcon);

        const bubble = {
            id,
            name: bubbleName,
            color: bubbleColor,
            x: targetX,
            y: targetY,
            vx: 0,
            vy: 0,
            isLocked: !!isLocked,
            isDragging: false,
            element: el,
            nameElement: nameEl,
            lockBadge: lockIcon
        };

        if (bubble.isLocked) {
            el.classList.add('is-locked');
        }

        this.applyBubbleStyle(bubble);
        this.updateElementPosition(bubble);

        this.container.appendChild(el);
        this.bubbles.push(bubble);

        if (this.onlineManager && this.onlineManager.isOnline) {
            this.onlineManager.onBubbleCreated(bubble);
        }

        return bubble;
    }

    /**
     * Instantly clears all bubbles and connections without animation delay.
     * Useful for loading saved boards.
     */
    clearBoard() {
        if (this.connectionManager) {
            this.connectionManager.reset();
        }
        this.container.innerHTML = '';
        this.bubbles = [];
    }

    /**
     * Rename an existing bubble.
     */
    renameBubble(id, newName) {
        const bubble = this.getBubbleById(id);
        if (bubble && newName && typeof newName === 'string' && newName.trim().length > 0) {
            bubble.name = newName.trim();
            if (bubble.nameElement) {
                bubble.nameElement.textContent = bubble.name;
                bubble.nameElement.title = bubble.name;
            }
            if (this.onlineManager && this.onlineManager.isOnline) {
                this.onlineManager.onBubbleRenamed(bubble);
            }
            return true;
        }
        return false;
    }

    /**
     * Updates the color of a bubble and re-renders its radial transparency gradient.
     */
    setBubbleColor(id, newColor) {
        const bubble = this.getBubbleById(id);
        if (bubble && newColor) {
            bubble.color = newColor;
            this.applyBubbleStyle(bubble);
            if (this.onlineManager && this.onlineManager.isOnline) {
                this.onlineManager.onBubbleColorChanged(bubble);
            }
            return true;
        }
        return false;
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
            if (this.onlineManager && this.onlineManager.isOnline) {
                this.onlineManager.onBubbleRemoved(id);
            }
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
        } else {
            bubble.element.classList.remove('is-locked');
        }

        if (this.onlineManager && this.onlineManager.isOnline) {
            this.onlineManager.onBubbleLockChanged(bubble);
        }
    }

    /**
     * Deletes all bubbles on board.
     */
    resetBoard() {
        if (this.savingManager) {
            this.savingManager.clearActiveBoard();
        }
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

        if (this.onlineManager && this.onlineManager.isOnline) {
            this.onlineManager.onBoardReset();
        }
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
