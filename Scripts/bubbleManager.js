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

    /**
     * Snaps a raw scale multiplier to steps of 20% (0.2) of the default bubble's size.
     */
    snapScale(rawScale) {
        const val = Number(rawScale);
        if (!Number.isFinite(val) || val <= 0) return 1.0;
        const stepPercent = (this.config && Number(this.config.sizeSnapPercent)) || 20;
        const step = stepPercent / 100; // 0.2 = 20%
        const minScale = (this.config && Number(this.config.minScale)) || 0.2;
        const maxScale = (this.config && Number(this.config.maxScale)) || 4.0;
        const snapped = Math.round(val / step) * step;
        return Math.max(minScale, Math.min(maxScale, Math.round(snapped * 100) / 100));
    }

    getBubbleScale(bubble) {
        if (!bubble || !Number.isFinite(Number(bubble.scale)) || Number(bubble.scale) <= 0) {
            return 1.0;
        }
        return Number(bubble.scale);
    }

    getBubbleDiameter(bubble) {
        return this.currentDiameter * this.getBubbleScale(bubble);
    }

    getBubbleRadius(bubble) {
        return this.currentRadius * this.getBubbleScale(bubble);
    }

    applyBubbleStyle(bubble) {
        const el = bubble.element;
        const scale = this.getBubbleScale(bubble);
        const diameter = this.getBubbleDiameter(bubble);

        el.style.width = `${diameter}px`;
        el.style.height = `${diameter}px`;
        el.style.border = 'none';
        el.style.outline = 'none';

        const color = bubble.color || this.config.bubbleColor || '#000000';
        const c100 = this.hexToRgba(color, 1);
        const c0 = this.hexToRgba(color, 0);

        el.style.background = `radial-gradient(circle closest-side, ${c100} 0%, ${c0} 100%)`;

        if (bubble.nameElement) {
            const fontSize = Math.max(8, Math.min(28, Math.round(diameter * 0.13)));
            bubble.nameElement.style.fontSize = `${fontSize}px`;
        }

        if (bubble.sizeBadge) {
            bubble.sizeBadge.textContent = `${Math.round(scale * 100)}%`;
        }
    }

    /**
     * Updates the scale of a bubble (snapped to 20% increments of default bubble size).
     */
    setBubbleScale(id, newScale, syncOnline = true) {
        const bubble = this.getBubbleById(id);
        if (!bubble) return false;

        const snapped = this.snapScale(newScale);
        if (bubble.scale === snapped) return false;

        bubble.scale = snapped;
        this.applyBubbleStyle(bubble);
        this.updateElementPosition(bubble);

        if (this.connectionManager) {
            this.connectionManager.render();
        }

        if (syncOnline && this.onlineManager && this.onlineManager.isOnline) {
            this.onlineManager.onBubbleDrag(bubble);
        }

        return true;
    }

    /**
     * Recalculates nextId from current bubbles so it is always a valid positive integer.
     */
    syncNextId() {
        let maxId = 0;
        for (const b of this.bubbles) {
            const num = Number(b.id);
            if (Number.isFinite(num) && num > maxId) {
                maxId = Math.floor(num);
            }
        }
        this.nextId = maxId + 1;
        return this.nextId;
    }

    /**
     * Creates and adds a new universe bubble.
     */
    createBubble(x, y, name = '', color = null, customId = null, isLocked = false, scale = 1.0) {
        this.calculateDimensions();

        const bubbleScale = this.snapScale(scale);
        const bubbleRadius = this.currentRadius * bubbleScale;

        let targetX = Number.isFinite(Number(x)) ? Number(x) : 500;
        let targetY = Number.isFinite(Number(y)) ? Number(y) : 500;

        const hasValidCustomId = customId !== null && customId !== undefined && customId !== '' && Number.isFinite(Number(customId)) && Number(customId) > 0;
        const isRemoteOrRestore = hasValidCustomId || (this.onlineManager && this.onlineManager.isApplyingRemote);

        // Only clamp initial position to current viewport when user manually creates a new bubble
        if (!isRemoteOrRestore) {
            const bounds = this.getViewportBounds();
            if (bounds.maxX > bounds.minX + 2 * bubbleRadius) {
                targetX = Math.max(bounds.minX + bubbleRadius, Math.min(bounds.maxX - bubbleRadius, targetX));
            }
            if (bounds.maxY > bounds.minY + 2 * bubbleRadius) {
                targetY = Math.max(bounds.minY + bubbleRadius, Math.min(bounds.maxY - bubbleRadius, targetY));
            }
        }

        this.syncNextId();
        const id = hasValidCustomId ? Math.floor(Number(customId)) : this.nextId;

        // Prevent duplicate bubble IDs
        const existing = this.getBubbleById(id);
        if (existing) {
            existing.x = targetX;
            existing.y = targetY;
            existing.vx = 0;
            existing.vy = 0;
            existing.scale = bubbleScale;
            if (name && typeof name === 'string' && name.trim().length > 0) {
                existing.name = name.trim();
                if (existing.nameElement) {
                    existing.nameElement.textContent = existing.name;
                    existing.nameElement.title = existing.name;
                }
            }
            if (color) {
                existing.color = color;
            }
            existing.isLocked = !!isLocked;
            if (existing.isLocked) {
                existing.element.classList.add('is-locked');
            } else {
                existing.element.classList.remove('is-locked');
            }
            this.applyBubbleStyle(existing);
            this.updateElementPosition(existing);
            this.syncNextId();
            return existing;
        }

        const bubbleName = (name && typeof name === 'string' && name.trim().length > 0 && !name.includes('NaN'))
            ? name.trim()
            : `Universe ${id}`;
        const bubbleColor = color || this.config.bubbleColor || '#000000';

        const el = document.createElement('div');
        el.className = 'universe-bubble';
        el.dataset.id = id;

        // Interactive resize outline ring (appears when hovered)
        const outlineEl = document.createElement('div');
        outlineEl.className = 'bubble-resize-outline';
        el.appendChild(outlineEl);

        // Live size percentage badge (appears while resizing)
        const sizeBadgeEl = document.createElement('div');
        sizeBadgeEl.className = 'bubble-size-badge';
        sizeBadgeEl.textContent = `${Math.round(bubbleScale * 100)}%`;
        el.appendChild(sizeBadgeEl);

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
            scale: bubbleScale,
            isLocked: !!isLocked,
            isDragging: false,
            isResizing: false,
            element: el,
            outlineElement: outlineEl,
            sizeBadge: sizeBadgeEl,
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
        this.syncNextId();

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
        this.nextId = 1;
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
        const targetId = Number(id);
        const index = this.bubbles.findIndex(b => b.id === targetId || (Number.isNaN(targetId) && Number.isNaN(b.id)));
        if (index !== -1) {
            const bubble = this.bubbles[index];
            this.bubbles.splice(index, 1);
            this.syncNextId();

            if (this.connectionManager) {
                this.connectionManager.removeConnectionsForBubble(targetId);
            }

            if (this.onlineManager && this.onlineManager.isOnline) {
                this.onlineManager.onBubbleRemoved(targetId);
            }

            if (this.onlineManager && this.onlineManager.isApplyingRemote) {
                if (bubble.element && bubble.element.parentNode) {
                    bubble.element.parentNode.removeChild(bubble.element);
                }
            } else {
                bubble.element.classList.add('bubble-destroying');
                setTimeout(() => {
                    if (bubble.element && bubble.element.parentNode) {
                        bubble.element.parentNode.removeChild(bubble.element);
                    }
                }, 180);
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
        const isOnline = !!(this.onlineManager && this.onlineManager.isOnline);
        if (this.savingManager && !isOnline) {
            this.savingManager.clearActiveBoard();
        }

        const oldElements = this.bubbles.map(b => b.element);
        this.bubbles = [];
        this.nextId = 1;

        if (this.connectionManager) {
            this.connectionManager.reset();
        }

        for (const el of oldElements) {
            if (el) el.classList.add('bubble-destroying');
        }
        setTimeout(() => {
            for (const el of oldElements) {
                if (el && el.parentNode) {
                    el.parentNode.removeChild(el);
                }
            }
        }, 180);

        if (isOnline) {
            this.onlineManager.onBoardReset();
        }
    }

    getBubbleById(id) {
        const numId = Number(id);
        if (!Number.isFinite(numId)) return undefined;
        return this.bubbles.find(b => b.id === numId);
    }

    /**
     * Update DOM element transform.
     */
    updateElementPosition(bubble) {
        const r = this.getBubbleRadius(bubble);
        bubble.element.style.transform = `translate3d(${bubble.x - r}px, ${bubble.y - r}px, 0)`;
    }
}

if (typeof window !== 'undefined') {
    window.BubbleManager = BubbleManager;
}
