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

        this.draggedBubble = null;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;

        this.bindEvents();
    }

    setConnectionManager(connectionManager) {
        this.connectionManager = connectionManager;
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

            // 3. Otherwise right-clicked in empty void
            this.contextMenu.showVoidMenu(e.clientX, e.clientY);
        });

        // Mouse down (Start drag or complete connection)
        window.addEventListener('mousedown', (e) => {
            // Only left mouse button
            if (e.button !== 0) return;

            // Check if connecting mode is active
            if (this.connectionManager && this.connectionManager.pendingSourceId) {
                const bubbleEl = e.target.closest('.universe-bubble');
                if (bubbleEl) {
                    const targetId = Number(bubbleEl.dataset.id);
                    const sourceId = this.connectionManager.pendingSourceId;

                    if (targetId !== sourceId) {
                        this.connectionManager.cancelConnecting();

                        // Prompt for mandatory connection name
                        this.contextMenu.showPrompt({
                            title: 'Name this Connection',
                            placeholder: 'e.g. Gravity Bridge, Wormhole, Orbit...',
                            defaultValue: '',
                            confirmText: 'Create Connection',
                            onSubmit: (name) => {
                                this.connectionManager.createConnection(sourceId, targetId, name);
                            }
                        });
                        return;
                    }
                }

                // If clicked outside or on same bubble, cancel connecting mode
                this.connectionManager.cancelConnecting();
                return;
            }

            const bubbleEl = e.target.closest('.universe-bubble');
            if (!bubbleEl) return;

            const bubbleId = Number(bubbleEl.dataset.id);
            const bubble = this.manager.getBubbleById(bubbleId);
            if (!bubble || bubble.isLocked) return;

            this.draggedBubble = bubble;
            bubble.isDragging = true;
            bubble.vx = 0;
            bubble.vy = 0;

            this.dragOffsetX = bubble.x - e.clientX;
            this.dragOffsetY = bubble.y - e.clientY;

            bubble.element.classList.add('is-dragging');
            document.body.classList.add('is-dragging-bubble');

            // Close context menu if open
            this.contextMenu.close();
        });

        // Mouse move (Update dragged position or connection preview line)
        window.addEventListener('mousemove', (e) => {
            // Update connection preview line if in connecting mode
            if (this.connectionManager && this.connectionManager.pendingSourceId) {
                this.connectionManager.updatePreview(e.clientX, e.clientY);
                return;
            }

            if (!this.draggedBubble) return;

            const radius = this.manager.currentRadius;
            const newX = e.clientX + this.dragOffsetX;
            const newY = e.clientY + this.dragOffsetY;

            // Keep within window boundaries while dragging
            const clampedX = Math.max(radius, Math.min(window.innerWidth - radius, newX));
            const clampedY = Math.max(radius, Math.min(window.innerHeight - radius, newY));

            this.draggedBubble.x = clampedX;
            this.draggedBubble.y = clampedY;
            this.draggedBubble.vx = 0;
            this.draggedBubble.vy = 0;

            this.manager.updateElementPosition(this.draggedBubble);
        });

        // Mouse up (End drag)
        window.addEventListener('mouseup', (e) => {
            if (this.draggedBubble) {
                this.draggedBubble.isDragging = false;
                this.draggedBubble.element.classList.remove('is-dragging');
                document.body.classList.remove('is-dragging-bubble');
                this.draggedBubble = null;
            }
        });

        // Cancel connecting mode on Escape
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.connectionManager && this.connectionManager.pendingSourceId) {
                this.connectionManager.cancelConnecting();
            }
        });
    }
}

if (typeof window !== 'undefined') {
    window.InteractionManager = InteractionManager;
}
