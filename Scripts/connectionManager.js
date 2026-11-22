/**
 * Connection Manager
 * ------------------------------------------------------------------
 * Handles directed connections between universes, rendering arrows,
 * label placement, and bidirectional curvature.
 */

class ConnectionManager {
    constructor(svgContainer, bubbleManager, config) {
        this.svg = svgContainer;
        this.bubbleManager = bubbleManager;
        this.config = config;

        this.connections = []; // [{ id, fromId, toId, name }]
        this.nextId = 1;
        this.hoveredConnectionId = null;
        this.onlineManager = null;
        this.connectionViewEnabled = false;

        // Active connection creation state (when user clicks "Add Connection")
        this.pendingSourceId = null;
        this.previewLine = null;

        this.initSVG();
    }

    setOnlineManager(onlineManager) {
        this.onlineManager = onlineManager;
    }

    /**
     * Toggles Connection View mode (colors connections dynamically by length ratio:
     * 1.0x normal = white, 2.0x long = red, 0.5x short = blue, smoothly interpolated).
     */
    setConnectionView(enabled) {
        this.connectionViewEnabled = !!enabled;
        this.render();
    }

    /**
     * Computes connection color for Connection View based on length ratio vs normal rest length.
     * - 1.0x normal length -> White (#ffffff)
     * - 2.0x twice as long -> Red (rgb(255, 42, 42)), smoothly interpolated (e.g. 1.5x is halfway white-red)
     * - 0.5x twice as short -> Blue (rgb(42, 130, 255)), smoothly interpolated
     */
    getConnectionLengthColor(dist, fromRadius, toRadius) {
        if (!this.connectionViewEnabled) {
            return (this.config && this.config.arrowColor) || '#000000';
        }

        const diameter = (this.bubbleManager && this.bubbleManager.currentDiameter) || 100;
        const gapMultiplier = (this.bubbleManager && this.bubbleManager.config && this.bubbleManager.config.bubbleGapMultiplier !== undefined)
            ? this.bubbleManager.config.bubbleGapMultiplier
            : 2.0;

        // Normal visible connection length at physics rest equilibrium
        const normalLength = Math.max(1, diameter * gapMultiplier);
        const currentLength = Math.max(0, dist - (fromRadius + toRadius));
        const ratio = currentLength / normalLength;

        if (ratio >= 1.0) {
            // Smoothly interpolate from White (1.0x) to Red (2.0x)
            const t = Math.max(0, Math.min(1, (ratio - 1.0) / 1.0));
            const r = 255;
            const g = Math.round(255 + (42 - 255) * t);
            const b = Math.round(255 + (42 - 255) * t);
            return `rgb(${r}, ${g}, ${b})`;
        } else {
            // Smoothly interpolate from White (1.0x) to Blue (0.5x = twice as short)
            const t = Math.max(0, Math.min(1, (1.0 - ratio) / 0.5));
            const r = Math.round(255 + (42 - 255) * t);
            const g = Math.round(255 + (130 - 255) * t);
            const b = 255;
            return `rgb(${r}, ${g}, ${b})`;
        }
    }

    initSVG() {
        this.svg.setAttribute('viewBox', '0 0 1000 1000');
        this.svg.style.overflow = 'visible';
        this.svg.innerHTML = `
            <defs>
                <filter id="arrow-shadow" x="-50%" y="-50%" width="200%" height="200%">
                    <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#000000" flood-opacity="0.6"/>
                </filter>
            </defs>
            <!-- 1. All connection arrow lines & heads (bottom) -->
            <g id="connections-arrows-group"></g>
            <!-- 2. All connection labels (rendered on top of all arrows) -->
            <g id="connections-labels-group"></g>
            <!-- 3. Preview line when creating new connections -->
            <g id="preview-group"></g>
        `;

        this.arrowsGroup = this.svg.getElementById('connections-arrows-group');
        this.labelsGroup = this.svg.getElementById('connections-labels-group');
        this.connectionsGroup = this.arrowsGroup; // alias for backwards compatibility
        this.previewGroup = this.svg.getElementById('preview-group');

        this.bindHoverEvents();
    }

    bindHoverEvents() {
        window.addEventListener('mouseout', (e) => {
            if (!e.relatedTarget) {
                this.setHoveredConnection(null);
            }
        });
    }

