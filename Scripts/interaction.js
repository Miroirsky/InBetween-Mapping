/**
 * Interaction Manager
 * ------------------------------------------------------------------
 * Handles mouse interactions: dragging bubbles, hover states,
 * dynamic cursor changes, connection creation workflows, and
 * routing right-clicks to the appropriate context menus.
 */

class InteractionManager {
    constructor(bubbleManager, contextMenu, connectionManager) {
        this.manager = bubbleManager;
        this.contextMenu = contextMenu;
        this.connectionManager = connectionManager || null;
        this.noiseRenderer = null;

        this.draggedBubble = null;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;

        // Pan and Zoom camera transform
        this.panX = 0;
        this.panY = 0;
        this.zoom = 1.0;

        this.isPanning = false;
        this.panStartX = 0;
        this.panStartY = 0;
        this.initialPanX = 0;
        this.initialPanY = 0;

        this.bindEvents();
    }

    setConnectionManager(connectionManager) {
        this.connectionManager = connectionManager;
    }

    setNoiseRenderer(renderer) {
        this.noiseRenderer = renderer;
        this.applyViewTransform();
    }

    /**
     * Updates CSS custom properties and shader uniforms to keep board and background in sync.
     */
    applyViewTransform() {
        const minDim = Math.min(window.innerWidth, window.innerHeight);
        const baseScale = minDim / 1000;
        const totalScale = baseScale * this.zoom;

        document.documentElement.style.setProperty('--board-scale', totalScale);
        document.documentElement.style.setProperty('--board-pan-x', `${this.panX}px`);
        document.documentElement.style.setProperty('--board-pan-y', `${this.panY}px`);

        if (this.noiseRenderer) {
            this.noiseRenderer.setPanAndZoom(this.panX, this.panY, this.zoom);
        }
    }

    /**
     * Resets camera pan and zoom back to default center.
     */
    resetView() {
        this.panX = 0;
        this.panY = 0;
        this.zoom = 1.0;
        this.applyViewTransform();
    }

    /**
     * Converts browser screen coordinates (clientX, clientY)
     * to the 1000x1000 square board coordinate space.
     */
    getBoardCoords(clientX, clientY) {
        const board = document.getElementById('board-frame');
        if (!board) return { x: clientX, y: clientY };
        const rect = board.getBoundingClientRect();
        const scale = rect.width / 1000;
        return {
            x: (clientX - rect.left) / scale,
            y: (clientY - rect.top) / scale
        };
    }

