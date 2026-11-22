/**
 * Comment Manager
 * ------------------------------------------------------------------
 * Manages colored rectangle comments (text & link types) on the board.
 * Comments scale with their content, are unaffected by physics forces,
 * can be attached to bubbles via a border-hover connection dot, and
 * follow their attached bubble automatically.
 */

class CommentManager {
    constructor(container, svgLayer, bubbleManager, config) {
        this.container = container;
        this.svg = svgLayer;
        this.bubbleManager = bubbleManager;
        this.config = config || window.CommentConfig || {};
        this.savingManager = null;
        this.onlineManager = null;

        this.comments = [];
        this.nextId = 1;
        this.commentLinks = []; // [{ id, fromCommentId, toCommentId, offsetX, offsetY }]
        this.nextLinkId = 1;

        // Cached SVG connection elements for zero-allocation in-place updates
        this.svgConnectionNodes = new Map(); // key ('bubble_1' | 'link_1') -> { group, hitbox, outline, line, startDot, endDot }
        this._connectionsDirty = false;

        // Border hover & dot drag state
        this.hoveredBorderInfo = null; // { comment, edgeX, edgeY, localX, localY, side }
        this.connectingState = null;   // { comment, startX, startY, targetInfo }

        this.initSVG();
    }

    setSavingManager(savingManager) {
        this.savingManager = savingManager;
    }

    setOnlineManager(onlineManager) {
        this.onlineManager = onlineManager;
    }

    initSVG() {
        if (!this.svg) return;
        this.svg.setAttribute('viewBox', '0 0 1000 1000');
        this.svg.style.overflow = 'visible';
        this.svg.innerHTML = `
            <g id="comment-connections-group"></g>
            <g id="comment-preview-group" style="pointer-events: none;"></g>
        `;
        this.connectionsGroup = this.svg.getElementById('comment-connections-group');
        this.previewGroup = this.svg.getElementById('comment-preview-group');
    }

    /**
     * Normalizes a URL string, adding https:// if no http(s) protocol is present.
     */
    normalizeUrl(rawUrl) {
        const trimmed = (rawUrl || '').trim();
        if (!trimmed) return '';
        if (/^https?:\/\//i.test(trimmed)) {
            return trimmed;
        }
        return `https://${trimmed}`;
    }

    /**
     * Validates that a URL uses a safe http/https protocol before opening.
     */
    isSafeUrl(url) {
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch (e) {
            return false;
        }
    }

