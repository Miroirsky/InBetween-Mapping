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
        this.svg.innerHTML = `
            <defs>
                <filter id="arrow-shadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#000000" flood-opacity="0.6"/>
                </filter>
            </defs>
            <g id="connections-group"></g>
            <g id="preview-group"></g>
        `;

        this.connectionsGroup = this.svg.getElementById('connections-group');
        this.previewGroup = this.svg.getElementById('preview-group');
    }

    /**
     * Check if a directed connection already exists from source to target
     */
    hasConnection(fromId, toId) {
        return this.connections.some(c => c.fromId === fromId && c.toId === toId);
    }

    /**
     * Creates a new directed connection with a mandatory name
     */
    createConnection(fromId, toId, name) {
        if (!name || name.trim() === '') return null;
        if (fromId === toId && !this.config.allowSelfConnection) return null;
        if (this.hasConnection(fromId, toId)) return null;

        const id = this.nextId++;
        const connection = {
            id,
            fromId,
            toId,
            name: name.trim()
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
                  stroke="${this.config.arrowOutlineColor}" stroke-width="${this.config.arrowWidth + 2}" stroke-dasharray="6,4" stroke-linecap="round"/>
            <line x1="${startX}" y1="${startY}" x2="${mouseX}" y2="${mouseY}"
                  stroke="${this.config.arrowColor}" stroke-width="${this.config.arrowWidth}" stroke-dasharray="6,4" stroke-linecap="round"/>
            <circle cx="${mouseX}" cy="${mouseY}" r="4" fill="${this.config.arrowOutlineColor}"/>
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
                    <!-- Outer White Stroke Line for Contrast -->
                    <path d="${pathD}" fill="none" stroke="${cfg.arrowOutlineColor}"
                          stroke-width="${cfg.arrowWidth + 2.5}" stroke-linecap="round" class="conn-outline"/>

                    <!-- Black Arrow Line -->
                    <path d="${pathD}" fill="none" stroke="${cfg.arrowColor}"
                          stroke-width="${cfg.arrowWidth}" stroke-linecap="round" class="conn-line"/>

                    <!-- Arrowhead Outer Border -->
                    <polygon points="${arrowPolyPoints}" fill="${cfg.arrowOutlineColor}" stroke="${cfg.arrowOutlineColor}" stroke-width="2"/>

                    <!-- Arrowhead Black Body -->
                    <polygon points="${arrowPolyPoints}" fill="${cfg.arrowColor}"/>

                    <!-- Invisible thick hit area for easy right clicking -->
                    <path d="${pathD}" fill="none" stroke="transparent" stroke-width="20" class="conn-hitbox"/>

                    <!-- Centered Label Group -->
                    <g class="connection-label-group" transform="translate(${midX}, ${midY})">
                        <text x="0" y="0" class="conn-label-text" text-anchor="middle" dominant-baseline="central">${safeName}</text>
                    </g>
                </g>
            `;
        }

        this.connectionsGroup.innerHTML = html;
        this.measureAndRenderLabelPills();
    }

    /**
     * Measures text elements to fit black background pill with white border accurately
     */
    measureAndRenderLabelPills() {
        const textElements = this.connectionsGroup.querySelectorAll('.conn-label-text');
        textElements.forEach(textEl => {
            const bbox = textEl.getBBox();
            const padX = 8;
            const padY = 4;
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', bbox.x - padX);
            rect.setAttribute('y', bbox.y - padY);
            rect.setAttribute('width', bbox.width + padX * 2);
            rect.setAttribute('height', bbox.height + padY * 2);
            rect.setAttribute('rx', '4');
            rect.setAttribute('ry', '4');
            rect.setAttribute('fill', this.config.textBackgroundColor);
            rect.setAttribute('stroke', this.config.textBorderColor);
            rect.setAttribute('stroke-width', this.config.textBorderWidth);
            rect.setAttribute('class', 'conn-label-bg');

            textEl.parentNode.insertBefore(rect, textEl);
        });
    }
}

if (typeof window !== 'undefined') {
    window.ConnectionManager = ConnectionManager;
}
