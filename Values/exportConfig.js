/**
 * Export & Import Configuration Values
 * ------------------------------------------------------------------
 * Centralized settings for file exports, schema definitions,
 * allowed file extensions, MIME types, and default naming.
 */

const ExportConfig = {
    /**
     * Application signature for exported JSON files
     */
    appSignature: 'InBetween Mapping',

    /**
     * Current schema version
     */
    schemaVersion: '1.0',

    /**
     * Supported file extensions
     */
    fileExtension: '.json',

    /**
     * Accepted MIME types for file input
     */
    acceptedMimeTypes: '.json,application/json',

    /**
     * Default file prefix when exporting untitled boards
     */
    defaultFilePrefix: 'inbetween-board',

    /**
     * Maximum allowed file size for import (in bytes, 10MB)
     */
    maxImportSizeBytes: 10 * 1024 * 1024,

    /**
     * Default window dimensions and positions
     */
    exportWindow: {
        width: 360,
        defaultTop: 60,
        defaultLeft: 360
    }
};

if (typeof window !== 'undefined') {
    window.ExportConfig = ExportConfig;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExportConfig;
}