    /**
     * Formats a URL for clean display when no custom label is provided.
     */
    formatDisplayUrl(url) {
        return (url || '')
            .replace(/^https?:\/\//i, '')
            .replace(/^www\./i, '')
            .replace(/\/$/, '');
    }

    /**
     * Computes readable contrast text color (#0f172a or #ffffff) for a given hex background.
     */
    getContrastTextColor(hex) {
        if (!hex || typeof hex !== 'string') return '#ffffff';
        let c = hex.replace('#', '').trim();
        if (c.length === 3) {
            c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
        }
        if (c.length !== 6) return '#ffffff';
        const num = parseInt(c, 16);
        if (isNaN(num)) return '#ffffff';
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        // Relative luminance (perceived brightness)
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.62 ? '#0f172a' : '#ffffff';
    }

    /**
     * Converts hex color to rgba string.
     */
    hexToRgba(hex, alpha) {
        if (!hex || typeof hex !== 'string') return `rgba(245, 158, 11, ${alpha})`;
        let c = hex.replace('#', '').trim();
        if (c.length === 3) {
            c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
        }
        if (c.length !== 6) return `rgba(245, 158, 11, ${alpha})`;
        const num = parseInt(c, 16);
        if (isNaN(num)) return `rgba(245, 158, 11, ${alpha})`;
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    syncNextId() {
        let maxId = 0;
        for (const c of this.comments) {
            const num = Number(c.id);
            if (Number.isFinite(num) && num > maxId) {
                maxId = Math.floor(num);
            }
        }
        this.nextId = maxId + 1;
        return this.nextId;
    }

    /**
     * Creates a new comment on the board.
     */
    createComment({
        x = 500,
        y = 500,
        type = 'text',
        text = '',
        url = '',
        color = null,
        attachedBubbleId = null,
        offsetX = 0,
        offsetY = 0,
        customId = null,
        saveSnapshot = true
    } = {}) {
        this.syncNextId();

        const hasValidCustomId = customId !== null && customId !== undefined && Number.isFinite(Number(customId)) && Number(customId) > 0;
        const id = hasValidCustomId ? Math.floor(Number(customId)) : this.nextId;

        const commentType = type === 'link' ? 'link' : 'text';
        const commentColor = color || this.config.defaultColor || '#f59e0b';
        const normalizedUrl = commentType === 'link' ? this.normalizeUrl(url) : '';
        const cleanText = typeof text === 'string' ? text.trim() : '';

        // Prevent duplicate comment DOM elements if ID already exists
        const existing = this.getCommentById(id);
        if (existing) {
            existing.type = commentType;
            existing.text = cleanText;
            existing.url = normalizedUrl;
            existing.color = commentColor;
            existing.x = Number.isFinite(Number(x)) ? Number(x) : existing.x;
            existing.y = Number.isFinite(Number(y)) ? Number(y) : existing.y;
            existing.attachedBubbleId = (attachedBubbleId !== null && attachedBubbleId !== undefined && Number.isFinite(Number(attachedBubbleId)))
                ? Math.floor(Number(attachedBubbleId))
                : null;
            existing.offsetX = Number.isFinite(Number(offsetX)) ? Number(offsetX) : 0;
            existing.offsetY = Number.isFinite(Number(offsetY)) ? Number(offsetY) : 0;
            if (existing.element) {
                existing.element.classList.toggle('is-attached', existing.attachedBubbleId !== null);
            }
            this.applyCommentContent(existing);
            this.applyCommentStyle(existing);
            this.updateElementPosition(existing);
            this.syncNextId();
            this._connectionsDirty = true;
            this.renderConnections();
            return existing;
        }

        const el = document.createElement('div');
        el.className = `board-comment comment-type-${commentType}`;
        el.dataset.id = id;

        // Content wrapper
        const contentEl = document.createElement('div');
        contentEl.className = 'comment-content';
        el.appendChild(contentEl);

        // Border-hover connection dot
        const dotEl = document.createElement('div');
        dotEl.className = 'comment-connect-dot';
        dotEl.dataset.commentId = id;
        dotEl.title = 'Drag to connect to a universe or comment';
        el.appendChild(dotEl);

        const comment = {
            id,
            type: commentType,
            text: cleanText,
            url: normalizedUrl,
            color: commentColor,
            x: Number.isFinite(Number(x)) ? Number(x) : 500,
            y: Number.isFinite(Number(y)) ? Number(y) : 500,
            attachedBubbleId: (attachedBubbleId !== null && attachedBubbleId !== undefined && Number.isFinite(Number(attachedBubbleId)))
                ? Math.floor(Number(attachedBubbleId))
                : null,
            offsetX: Number.isFinite(Number(offsetX)) ? Number(offsetX) : 0,
            offsetY: Number.isFinite(Number(offsetY)) ? Number(offsetY) : 0,
            isDragging: false,
            element: el,
            contentElement: contentEl,
            dotElement: dotEl
        };

        // If attached to a bubble and offsets weren't explicitly provided, compute them
        if (comment.attachedBubbleId !== null && this.bubbleManager) {
            const bubble = this.bubbleManager.getBubbleById(comment.attachedBubbleId);
            if (bubble) {
                if (offsetX === 0 && offsetY === 0 && (comment.x !== bubble.x || comment.y !== bubble.y)) {
                    comment.offsetX = comment.x - bubble.x;
                    comment.offsetY = comment.y - bubble.y;
                }
                el.classList.add('is-attached');
            } else {
                comment.attachedBubbleId = null;
            }
        }

        this.applyCommentContent(comment);
        this.applyCommentStyle(comment);
        this.updateElementPosition(comment);

        if (this.container) {
            this.container.appendChild(el);
        }

        this.measureComment(comment);
        this.comments.push(comment);
        this.syncNextId();
        this._connectionsDirty = true;
        this.renderConnections();

        if (this.onlineManager && this.onlineManager.isOnline && !this.onlineManager.isApplyingRemote) {
            this.onlineManager.onCommentCreated(comment);
        }

        if (saveSnapshot && this.savingManager) {
            this.savingManager.saveSessionSnapshot();
        }

        return comment;
    }

    /**
     * Populates the inner DOM of a comment based on its type (text or link).
     */
    applyCommentContent(comment) {
        if (!comment || !comment.contentElement) return;
        const el = comment.element;
        const contentEl = comment.contentElement;

        el.classList.remove('comment-type-text', 'comment-type-link');
        el.classList.add(`comment-type-${comment.type}`);

        contentEl.innerHTML = '';

        if (comment.type === 'link') {
            const displayLabel = comment.text || this.formatDisplayUrl(comment.url) || 'Link';

            const iconSpan = document.createElement('span');
            iconSpan.className = 'comment-link-icon';
            iconSpan.innerHTML = `
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                </svg>
            `;

            const textSpan = document.createElement('span');
            textSpan.className = 'comment-link-label';
            textSpan.textContent = displayLabel;

            const extSpan = document.createElement('span');
            extSpan.className = 'comment-link-external';
            extSpan.innerHTML = `
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
            `;

            contentEl.appendChild(iconSpan);
            contentEl.appendChild(textSpan);
            contentEl.appendChild(extSpan);
            el.title = comment.url ? `${displayLabel}\n${comment.url} (click to open)` : displayLabel;
        } else {
            const textSpan = document.createElement('span');
            textSpan.className = 'comment-text-body';
            textSpan.textContent = comment.text || 'Comment';
            contentEl.appendChild(textSpan);
            el.title = '';
        }

        // Refresh cached dimensions if already mounted in DOM
        if (el.isConnected) {
            this.measureComment(comment);
        } else {
            comment._width = null;
            comment._height = null;
        }
    }

    /**
     * Measures and caches comment dimensions in board coordinate space to avoid per-frame layout reflows.
     */
    measureComment(comment) {
        if (!comment || !comment.element) return;
        const w = comment.element.offsetWidth;
        const h = comment.element.offsetHeight;
        if (w > 0 && h > 0) {
            comment._width = w;
            comment._height = h;
        }
    }

    /**
     * Applies background color, border, and contrast text color to the comment element.
     */
    applyCommentStyle(comment) {
        if (!comment || !comment.element) return;
        const el = comment.element;
        const color = comment.color || this.config.defaultColor || '#f59e0b';
        const textColor = this.getContrastTextColor(color);
        const isDarkText = textColor !== '#ffffff';

        el.style.backgroundColor = this.hexToRgba(color, 0.92);
        el.style.color = textColor;
        el.style.borderColor = isDarkText ? 'rgba(15, 23, 42, 0.28)' : 'rgba(255, 255, 255, 0.28)';
        el.style.setProperty('--comment-accent', color);

        if (comment.dotElement) {
            comment.dotElement.style.backgroundColor = color;
        }
    }

    /**
     * Updates an existing comment's content, type, url, or color.
     */
    updateComment(id, { type, text, url, color }) {
        const comment = this.getCommentById(id);
        if (!comment) return false;

        if (type === 'text' || type === 'link') {
            comment.type = type;
        }
        if (text !== undefined) {
            comment.text = typeof text === 'string' ? text.trim() : '';
        }
        if (url !== undefined) {
            comment.url = comment.type === 'link' ? this.normalizeUrl(url) : '';
        }
        if (color) {
            comment.color = color;
        }

        this.applyCommentContent(comment);
        this.applyCommentStyle(comment);
        this.renderConnections();

        if (this.onlineManager && this.onlineManager.isOnline && !this.onlineManager.isApplyingRemote) {
            this.onlineManager.onCommentUpdated(comment);
        }

        if (this.savingManager) {
            this.savingManager.saveSessionSnapshot();
        }
        return true;
    }

    /**
     * Sets a comment's background color.
     */
    setCommentColor(id, newColor) {
        const comment = this.getCommentById(id);
        if (!comment || !newColor) return false;
        comment.color = newColor;
        this.applyCommentStyle(comment);
        this.renderConnections();
        if (this.onlineManager && this.onlineManager.isOnline && !this.onlineManager.isApplyingRemote) {
            this.onlineManager.onCommentUpdated(comment);
        }
        if (this.savingManager) {
            this.savingManager.saveSessionSnapshot();
        }
        return true;
    }

    /**
     * Opens a link comment's URL in a new browser tab.
     */
    openCommentLink(id) {
        const comment = this.getCommentById(id);
        if (!comment || comment.type !== 'link' || !comment.url) return false;
        if (!this.isSafeUrl(comment.url)) return false;
        window.open(comment.url, '_blank', 'noopener,noreferrer');
        return true;
    }

    /**
     * Removes a comment from the board.
     */
    removeComment(id) {
        const targetId = Number(id);
        const index = this.comments.findIndex(c => c.id === targetId);
        if (index === -1) return false;

        const comment = this.comments[index];
        this.comments.splice(index, 1);
        this.syncNextId();

        this.removeCommentLinksForComment(targetId, false);

        if (this.hoveredBorderInfo && this.hoveredBorderInfo.comment.id === targetId) {
            this.hoveredBorderInfo = null;
        }
        if (this.connectingState && this.connectingState.comment.id === targetId) {
            this.endConnectionDrag();
        }

        if (this.onlineManager && this.onlineManager.isOnline && !this.onlineManager.isApplyingRemote) {
            this.onlineManager.onCommentRemoved(targetId);
        }

        if (this.onlineManager && this.onlineManager.isApplyingRemote) {
            if (comment.element && comment.element.parentNode) {
                comment.element.parentNode.removeChild(comment.element);
            }
        } else if (comment.element) {
            comment.element.classList.add('comment-destroying');
            setTimeout(() => {
                if (comment.element && comment.element.parentNode) {
                    comment.element.parentNode.removeChild(comment.element);
                }
            }, 160);
        }

        this.renderConnections();

        if (this.savingManager) {
            this.savingManager.saveSessionSnapshot();
        }
        return true;
    }

    /**
     * Instantly clears all comments (used when loading or resetting a board).
     */
    clearAll() {
        this.endConnectionDrag();
        this.hoveredBorderInfo = null;
        this.comments = [];
        this.nextId = 1;
        this.commentLinks = [];
        this.nextLinkId = 1;
        this.svgConnectionNodes.clear();
        this._connectionsDirty = false;
        if (this.container) {
            this.container.innerHTML = '';
        }
        if (this.connectionsGroup) {
            this.connectionsGroup.innerHTML = '';
        }
        if (this.previewGroup) {
            this.previewGroup.innerHTML = '';
        }
    }

    getCommentById(id) {
        const numId = Number(id);
        if (!Number.isFinite(numId)) return undefined;
        return this.comments.find(c => c.id === numId);
    }

    /**
     * Returns the comment's bounding rectangle in 1000x1000 board coordinate space using cached dimensions.
     */
    getCommentRect(comment) {
        if ((!comment._width || !comment._height) && comment.element) {
            this.measureComment(comment);
        }
        const width = comment._width || 96;
        const height = comment._height || 34;
        const halfW = width * 0.5;
        const halfH = height * 0.5;
        return {
            cx: comment.x,
            cy: comment.y,
            width,
            height,
            halfW,
            halfH,
            left: comment.x - halfW,
            right: comment.x + halfW,
            top: comment.y - halfH,
            bottom: comment.y + halfH
        };
    }

    /**
     * Positions the comment DOM element centered at (comment.x, comment.y).
     */
    updateElementPosition(comment) {
        if (!comment || !comment.element) return;
        comment.element.style.transform = `translate3d(${comment.x}px, ${comment.y}px, 0) translate(-50%, -50%)`;
    }

    /**
     * Attaches a comment to a bubble so it follows the bubble's movement.
     */
    attachCommentToBubble(commentId, bubbleId) {
        const comment = this.getCommentById(commentId);
        const bubble = this.bubbleManager ? this.bubbleManager.getBubbleById(bubbleId) : null;
        if (!comment || !bubble) return false;

        comment.attachedBubbleId = bubble.id;
        comment.offsetX = comment.x - bubble.x;
        comment.offsetY = comment.y - bubble.y;

        if (comment.element) {
            comment.element.classList.add('is-attached');
        }

        this.renderConnections();

        if (this.onlineManager && this.onlineManager.isOnline && !this.onlineManager.isApplyingRemote) {
            this.onlineManager.onCommentUpdated(comment);
        }

        if (this.savingManager) {
            this.savingManager.saveSessionSnapshot();
        }
        return true;
    }

    /**
     * Detaches a comment from its bubble.
     */
    detachComment(commentId) {
        const comment = this.getCommentById(commentId);
        if (!comment) return false;

        comment.attachedBubbleId = null;
        comment.offsetX = 0;
        comment.offsetY = 0;

        if (comment.element) {
            comment.element.classList.remove('is-attached');
        }

        this.renderConnections();

        if (this.onlineManager && this.onlineManager.isOnline && !this.onlineManager.isApplyingRemote) {
            this.onlineManager.onCommentUpdated(comment);
        }

        if (this.savingManager) {
            this.savingManager.saveSessionSnapshot();
        }
        return true;
    }

    /**
     * Detaches all comments that were attached to a removed bubble (keeps the comments on board).
     */
    detachCommentsForBubble(bubbleId) {
        const targetId = Number(bubbleId);
        let changed = false;
        for (const comment of this.comments) {
            if (comment.attachedBubbleId === targetId) {
                comment.attachedBubbleId = null;
                comment.offsetX = 0;
                comment.offsetY = 0;
                if (comment.element) {
                    comment.element.classList.remove('is-attached');
                }
                if (this.onlineManager && this.onlineManager.isOnline && !this.onlineManager.isApplyingRemote) {
                    this.onlineManager.onCommentUpdated(comment);
                }
                changed = true;
            }
        }
        if (changed) {
            this.renderConnections();
        }
    }

    /**
     * Connects two comments with a visual link (fromComment follows toComment at their relative offset).
     */
    connectComments(fromCommentId, toCommentId, customId = null, saveSnapshot = true, offsetX = null, offsetY = null) {
        const fromId = Number(fromCommentId);
        const toId = Number(toCommentId);
        if (!Number.isFinite(fromId) || !Number.isFinite(toId) || fromId === toId) return null;

        const fromComment = this.getCommentById(fromId);
        const toComment = this.getCommentById(toId);
        if (!fromComment || !toComment) return null;

        // Prevent duplicate link between the same pair of comments
        const existing = this.commentLinks.find(
            l => (l.fromCommentId === fromId && l.toCommentId === toId) ||
                 (l.fromCommentId === toId && l.toCommentId === fromId)
        );
        if (existing) return existing;

        this.syncNextLinkId();
        const hasValidCustomId = customId !== null && customId !== undefined && Number.isFinite(Number(customId)) && Number(customId) > 0;
        const id = hasValidCustomId ? Math.floor(Number(customId)) : this.nextLinkId;

        const computedOffsetX = (offsetX !== null && offsetX !== undefined && Number.isFinite(Number(offsetX)))
            ? Math.round(Number(offsetX) * 100) / 100
            : Math.round((fromComment.x - toComment.x) * 100) / 100;
        const computedOffsetY = (offsetY !== null && offsetY !== undefined && Number.isFinite(Number(offsetY)))
            ? Math.round(Number(offsetY) * 100) / 100
            : Math.round((fromComment.y - toComment.y) * 100) / 100;

        const link = {
            id,
            fromCommentId: fromId,
            toCommentId: toId,
            offsetX: computedOffsetX,
            offsetY: computedOffsetY
        };

        this.commentLinks.push(link);
        this.syncNextLinkId();
        this._connectionsDirty = true;
        this.renderConnections();

        if (this.onlineManager && this.onlineManager.isOnline && !this.onlineManager.isApplyingRemote) {
            this.onlineManager.onCommentLinkCreated(link);
        }

        if (saveSnapshot && this.savingManager) {
            this.savingManager.saveSessionSnapshot();
        }
        return link;
    }

    hasParentCommentLink(commentId) {
        const id = Number(commentId);
        return this.commentLinks.some(l => l.fromCommentId === id);
    }

    /**
     * Updates stored (offsetX, offsetY) on all links touching a comment
     * (called when repositioning a comment relative to its neighbors). Returns the updated links.
     */
    updateIncidentLinkOffsets(commentId) {
        const id = Number(commentId);
        const comment = this.getCommentById(id);
        if (!comment) return [];

        const updatedLinks = [];
        for (const link of this.commentLinks) {
            if (link.fromCommentId === id) {
                const other = this.getCommentById(link.toCommentId);
                if (other) {
                    link.offsetX = Math.round((comment.x - other.x) * 100) / 100;
                    link.offsetY = Math.round((comment.y - other.y) * 100) / 100;
                    updatedLinks.push(link);
                }
            } else if (link.toCommentId === id) {
                const other = this.getCommentById(link.fromCommentId);
                if (other) {
                    link.offsetX = Math.round((other.x - comment.x) * 100) / 100;
                    link.offsetY = Math.round((other.y - comment.y) * 100) / 100;
                    updatedLinks.push(link);
                }
            }
        }
        return updatedLinks;
    }

    /**
     * Returns true if any comment in the same comment-link component (excluding `excludeId`)
     * is directly attached to a bubble.
     */
    hasBubbleAnchorInComponent(startCommentId, excludeId = null) {
        const startId = Number(startCommentId);
        const visited = new Set([startId]);
        const queue = [startId];

        while (queue.length > 0) {
            const cur = queue.shift();
            if (cur !== excludeId) {
                const c = this.getCommentById(cur);
                if (c && c.attachedBubbleId !== null) return true;
            }
            for (const link of this.commentLinks) {
                let nextId = null;
                if (link.fromCommentId === cur) nextId = link.toCommentId;
                else if (link.toCommentId === cur) nextId = link.fromCommentId;
                if (nextId !== null && !visited.has(nextId)) {
                    visited.add(nextId);
                    queue.push(nextId);
                }
            }
        }
        return false;
    }

    /**
     * Returns all comments in the same comment-link connected component as `startCommentId`.
     */
    getConnectedCommentComponent(startCommentId) {
        const startId = Number(startCommentId);
        const start = this.getCommentById(startId);
        if (!start) return [];

        const visited = new Set([startId]);
        const queue = [startId];
        const result = [start];

        while (queue.length > 0) {
            const cur = queue.shift();
            for (const link of this.commentLinks) {
                let nextId = null;
                if (link.fromCommentId === cur) nextId = link.toCommentId;
                else if (link.toCommentId === cur) nextId = link.fromCommentId;
                if (nextId !== null && !visited.has(nextId)) {
                    visited.add(nextId);
                    const next = this.getCommentById(nextId);
                    if (next) {
                        result.push(next);
                        queue.push(nextId);
                    }
                }
            }
        }
        return result;
    }

    syncNextLinkId() {
        let maxId = 0;
        for (const l of this.commentLinks) {
            const num = Number(l.id);
            if (Number.isFinite(num) && num > maxId) {
                maxId = Math.floor(num);
            }
        }
        this.nextLinkId = maxId + 1;
        return this.nextLinkId;
    }

    getCommentLinkById(linkId) {
        const numId = Number(linkId);
        if (!Number.isFinite(numId)) return undefined;
        return this.commentLinks.find(l => l.id === numId);
    }

    getCommentLinksForComment(commentId) {
        const targetId = Number(commentId);
        return this.commentLinks.filter(l => l.fromCommentId === targetId || l.toCommentId === targetId);
    }

    /**
     * Removes a single comment-to-comment connection.
     */
    removeCommentLink(linkId, saveSnapshot = true) {
        const targetId = Number(linkId);
        const index = this.commentLinks.findIndex(l => l.id === targetId);
        if (index === -1) return false;

        this.commentLinks.splice(index, 1);
        this.syncNextLinkId();
        this.renderConnections();

        if (this.onlineManager && this.onlineManager.isOnline && !this.onlineManager.isApplyingRemote) {
            this.onlineManager.onCommentLinkRemoved(targetId);
        }

        if (saveSnapshot && this.savingManager) {
            this.savingManager.saveSessionSnapshot();
        }
        return true;
    }

    /**
     * Removes all comment-to-comment links connected to a specific comment.
     */
    removeCommentLinksForComment(commentId, saveSnapshot = true) {
        const targetId = Number(commentId);
        const toRemove = this.commentLinks.filter(l => l.fromCommentId === targetId || l.toCommentId === targetId);
        if (toRemove.length > 0) {
            this.commentLinks = this.commentLinks.filter(l => l.fromCommentId !== targetId && l.toCommentId !== targetId);
            this.syncNextLinkId();
            this.renderConnections();
            if (this.onlineManager && this.onlineManager.isOnline && !this.onlineManager.isApplyingRemote) {
                toRemove.forEach(l => this.onlineManager.onCommentLinkRemoved(l.id));
            }
            if (saveSnapshot && this.savingManager) {
                this.savingManager.saveSessionSnapshot();
            }
            return true;
        }
        return false;
    }

    /**
     * Declaratively resolves all attached comment positions in bidirectional BFS order:
     * 1. Bubble-attached comments -> bubble + (offsetX, offsetY)
     * 2. Comment-attached comments -> follow their connected bubble-attached or dragged comment
     *    in EITHER link direction (from -> to or to -> from) at their exact relative offset.
     * Skips SVG rendering completely when nothing moved (zero idle CPU/GPU cost).
     */
    syncAttachedHierarchy(forceRender = false, activeRootCommentId = null) {
        const movedComments = [];
        if (this.comments.length === 0) return movedComments;

        let anyMoved = false;

        // 1. Resolve bubble-attached comments
        for (const comment of this.comments) {
            if (comment.attachedBubbleId === null) continue;

            const bubble = this.bubbleManager ? this.bubbleManager.getBubbleById(comment.attachedBubbleId) : null;
            if (!bubble) {
                comment.attachedBubbleId = null;
                if (comment.element) comment.element.classList.remove('is-attached');
                this._connectionsDirty = true;
                continue;
            }

            if (comment.isDragging) {
                comment.offsetX = comment.x - bubble.x;
                comment.offsetY = comment.y - bubble.y;
                anyMoved = true;
            } else {
                const targetX = bubble.x + comment.offsetX;
                const targetY = bubble.y + comment.offsetY;
                if (Math.abs(targetX - comment.x) > 0.01 || Math.abs(targetY - comment.y) > 0.01) {
                    comment.x = targetX;
                    comment.y = targetY;
                    this.updateElementPosition(comment);
                    movedComments.push(comment);
                    anyMoved = true;
                }
            }
        }

        // 2. Resolve comment-to-comment connections bidirectionally via BFS
        if (this.commentLinks.length > 0) {
            const adj = new Map(); // commentId -> [{ neighborId, dx, dy }]

            for (const link of this.commentLinks) {
                const fromC = this.getCommentById(link.fromCommentId);
                const toC = this.getCommentById(link.toCommentId);
                if (!fromC || !toC) continue;

                // Ensure legacy links without stored offsets get initialized once
                if (!Number.isFinite(Number(link.offsetX)) || !Number.isFinite(Number(link.offsetY))) {
                    link.offsetX = Math.round((fromC.x - toC.x) * 100) / 100;
                    link.offsetY = Math.round((fromC.y - toC.y) * 100) / 100;
                }

                if (!adj.has(toC.id)) adj.set(toC.id, []);
                if (!adj.has(fromC.id)) adj.set(fromC.id, []);

                // fromC = toC + (offsetX, offsetY)
                adj.get(toC.id).push({ neighborId: fromC.id, dx: link.offsetX, dy: link.offsetY });
                // toC = fromC + (-offsetX, -offsetY)
                adj.get(fromC.id).push({ neighborId: toC.id, dx: -link.offsetX, dy: -link.offsetY });
            }

            if (adj.size > 0) {
                const visited = new Set();
                const queue = [];

                // Priority 1: Bubble-attached comments are fixed anchors that pull connected comments
                for (const c of this.comments) {
                    if (c.attachedBubbleId !== null && adj.has(c.id) && !visited.has(c.id)) {
                        visited.add(c.id);
                        queue.push(c.id);
                    }
                }

                // Priority 2: Actively dragged comment (if not already visited) pulls its connected comments
                if (activeRootCommentId !== null) {
                    const rootId = Number(activeRootCommentId);
                    if (adj.has(rootId) && !visited.has(rootId)) {
                        visited.add(rootId);
                        queue.push(rootId);
                    }
                }
                for (const c of this.comments) {
                    if (c.isDragging && adj.has(c.id) && !visited.has(c.id)) {
                        visited.add(c.id);
                        queue.push(c.id);
                    }
                }

                // Priority 3: Remaining unattached connected components — pick most recently updated comment as root
                const unvisitedLinked = this.comments
                    .filter(c => adj.has(c.id) && !visited.has(c.id))
                    .sort((a, b) => (b._lastRemoteUpdateAt || b._lastLocalEditAt || 0) - (a._lastRemoteUpdateAt || a._lastLocalEditAt || 0));

                const runBfs = () => {
                    while (queue.length > 0) {
                        const curId = queue.shift();
                        const cur = this.getCommentById(curId);
                        const edges = adj.get(curId);
                        if (!cur || !edges) continue;

                        for (const edge of edges) {
                            const nextId = edge.neighborId;
                            if (visited.has(nextId)) continue;
                            visited.add(nextId);

                            const next = this.getCommentById(nextId);
                            if (!next || next.isDragging || next.attachedBubbleId !== null) continue;

                            const targetX = cur.x + edge.dx;
                            const targetY = cur.y + edge.dy;
                            if (Math.abs(targetX - next.x) > 0.01 || Math.abs(targetY - next.y) > 0.01) {
                                next.x = targetX;
                                next.y = targetY;
                                this.updateElementPosition(next);
                                movedComments.push(next);
                                anyMoved = true;
                            }
                            queue.push(nextId);
                        }
                    }
                };

                // Run BFS from bubble anchors & dragged comments first
                runBfs();

                // Then resolve any remaining free-floating linked clusters
                for (const c of unvisitedLinked) {
                    if (!visited.has(c.id)) {
                        visited.add(c.id);
                        queue.push(c.id);
                        runBfs();
                    }
                }
            }
        }

        if (anyMoved || forceRender || this._connectionsDirty) {
            this._connectionsDirty = false;
            this.renderConnections();
        }

        return movedComments;
    }

    /**
     * Alias called every frame by BubblePhysics.update().
     */
    syncWithBubbles() {
        this.syncAttachedHierarchy(false);
    }

    /**
     * Detects whether board coordinate (boardX, boardY) is hovering near any comment's border,
     * and shows/positions the connection dot on the hovered side of that comment.
     */
    updateBorderHover(boardX, boardY) {
        if (this.connectingState) {
            return this.hoveredBorderInfo;
        }

        const outerMargin = this.config.borderOuterMargin || 12;
        const innerMargin = this.config.borderInnerMargin || 10;

        let bestMatch = null;
        let bestDist = Infinity;

        // Check top-most comments first
        for (let i = this.comments.length - 1; i >= 0; i--) {
            const comment = this.comments[i];
            const rect = this.getCommentRect(comment);

            // Quick bounding box rejection
            if (
                boardX < rect.left - outerMargin ||
                boardX > rect.right + outerMargin ||
                boardY < rect.top - outerMargin ||
                boardY > rect.bottom + outerMargin
            ) {
                continue;
            }

            const isInside = (
                boardX >= rect.left &&
                boardX <= rect.right &&
                boardY >= rect.top &&
                boardY <= rect.bottom
            );

            let edgeX, edgeY, distToBorder, side;

            if (!isInside) {
                // Closest point on rectangle perimeter
                edgeX = Math.max(rect.left, Math.min(rect.right, boardX));
                edgeY = Math.max(rect.top, Math.min(rect.bottom, boardY));
                distToBorder = Math.hypot(boardX - edgeX, boardY - edgeY);

                if (distToBorder > outerMargin) continue;

                // Determine side
                if (Math.abs(edgeY - rect.top) < 0.01) side = 'top';
                else if (Math.abs(edgeY - rect.bottom) < 0.01) side = 'bottom';
                else if (Math.abs(edgeX - rect.left) < 0.01) side = 'left';
                else side = 'right';
            } else {
                // Inside rectangle: find distance to nearest of the 4 edges
                const dLeft = boardX - rect.left;
                const dRight = rect.right - boardX;
                const dTop = boardY - rect.top;
                const dBottom = rect.bottom - boardY;
                const minD = Math.min(dLeft, dRight, dTop, dBottom);

                // Adaptive inner margin so small comments remain easy to drag from their center
                const effectiveInner = Math.min(innerMargin, rect.height * 0.28, rect.width * 0.25);
                if (minD > effectiveInner) continue;

                distToBorder = minD;
                if (minD === dTop) {
                    side = 'top';
                    edgeX = boardX;
                    edgeY = rect.top;
                } else if (minD === dBottom) {
                    side = 'bottom';
                    edgeX = boardX;
                    edgeY = rect.bottom;
                } else if (minD === dLeft) {
                    side = 'left';
                    edgeX = rect.left;
                    edgeY = boardY;
                } else {
                    side = 'right';
                    edgeX = rect.right;
                    edgeY = boardY;
                }
            }

            if (distToBorder < bestDist) {
                bestDist = distToBorder;
                bestMatch = {
                    comment,
                    edgeX,
                    edgeY,
                    localX: edgeX - rect.left,
                    localY: edgeY - rect.top,
                    side
                };
            }
        }

        // Hide previous dot if switching comments or leaving border
        if (this.hoveredBorderInfo && (!bestMatch || this.hoveredBorderInfo.comment !== bestMatch.comment)) {
            const prev = this.hoveredBorderInfo.comment;
            if (prev.dotElement) prev.dotElement.classList.remove('is-visible');
            if (prev.element) prev.element.classList.remove('is-border-hovered');
        }

        this.hoveredBorderInfo = bestMatch;

        if (bestMatch) {
            const { comment, localX, localY } = bestMatch;
            if (comment.dotElement) {
                comment.dotElement.style.left = `${localX}px`;
                comment.dotElement.style.top = `${localY}px`;
                comment.dotElement.classList.add('is-visible');
            }
            if (comment.element) {
                comment.element.classList.add('is-border-hovered');
            }
        }

        return bestMatch;
    }

    /**
     * Clears any active border hover dot.
     */
    clearBorderHover() {
        if (this.hoveredBorderInfo) {
            const prev = this.hoveredBorderInfo.comment;
            if (prev.dotElement) prev.dotElement.classList.remove('is-visible');
            if (prev.element) prev.element.classList.remove('is-border-hovered');
            this.hoveredBorderInfo = null;
        }
    }

    /**
     * Starts dragging a comment connection from a border dot.
     */
    startConnectionDrag(comment, startX, startY) {
        if (!comment) return;
        this.connectingState = {
            comment,
            startX,
            startY,
            targetInfo: null // { type: 'bubble' | 'comment', target }
        };

        if (comment.dotElement) {
            comment.dotElement.classList.add('is-visible', 'is-dragging-dot');
        }
        if (comment.element) {
            comment.element.classList.add('is-connecting');
        }
        document.body.classList.add('is-connecting-comment');
        this.updateConnectionPreview(startX, startY, null);
    }

    /**
     * Updates the live SVG preview line while dragging a comment connection dot.
     * Supports both bubble targets and other comment targets.
     */
    updateConnectionPreview(targetX, targetY, hoveredTargetInfo = null) {
        if (!this.connectingState || !this.previewGroup) return;

        // Update drop-target highlight on previous target (bubble or comment)
        const prevTarget = this.connectingState.targetInfo ? this.connectingState.targetInfo.target : null;
        const nextTarget = hoveredTargetInfo ? hoveredTargetInfo.target : null;
        if (prevTarget && prevTarget !== nextTarget && prevTarget.element) {
            prevTarget.element.classList.remove('is-comment-drop-target');
        }
        this.connectingState.targetInfo = hoveredTargetInfo;
        if (nextTarget && nextTarget.element) {
            nextTarget.element.classList.add('is-comment-drop-target');
        }

        const { comment, startX, startY } = this.connectingState;
        const accentColor = comment.color || this.config.defaultColor || '#f59e0b';

        let endX = targetX;
        let endY = targetY;
        if (hoveredTargetInfo && hoveredTargetInfo.type === 'bubble') {
            const hoveredBubble = hoveredTargetInfo.target;
            const r = typeof this.bubbleManager.getBubbleRadius === 'function'
                ? this.bubbleManager.getBubbleRadius(hoveredBubble)
                : this.bubbleManager.currentRadius;
            const dx = hoveredBubble.x - startX;
            const dy = hoveredBubble.y - startY;
            const dist = Math.hypot(dx, dy);
            if (dist > r) {
                endX = hoveredBubble.x - (dx / dist) * r;
                endY = hoveredBubble.y - (dy / dist) * r;
            } else {
                endX = hoveredBubble.x;
                endY = hoveredBubble.y;
            }
        } else if (hoveredTargetInfo && hoveredTargetInfo.type === 'comment') {
            const targetRect = this.getCommentRect(hoveredTargetInfo.target);
            const edgePt = this.getRectEdgeIntersection(targetRect, startX, startY);
            endX = edgePt.x;
            endY = edgePt.y;
        }

        const hasTarget = !!hoveredTargetInfo;
        const svgNS = 'http://www.w3.org/2000/svg';
        this.previewGroup.innerHTML = '';

        // Dark outline for contrast
        const outline = document.createElementNS(svgNS, 'line');
        outline.setAttribute('x1', startX);
        outline.setAttribute('y1', startY);
        outline.setAttribute('x2', endX);
        outline.setAttribute('y2', endY);
        outline.setAttribute('stroke', 'rgba(0, 0, 0, 0.75)');
        outline.setAttribute('stroke-width', '5');
        outline.setAttribute('stroke-dasharray', '6 4');
        outline.setAttribute('stroke-linecap', 'round');
        this.previewGroup.appendChild(outline);

        // Colored dashed line
        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', startX);
        line.setAttribute('y1', startY);
        line.setAttribute('x2', endX);
        line.setAttribute('y2', endY);
        line.setAttribute('stroke', hasTarget ? '#38bdf8' : accentColor);
        line.setAttribute('stroke-width', '2.5');
        line.setAttribute('stroke-dasharray', '6 4');
        line.setAttribute('stroke-linecap', 'round');
        this.previewGroup.appendChild(line);

        // End dot
        const tip = document.createElementNS(svgNS, 'circle');
        tip.setAttribute('cx', endX);
        tip.setAttribute('cy', endY);
        tip.setAttribute('r', hasTarget ? '6' : '4.5');
        tip.setAttribute('fill', hasTarget ? '#38bdf8' : accentColor);
        tip.setAttribute('stroke', '#ffffff');
        tip.setAttribute('stroke-width', '1.8');
        this.previewGroup.appendChild(tip);
    }

    /**
     * Ends the comment connection drag (cleaning up preview line & highlights).
     */
    endConnectionDrag() {
        if (!this.connectingState) return;

        const { comment, targetInfo } = this.connectingState;
        if (comment && comment.dotElement) {
            comment.dotElement.classList.remove('is-visible', 'is-dragging-dot');
        }
        if (comment && comment.element) {
            comment.element.classList.remove('is-connecting', 'is-border-hovered');
        }
        if (targetInfo && targetInfo.target && targetInfo.target.element) {
            targetInfo.target.element.classList.remove('is-comment-drop-target');
        }

        if (this.previewGroup) {
            this.previewGroup.innerHTML = '';
        }

        this.connectingState = null;
        this.hoveredBorderInfo = null;
        document.body.classList.remove('is-connecting-comment');
    }

    /**
     * Finds the comment under board coordinates (boardX, boardY), excluding a given comment ID.
     */
    getCommentAtPoint(boardX, boardY, excludeId = null) {
        const pad = 6;
        for (let i = this.comments.length - 1; i >= 0; i--) {
            const c = this.comments[i];
            if (excludeId !== null && c.id === Number(excludeId)) continue;
            const rect = this.getCommentRect(c);
            if (
                boardX >= rect.left - pad &&
                boardX <= rect.right + pad &&
                boardY >= rect.top - pad &&
                boardY <= rect.bottom + pad
            ) {
                return c;
            }
        }
        return null;
    }

    /**
     * Finds the bubble under board coordinates (boardX, boardY), if any.
     */
    getBubbleAtPoint(boardX, boardY) {
        if (!this.bubbleManager) return null;
        for (let i = this.bubbleManager.bubbles.length - 1; i >= 0; i--) {
            const b = this.bubbleManager.bubbles[i];
            const r = typeof this.bubbleManager.getBubbleRadius === 'function'
                ? this.bubbleManager.getBubbleRadius(b)
                : this.bubbleManager.currentRadius;
            if (Math.hypot(boardX - b.x, boardY - b.y) <= r + 6) {
                return b;
            }
        }
        return null;
    }

    /**
     * Finds a valid connection target (comment first, then bubble) under (boardX, boardY).
     */
    getConnectionTargetAtPoint(boardX, boardY, excludeCommentId = null) {
        const targetComment = this.getCommentAtPoint(boardX, boardY, excludeCommentId);
        if (targetComment) {
            return { type: 'comment', target: targetComment };
        }
        const targetBubble = this.getBubbleAtPoint(boardX, boardY);
        if (targetBubble) {
            return { type: 'bubble', target: targetBubble };
        }
        return null;
    }

    /**
     * Computes where a ray from the comment center toward (targetX, targetY) exits the comment rectangle.
     */
    getRectEdgeIntersection(rect, targetX, targetY) {
        const dx = targetX - rect.cx;
        const dy = targetY - rect.cy;
        if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
            return { x: rect.cx, y: rect.cy };
        }
        const tx = Math.abs(dx) > 0.001 ? rect.halfW / Math.abs(dx) : Infinity;
        const ty = Math.abs(dy) > 0.001 ? rect.halfH / Math.abs(dy) : Infinity;
        const t = Math.min(tx, ty);
        return {
            x: rect.cx + dx * t,
            y: rect.cy + dy * t
        };
    }

    /**
     * Creates or reuses an SVG connection node group for zero-allocation in-place updates.
     */
    getOrCreateConnectionNode(key, className, datasetKey, datasetVal, isDashed, lineWidth, anchorR) {
        let entry = this.svgConnectionNodes.get(key);
        if (entry) return entry;

        const svgNS = 'http://www.w3.org/2000/svg';
        const dashArray = this.config.connectionDashArray || '5 4';

        const group = document.createElementNS(svgNS, 'g');
        group.setAttribute('class', className);
        group.dataset[datasetKey] = datasetVal;

        const hitbox = document.createElementNS(svgNS, 'line');
        hitbox.setAttribute('class', 'comment-conn-hitbox');
        hitbox.setAttribute('stroke', 'transparent');
        hitbox.setAttribute('stroke-width', '14');
        group.appendChild(hitbox);

        const outline = document.createElementNS(svgNS, 'line');
        outline.setAttribute('class', 'comment-conn-outline');
        outline.setAttribute('stroke', 'rgba(0, 0, 0, 0.72)');
        outline.setAttribute('stroke-width', String(lineWidth + 2.2));
        outline.setAttribute('stroke-linecap', 'round');
        if (isDashed) outline.setAttribute('stroke-dasharray', dashArray);
        group.appendChild(outline);

        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('class', 'comment-conn-line');
        line.setAttribute('stroke-width', String(lineWidth));
        line.setAttribute('stroke-linecap', 'round');
        if (isDashed) line.setAttribute('stroke-dasharray', dashArray);
        group.appendChild(line);

        const startDot = document.createElementNS(svgNS, 'circle');
        startDot.setAttribute('class', 'comment-conn-dot');
        startDot.setAttribute('r', String(anchorR));
        startDot.setAttribute('stroke', 'rgba(0, 0, 0, 0.75)');
        startDot.setAttribute('stroke-width', '1.4');
        group.appendChild(startDot);

        const endDot = document.createElementNS(svgNS, 'circle');
        endDot.setAttribute('class', 'comment-conn-dot');
        endDot.setAttribute('r', String(anchorR));
        endDot.setAttribute('stroke', 'rgba(0, 0, 0, 0.75)');
        endDot.setAttribute('stroke-width', '1.4');
        group.appendChild(endDot);

        this.connectionsGroup.appendChild(group);
        entry = { group, hitbox, outline, line, startDot, endDot };
        this.svgConnectionNodes.set(key, entry);
        return entry;
    }

    updateConnectionNodeGeometry(entry, x1, y1, x2, y2, startColor, endColor) {
        entry.group.style.display = '';
        entry.hitbox.setAttribute('x1', x1);
        entry.hitbox.setAttribute('y1', y1);
        entry.hitbox.setAttribute('x2', x2);
        entry.hitbox.setAttribute('y2', y2);

        entry.outline.setAttribute('x1', x1);
        entry.outline.setAttribute('y1', y1);
        entry.outline.setAttribute('x2', x2);
        entry.outline.setAttribute('y2', y2);

        entry.line.setAttribute('x1', x1);
        entry.line.setAttribute('y1', y1);
        entry.line.setAttribute('x2', x2);
        entry.line.setAttribute('y2', y2);
        entry.line.setAttribute('stroke', startColor);

        entry.startDot.setAttribute('cx', x1);
        entry.startDot.setAttribute('cy', y1);
        entry.startDot.setAttribute('fill', startColor);

        entry.endDot.setAttribute('cx', x2);
        entry.endDot.setAttribute('cy', y2);
        entry.endDot.setAttribute('fill', endColor);
    }

    /**
     * Renders all SVG lines connecting attached comments to bubbles and other comments
     * using pooled SVG nodes updated in-place.
     */
    renderConnections() {
        if (!this.connectionsGroup) return;

        const lineWidth = this.config.connectionLineWidth || 2.2;
        const anchorR = this.config.connectionAnchorRadius || 4;
        const activeKeys = new Set();

        // 1. Render comment-to-bubble connections
        for (const comment of this.comments) {
            if (comment.attachedBubbleId === null) continue;
            const bubble = this.bubbleManager ? this.bubbleManager.getBubbleById(comment.attachedBubbleId) : null;
            if (!bubble) continue;

            const key = `bubble_${comment.id}`;
            activeKeys.add(key);

            const rect = this.getCommentRect(comment);
            const bubbleRadius = typeof this.bubbleManager.getBubbleRadius === 'function'
                ? this.bubbleManager.getBubbleRadius(bubble)
                : this.bubbleManager.currentRadius;

            const dx = bubble.x - rect.cx;
            const dy = bubble.y - rect.cy;
            const centerDist = Math.hypot(dx, dy);

            const entry = this.getOrCreateConnectionNode(
                key,
                'comment-connection',
                'commentId',
                comment.id,
                true,
                lineWidth,
                anchorR
            );

            if (centerDist < 1) {
                entry.group.style.display = 'none';
                continue;
            }

            const startPt = this.getRectEdgeIntersection(rect, bubble.x, bubble.y);
            const startDistFromCenter = Math.hypot(startPt.x - rect.cx, startPt.y - rect.cy);

            if (centerDist <= startDistFromCenter + bubbleRadius) {
                entry.group.style.display = 'none';
                continue;
            }

            const nx = dx / centerDist;
            const ny = dy / centerDist;
            const endX = bubble.x - nx * bubbleRadius;
            const endY = bubble.y - ny * bubbleRadius;
            const accentColor = comment.color || this.config.defaultColor || '#f59e0b';

            this.updateConnectionNodeGeometry(entry, startPt.x, startPt.y, endX, endY, accentColor, accentColor);
        }

        // 2. Render comment-to-comment connections
        for (const link of this.commentLinks) {
            const fromComment = this.getCommentById(link.fromCommentId);
            const toComment = this.getCommentById(link.toCommentId);
            if (!fromComment || !toComment) continue;

            const key = `link_${link.id}`;
            activeKeys.add(key);

            const fromRect = this.getCommentRect(fromComment);
            const toRect = this.getCommentRect(toComment);

            const dx = toRect.cx - fromRect.cx;
            const dy = toRect.cy - fromRect.cy;
            const centerDist = Math.hypot(dx, dy);

            const entry = this.getOrCreateConnectionNode(
                key,
                'comment-connection comment-to-comment-connection',
                'linkId',
                link.id,
                false,
                lineWidth,
                anchorR
            );

            if (centerDist < 1) {
                entry.group.style.display = 'none';
                continue;
            }

            const startPt = this.getRectEdgeIntersection(fromRect, toRect.cx, toRect.cy);
            const endPt = this.getRectEdgeIntersection(toRect, fromRect.cx, fromRect.cy);
            const startDist = Math.hypot(startPt.x - fromRect.cx, startPt.y - fromRect.cy);
            const endDist = Math.hypot(endPt.x - toRect.cx, endPt.y - toRect.cy);

            if (centerDist <= startDist + endDist) {
                entry.group.style.display = 'none';
                continue;
            }

            const fromColor = fromComment.color || this.config.defaultColor || '#f59e0b';
            const toColor = toComment.color || this.config.defaultColor || '#f59e0b';

            this.updateConnectionNodeGeometry(entry, startPt.x, startPt.y, endPt.x, endPt.y, fromColor, toColor);
        }

        // 3. Remove any stale SVG nodes for deleted/detached connections
        for (const [key, entry] of this.svgConnectionNodes.entries()) {
            if (!activeKeys.has(key)) {
                if (entry.group && entry.group.parentNode) {
                    entry.group.parentNode.removeChild(entry.group);
                }
                this.svgConnectionNodes.delete(key);
            }
        }
    }

    /**
     * Serializes all comment-to-comment links for saving / exporting.
     */
    serializeCommentLinks() {
        return this.commentLinks
            .filter(l => l && Number.isFinite(Number(l.fromCommentId)) && Number.isFinite(Number(l.toCommentId)))
            .map(l => ({
                id: Math.floor(Number(l.id)),
                fromCommentId: Math.floor(Number(l.fromCommentId)),
                toCommentId: Math.floor(Number(l.toCommentId)),
                offsetX: Number.isFinite(Number(l.offsetX)) ? Math.round(Number(l.offsetX) * 100) / 100 : 0,
                offsetY: Number.isFinite(Number(l.offsetY)) ? Math.round(Number(l.offsetY) * 100) / 100 : 0
            }));
    }

    /**
     * Restores an array of serialized comment-to-comment links.
     */
    loadCommentLinks(linksArray) {
        this.commentLinks = [];
        this.nextLinkId = 1;
        if (!Array.isArray(linksArray)) return;

        linksArray.forEach(l => {
            if (!l) return;
            this.connectComments(
                l.fromCommentId,
                l.toCommentId,
                l.id || null,
                false,
                l.offsetX !== undefined ? l.offsetX : null,
                l.offsetY !== undefined ? l.offsetY : null
            );
        });
        this.syncAttachedHierarchy(true);
    }

    /**
     * Serializes all comments for saving / exporting.
     */
    serializeComments() {
        return this.comments
            .filter(c => c && Number.isFinite(Number(c.id)) && Number(c.id) > 0)
            .map(c => ({
                id: Math.floor(Number(c.id)),
                type: c.type === 'link' ? 'link' : 'text',
                text: c.text || '',
                url: c.url || '',
                color: c.color || this.config.defaultColor || '#f59e0b',
                x: Math.round(c.x * 100) / 100,
                y: Math.round(c.y * 100) / 100,
                attachedBubbleId: c.attachedBubbleId !== null ? Math.floor(Number(c.attachedBubbleId)) : null,
                offsetX: Math.round((c.offsetX || 0) * 100) / 100,
                offsetY: Math.round((c.offsetY || 0) * 100) / 100
            }));
    }

    /**
     * Restores an array of serialized comments onto the board.
     */
    loadComments(commentsArray) {
        this.clearAll();
        if (!Array.isArray(commentsArray)) return;

        commentsArray.forEach(c => {
            if (!c) return;
            this.createComment({
                x: c.x,
                y: c.y,
                type: c.type || 'text',
                text: c.text || '',
                url: c.url || '',
                color: c.color || null,
                attachedBubbleId: c.attachedBubbleId !== undefined ? c.attachedBubbleId : null,
                offsetX: c.offsetX || 0,
                offsetY: c.offsetY || 0,
                customId: c.id || null,
                saveSnapshot: false
            });
        });

        this.renderConnections();
    }
}

if (typeof window !== 'undefined') {
    window.CommentManager = CommentManager;
}