    bindEvents() {
        // Prevent default browser right-click menu and show custom context menus
        window.addEventListener('contextmenu', (e) => {
            e.preventDefault();

            // If in connecting mode, right click cancels it
            if (this.connectionManager && this.connectionManager.pendingSourceId) {
                this.connectionManager.cancelConnecting();
                return;
            }

            const boardCoords = this.getBoardCoords(e.clientX, e.clientY);

            // 1. Check if right-clicked on a connection line/label
            const connEl = e.target.closest('.universe-connection');
            if (connEl) {
                const connectionId = Number(connEl.dataset.id);
                this.contextMenu.showConnectionMenu(e.clientX, e.clientY, connectionId);
                return;
            }

            // 2. Check if right-clicked on a universe bubble
            const bubbleEl = e.target.closest('.universe-bubble');
            if (bubbleEl) {
                const bubbleId = Number(bubbleEl.dataset.id);
                this.contextMenu.showBubbleMenu(e.clientX, e.clientY, bubbleId);
                return;
            }

            // 3. Ignore right-clicks inside UI panels, floating windows, menus, or modals
            if (e.target.closest('.floating-window, .view-menu-container, .view-menu-dropdown, .custom-input-modal-backdrop, .custom-context-menu, .active-board-widget, #noise-controls-panel, button, input')) {
                return;
            }

            // 4. Otherwise right-clicked in empty void
            this.contextMenu.showVoidMenu(boardCoords.x, boardCoords.y, e.clientX, e.clientY);
        });

        // Mouse down (Start bubble drag, background pan, or complete connection)
        window.addEventListener('mousedown', (e) => {
            // Only left mouse button
            if (e.button !== 0) return;

            // If clicked on UI panels, menus, modals, floating windows, buttons, or inputs, ignore completely
            if (e.target.closest(
                '.custom-context-menu, ' +
                '.custom-input-modal-backdrop, ' +
                '.floating-window, ' +
                '.view-menu-container, ' +
                '.view-menu-dropdown, ' +
                '.active-board-widget, ' +
                '#noise-controls-panel, ' +
                'button, input, select, textarea, label, a'
            )) {
                return;
            }

            // If context menu is currently open and user clicked outside it, simply dismiss it without moving the board
            if (this.contextMenu && this.contextMenu.isOpen) {
                this.contextMenu.close();
                return;
            }

            const boardCoords = this.getBoardCoords(e.clientX, e.clientY);

            // Check if connecting mode is active
            if (this.connectionManager && this.connectionManager.pendingSourceId) {
                const bubbleEl = e.target.closest('.universe-bubble');
                if (bubbleEl) {
                    const targetId = Number(bubbleEl.dataset.id);
                    const sourceId = this.connectionManager.pendingSourceId;

                    if (targetId !== sourceId) {
                        this.connectionManager.cancelConnecting();

                        // Automatically create connection with default name (not asked on creation, still editable later)
                        this.connectionManager.createConnection(sourceId, targetId);
                        return;
                    }
                }

                // If clicked outside or on same bubble, cancel connecting mode
                this.connectionManager.cancelConnecting();
                return;
            }

            // Check if clicked on a universe bubble to drag it
            const bubbleEl = e.target.closest('.universe-bubble');
            if (bubbleEl) {
                const bubbleId = Number(bubbleEl.dataset.id);
                const bubble = this.manager.getBubbleById(bubbleId);
                if (!bubble || bubble.isLocked) return;

                this.draggedBubble = bubble;
                bubble.isDragging = true;
                bubble.vx = 0;
                bubble.vy = 0;

                this.dragOffsetX = bubble.x - boardCoords.x;
                this.dragOffsetY = bubble.y - boardCoords.y;

                bubble.element.classList.add('is-dragging');
                document.body.classList.add('is-dragging-bubble');

                // Close context menu if open
                this.contextMenu.close();
                return;
            }

            // Check if clicked on a connection line/label
            const connEl = e.target.closest('.universe-connection');
            if (connEl) return;

            // Otherwise, clicked on background void: start background panning!
            this.isPanning = true;
            this.panStartX = e.clientX;
            this.panStartY = e.clientY;
            this.initialPanX = this.panX;
            this.initialPanY = this.panY;
            document.body.classList.add('is-panning-background');

            // Close context menu if open
            this.contextMenu.close();
        });

        // Mouse move (Update dragged bubble position, background pan, or connection preview line)
        window.addEventListener('mousemove', (e) => {
            const boardCoords = this.getBoardCoords(e.clientX, e.clientY);

            // Update connection preview line if in connecting mode
            if (this.connectionManager && this.connectionManager.pendingSourceId) {
                this.connectionManager.updatePreview(boardCoords.x, boardCoords.y);
                return;
            }

            // Handle background panning
            if (this.isPanning) {
                const dx = e.clientX - this.panStartX;
                const dy = e.clientY - this.panStartY;
                this.panX = this.initialPanX + dx;
                this.panY = this.initialPanY + dy;
                this.applyViewTransform();
                return;
            }

            // Handle dragged bubble
            if (this.draggedBubble) {
                const newX = boardCoords.x + this.dragOffsetX;
                const newY = boardCoords.y + this.dragOffsetY;

                this.draggedBubble.x = newX;
                this.draggedBubble.y = newY;
                this.draggedBubble.vx = 0;
                this.draggedBubble.vy = 0;

                this.manager.updateElementPosition(this.draggedBubble);

                if (this.manager.onlineManager && this.manager.onlineManager.isOnline) {
                    this.manager.onlineManager.onBubbleDrag(this.draggedBubble);
                }
                return;
            }

            // Normal hover: check if hovering near any connection line or label
            if (this.connectionManager) {
                this.connectionManager.checkHover(boardCoords.x, boardCoords.y);
            }
        });

        // Mouse up (End bubble drag or background pan)
        window.addEventListener('mouseup', (e) => {
            if (this.draggedBubble) {
                const bubble = this.draggedBubble;
                bubble.isDragging = false;
                bubble.element.classList.remove('is-dragging');
                document.body.classList.remove('is-dragging-bubble');
                this.draggedBubble = null;

                if (this.manager.onlineManager && this.manager.onlineManager.isOnline) {
                    this.manager.onlineManager.onBubbleDragEnd(bubble);
                }
            }

            if (this.isPanning) {
                this.isPanning = false;
                document.body.classList.remove('is-panning-background');
            }
        });

        // Mouse wheel zoom (zoom towards cursor position)
        window.addEventListener('wheel', (e) => {
            // Ignore if scrolling inside a floating window, view menu, modal, or context menu
            if (e.target.closest('.floating-window, .view-menu-container, .view-menu-dropdown, .custom-input-modal-backdrop, .custom-context-menu')) {
                return;
            }

            e.preventDefault();

            const zoomFactor = e.deltaY < 0 ? 1.08 : (1 / 1.08);
            const minZoom = 0.15;
            const maxZoom = 8.0;
            const newZoom = Math.max(minZoom, Math.min(maxZoom, this.zoom * zoomFactor));

            if (newZoom === this.zoom) return;

            const k = newZoom / this.zoom;
            const screenCenterX = window.innerWidth * 0.5;
            const screenCenterY = window.innerHeight * 0.5;

            // Zoom centered at mouse cursor position
            this.panX = e.clientX - k * (e.clientX - (screenCenterX + this.panX)) - screenCenterX;
            this.panY = e.clientY - k * (e.clientY - (screenCenterY + this.panY)) - screenCenterY;
            this.zoom = newZoom;

            this.applyViewTransform();
        }, { passive: false });

        // Cancel connecting mode on Escape
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.connectionManager && this.connectionManager.pendingSourceId) {
                this.connectionManager.cancelConnecting();
            }
        });

        // Double click to quickly edit name (bubbles or connections)
        window.addEventListener('dblclick', (e) => {
            const bubbleEl = e.target.closest('.universe-bubble');
            if (bubbleEl) {
                const bubbleId = Number(bubbleEl.dataset.id);
                const bubble = this.manager.getBubbleById(bubbleId);
                if (bubble) {
                    this.contextMenu.showPrompt({
                        title: 'Edit Universe Name',
                        placeholder: 'Enter universe name...',
                        defaultValue: bubble.name,
                        confirmText: 'Update',
                        onSubmit: (newName) => {
                            this.manager.renameBubble(bubbleId, newName);
                        }
                    });
                    return;
                }
            }

            const connEl = e.target.closest('.universe-connection');
            if (connEl && this.connectionManager) {
                const connectionId = Number(connEl.dataset.id);
                const conn = this.connectionManager.getConnectionById(connectionId);
                if (conn) {
                    this.contextMenu.showPrompt({
                        title: 'Edit Connection Name',
                        placeholder: 'Enter connection name...',
                        defaultValue: conn.name,
                        confirmText: 'Update',
                        onSubmit: (newName) => {
                            this.connectionManager.renameConnection(connectionId, newName);
                        }
                    });
                    return;
                }
            }
        });
    }
}

if (typeof window !== 'undefined') {
    window.InteractionManager = InteractionManager;
}
