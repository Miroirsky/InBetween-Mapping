/**
 * Window & View Menu Configuration Values
 * ------------------------------------------------------------------
 * Centralized settings for floating windows, default coordinates,
 * scaling ranges, and storage keys.
 */

const WindowConfig = {
    /**
     * Local storage key for saving boards
     */
    storageKey: 'inbetween_mapping_saved_boards',

    /**
     * Local storage key for currently active board ID
     */
    activeBoardKey: 'inbetween_mapping_active_board_id',

    /**
     * Local storage key for latest session state (prevents reset on refresh)
     */
    sessionKey: 'inbetween_mapping_session_state',

    /**
     * Parameters scaling range (percentage of default values)
     */
    paramScaleMinPercent: 10,
    paramScaleMaxPercent: 1000,
    paramScaleStepPercent: 5,

    /**
     * Default window dimensions and positions
     */
    savingWindow: {
        width: 320,
        defaultTop: 60,
        defaultLeft: 20
    },

    paramsWindow: {
        width: 290,
        defaultTop: 60,
        defaultLeft: 360
    },

    exportWindow: {
        width: 360,
        defaultTop: 60,
        defaultLeft: 360
    },

    /**
     * Base z-index for floating windows
     */
    baseZIndex: 100
};

if (typeof window !== 'undefined') {
    window.WindowConfig = WindowConfig;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = WindowConfig;
}
