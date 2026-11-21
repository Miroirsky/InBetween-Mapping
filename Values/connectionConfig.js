/**
 * Connection Configuration Values
 * ------------------------------------------------------------------
 * All accessible parameters for universe connections, arrows, labels,
 * and constraint physics.
 */

const ConnectionConfig = {
    /**
     * Arrow Styling
     */
    arrowColor: '#000000',               // Arrow body color (black as requested)
    arrowOutlineColor: '#ffffff',        // Arrow border/outline color for contrast
    arrowWidth: 2.5,                     // Stroke width in pixels
    arrowHeadLength: 14,                 // Arrowhead length in pixels
    arrowHeadWidth: 14,                  // Arrowhead width in pixels

    /**
     * Text Label Styling
     */
    textColor: '#ffffff',                // Name text color (white as requested)
    textFontSize: 25,                    // Font size in pixels
    textBackgroundColor: '#000000',      // Pill background for label readability
    textBorderColor: '#ffffff',          // Pill outline
    textBorderWidth: 1,

    /**
     * Physics Constraint
     * Connected universes are maintained at the exact same repulsion distance.
     */
    springStrength: 0.2,                // Force pulling/pushing connected bubbles to target distance
    maxCorrectionPerFrame: 100.0,         // Cap on constraint impulse to prevent jitter

    /**
     * Bidirectional Curve Separation
     * When both A -> B and B -> A exist, curve them so both arrows & names are clearly visible.
     */
    bidirectionalCurveOffset: 32,        // Curvature offset in pixels

    /**
     * Self-loop prevention
     */
    allowSelfConnection: false
};

// Expose to window for global browser access without bundling required
if (typeof window !== 'undefined') {
    window.ConnectionConfig = ConnectionConfig;
}

// Support ES/CommonJS modules if imported
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConnectionConfig;
}
