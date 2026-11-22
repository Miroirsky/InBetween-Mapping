/**
 * Interaction Manager
 * ------------------------------------------------------------------
 * Handles mouse interactions: dragging bubbles, hover states,
 * dynamic cursor changes, connection creation workflows, and
 * routing right-clicks to the appropriate context menus.
 */

class InteractionManager {
    constructor(bubbleManager, contextMenu, connectionManager, commentManager = null) {
        this.manager = bubbleManager;
        this.contextMenu = contextMenu;
        this.connectionManager = connectionManager || null;
        this.commentManager = commentManager || null;
        this.noiseRenderer = null;

        // Single & Multi-Bubble Drag State
        this.draggedBubble = null;
        this.draggedBubbles = []; // Array of { bubble, offsetX, offsetY }
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;

        // Comment Drag State
        this.draggedComment = null;
        this.commentDragOffsetX = 0;
        this.commentDragOffsetY = 0;
        this.commentDragStartClientX = 0;
        this.commentDragStartClientY = 0;
        this.commentDragMoved = false;

        // Bubble Outline Hover & Resize State
        this.hoveredBubble = null;
        this.hoveredOutlineBubble = null;
        this.resizingBubble = null;
        this.resizingGroup = []; // Array of { bubble, initialScale }
        this.resizeInitialScale = 1.0;
        this.resizeInitialDist = 50;

        // Arrow Length Adjustment State (click & drag outward to scale)
        this.potentialArrowResize = null;
        this.isDraggingArrowLength = false;

        // Multi-Bubble Selection State (Right-click & drag marquee)
        this.selectedBubbleIds = new Set();
        this.isRightMouseDown = false;
        this.isSelecting = false;
        this.suppressNextContextMenu = false;
        this.selectStartClientX = 0;
        this.selectStartClientY = 0;
        this.selectStartBoardX = 0;
        this.selectStartBoardY = 0;
        this.selectAdditive = false;
        this.initialSelectionBeforeDrag = new Set();
        this.selectionBoxEl = null;
        this.groupFrameEl = null;
        this.groupBadgeEl = null;
        this.groupBounds = null;

        // Pan and Zoom camera transform
        this.panX = 0;
        this.panY = 0;
        this.zoom = 1.0;

        this.isPanning = false;
        this.panMoved = false;
        this.panStartX = 0;
        this.panStartY = 0;
        this.initialPanX = 0;
        this.initialPanY = 0;

        this.createSelectionDOM();
        this.hookManagerCallbacks();
        this.bindEvents();
    }