    /**
     * Mathematical distance from board coordinate (px, py) to a connection line or curve
     */
    getDistanceToConnection(conn, px, py) {
        const fromBubble = this.bubbleManager.getBubbleById(conn.fromId);
        const toBubble = this.bubbleManager.getBubbleById(conn.toId);
        if (!fromBubble || !toBubble) return Infinity;

        const fromRadius = typeof this.bubbleManager.getBubbleRadius === 'function'
            ? this.bubbleManager.getBubbleRadius(fromBubble)
            : this.bubbleManager.currentRadius;
        const toRadius = typeof this.bubbleManager.getBubbleRadius === 'function'
            ? this.bubbleManager.getBubbleRadius(toBubble)
            : this.bubbleManager.currentRadius;
        const cfg = this.config;
        const dx = toBubble.x - fromBubble.x;
        const dy = toBubble.y - fromBubble.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) return Infinity;

        const angle = Math.atan2(dy, dx);
        const hasReverse = this.hasConnection(conn.toId, conn.fromId);

        let startX, startY, endX, endY, ctrlX, ctrlY;

        if (hasReverse) {
            const curveOffset = cfg.bidirectionalCurveOffset;
            const normalX = -Math.sin(angle);
            const normalY = Math.cos(angle);
            const startShiftAngle = angle + 0.2;
            const endShiftAngle = angle - 0.2;

            startX = fromBubble.x + fromRadius * Math.cos(startShiftAngle);
            startY = fromBubble.y + fromRadius * Math.sin(startShiftAngle);
            endX = toBubble.x - toRadius * Math.cos(endShiftAngle);
            endY = toBubble.y - toRadius * Math.sin(endShiftAngle);

            const rawMidX = (fromBubble.x + toBubble.x) * 0.5;
            const rawMidY = (fromBubble.y + toBubble.y) * 0.5;
            ctrlX = rawMidX + normalX * curveOffset;
            ctrlY = rawMidY + normalY * curveOffset;

            let minDist = Infinity;
            for (let s = 0; s <= 10; s++) {
                const t = s / 10;
                const omt = 1 - t;
                const bx = omt * omt * startX + 2 * omt * t * ctrlX + t * t * endX;
                const by = omt * omt * startY + 2 * omt * t * ctrlY + t * t * endY;
                const d = Math.hypot(px - bx, py - by);
                if (d < minDist) minDist = d;
            }
            return minDist;
        } else {
            startX = fromBubble.x + fromRadius * Math.cos(angle);
            startY = fromBubble.y + fromRadius * Math.sin(angle);
            endX = toBubble.x - toRadius * Math.cos(angle);
            endY = toBubble.y - toRadius * Math.sin(angle);

            const segDx = endX - startX;
            const segDy = endY - startY;
            const segLenSq = segDx * segDx + segDy * segDy;
            if (segLenSq === 0) return Math.hypot(px - startX, py - startY);

            const t = Math.max(0, Math.min(1, ((px - startX) * segDx + (py - startY) * segDy) / segLenSq));
            const projX = startX + t * segDx;
            const projY = startY + t * segDy;
            return Math.hypot(px - projX, py - projY);
        }
    }

    checkHover(boardX, boardY) {
        let bestId = null;
        let bestDist = 32; // Generous hover zone in board coordinates

        for (let i = 0; i < this.connections.length; i++) {
            const conn = this.connections[i];
            const d = this.getDistanceToConnection(conn, boardX, boardY);
            if (d < bestDist) {
                bestDist = d;
                bestId = conn.id;
            }
        }

        this.setHoveredConnection(bestId);
    }

    setHoveredConnection(connId) {
        if (this.hoveredConnectionId === connId) return;
        this.hoveredConnectionId = connId;

        // Toggle hover on arrow group
        if (this.arrowsGroup) {
            const allArrowEls = this.arrowsGroup.querySelectorAll('.universe-connection');
            allArrowEls.forEach(el => {
                const id = Number(el.dataset.id);
                if (id === connId) {
                    el.classList.add('is-hovered');
                } else {
                    el.classList.remove('is-hovered');
                }
            });
        }

        // Toggle hover on label group (and elevate hovered label to the top)
        if (this.labelsGroup) {
            const allLabelEls = this.labelsGroup.querySelectorAll('.universe-connection-label');
            allLabelEls.forEach(el => {
                const id = Number(el.dataset.id);
                if (id === connId) {
                    el.classList.add('is-hovered');
                    this.labelsGroup.appendChild(el);
                } else {
                    el.classList.remove('is-hovered');
                }
            });
        }
    }

    /**
     * Recalculates nextId from current connections so it is always a valid positive integer.
     */
    syncNextId() {
        let maxId = 0;
        for (const c of this.connections) {
            const num = Number(c.id);
            if (Number.isFinite(num) && num > maxId) {
                maxId = Math.floor(num);
            }
        }
        this.nextId = maxId + 1;
        return this.nextId;
    }

    /**
     * Check if a directed connection already exists from source to target
     */
    hasConnection(fromId, toId) {
        const fId = Number(fromId);
        const tId = Number(toId);
        return this.connections.some(c => Number(c.fromId) === fId && Number(c.toId) === tId);
    }

    /**
     * Creates a new directed connection with a default name if not provided
     */
    createConnection(fromId, toId, name = '', customId = null) {
        const fId = Number(fromId);
        const tId = Number(toId);
        if (!Number.isFinite(fId) || !Number.isFinite(tId)) return null;
        if (fId === tId && !this.config.allowSelfConnection) return null;
        if (this.hasConnection(fId, tId)) return null;

        const hasValidCustomId = customId !== null && customId !== undefined && customId !== '' && Number.isFinite(Number(customId)) && Number(customId) > 0;
        this.syncNextId();
        const id = hasValidCustomId ? Math.floor(Number(customId)) : this.nextId;

        const defaultName = `Connection ${id}`;
        const connName = (name && typeof name === 'string' && name.trim().length > 0 && !name.includes('NaN'))
            ? name.trim()
            : defaultName;

        const connection = {
            id,
            fromId: fId,
            toId: tId,
            name: connName
        };

        this.connections.push(connection);
        this.syncNextId();
        this.render();

        if (this.onlineManager && this.onlineManager.isOnline) {
            this.onlineManager.onConnectionCreated(connection);
        }

        return connection;
    }

    /**
     * Update connection name
     */
    renameConnection(id, newName) {
        const conn = this.getConnectionById(id);
        if (conn && newName && newName.trim() !== '') {
            conn.name = newName.trim();
            this.render();
            if (this.onlineManager && this.onlineManager.isOnline) {
                this.onlineManager.onConnectionRenamed(conn);
            }
            return true;
        }
        return false;
    }

    /**
     * Delete a connection
     */
    removeConnection(id) {
        const targetId = Number(id);
        const index = this.connections.findIndex(c => c.id === targetId || (Number.isNaN(targetId) && Number.isNaN(c.id)));
        if (index !== -1) {
            this.connections.splice(index, 1);
            this.syncNextId();
            this.render();
            if (this.onlineManager && this.onlineManager.isOnline) {
                this.onlineManager.onConnectionRemoved(targetId);
            }
            return true;
        }
        return false;
    }

    /**
     * Remove all connections attached to a bubble (called when bubble is deleted)
     */
    removeConnectionsForBubble(bubbleId) {
        const targetId = Number(bubbleId);
        const removed = this.connections.filter(c => Number(c.fromId) === targetId || Number(c.toId) === targetId);
        if (removed.length > 0) {
            this.connections = this.connections.filter(c => Number(c.fromId) !== targetId && Number(c.toId) !== targetId);
            this.syncNextId();
            this.render();
            if (this.onlineManager && this.onlineManager.isOnline) {
                removed.forEach(c => this.onlineManager.onConnectionRemoved(c.id));
            }
        }
    }

    /**
     * Remove all connections (called on Reset Board)
     */
    reset() {
        this.connections = [];
        this.nextId = 1;
        this.cancelConnecting();
        this.render();
    }

    getConnectionById(id) {
        const numId = Number(id);
        if (!Number.isFinite(numId)) return undefined;
        return this.connections.find(c => c.id === numId);
    }

    /**
     * Connection preview mode (when dragging or clicking to connect)
     */
    startConnecting(sourceBubbleId) {
        this.pendingSourceId = sourceBubbleId;
        document.body.classList.add('is-connecting-mode');
    }

    cancelConnecting() {
        this.pendingSourceId = null;
        this.previewGroup.innerHTML = '';
        document.body.classList.remove('is-connecting-mode');
    }

    updatePreview(mouseX, mouseY) {
        if (!this.pendingSourceId) return;

        const source = this.bubbleManager.getBubbleById(this.pendingSourceId);
        if (!source) {
            this.cancelConnecting();
            return;
        }

        const radius = typeof this.bubbleManager.getBubbleRadius === 'function'
            ? this.bubbleManager.getBubbleRadius(source)
            : this.bubbleManager.currentRadius;
        const dx = mouseX - source.x;
        const dy = mouseY - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= radius) {
            this.previewGroup.innerHTML = '';
            return;
        }

        const angle = Math.atan2(dy, dx);
        const startX = source.x + radius * Math.cos(angle);
        const startY = source.y + radius * Math.sin(angle);
        const previewColor = this.connectionViewEnabled
            ? this.getConnectionLengthColor(dist, radius, this.bubbleManager.currentRadius || radius)
            : this.config.arrowColor;

        this.previewGroup.innerHTML = `
            <line x1="${startX}" y1="${startY}" x2="${mouseX}" y2="${mouseY}"
                  stroke="${previewColor}" stroke-width="${this.config.arrowWidth}" stroke-dasharray="6,4" stroke-linecap="round"/>
            <circle cx="${mouseX}" cy="${mouseY}" r="4" fill="${previewColor}"/>
        `;
    }

    /**
     * Main render pass for all connections, arrows, and labels
     */
    render() {
        if (!this.arrowsGroup || !this.labelsGroup) return;

        const defaultRadius = this.bubbleManager.currentRadius;
        const cfg = this.config;
        const currentIds = new Set(this.connections.map(c => c.id));

        // Remove any deleted connection elements from arrowsGroup and labelsGroup
        this.arrowsGroup.querySelectorAll('.universe-connection').forEach(el => {
            if (!currentIds.has(Number(el.dataset.id))) el.remove();
        });
        this.labelsGroup.querySelectorAll('.universe-connection-label').forEach(el => {
            if (!currentIds.has(Number(el.dataset.id))) el.remove();
        });

        for (let i = 0; i < this.connections.length; i++) {
            const conn = this.connections[i];
            const fromBubble = this.bubbleManager.getBubbleById(conn.fromId);
            const toBubble = this.bubbleManager.getBubbleById(conn.toId);

            if (!fromBubble || !toBubble) continue;

            const fromRadius = typeof this.bubbleManager.getBubbleRadius === 'function'
                ? this.bubbleManager.getBubbleRadius(fromBubble)
                : defaultRadius;
            const toRadius = typeof this.bubbleManager.getBubbleRadius === 'function'
                ? this.bubbleManager.getBubbleRadius(toBubble)
                : defaultRadius;

            const dx = toBubble.x - fromBubble.x;
            const dy = toBubble.y - fromBubble.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 1) continue;

            const angle = Math.atan2(dy, dx);
            const hasReverse = this.hasConnection(conn.toId, conn.fromId);

            let pathD = '';
            let midX = 0;
            let midY = 0;
            let arrowEndAngle = angle;
            let arrowTipX = toBubble.x - toRadius * Math.cos(angle);
            let arrowTipY = toBubble.y - toRadius * Math.sin(angle);

            if (hasReverse) {
                // Curved offset for bidirectional connections
                const curveOffset = cfg.bidirectionalCurveOffset;
                const normalX = -Math.sin(angle);
                const normalY = Math.cos(angle);

                // Start and end points along bubble edges with slight rotational shift
                const startShiftAngle = angle + 0.2;
                const endShiftAngle = angle - 0.2;

                const startX = fromBubble.x + fromRadius * Math.cos(startShiftAngle);
                const startY = fromBubble.y + fromRadius * Math.sin(startShiftAngle);
                arrowTipX = toBubble.x - toRadius * Math.cos(endShiftAngle);
                arrowTipY = toBubble.y - toRadius * Math.sin(endShiftAngle);

                // Control point offset in normal direction
                const rawMidX = (fromBubble.x + toBubble.x) * 0.5;
                const rawMidY = (fromBubble.y + toBubble.y) * 0.5;
                const ctrlX = rawMidX + normalX * curveOffset;
                const ctrlY = rawMidY + normalY * curveOffset;

                pathD = `M ${startX} ${startY} Q ${ctrlX} ${ctrlY} ${arrowTipX} ${arrowTipY}`;

                // Midpoint of quadratic bezier curve for text label
                midX = 0.25 * startX + 0.5 * ctrlX + 0.25 * arrowTipX;
                midY = 0.25 * startY + 0.5 * ctrlY + 0.25 * arrowTipY;

                // Tangent angle at curve end for arrowhead
                arrowEndAngle = Math.atan2(arrowTipY - ctrlY, arrowTipX - ctrlX);
            } else {
                // Straight connection
                const startX = fromBubble.x + fromRadius * Math.cos(angle);
                const startY = fromBubble.y + fromRadius * Math.sin(angle);
                arrowTipX = toBubble.x - toRadius * Math.cos(angle);
                arrowTipY = toBubble.y - toRadius * Math.sin(angle);

                pathD = `M ${startX} ${startY} L ${arrowTipX} ${arrowTipY}`;
                midX = (startX + arrowTipX) * 0.5;
                midY = (startY + arrowTipY) * 0.5;
                arrowEndAngle = angle;
            }

            // Arrowhead vertices
            const headLen = cfg.arrowHeadLength;
            const headHalfWidth = cfg.arrowHeadWidth * 0.5;
            const backX = arrowTipX - headLen * Math.cos(arrowEndAngle);
            const backY = arrowTipY - headLen * Math.sin(arrowEndAngle);
            const perpX = -Math.sin(arrowEndAngle) * headHalfWidth;
            const perpY = Math.cos(arrowEndAngle) * headHalfWidth;

            const leftWingX = backX + perpX;
            const leftWingY = backY + perpY;
            const rightWingX = backX - perpX;
            const rightWingY = backY - perpY;

            const arrowPolyPoints = `${arrowTipX},${arrowTipY} ${leftWingX},${leftWingY} ${rightWingX},${rightWingY}`;
            const safeName = conn.name || '';
            const isHovered = conn.id === this.hoveredConnectionId;
            const arrowColor = this.getConnectionLengthColor(dist, fromRadius, toRadius);

            // 1. Render/Update Arrow in arrowsGroup (Bottom Layer)
            let arrowGroup = this.arrowsGroup.querySelector(`.universe-connection[data-id="${conn.id}"]`);
            if (!arrowGroup) {
                arrowGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                arrowGroup.setAttribute('class', 'universe-connection');
                arrowGroup.setAttribute('data-id', conn.id);
                arrowGroup.setAttribute('filter', 'url(#arrow-shadow)');

                arrowGroup.innerHTML = `
                    <path fill="none" stroke="${arrowColor}" stroke-width="${cfg.arrowWidth}" stroke-linecap="round" class="conn-line" pointer-events="stroke"/>
                    <polygon fill="${arrowColor}" class="conn-arrowhead" pointer-events="all"/>
                    <path fill="none" stroke="rgba(0,0,0,0.001)" stroke-width="36" class="conn-hitbox" pointer-events="stroke"/>
                `;
                this.arrowsGroup.appendChild(arrowGroup);
            }

            const line = arrowGroup.querySelector('.conn-line');
            if (line) {
                line.setAttribute('d', pathD);
                line.setAttribute('stroke', arrowColor);
            }

            const head = arrowGroup.querySelector('.conn-arrowhead');
            if (head) {
                head.setAttribute('points', arrowPolyPoints);
                head.setAttribute('fill', arrowColor);
            }

            const hitbox = arrowGroup.querySelector('.conn-hitbox');
            if (hitbox) hitbox.setAttribute('d', pathD);

            if (isHovered) {
                arrowGroup.classList.add('is-hovered');
            } else {
                arrowGroup.classList.remove('is-hovered');
            }

            // 2. Render/Update Label in labelsGroup (Top Layer - Rendered on top of all arrows)
            let labelGroup = this.labelsGroup.querySelector(`.universe-connection-label[data-id="${conn.id}"]`);
            if (!labelGroup) {
                labelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                labelGroup.setAttribute('class', 'universe-connection-label universe-connection');
                labelGroup.setAttribute('data-id', conn.id);

                labelGroup.innerHTML = `
                    <rect x="-60" y="-16" width="120" height="32" fill="rgba(0,0,0,0.001)" class="conn-label-hitbox" pointer-events="all"/>
                    <text x="0" y="0" class="conn-label-text" fill="${cfg.textColor}" text-anchor="middle" dominant-baseline="central"></text>
                `;
                this.labelsGroup.appendChild(labelGroup);
            }

            labelGroup.setAttribute('transform', `translate(${midX}, ${midY})`);

            const labelText = labelGroup.querySelector('.conn-label-text');
            if (labelText && labelText.textContent !== safeName) {
                labelText.textContent = safeName;
            }

            if (isHovered) {
                labelGroup.classList.add('is-hovered');
            } else {
                labelGroup.classList.remove('is-hovered');
            }
        }
    }
}

if (typeof window !== 'undefined') {
    window.ConnectionManager = ConnectionManager;
}
