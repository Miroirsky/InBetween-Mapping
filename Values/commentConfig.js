/**
 * Comment Configuration Values
 * ------------------------------------------------------------------
 * Styling, colors, and interaction parameters for board comments
 * and comment-to-bubble connections.
 */

const CommentConfig = {
    /**
     * Default rectangle background color for new comments
     */
    defaultColor: '#f59e0b',

    /**
     * Curated preset color swatches shown in the comment creation/edit modal
     */
    presetColors: [
        '#f59e0b', // Amber
        '#3b82f6', // Blue
        '#10b981', // Emerald
        '#8b5cf6', // Violet
        '#ec4899', // Pink
        '#ef4444', // Red
        '#06b6d4', // Cyan
        '#84cc16', // Lime
        '#334155', // Slate
        '#18181b'  // Charcoal
    ],

    /**
     * Sizing limits (in 1000x1000 board coordinate units)
     */
    minWidth: 72,
    maxWidth: 260,

    /**
     * Border hover detection tolerance (in board units) for showing the connection dot
     */
    borderOuterMargin: 12,
    borderInnerMargin: 10,

    /**
     * Comment connection line styling
     */
    connectionLineWidth: 2.2,
    connectionDashArray: '5 4',
    connectionAnchorRadius: 4
};

if (typeof window !== 'undefined') {
    window.CommentConfig = CommentConfig;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CommentConfig;
}
