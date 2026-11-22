/**
 * Bubble & Physics Configuration Values
 * ------------------------------------------------------------------
 * All accessible parameters for bubbles, sizing, physics, and interaction.
 * You can edit these values directly in this file.
 */

const BubbleConfig = {
    /**
     * Bubble diameter as a percentage of the window (smaller viewport dimension, vmin).
     * e.g. 10 = 10% of min(window.innerWidth, window.innerHeight)
     */
    bubbleSizePercent: 10,

    /**
     * Outline thickness as a percentage of the bubble diameter.
     * e.g. 3.5 = 3.5% of the bubble's diameter (scales with bubble size)
     */
    outlineSizePercent: 5.0,

    /**
     * Bubble resizing snap step as a percentage of the default bubble's size.
     * 20 = snaps to 20% increments of the default bubble size (20%, 40%, 60%, 80%, 100%, 120%, ...).
     */
    sizeSnapPercent: 25,
    minScale: 0.4,
    maxScale: 4.0,

    /**
     * Desired distance / spacing between bubbles, in units of bubble diameter.
     * 1.0 = exactly 1 bubble distance (a gap of 1 bubble diameter between surfaces).
     * 0.0 = bubbles touch edge-to-edge.
     * 0.5 = half a bubble distance gap.
     */
    bubbleGapMultiplier: 2.0,

    /**
     * Physics simulation parameters:
     * - repulsionStrength: magnitude of the push force when bubbles are within the target distance
     * - damping: velocity retention per frame (0.0 = stops instantly, 0.9 = smooth glide)
     * - maxSpeed: velocity cap to prevent excessive bounce
     */
    repulsionStrength: 0.06,
    damping: 0.82,
    maxSpeed: 15.0,

    /**
     * Window edge boundary padding (% of window dimension)
     */
    boundaryPaddingPercent: 1.5,

    /**
     * Visual colors
     */
    bubbleColor: '#000000',
    outlineColor: '#ffffff',
    lockedOutlineColor: '#ff4d4d', // Visual hint for locked bubbles
    lockedBadgeColor: 'rgba(255, 77, 77, 0.9)'
};

// Expose to window for global browser access without bundling required
if (typeof window !== 'undefined') {
    window.BubbleConfig = BubbleConfig;
}

// Support ES/CommonJS modules if imported
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BubbleConfig;
}