    /**
     * Creates the screen-space selection marquee box and the board-space group frame.
     */
    createSelectionDOM() {
        // 1. Screen-space marquee rectangle shown while right-click dragging
        const marquee = document.createElement('div');
        marquee.id = 'selection-marquee';
        marquee.className = 'selection-marquee';
        document.body.appendChild(marquee);
        this.selectionBoxEl = marquee;

        // 2. Board-space bounding box around selected bubbles (when 2+ selected)
        const boardFrame = document.getElementById('board-frame');
        if (boardFrame) {
            const groupFrame = document.createElement('div');
            groupFrame.id = 'group-selection-frame';
            groupFrame.className = 'group-selection-frame';

            const badge = document.createElement('div');
            badge.className = 'group-selection-badge';
            badge.innerHTML = `
                <span class="group-badge-label">Selected • Drag to move</span>
                <button type="button" class="group-badge-btn" style="display: none;" title="Set perfect length for all connections in this selection">
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <circle cx="12" cy="12" r="6"></circle>
                        <circle cx="12" cy="12" r="2"></circle>
                    </svg>
                    <span>Perfect Length</span>
                </button>
            `;
            groupFrame.appendChild(badge);

            boardFrame.appendChild(groupFrame);
            this.groupFrameEl = groupFrame;
            this.groupBadgeEl = badge;
            this.groupBadgeLabel = badge.querySelector('.group-badge-label');
            this.groupBadgeBtn = badge.querySelector('.group-badge-btn');

            if (this.groupBadgeBtn) {
                this.groupBadgeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.connectionManager && this.selectedBubbleIds.size > 0) {
                        this.connectionManager.setSelectionConnectionsToOptimalLength(this.selectedBubbleIds);
                        if (this.manager.savingManager) {
                            this.manager.savingManager.saveSessionSnapshot();
                        }
                        if (window.app && window.app.displayManager) {
                            window.app.displayManager.syncUI();
                        }
                    }
                });
            }
        }
    }

    /**
     * Hooks into BubbleManager position and removal updates so selection visuals stay in sync.
     */
    hookManagerCallbacks() {
        if (!this.manager) return;

        const origUpdatePos = this.manager.updateElementPosition.bind(this.manager);
        this.manager.updateElementPosition = (bubble) => {
            origUpdatePos(bubble);
            if (bubble && this.selectedBubbleIds.has(bubble.id)) {
                this.updateGroupSelectionFrame();
            }
        };

        const origRemove = this.manager.removeBubble.bind(this.manager);
        this.manager.removeBubble = (id) => {
            this.deselectBubble(Number(id));
            origRemove(id);
            this.updateGroupSelectionFrame();
        };

        const origClear = this.manager.clearBoard.bind(this.manager);
        this.manager.clearBoard = () => {
            this.clearSelection();
            origClear();
        };

        const origReset = this.manager.resetBoard.bind(this.manager);
        this.manager.resetBoard = () => {
            this.clearSelection();
            origReset();
        };
    }

    /**
     * Selects a bubble by ID and updates its visual state.
     */
    selectBubble(id, updateFrame = true) {
        const bubble = this.manager.getBubbleById(id);
        if (!bubble) return;
        this.selectedBubbleIds.add(bubble.id);
        bubble.isSelected = true;
        if (bubble.element) {
            bubble.element.classList.add('is-selected');
        }
        if (updateFrame) {
            this.updateGroupSelectionFrame();
        }
    }

    /**
     * Deselects a bubble by ID and updates its visual state.
     */
    deselectBubble(id, updateFrame = true) {
        const numId = Number(id);
        this.selectedBubbleIds.delete(numId);
        const bubble = this.manager.getBubbleById(numId);
        if (bubble) {
            bubble.isSelected = false;
            if (bubble.element) {
                bubble.element.classList.remove('is-selected');
            }
        }
        if (updateFrame) {
            this.updateGroupSelectionFrame();
        }
    }

    /**
     * Clears all selected bubbles.
     */
    clearSelection() {
        for (const id of this.selectedBubbleIds) {
            const bubble = this.manager.getBubbleById(id);
            if (bubble) {
                bubble.isSelected = false;
                if (bubble.element) {
                    bubble.element.classList.remove('is-selected');
                }
            }
        }
        this.selectedBubbleIds.clear();
        this.updateGroupSelectionFrame();
    }

    /**
     * Returns array of currently selected valid bubble objects.
     */
    getSelectedBubbles() {
        const selected = [];
        for (const id of Array.from(this.selectedBubbleIds)) {
            const b = this.manager.getBubbleById(id);
            if (b) {
                selected.push(b);
            } else {
                this.selectedBubbleIds.delete(id);
            }
        }
        return selected;
    }

    /**
     * Updates the board-space bounding frame surrounding multiple selected bubbles.
     */
    updateGroupSelectionFrame() {
        if (!this.groupFrameEl) return;

        const selected = this.getSelectedBubbles();
        if (selected.length < 2) {
            this.groupFrameEl.classList.remove('visible');
            this.groupBounds = null;
            document.body.classList.remove('is-hovering-selection-group');
            return;
        }

        const defaultR = this.manager.currentRadius || 40;
        const pad = 12;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const b of selected) {
            const r = typeof this.manager.getBubbleRadius === 'function'
                ? this.manager.getBubbleRadius(b)
                : defaultR;
            if (b.x - r < minX) minX = b.x - r;
            if (b.y - r < minY) minY = b.y - r;
            if (b.x + r > maxX) maxX = b.x + r;
            if (b.y + r > maxY) maxY = b.y + r;
        }

        minX -= pad;
        minY -= pad;
        maxX += pad;
        maxY += pad;

        this.groupBounds = { minX, minY, maxX, maxY };

        this.groupFrameEl.style.transform = `translate3d(${minX}px, ${minY}px, 0)`;
        this.groupFrameEl.style.width = `${Math.max(0, maxX - minX)}px`;
        this.groupFrameEl.style.height = `${Math.max(0, maxY - minY)}px`;

        if (this.groupBadgeLabel) {
            this.groupBadgeLabel.textContent = `${selected.length} Selected • Drag to move`;
        } else if (this.groupBadgeEl) {
            this.groupBadgeEl.textContent = `${selected.length} Selected • Drag to move`;
        }

        if (this.groupBadgeBtn && this.connectionManager) {
            const targetIds = selected.map(b => b.id);
            const internalConns = this.connectionManager.getConnectionsForBubbleIds(targetIds, true);
            const targetConns = internalConns.length > 0
                ? internalConns
                : this.connectionManager.getConnectionsForBubbleIds(targetIds, false);

            if (targetConns.length > 0) {
                this.groupBadgeBtn.style.display = 'inline-flex';
                const textSpan = this.groupBadgeBtn.querySelector('span');
                if (textSpan) {
                    textSpan.textContent = `Perfect Length (${targetConns.length})`;
                }
            } else {
                this.groupBadgeBtn.style.display = 'none';
            }
        }

        this.groupFrameEl.classList.add('visible');
    }

    /**
     * Computes directional resize cursor class/style based on angle from bubble center to cursor.
     */
    getResizeCursorForAngle(dx, dy) {
        const angleDeg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 180;
        if (angleDeg >= 22.5 && angleDeg < 67.5) {
            return 'nwse-resize';
        } else if (angleDeg >= 67.5 && angleDeg < 112.5) {
            return 'ns-resize';
        } else if (angleDeg >= 112.5 && angleDeg < 157.5) {
            return 'nesw-resize';
        }
        return 'ew-resize';
    }

    /**
     * Checks if the cursor at (boardX, boardY) is hovering over a bubble or its outer outline ring.
     * Updates hover classes and resize cursor accordingly.
     */
    updateOutlineHoverState(boardX, boardY) {
        let bestBubble = null;
        let isOnOutline = false;
        let bestDistToEdge = Infinity;

        // Check in reverse order so top-most bubbles take priority
        for (let i = this.manager.bubbles.length - 1; i >= 0; i--) {
            const b = this.manager.bubbles[i];
            const r = typeof this.manager.getBubbleRadius === 'function'
                ? this.manager.getBubbleRadius(b)
                : this.manager.currentRadius;

            const dist = Math.hypot(boardX - b.x, boardY - b.y);
            const outerTolerance = 8; // Board units outside the perimeter
            const innerBand = Math.max(10, Math.min(22, r * 0.26));
            const innerLimit = Math.max(r * 0.42, r - innerBand);

            if (dist <= r + outerTolerance) {
                const onEdge = dist >= innerLimit && dist <= r + outerTolerance;
                const distToEdge = Math.abs(dist - r);

                if (!bestBubble || (onEdge && !isOnOutline) || (onEdge === isOnOutline && distToEdge < bestDistToEdge)) {
                    bestBubble = b;
                    isOnOutline = onEdge;
                    bestDistToEdge = distToEdge;
                }
            }
        }

        // Update hovered bubble visual state (shows outline when hovering the bubble or its edge)
        if (this.hoveredBubble && this.hoveredBubble !== bestBubble) {
            if (this.hoveredBubble.element) {
                this.hoveredBubble.element.classList.remove('is-bubble-hovered', 'is-outline-hovered');
                this.hoveredBubble.element.style.cursor = '';
            }
        }
        this.hoveredBubble = bestBubble;

        const targetOutlineBubble = isOnOutline ? bestBubble : null;
        if (this.hoveredOutlineBubble && this.hoveredOutlineBubble !== targetOutlineBubble) {
            if (this.hoveredOutlineBubble.element) {
                this.hoveredOutlineBubble.element.classList.remove('is-outline-hovered');
                this.hoveredOutlineBubble.element.style.cursor = '';
            }
        }
        this.hoveredOutlineBubble = targetOutlineBubble;

        if (bestBubble && bestBubble.element) {
            bestBubble.element.classList.add('is-bubble-hovered');

            if (isOnOutline) {
                bestBubble.element.classList.add('is-outline-hovered');
                const cursor = this.getResizeCursorForAngle(boardX - bestBubble.x, boardY - bestBubble.y);
                bestBubble.element.style.cursor = cursor;
                document.body.style.cursor = cursor;
            } else {
                bestBubble.element.classList.remove('is-outline-hovered');
                bestBubble.element.style.cursor = '';
                document.body.style.cursor = '';
            }
        } else {
            document.body.style.cursor = '';
        }

        return { hoveredBubble: bestBubble, hoveredOutlineBubble: targetOutlineBubble };
    }

    /**
     * Begins resizing a bubble (and any other selected bubbles if it's part of a multi-selection)
     * by dragging its outline.
     */
    startResizingBubble(bubble, boardCoords) {
        if (!bubble) return;

        this.resizingBubble = bubble;
        this.resizeInitialScale = this.manager.getBubbleScale(bubble);
        this.resizeInitialDist = Math.max(5, Math.hypot(boardCoords.x - bubble.x, boardCoords.y - bubble.y));

        const targetBubbles = this.selectedBubbleIds.has(bubble.id)
            ? this.getSelectedBubbles()
            : [bubble];

        this.resizingGroup = targetBubbles.map(b => {
            b.isResizing = true;
            b.vx = 0;
            b.vy = 0;
            if (b.element) {
                b.element.classList.add('is-resizing', 'is-outline-hovered', 'is-bubble-hovered');
            }
            return {
                bubble: b,
                initialScale: this.manager.getBubbleScale(b)
            };
        });

        const cursor = this.getResizeCursorForAngle(boardCoords.x - bubble.x, boardCoords.y - bubble.y);
        document.body.classList.add('is-resizing-bubble');
        document.body.style.cursor = cursor;
    }

    /**
     * Checks if a board coordinate point falls inside the active multi-selection group box.
     */
    isPointInGroupSelectionBounds(boardX, boardY) {
        if (!this.groupBounds || this.selectedBubbleIds.size < 2) return false;
        return (
            boardX >= this.groupBounds.minX &&
            boardX <= this.groupBounds.maxX &&
            boardY >= this.groupBounds.minY &&
            boardY <= this.groupBounds.maxY
        );
    }

    /**
     * Begins dragging a set of bubbles together from the given board coordinates.
     */
    startDraggingBubbles(bubbles, boardCoords) {
        if (!bubbles || bubbles.length === 0) return;

        this.draggedBubbles = bubbles.map(b => {
            b.isDragging = true;
            b.vx = 0;
            b.vy = 0;
            if (b.element) {
                b.element.classList.add('is-dragging');
            }
            return {
                bubble: b,
                offsetX: b.x - boardCoords.x,
                offsetY: b.y - boardCoords.y
            };
        });

        this.draggedBubble = this.draggedBubbles[0].bubble;
        this.dragOffsetX = this.draggedBubbles[0].offsetX;
        this.dragOffsetY = this.draggedBubbles[0].offsetY;

        document.body.classList.add('is-dragging-bubble');
        if (this.groupFrameEl) {
            this.groupFrameEl.classList.add('is-dragging');
        }
    }

    setConnectionManager(connectionManager) {
        this.connectionManager = connectionManager;
    }

    setCommentManager(commentManager) {
        this.commentManager = commentManager;
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
        const uiIgnoreSelector =
            '.custom-context-menu, ' +
            '.custom-input-modal-backdrop, ' +
            '.floating-window, ' +
            '.view-menu-container, ' +
            '.view-menu-dropdown, ' +
            '.active-board-widget, ' +
            '#noise-controls-panel, ' +
            'button, input, select, textarea, label, a';

        // Prevent default browser right-click menu and show custom context menus
        window.addEventListener('contextmenu', (e) => {
            e.preventDefault();

            // If a right-click selection drag just finished, suppress the context menu
            if (this.suppressNextContextMenu) {
                this.suppressNextContextMenu = false;
                return;
            }

            // If in connecting mode, right click cancels it
            if (this.connectionManager && this.connectionManager.pendingSourceId) {
                this.connectionManager.cancelConnecting();
                return;
            }

            if (this.commentManager && this.commentManager.connectingState) {
                this.commentManager.endConnectionDrag();
                return;
            }

            const boardCoords = this.getBoardCoords(e.clientX, e.clientY);

            // 0. Check if right-clicked on a comment or comment connection line
            const commentLinkEl = e.target.closest('.comment-to-comment-connection');
            if (commentLinkEl && this.commentManager) {
                const linkId = Number(commentLinkEl.dataset.linkId);
                this.contextMenu.showCommentLinkMenu(e.clientX, e.clientY, linkId);
                return;
            }

            const commentConnEl = e.target.closest('.comment-connection');
            if (commentConnEl && this.commentManager) {
                const commentId = Number(commentConnEl.dataset.commentId);
                this.contextMenu.showCommentConnectionMenu(e.clientX, e.clientY, commentId);
                return;
            }

            const commentEl = e.target.closest('.board-comment');
            if (commentEl && this.commentManager) {
                const commentId = Number(commentEl.dataset.id);
                this.contextMenu.showCommentMenu(e.clientX, e.clientY, commentId);
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
                const selectedBubbles = this.selectedBubbleIds.has(bubbleId)
                    ? this.getSelectedBubbles()
                    : [];
                this.contextMenu.showBubbleMenu(e.clientX, e.clientY, bubbleId, selectedBubbles, () => {
                    this.clearSelection();
                });
                return;
            }

            // 2.5 Check if right-clicked inside the active multi-selection group or on the group frame/badge
            if (this.selectedBubbleIds.size > 1 && (
                e.target.closest('#group-selection-frame, .group-selection-badge') ||
                this.isPointInGroupSelectionBounds(boardCoords.x, boardCoords.y)
            )) {
                const selectedBubbles = this.getSelectedBubbles();
                if (selectedBubbles.length > 0) {
                    this.contextMenu.showBubbleMenu(e.clientX, e.clientY, selectedBubbles[0].id, selectedBubbles, () => {
                        this.clearSelection();
                    });
                    return;
                }
            }

            // 3. Ignore right-clicks inside UI panels, floating windows, menus, or modals
            if (e.target.closest(uiIgnoreSelector)) {
                return;
            }

            // 4. Otherwise right-clicked in empty void
            this.contextMenu.showVoidMenu(boardCoords.x, boardCoords.y, e.clientX, e.clientY);
        });

        // Mouse down (Start bubble/group drag, right-click selection marquee, background pan, or complete connection)
        window.addEventListener('mousedown', (e) => {
            // If clicked on UI panels, menus, modals, floating windows, buttons, or inputs, ignore completely
            if (e.target.closest(uiIgnoreSelector)) {
                return;
            }

            const boardCoords = this.getBoardCoords(e.clientX, e.clientY);

            // RIGHT MOUSE BUTTON (button === 2): Prepare for marquee multi-bubble selection on drag
            if (e.button === 2) {
                this.isRightMouseDown = true;
                this.isSelecting = false;
                this.suppressNextContextMenu = false;
                this.selectStartClientX = e.clientX;
                this.selectStartClientY = e.clientY;
                this.selectStartBoardX = boardCoords.x;
                this.selectStartBoardY = boardCoords.y;
                this.selectAdditive = e.shiftKey || e.ctrlKey || e.metaKey;
                this.initialSelectionBeforeDrag = new Set(this.selectedBubbleIds);
                return;
            }

            // LEFT MOUSE BUTTON (button === 0)
            if (e.button !== 0) return;

            // If context menu is currently open and user clicked outside it, simply dismiss it without moving the board
            if (this.contextMenu && this.contextMenu.isOpen) {
                this.contextMenu.close();
                return;
            }

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

            // Check if clicked on a comment's border connection dot (or hovered border) to drag a comment connection
            if (this.commentManager) {
                const dotEl = e.target.closest('.comment-connect-dot');
                const borderMatch = this.commentManager.updateBorderHover(boardCoords.x, boardCoords.y);

                if (dotEl) {
                    const commentId = Number(dotEl.dataset.commentId);
                    const comment = this.commentManager.getCommentById(commentId);
                    if (comment) {
                        const rect = this.commentManager.getCommentRect(comment);
                        const startX = (borderMatch && borderMatch.comment.id === comment.id)
                            ? borderMatch.edgeX
                            : Math.max(rect.left, Math.min(rect.right, boardCoords.x));
                        const startY = (borderMatch && borderMatch.comment.id === comment.id)
                            ? borderMatch.edgeY
                            : Math.max(rect.top, Math.min(rect.bottom, boardCoords.y));
                        this.commentManager.startConnectionDrag(comment, startX, startY);
                        this.contextMenu.close();
                        return;
                    }
                } else if (borderMatch) {
                    this.commentManager.startConnectionDrag(borderMatch.comment, borderMatch.edgeX, borderMatch.edgeY);
                    this.contextMenu.close();
                    return;
                }

                // Check if clicked on a comment rectangle body to drag it (or click link)
                const commentEl = e.target.closest('.board-comment');
                if (commentEl) {
                    const commentId = Number(commentEl.dataset.id);
                    const comment = this.commentManager.getCommentById(commentId);
                    if (comment) {
                        this.draggedComment = comment;
                        this.commentDragOffsetX = comment.x - boardCoords.x;
                        this.commentDragOffsetY = comment.y - boardCoords.y;
                        this.commentDragStartClientX = e.clientX;
                        this.commentDragStartClientY = e.clientY;
                        this.commentDragMoved = false;
                        comment.isDragging = true;
                        if (comment.element) {
                            comment.element.classList.add('is-dragging');
                        }
                        this.commentManager.clearBorderHover();
                        document.body.classList.add('is-dragging-comment');
                        this.contextMenu.close();
                        return;
                    }
                }
            }

            // Check if clicked on a bubble's outline to resize it!
            const hoverCheck = this.updateOutlineHoverState(boardCoords.x, boardCoords.y);
            if (hoverCheck.hoveredOutlineBubble && !(e.shiftKey || e.ctrlKey || e.metaKey)) {
                this.startResizingBubble(hoverCheck.hoveredOutlineBubble, boardCoords);
                this.contextMenu.close();
                return;
            }

            // Check if clicked on a universe bubble to drag it (or drag all selected bubbles)
            const bubbleEl = e.target.closest('.universe-bubble');
            if (bubbleEl) {
                const bubbleId = Number(bubbleEl.dataset.id);
                const bubble = this.manager.getBubbleById(bubbleId);
                if (!bubble) return;

                const isToggleKey = e.shiftKey || e.ctrlKey || e.metaKey;

                if (isToggleKey) {
                    // Toggle bubble in multi-selection
                    if (this.selectedBubbleIds.has(bubbleId)) {
                        this.deselectBubble(bubbleId);
                        return;
                    } else {
                        this.selectBubble(bubbleId);
                    }
                } else if (!this.selectedBubbleIds.has(bubbleId)) {
                    // Clicked an unselected bubble without modifier key: clear old multi-selection
                    this.clearSelection();
                }

                const bubblesToDrag = this.selectedBubbleIds.has(bubbleId)
                    ? this.getSelectedBubbles()
                    : [bubble];

                this.startDraggingBubbles(bubblesToDrag, boardCoords);

                // Close context menu if open
                this.contextMenu.close();
                return;
            }

            // Check if clicked on a connection line/label to adjust its default length by dragging
            const connEl = e.target.closest('.universe-connection');
            if (connEl) {
                const connId = Number(connEl.dataset.id);
                if (Number.isFinite(connId) && this.connectionManager) {
                    const arrowCenter = this.connectionManager.getConnectionCenter(connId) || { x: boardCoords.x, y: boardCoords.y };
                    this.potentialArrowResize = {
                        connId,
                        arrowCenterX: arrowCenter.x,
                        arrowCenterY: arrowCenter.y,
                        clickX: boardCoords.x,
                        clickY: boardCoords.y,
                        clientX: e.clientX,
                        clientY: e.clientY
                    };
                    this.isDraggingArrowLength = false;
                    this.contextMenu.close();
                    return;
                }
            }

            // Check if clicked inside the active multi-selection group bounding frame
            if (this.isPointInGroupSelectionBounds(boardCoords.x, boardCoords.y)) {
                const selectedBubbles = this.getSelectedBubbles();
                if (selectedBubbles.length > 0) {
                    this.startDraggingBubbles(selectedBubbles, boardCoords);
                    this.contextMenu.close();
                    return;
                }
            }

            // Otherwise, clicked on background void: start background panning!
            this.isPanning = true;
            this.panMoved = false;
            this.panStartX = e.clientX;
            this.panStartY = e.clientY;
            this.initialPanX = this.panX;
            this.initialPanY = this.panY;
            document.body.classList.add('is-panning-background');

            // Close context menu if open
            this.contextMenu.close();
        });

        // Mouse move (Update marquee selection, outline resize, dragged bubble(s), background pan, or connection preview line)
        window.addEventListener('mousemove', (e) => {
            const boardCoords = this.getBoardCoords(e.clientX, e.clientY);

            // Handle arrow length adjustment via scaling circle (centered directly on the arrow)
            if (this.potentialArrowResize) {
                const resizeState = this.potentialArrowResize;
                const dragDist = Math.hypot(boardCoords.x - resizeState.clickX, boardCoords.y - resizeState.clickY);

                if (!this.isDraggingArrowLength && dragDist > 4) {
                    this.isDraggingArrowLength = true;
                    document.body.classList.add('is-resizing-arrow');
                    if (this.connectionManager) {
                        const arrowCenter = this.connectionManager.getConnectionCenter(resizeState.connId) || {
                            x: resizeState.arrowCenterX,
                            y: resizeState.arrowCenterY
                        };
                        this.connectionManager.startArrowScalePreview(resizeState.connId, arrowCenter.x, arrowCenter.y);
                    }
                }

                if (this.isDraggingArrowLength && this.connectionManager) {
                    const arrowCenter = this.connectionManager.getConnectionCenter(resizeState.connId) || {
                        x: resizeState.arrowCenterX,
                        y: resizeState.arrowCenterY
                    };
                    const dist = Math.hypot(boardCoords.x - arrowCenter.x, boardCoords.y - arrowCenter.y);
                    const baseLength = this.connectionManager.getBaseArrowLength();
                    const snapStep = Math.max(1, baseLength * 0.1); // Snap to 10% of base arrow size
                    const rawDiameter = 2 * dist;
                    const snappedLength = Math.max(snapStep, Math.round(rawDiameter / snapStep) * snapStep);

                    this.connectionManager.updateArrowScalePreview(
                        arrowCenter.x, arrowCenter.y,
                        boardCoords.x, boardCoords.y,
                        dist, snappedLength, baseLength
                    );
                    this.connectionManager.setConnectionTargetLength(resizeState.connId, snappedLength, false);
                    return;
                }
            }

            // 1. Handle right-click drag marquee selection
            if (this.isRightMouseDown) {
                const dist = Math.hypot(e.clientX - this.selectStartClientX, e.clientY - this.selectStartClientY);

                if (!this.isSelecting && dist > 5) {
                    this.isSelecting = true;
                    this.suppressNextContextMenu = true;

                    if (this.contextMenu && this.contextMenu.isOpen) {
                        this.contextMenu.close();
                    }
                    if (this.connectionManager && this.connectionManager.pendingSourceId) {
                        this.connectionManager.cancelConnecting();
                    }
                    if (!this.selectAdditive) {
                        this.clearSelection();
                    }
                    if (this.selectionBoxEl) {
                        this.selectionBoxEl.classList.add('visible');
                    }
                    document.body.classList.add('is-selecting-bubbles');
                }

                if (this.isSelecting) {
                    // Update screen-space marquee rectangle
                    if (this.selectionBoxEl) {
                        const left = Math.min(this.selectStartClientX, e.clientX);
                        const top = Math.min(this.selectStartClientY, e.clientY);
                        const width = Math.abs(e.clientX - this.selectStartClientX);
                        const height = Math.abs(e.clientY - this.selectStartClientY);

                        this.selectionBoxEl.style.left = `${left}px`;
                        this.selectionBoxEl.style.top = `${top}px`;
                        this.selectionBoxEl.style.width = `${width}px`;
                        this.selectionBoxEl.style.height = `${height}px`;
                    }

                    // Determine which bubbles overlap the selection rectangle in board coordinates
                    const minX = Math.min(this.selectStartBoardX, boardCoords.x);
                    const maxX = Math.max(this.selectStartBoardX, boardCoords.x);
                    const minY = Math.min(this.selectStartBoardY, boardCoords.y);
                    const maxY = Math.max(this.selectStartBoardY, boardCoords.y);
                    const defaultRadius = this.manager.currentRadius || 50;

                    for (const bubble of this.manager.bubbles) {
                        const r = typeof this.manager.getBubbleRadius === 'function'
                            ? this.manager.getBubbleRadius(bubble)
                            : defaultRadius;
                        const hitRadius = r * 0.78;
                        const closestX = Math.max(minX, Math.min(bubble.x, maxX));
                        const closestY = Math.max(minY, Math.min(bubble.y, maxY));
                        const distToBox = Math.hypot(bubble.x - closestX, bubble.y - closestY);
                        const isInside = distToBox <= hitRadius;

                        if (isInside || (this.selectAdditive && this.initialSelectionBeforeDrag.has(bubble.id))) {
                            this.selectBubble(bubble.id, false);
                        } else {
                            this.deselectBubble(bubble.id, false);
                        }
                    }

                    this.updateGroupSelectionFrame();
                    return;
                }
            }

            // 2. Update connection preview line if in connecting mode
            if (this.connectionManager && this.connectionManager.pendingSourceId) {
                this.connectionManager.updatePreview(boardCoords.x, boardCoords.y);
                return;
            }

            // 2.5 Handle dragging a comment connection dot to connect to a bubble or another comment
            if (this.commentManager && this.commentManager.connectingState) {
                const sourceId = this.commentManager.connectingState.comment.id;
                const targetInfo = this.commentManager.getConnectionTargetAtPoint(boardCoords.x, boardCoords.y, sourceId);
                this.commentManager.updateConnectionPreview(boardCoords.x, boardCoords.y, targetInfo);
                return;
            }

            // 2.6 Handle dragging a comment rectangle
            if (this.draggedComment && this.commentManager) {
                const c = this.draggedComment;
                if (!this.commentDragMoved && Math.hypot(e.clientX - this.commentDragStartClientX, e.clientY - this.commentDragStartClientY) > 4) {
                    this.commentDragMoved = true;
                }
                if (this.commentDragMoved) {
                    c.x = boardCoords.x + this.commentDragOffsetX;
                    c.y = boardCoords.y + this.commentDragOffsetY;
                    if (c.attachedBubbleId !== null) {
                        const attachedBubble = this.manager.getBubbleById(c.attachedBubbleId);
                        if (attachedBubble) {
                            c.offsetX = c.x - attachedBubble.x;
                            c.offsetY = c.y - attachedBubble.y;
                        }
                    }
                    const updatedLinks = this.commentManager.updateOutgoingLinkOffsets(c.id);
                    this.commentManager.updateElementPosition(c);
                    this.commentManager.syncAttachedHierarchy(true);

                    if (this.commentManager.onlineManager && this.commentManager.onlineManager.isOnline) {
                        this.commentManager.onlineManager.onCommentDrag(c);
                        updatedLinks.forEach(l => this.commentManager.onlineManager.onCommentLinkUpdated(l));
                    }
                }
                return;
            }

            // 3. Handle background panning
            if (this.isPanning) {
                const dx = e.clientX - this.panStartX;
                const dy = e.clientY - this.panStartY;
                if (Math.hypot(dx, dy) > 4) {
                    this.panMoved = true;
                }
                this.panX = this.initialPanX + dx;
                this.panY = this.initialPanY + dy;
                this.applyViewTransform();
                return;
            }

            // 4. Handle bubble outline resizing (snaps to 20% of default bubble size)
            if (this.resizingBubble) {
                const primary = this.resizingBubble;
                const defaultRadius = this.manager.currentRadius || 50;
                const currentDist = Math.hypot(boardCoords.x - primary.x, boardCoords.y - primary.y);

                // Compute scale relative to default bubble radius and snap to 20% (0.2) steps
                const rawPrimaryScale = currentDist / defaultRadius;
                const snappedPrimaryScale = this.manager.snapScale(rawPrimaryScale);
                const scaleDelta = snappedPrimaryScale - this.resizeInitialScale;

                for (const item of this.resizingGroup) {
                    const targetScale = item.bubble.id === primary.id
                        ? snappedPrimaryScale
                        : this.manager.snapScale(item.initialScale + scaleDelta);
                    this.manager.setBubbleScale(item.bubble.id, targetScale, true);
                }

                const cursor = this.getResizeCursorForAngle(boardCoords.x - primary.x, boardCoords.y - primary.y);
                document.body.style.cursor = cursor;
                if (primary.element) {
                    primary.element.style.cursor = cursor;
                }

                this.updateGroupSelectionFrame();
                return;
            }

            // 5. Handle dragged bubble(s) (single or multi-selection group)
            if (this.draggedBubbles && this.draggedBubbles.length > 0) {
                for (const item of this.draggedBubbles) {
                    const b = item.bubble;
                    b.x = boardCoords.x + item.offsetX;
                    b.y = boardCoords.y + item.offsetY;
                    b.vx = 0;
                    b.vy = 0;

                    this.manager.updateElementPosition(b);

                    if (this.manager.onlineManager && this.manager.onlineManager.isOnline) {
                        this.manager.onlineManager.onBubbleDrag(b);
                    }
                }
                if (this.commentManager) {
                    this.commentManager.syncWithBubbles();
                }
                this.updateGroupSelectionFrame();
                return;
            }

            // 5.5 Check if hovering a comment border (shows the connection dot on the hovered side)
            if (this.commentManager) {
                const borderHover = this.commentManager.updateBorderHover(boardCoords.x, boardCoords.y);
                if (borderHover) {
                    if (this.hoveredBubble && this.hoveredBubble.element) {
                        this.hoveredBubble.element.classList.remove('is-bubble-hovered', 'is-outline-hovered');
                        this.hoveredBubble.element.style.cursor = '';
                    }
                    this.hoveredBubble = null;
                    this.hoveredOutlineBubble = null;
                    document.body.style.cursor = 'crosshair';
                    return;
                }
            }

            // 6. Check if hovering a bubble or its outline ring
            const hoverCheck = this.updateOutlineHoverState(boardCoords.x, boardCoords.y);

            // 7. Update cursor when hovering inside the multi-selection group frame (if not on an outline)
            if (!hoverCheck.hoveredOutlineBubble && this.isPointInGroupSelectionBounds(boardCoords.x, boardCoords.y)) {
                document.body.classList.add('is-hovering-selection-group');
            } else {
                document.body.classList.remove('is-hovering-selection-group');
            }

            // 8. Normal hover: check if hovering near any connection line or label
            if (this.connectionManager) {
                this.connectionManager.checkHover(boardCoords.x, boardCoords.y);
            }
        });

        // Mouse up (End right-click marquee selection, outline resize, arrow length resize, bubble/group drag, or background pan)
        window.addEventListener('mouseup', (e) => {
            if (e.button === 2 || this.isRightMouseDown) {
                this.isRightMouseDown = false;
                if (this.isSelecting) {
                    this.isSelecting = false;
                    if (this.selectionBoxEl) {
                        this.selectionBoxEl.classList.remove('visible');
                    }
                    document.body.classList.remove('is-selecting-bubbles');
                    this.updateGroupSelectionFrame();
                }
            }

            if (this.isDraggingArrowLength) {
                const connId = this.potentialArrowResize ? this.potentialArrowResize.connId : null;
                this.isDraggingArrowLength = false;
                this.potentialArrowResize = null;
                document.body.classList.remove('is-resizing-arrow');

                if (this.connectionManager) {
                    this.connectionManager.endArrowScalePreview();
                    if (connId) {
                        const conn = this.connectionManager.getConnectionById(connId);
                        if (conn) {
                            this.connectionManager.setConnectionTargetLength(connId, conn.targetLength, true);
                        }
                    }
                }

                if (this.manager.savingManager && (!this.manager.onlineManager || !this.manager.onlineManager.isOnline)) {
                    this.manager.savingManager.saveSessionSnapshot();
                }
            } else {
                this.potentialArrowResize = null;
            }

            if (this.resizingBubble) {
                const resizedBubbles = this.resizingGroup.map(item => item.bubble);

                for (const bubble of resizedBubbles) {
                    bubble.isResizing = false;
                    if (bubble.element) {
                        bubble.element.classList.remove('is-resizing');
                    }
                }

                this.resizingBubble = null;
                this.resizingGroup = [];
                document.body.classList.remove('is-resizing-bubble');

                const boardCoords = this.getBoardCoords(e.clientX, e.clientY);
                this.updateOutlineHoverState(boardCoords.x, boardCoords.y);
                this.updateGroupSelectionFrame();

                if (this.manager.onlineManager && this.manager.onlineManager.isOnline && resizedBubbles.length > 0) {
                    for (const bubble of resizedBubbles) {
                        this.manager.onlineManager.pendingDragUpdates.set(bubble.id, bubble);
                    }
                    this.manager.onlineManager.onBubbleDragEnd(resizedBubbles[resizedBubbles.length - 1]);
                }

                if (this.manager.savingManager && (!this.manager.onlineManager || !this.manager.onlineManager.isOnline)) {
                    this.manager.savingManager.saveSessionSnapshot();
                }
            }

            if (this.commentManager && this.commentManager.connectingState) {
                const boardCoords = this.getBoardCoords(e.clientX, e.clientY);
                const commentId = this.commentManager.connectingState.comment.id;
                const targetInfo = this.commentManager.getConnectionTargetAtPoint(boardCoords.x, boardCoords.y, commentId);
                this.commentManager.endConnectionDrag();
                if (targetInfo) {
                    if (targetInfo.type === 'comment') {
                        this.commentManager.connectComments(commentId, targetInfo.target.id);
                    } else if (targetInfo.type === 'bubble') {
                        this.commentManager.attachCommentToBubble(commentId, targetInfo.target.id);
                    }
                }
            }

            if (this.draggedComment) {
                const comment = this.draggedComment;
                const didMove = this.commentDragMoved;
                comment.isDragging = false;
                if (comment.element) {
                    comment.element.classList.remove('is-dragging');
                }
                this.draggedComment = null;
                this.commentDragMoved = false;
                document.body.classList.remove('is-dragging-comment');

                if (!didMove && comment.type === 'link' && comment.url && this.commentManager) {
                    this.commentManager.openCommentLink(comment.id);
                } else if (didMove) {
                    if (this.commentManager && this.commentManager.onlineManager && this.commentManager.onlineManager.isOnline) {
                        const updatedLinks = this.commentManager.updateOutgoingLinkOffsets(comment.id);
                        this.commentManager.onlineManager.onCommentDragEnd(comment);
                        updatedLinks.forEach(l => this.commentManager.onlineManager.onCommentLinkUpdated(l));
                    } else if (this.manager.savingManager) {
                        this.manager.savingManager.saveSessionSnapshot();
                    }
                }
            }

            if (this.draggedBubbles && this.draggedBubbles.length > 0) {
                const movedBubbles = this.draggedBubbles.map(item => item.bubble);

                for (const bubble of movedBubbles) {
                    bubble.isDragging = false;
                    if (bubble.element) {
                        bubble.element.classList.remove('is-dragging');
                    }
                }

                this.draggedBubbles = [];
                this.draggedBubble = null;
                document.body.classList.remove('is-dragging-bubble');
                if (this.groupFrameEl) {
                    this.groupFrameEl.classList.remove('is-dragging');
                }

                if (this.manager.onlineManager && this.manager.onlineManager.isOnline) {
                    for (const bubble of movedBubbles) {
                        this.manager.onlineManager.pendingDragUpdates.set(bubble.id, bubble);
                    }
                    this.manager.onlineManager.onBubbleDragEnd(movedBubbles[movedBubbles.length - 1]);
                }

                if (this.manager.savingManager && (!this.manager.onlineManager || !this.manager.onlineManager.isOnline)) {
                    this.manager.savingManager.saveSessionSnapshot();
                }
            }

            if (this.isPanning) {
                const wasClickWithoutPan = !this.panMoved;
                this.isPanning = false;
                this.panMoved = false;
                document.body.classList.remove('is-panning-background');

                // Clicking empty void without dragging clears current multi-selection
                if (wasClickWithoutPan && this.selectedBubbleIds.size > 0) {
                    this.clearSelection();
                }
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

        // Cancel connecting mode or clear selection on Escape
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.isDraggingArrowLength) {
                    this.isDraggingArrowLength = false;
                    this.potentialArrowResize = null;
                    document.body.classList.remove('is-resizing-arrow');
                    if (this.connectionManager) {
                        this.connectionManager.endArrowScalePreview();
                    }
                    return;
                }
                if (this.commentManager && this.commentManager.connectingState) {
                    this.commentManager.endConnectionDrag();
                    return;
                }
                if (this.connectionManager && this.connectionManager.pendingSourceId) {
                    this.connectionManager.cancelConnecting();
                } else if (this.selectedBubbleIds.size > 0) {
                    this.clearSelection();
                }
            }
        });

        // Double click to quickly edit name (bubbles, connections, or comments)
        window.addEventListener('dblclick', (e) => {
            const commentEl = e.target.closest('.board-comment');
            if (commentEl && this.commentManager) {
                const commentId = Number(commentEl.dataset.id);
                const comment = this.commentManager.getCommentById(commentId);
                if (comment) {
                    this.contextMenu.showCommentModal({
                        mode: 'edit',
                        comment,
                        onSubmit: ({ type, text, url, color }) => {
                            this.commentManager.updateComment(commentId, { type, text, url, color });
                        }
                    });
                    return;
                }
            }

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
