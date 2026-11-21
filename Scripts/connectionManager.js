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

        // Active connection creation state (when user clicks "Add Connection")
        this.pendingSourceId = null;
        this.previewLine = null;

        this.initSVG();
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
            <g id="connections-group"></g>
            <g id="preview-group"></g>
        `;

        this.connectionsGroup = this.svg.getElementById('connections-group');
        this.previewGroup = this.svg.getElementById('preview-group');

        // Robust hover detection across entire connection (line, arrowhead, label area)
        this.bindHoverEvents();
    }

    bindHoverEvents() {
        window.addEventListener('mousemove', (e) => {
            const connEl = e.target.closest('.universe-connection');
            document.querySelectorAll('.universe-connection.is-hovered').forEach(el => {
                if (el !== connEl) el.classList.remove('is-hovered');
            });
            if (connEl) {
                connEl.classList.add('is-hovered');
            }
        });

        window.addEventListener('mouseout', (e) => {
            if (!e.relatedTarget) {
                document.querySelectorAll('.universe-connection.is-hovered').forEach(el => el.classList.remove('is-hovered'));
            }
        });
    }

    /**
     * Check if a directed connection already exists from source to target
     */
    hasConnection(fromId, toId) {
        return this.connections.some(c => c.fromId === fromId && c.toId === toId);
    }

    /**
     * Creates a new directed connection with a default name if not provided
     */
    createConnection(fromId, toId, name = '') {
        if (fromId === toId && !this.config.allowSelfConnection) return null;
        if (this.hasConnection(fromId, toId)) return null;

        const id = this.nextId++;
        const defaultName = `Connection ${id}`;
        const connName = (name && typeof name === 'string' && name.trim().length > 0) ? name.trim() : defaultName;

        const connection = {
            id,
            fromId,
            toId,
            name: connName
        };

        this.connections.push(connection);
        this.render();
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
            return true;
        }
        return false;
    }

    /**
     * Delete a connection
     */
    removeConnection(id) {
        const index = this.connections.findIndex(c => c.id === Number(id));
        if (index !== -1) {
            this.connections.splice(index, 1);
            this.render();
            return true;
        }
        return false;
    }

    /**
     * Remove all connections attached to a bubble (called when bubble is deleted)
     */
    removeConnectionsForBubble(bubbleId) {
        const before = this.connections.length;
        this.connections = this.connections.filter(c => c.fromId !== bubbleId && c.toId !== bubbleId);
        if (this.connections.length !== before) {
            this.render();
        }
    }

    /**
     * Remove all connections (called on Reset Board)
     */
    reset() {
        this.connections = [];
        this.cancelConnecting();
        this.render();
    }

    getConnectionById(id) {
        return this.connections.find(c => c.id === Number(id));
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

        const radius = this.bubbleManager.currentRadius;
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

        this.previewGroup.innerHTML = `
            <line x1="${startX}" y1="${startY}" x2="${mouseX}" y2="${mouseY}"
                  stroke="${this.config.arrowColor}" stroke-width="${this.config.arrowWidth}" stroke-dasharray="6,4" stroke-linecap="round"/>
            <circle cx="${mouseX}" cy="${mouseY}" r="4" fill="${this.config.arrowColor}"/>
        `;
    }

    /**
     * Main render pass for all connections, arrows, and labels
     */
    render() {
        if (!this.connectionsGroup) return;

        const radius = this.bubbleManager.currentRadius;
        const cfg = this.config;
        let html = '';

        for (let i = 0; i < this.connections.length; i++) {
            const conn = this.connections[i];
            const fromBubble = this.bubbleManager.getBubbleById(conn.fromId);
            const toBubble = this.bubbleManager.getBubbleById(conn.toId);

            if (!fromBubble || !toBubble) continue;

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
            let arrowTipX = toBubble.x - radius * Math.cos(angle);
            let arrowTipY = toBubble.y - radius * Math.sin(angle);

            if (hasReverse) {
                // Curved offset for bidirectional connections
                const curveOffset = cfg.bidirectionalCurveOffset;
                const normalX = -Math.sin(angle);
                const normalY = Math.cos(angle);

                // Start and end points along bubble edges with slight rotational shift
                const startShiftAngle = angle + 0.2;
                const endShiftAngle = angle - 0.2;

                const startX = fromBubble.x + radius * Math.cos(startShiftAngle);
                const startY = fromBubble.y + radius * Math.sin(startShiftAngle);
                arrowTipX = toBubble.x - radius * Math.cos(endShiftAngle);
                arrowTipY = toBubble.y - radius * Math.sin(endShiftAngle);

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
                const startX = fromBubble.x + radius * Math.cos(angle);
                const startY = fromBubble.y + radius * Math.sin(angle);
                arrowTipX = toBubble.x - radius * Math.cos(angle);
                arrowTipY = toBubble.y - radius * Math.sin(angle);

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

            // Escape HTML in name
            const safeName = conn.name
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');

            html += `
                <g class="universe-connection" data-id="${conn.id}" filter="url(#arrow-shadow)">
                    <!-- Arrow Line (No outline) -->
                    <path d="${pathD}" fill="none" stroke="${cfg.arrowColor}"
                          stroke-width="${cfg.arrowWidth}" stroke-linecap="round" class="conn-line" pointer-events="stroke"/>

                    <!-- Arrowhead (No outline) -->
                    <polygon points="${arrowPolyPoints}" fill="${cfg.arrowColor}" class="conn-arrowhead" pointer-events="all"/>

                    <!-- Invisible thick hit area (36px wide) for easy hovering & right clicking -->
                    <path d="${pathD}" fill="none" stroke="rgba(0,0,0,0.001)" stroke-width="36" class="conn-hitbox" pointer-events="stroke"/>

                    <!-- Centered Title (Title only, visible on hover) -->
                    <g class="connection-label-group" transform="translate(${midX}, ${midY})">
                        <rect x="-60" y="-16" width="120" height="32" fill="rgba(0,0,0,0.001)" class="conn-label-hitbox" pointer-events="all"/>
                        <text x="0" y="0" class="conn-label-text" fill="${cfg.textColor}" text-anchor="middle" dominant-baseline="central">${safeName}</text>
                    </g>
                </g>
            `;
        }

        this.connectionsGroup.innerHTML = html;
    }
}

if (typeof window !== 'undefined') {
    window.ConnectionManager = ConnectionManager;
}
