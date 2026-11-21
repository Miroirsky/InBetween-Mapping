/**
 * Main Application Entry Point
 * ------------------------------------------------------------------
 * Coordinates configuration, background renderer, universe bubbles,
 * connections, physics simulation, and mouse interactions.
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Noise Background Setup
    const canvas = document.getElementById('noise-canvas');
    const noiseConfig = window.NoiseConfig;

    let renderer = null;
    let ui = null;

    if (canvas && noiseConfig) {
        renderer = new window.NoiseRenderer(canvas, noiseConfig);
        renderer.start();
        ui = new window.NoiseUI(noiseConfig);
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

    // Expose all modules on window.app for easy debugging or scripting
    window.app = {
        noiseRenderer: renderer,
        noiseUI: ui,
        noiseConfig,
        bubbleManager,
        bubblePhysics,
        bubbleConfig,
        connectionManager,
        connectionConfig,
        contextMenu,
        interactionManager
    };
});
