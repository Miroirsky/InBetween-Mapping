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

    // 4. Physics Simulation Setup
    const bubblePhysics = new window.BubblePhysics(bubbleManager, bubbleConfig, connectionManager, connectionConfig);
    bubblePhysics.start();

    // 5. Context Menu & Interaction Setup
    const contextMenu = new window.ContextMenu(bubbleManager, connectionManager);
    const interactionManager = new window.InteractionManager(bubbleManager, contextMenu, connectionManager);

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
    }

    if (savingManager) {
        // Auto-restore board state on refresh (or load active board)
        savingManager.initAutoRestore();
    }

    let viewMenu = null;
    if (window.ViewMenu && savingManager && paramsManager) {
        viewMenu = new window.ViewMenu(savingManager, paramsManager, interactionManager, exportManager);
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
        contextMenu,
        interactionManager,
        windowConfig,
        exportConfig,
        savingManager,
        exportManager,
        paramsManager,
        viewMenu,
        firebaseConfig,
        firebaseService,
        onlineManager
    };
});
