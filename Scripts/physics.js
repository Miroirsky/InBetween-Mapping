/**
 * Bubble Physics Simulation
 * ------------------------------------------------------------------
 * Simulates repulsive distance-keeping forces between bubbles,
 * connected distance constraints, velocity damping, boundary containment,
 * and locked state handling.
 */

class BubblePhysics {
    constructor(bubbleManager, config, connectionManager, connectionConfig) {
        this.manager = bubbleManager;
        this.config = config;
        this.connectionManager = connectionManager || null;
        this.connectionConfig = connectionConfig || null;

        this.animationFrameId = null;
        this.isRunning = false;
    }

    setConnectionManager(connectionManager, connectionConfig) {
        this.connectionManager = connectionManager;
        this.connectionConfig = connectionConfig;
    }

    start() {
        if (!this.isRunning) {
            this.isRunning = true;
            this.step();
        }
    }

    stop() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.isRunning = false;
    }

    step() {
        if (!this.isRunning) return;

        this.update();
        this.animationFrameId = requestAnimationFrame(() => this.step());
    }

    update() {
        const bubbles = this.manager.bubbles;
        const count = bubbles.length;

        // Still update connection preview or lines if needed
        if (this.connectionManager && count > 0) {
            this.connectionManager.render();
        }

        if (count === 0) return;

        const diameter = this.manager.currentDiameter;
        const radius = this.manager.currentRadius;
        const gapMultiplier = this.config.bubbleGapMultiplier;

        // Desired center-to-center distance = 2*radius + gap
        // (default gap is 1 full bubble diameter = 2*radius)
        const targetDistance = diameter * (1.0 + gapMultiplier);

        const repulsion = this.config.repulsionStrength;
        const damping = this.config.damping;
        const maxSpeed = this.config.maxSpeed;

        // 1. Pairwise repulsion between all bubbles (keeps them from crowding)
        for (let i = 0; i < count; i++) {
            const b1 = bubbles[i];

            for (let j = i + 1; j < count; j++) {
                const b2 = bubbles[j];

                let dx = b2.x - b1.x;
                let dy = b2.y - b1.y;
                let dist = Math.sqrt(dx * dx + dy * dy);

                // Prevent division by zero if overlapping exactly
                if (dist < 0.0001) {
                    dx = (Math.random() - 0.5) * 2;
                    dy = (Math.random() - 0.5) * 2;
                    dist = Math.sqrt(dx * dx + dy * dy) || 1;
                }

                if (dist < targetDistance) {
                    const nx = dx / dist;
                    const ny = dy / dist;

                    // Push force proportional to penetration depth
                    const overlap = targetDistance - dist;
                    const force = overlap * repulsion;

                    const b1Movable = !b1.isLocked && !b1.isDragging;
                    const b2Movable = !b2.isLocked && !b2.isDragging;

                    if (b1Movable && b2Movable) {
                        const halfForce = force * 0.5;
                        b1.vx -= nx * halfForce;
                        b1.vy -= ny * halfForce;
                        b2.vx += nx * halfForce;
                        b2.vy += ny * halfForce;
                    } else if (b1Movable) {
                        b1.vx -= nx * force;
                        b1.vy -= ny * force;
                    } else if (b2Movable) {
                        b2.vx += nx * force;
                        b2.vy += ny * force;
                    }
                }
            }
        }

        // 2. Strict Distance Constraint for Connected Universes:
        // Connected universes are constrained to always stay at the exact same distance (targetDistance)
        if (this.connectionManager && this.connectionManager.connections.length > 0) {
            const connections = this.connectionManager.connections;
            const springK = (this.connectionConfig && this.connectionConfig.springStrength) || 0.12;
            const maxCorrection = (this.connectionConfig && this.connectionConfig.maxCorrectionPerFrame) || 12.0;

            const processedPairs = new Set();

            for (let k = 0; k < connections.length; k++) {
                const conn = connections[k];
                const pairKey = conn.fromId < conn.toId ? `${conn.fromId}_${conn.toId}` : `${conn.toId}_${conn.fromId}`;
                if (processedPairs.has(pairKey)) continue;
                processedPairs.add(pairKey);

                const b1 = this.manager.getBubbleById(conn.fromId);
                const b2 = this.manager.getBubbleById(conn.toId);
                if (!b1 || !b2) continue;

                let dx = b2.x - b1.x;
                let dy = b2.y - b1.y;
                let dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 0.0001) {
                    dx = 1;
                    dy = 0;
                    dist = 1;
                }

                const nx = dx / dist;
                const ny = dy / dist;

                // Difference from target distance
                // If dist > targetDistance, delta > 0 (pulls bubbles together)
                // If dist < targetDistance, delta < 0 (pushes bubbles apart)
                const delta = dist - targetDistance;
                let impulse = delta * springK;

                // Clamp impulse to prevent physics explosion
                if (Math.abs(impulse) > maxCorrection) {
                    impulse = Math.sign(impulse) * maxCorrection;
                }

                const b1Movable = !b1.isLocked && !b1.isDragging;
                const b2Movable = !b2.isLocked && !b2.isDragging;

                if (b1Movable && b2Movable) {
                    const halfImpulse = impulse * 0.5;
                    b1.x += nx * halfImpulse;
                    b1.y += ny * halfImpulse;
                    b2.x -= nx * halfImpulse;
                    b2.y -= ny * halfImpulse;
                } else if (b1Movable) {
                    b1.x += nx * impulse;
                    b1.y += ny * impulse;
                } else if (b2Movable) {
                    b2.x -= nx * impulse;
                    b2.y -= ny * impulse;
                }
            }
        }

        // 3. Integration & damping
        for (let i = 0; i < count; i++) {
            const b = bubbles[i];

            if (b.isDragging || b.isLocked) {
                b.vx = 0;
                b.vy = 0;
                continue;
            }

            // Cap velocities
            const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
            if (speed > maxSpeed) {
                const factor = maxSpeed / speed;
                b.vx *= factor;
                b.vy *= factor;
            }

            // Apply velocity
            b.x += b.vx;
            b.y += b.vy;

            // Apply friction/damping
            b.vx *= damping;
            b.vy *= damping;

            // Zero tiny movements to avoid infinite micro-jitter
            if (Math.abs(b.vx) < 0.01) b.vx = 0;
            if (Math.abs(b.vy) < 0.01) b.vy = 0;

            // Update DOM element visual transform
            this.manager.updateElementPosition(b);
        }
    }
}

if (typeof window !== 'undefined') {
    window.BubblePhysics = BubblePhysics;
}
