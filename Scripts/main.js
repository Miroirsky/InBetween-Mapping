/**
 * Main Application Entry Point
 * ------------------------------------------------------------------
 * Coordinates configuration, background renderer, universe bubbles,
 * connections, physics simulation, and mouse interactions.
 */

document.addEventListener('DOMContentLoaded', () => {
    // 0. Initial Board Frame Scale
    const initialDim = Math.min(window.innerWidth, window.innerHeight);
    document.documentElement.style.setProperty('--board-scale', initialDim / 1000);
    document.documentElement.style.setProperty('--board-pan-x', '0px');
    document.documentElement.style.setProperty('--board-pan-y', '0px');

    // 1. Noise Background Setup
    const canvas = document.getElementById('noise-canvas');
    const noiseConfig = window.NoiseConfig;

    let renderer = null;

    if (canvas && noiseConfig) {
        renderer = new window.NoiseRenderer(canvas, noiseConfig);
        renderer.start();
    } else {
        console.warn('Noise canvas or NoiseConfig not initialized.');
    }

    // 2. Universe Bubbles Setup
    const bubbleContainer = document.getElementById('bubble-container') || document.body;
    const bubbleConfig = window.BubbleConfig;

    if (!bubbleConfig) {
        console.error('BubbleConfig from Values/bubbleConfig.js was not loaded.');
        return;
    }

    const bubbleManager = new window.BubbleManager(bubbleContainer, bubbleConfig);

    // 3. Connections Setup
    const svgLayer = document.getElementById('connection-svg-layer');
    const connectionConfig = window.ConnectionConfig;
    let connectionManager = null;

    if (svgLayer && connectionConfig) {
        connectionManager = new window.ConnectionManager(svgLayer, bubbleManager, connectionConfig);
        bubbleManager.setConnectionManager(connectionManager);
    }

    // 3.5 Comments Setup
    const commentContainer = document.getElementById('comment-container');
    const commentSvgLayer = document.getElementById('comment-connection-svg-layer');
    const commentConfig = window.CommentConfig;
    let commentManager = null;

    if (window.CommentManager && commentContainer && commentSvgLayer) {
        commentManager = new window.CommentManager(commentContainer, commentSvgLayer, bubbleManager, commentConfig);
        bubbleManager.setCommentManager(commentManager);
    }

    // 4. Physics Simulation Setup
    const bubblePhysics = new window.BubblePhysics(bubbleManager, bubbleConfig, connectionManager, connectionConfig, commentManager);
    bubblePhysics.start();

    // 5. Context Menu & Interaction Setup
    const contextMenu = new window.ContextMenu(bubbleManager, connectionManager, commentManager);
    const interactionManager = new window.InteractionManager(bubbleManager, contextMenu, connectionManager, commentManager);

    if (renderer) {
        interactionManager.setNoiseRenderer(renderer);
    }
    window.addEventListener('resize', () => {
        interactionManager.applyViewTransform();
    });

    // 6. Window System & View Menu Setup
    const windowConfig = window.WindowConfig;
    const exportConfig = window.ExportConfig;

    let paramsManager = null;
    if (window.ParamsManager && noiseConfig) {
        paramsManager = new window.ParamsManager(noiseConfig, windowConfig);
    }

    let savingManager = null;
    let exportManager = null;

    if (window.SavingManager) {
        savingManager = new window.SavingManager(
            bubbleManager,
            connectionManager,
            noiseConfig,
            windowConfig,
            () => {
                if (paramsManager) paramsManager.syncFromConfig();
            }
        );
        savingManager.setContextMenu(contextMenu);
        bubbleManager.setSavingManager(savingManager);
        if (commentManager) {
            savingManager.setCommentManager(commentManager);
            commentManager.setSavingManager(savingManager);
        }
    }

    if (window.ExportManager && savingManager) {
        exportManager = new window.ExportManager(
            bubbleManager,
            connectionManager,
            noiseConfig,
            savingManager,
            windowConfig,
            exportConfig,
            () => {
                if (paramsManager) paramsManager.syncFromConfig();
            }
        );
        savingManager.setExportManager(exportManager);
        if (commentManager) {
            exportManager.setCommentManager(commentManager);
        }
    }

    if (savingManager) {
        // Auto-restore board state on refresh (or load active board)
        savingManager.initAutoRestore();
    }

    let displayManager = null;
    if (window.DisplayManager && connectionManager) {
        displayManager = new window.DisplayManager(connectionManager, windowConfig, savingManager);
    }

    let viewMenu = null;
    if (window.ViewMenu && savingManager && paramsManager) {
        viewMenu = new window.ViewMenu(savingManager, paramsManager, interactionManager, exportManager, null, connectionManager, displayManager);
    }

    // 7. Firebase & Online Multiplayer Room Setup
    const firebaseConfig = window.FirebaseConfig;
    let firebaseService = null;
    let onlineManager = null;

    if (window.OnlineManager && savingManager) {
        if (window.FirebaseService) {
            firebaseService = new window.FirebaseService(firebaseConfig);
        }
        onlineManager = new window.OnlineManager(
            bubbleManager,
            connectionManager,
            savingManager,
            noiseConfig,
            firebaseService,
            firebaseConfig
        );

        bubbleManager.setOnlineManager(onlineManager);
        if (connectionManager) {
            connectionManager.setOnlineManager(onlineManager);
        }

        if (viewMenu) {
            viewMenu.setOnlineManager(onlineManager);
        }
    }

    // Expose all modules on window.app for easy debugging or scripting
    window.app = {
        noiseRenderer: renderer,
        noiseConfig,
        bubbleManager,
        bubblePhysics,
        bubbleConfig,
        connectionManager,
        connectionConfig,
        commentManager,
        commentConfig,
        contextMenu,
        interactionManager,
        windowConfig,
        exportConfig,
        savingManager,
        exportManager,
        paramsManager,
        displayManager,
        viewMenu,
        firebaseConfig,
        firebaseService,
        onlineManager
    };
});
