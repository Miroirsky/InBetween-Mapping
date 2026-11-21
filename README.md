# InBetween Mapping

Welcome to the **InBetween Mapping** project repository.

---

## 📁 Project Structure

```text
InBetween Mapping/
├── Assets/       # Media, assets, textures, and static resources
├── Scripts/      # Source code files separated by feature and responsibility
├── Styles/       # Styling, theme definitions, and presentation rules
├── Values/       # Global constants, settings, and accessible configuration variables
└── README.md     # Project guidelines and documentation
```

---

## 🛠️ Development & Architecture Guidelines

To keep the codebase maintainable, readable, and scalable, please follow these core rules:

### 1. Great Code Structure & Organization
- Maintain a clean and modular code architecture.
- Keep components loosely coupled and follow the **Single Responsibility Principle (SRP)**.
- Document logic clearly and keep naming conventions consistent throughout the codebase.

### 2. Separate Functionalities into Different Files
- **Do not write monolithic files.**
- Each distinct feature, service, or functionality must reside in its own dedicated file (e.g., inside the `Scripts/` folder or relevant subdirectories).
- Break large modules into smaller, reusable helper functions or classes across separate files.

### 3. Centralize Accessible Variables in the `Values/` Folder
- All configurable variables, tuneable parameters, game/app settings, and global constants that need to be accessed or adjusted must be stored in files inside the **`Values/`** directory.
- Avoid hardcoding values directly within logic scripts.
- Expose values cleanly (e.g., config files, constants modules) so they can be easily reviewed, updated, and referenced across the project.

---

## 🌊 Perlin Noise Background

A black-and-white stepped Perlin/Simplex noise background that scales automatically to any window size and runs at 60 FPS via WebGL.

### Accessible Parameters (`Values/noiseConfig.js`)
All accessible variables are centralized in [`Values/noiseConfig.js`](file:///g:/AI%20Projects/InBetween%20Mapping/Values/noiseConfig.js):
- **`noiseSize`** (default `3.0`): Controls the frequency/zoom of the noise patterns.
- **`noiseSpeed`** (default `0.25`): Controls the animation rate of the noise evolving over time.
- **`steps`** (default `10`): Quantizes the black-and-white gradient into exactly 10 distinct shades between black and white.
- **`octaves`** (default `1`): Number of fractal noise layers.
- **`invert`** (default `false`): Flips black and white values.
- **`maintainAspectRatio`** (default `true`): Keeps noise shapes square regardless of window aspect ratio.

### Project Files
- [`index.html`](file:///g:/AI%20Projects/InBetween%20Mapping/index.html): Main webpage structure.
- [`Values/noiseConfig.js`](file:///g:/AI%20Projects/InBetween%20Mapping/Values/noiseConfig.js): Centralized configuration variables.
- [`Scripts/perlinShader.js`](file:///g:/AI%20Projects/InBetween%20Mapping/Scripts/perlinShader.js): GLSL vertex and fragment shader with 3D noise and step quantization.
- [`Scripts/noiseRenderer.js`](file:///g:/AI%20Projects/InBetween%20Mapping/Scripts/noiseRenderer.js): WebGL renderer managing resolution scaling and render loop.
- [`Scripts/ui.js`](file:///g:/AI%20Projects/InBetween%20Mapping/Scripts/ui.js): Interactive floating control HUD (press `H` to toggle visibility).
- [`Scripts/main.js`](file:///g:/AI%20Projects/InBetween%20Mapping/Scripts/main.js): Application bootstrap.
- [`Styles/style.css`](file:///g:/AI%20Projects/InBetween%20Mapping/Styles/style.css): Fullscreen layout and HUD styling.



---

## 🫧 Universe Bubbles & Physics Board

Interactive universe bubbles placed on top of the Perlin noise background, simulating repulsive spacing forces and full drag-and-drop mechanics.

### Controls & Actions
- **Right-click in the void**: Opens context menu with options:
  - `Create a new Universe`: Spawns a new black bubble with white outline at the cursor position.
  - `Reset Board`: Removes all bubbles from the board.
- **Left-click + Drag on a bubble**: Moves the bubble around freely. Cursor changes to `grab` on hover and `grabbing` while dragging.
- **Right-click on a bubble**: Opens bubble context menu with options:
  - `Lock Bubble` / `Unlock Bubble`: Toggles position lock (locked bubbles cannot be dragged and resist physics pushes).
  - `Remove Universe`: Deletes the bubble.

### Accessible Parameters (`Values/bubbleConfig.js`)
All accessible variables are centralized in [`Values/bubbleConfig.js`](file:///g:/AI%20Projects/InBetween%20Mapping/Values/bubbleConfig.js):
- **`bubbleSizePercent`** (default `12`): Bubble diameter as a percentage of the window (scaled to `vmin`).
- **`outlineSizePercent`** (default `4.0`): Outline thickness as a percentage of the bubble diameter.
- **`bubbleGapMultiplier`** (default `1.0`): Desired distance between bubble edges (**1 bubble distance by default**).
- **`repulsionStrength`** (default `0.06`): Magnitude of repulsion force pushing bubbles apart.
- **`damping`** (default `0.82`): Friction and velocity damping per physics step.
- **`maxSpeed`** (default `15.0`): Speed clamp to prevent bouncing instability.
- **`bubbleColor`** (`#000000`) & **`outlineColor`** (`#ffffff`): Color scheme.
- **`lockedOutlineColor`** (`#ff4d4d`): Distinct outline color for locked bubbles.

### Universe & Physics Files
- [`Values/bubbleConfig.js`](file:///g:/AI%20Projects/InBetween%20Mapping/Values/bubbleConfig.js): Configuration file for bubbles, sizing, physics constants, and colors.
- [`Scripts/bubbleManager.js`](file:///g:/AI%20Projects/InBetween%20Mapping/Scripts/bubbleManager.js): Bubble creation, deletion, locking, and window percentage sizing calculations.
- [`Scripts/physics.js`](file:///g:/AI%20Projects/InBetween%20Mapping/Scripts/physics.js): Physics simulation engine handling repulsive distances, damping, velocity, and boundary containment.
- [`Scripts/contextMenu.js`](file:///g:/AI%20Projects/InBetween%20Mapping/Scripts/contextMenu.js): Custom right-click context menu manager for both void and bubble interactions.
- [`Scripts/interaction.js`](file:///g:/AI%20Projects/InBetween%20Mapping/Scripts/interaction.js): Mouse drag-and-drop, cursor management (`grab`/`grabbing`/`not-allowed`), and event routing.

---

## 🔗 Universe Connections

Directed black arrows connecting universes with centered labels and distance-keeping physics constraints.

### Controls & Actions
- **Right-click on a Bubble -> `Add Connection`**: Enters connection mode. Move cursor to target universe and left-click it (or press Escape / click void to cancel).
- **Mandatory Connection Name**: Prompt modal opens asking for a connection name. Names remain clean and subtle, displaying smoothly centered on the arrow when hovered.
- **Fixed Distance Constraint**: Connected universes are constrained by physics to always remain at the exact same repulsion distance (`targetDistance`).
- **Bidirectional Connections**: Connections can be created in both directions ($A \rightarrow B$ and $B \rightarrow A$) with different names. Curved paths ensure both arrows and labels remain distinct and readable.
- **Right-click on a Connection (line or label)**:
  - `Edit Name`: Renames the connection via modal dialog.
  - `Remove Connection`: Deletes the connection.

### Accessible Parameters (`Values/connectionConfig.js`)
All accessible variables are centralized in [`Values/connectionConfig.js`](file:///g:/AI%20Projects/InBetween%20Mapping/Values/connectionConfig.js):
- **`arrowColor`** (`#000000`): Black arrow body.
- **`arrowOutlineColor`** (`#ffffff`): Crisp white stroke for visibility against any background.
- **`arrowWidth`** (`3.5`): Stroke width in pixels.
- **`arrowHeadLength`** (`14`) & **`arrowHeadWidth`** (`10`): Arrowhead dimensions.
- **`textColor`** (`#ffffff`): Connection name text color.
- **`textFontSize`** (`12`): Font size of the name.
- **`textBackgroundColor`** (`#000000`): Background pill fill.
- **`textBorderColor`** (`#ffffff`): Background pill border.
- **`springStrength`** (`0.12`): Strength of the fixed-distance physics constraint.
- **`bidirectionalCurveOffset`** (`32`): Curvature separation when two opposite connections exist between the same pair.

### Connection Files
- [`Values/connectionConfig.js`](file:///g:/AI%20Projects/InBetween%20Mapping/Values/connectionConfig.js): Sizing, colors, arrow parameters, and physics constraints.
- [`Scripts/connectionManager.js`](file:///g:/AI%20Projects/InBetween%20Mapping/Scripts/connectionManager.js): SVG rendering of directed arrows, curved bidirectional paths, and measured text pills.

---

## 🪟 View Menu & Window System (Saving & Params)

A top-left view navigation menu that launches movable, closable, and reducible glassmorphic windows.

### Controls & Windows
- **View Menu (Top-Left)**: Click "View" to reveal dropdown options:
  - **Saving**: Opens the local board saves window.
    - Save current board setups with custom or auto-generated names to browser `localStorage`.
    - View all saved boards with creation dates, universe counts, and connection counts.
    - Open / load any saved board instantly.
    - Delete unwanted saved boards.
- **Active Board Status & Quick Save (Bottom-Left)**:
  - When a saved board is opened or saved, its name appears in an active status pill in the bottom-left corner.
  - **Rename Active Board**: Click the pencil icon or double-click the board name to rename it via prompt dialog.
  - Click **Save** on the pill or press <kbd>Ctrl+S</kbd> (<kbd>Cmd+S</kbd>) to instantly update the active board with current universes, connections, and noise settings.
  - Visual feedback flashes `Saved! ✓` upon updating.
- **Rename Saved Boards**:
  - In the **Saving** window list, click the pencil icon or double-click on any board's title to rename it.
- **Persistent Across Refreshes**:
  - The board state is automatically preserved in `localStorage`; refreshing the page does not reset your universes or connections.
  - Resetting via context menu ("Reset Board") cleanly wipes the board and session.
- **Params**: Opens the Noise Parameters window.
  - Scales noise settings from **10% to 1000%** of default reference values.
  - Sliders display current percentage and actual numeric values:
    - Noise Size (10% to 1000%)
    - Noise Speed (10% to 1000%)
    - Shade Steps (10% to 1000%)
    - Octaves (10% to 1000%)
  - Quick toggles for Invert Colors and Keep Aspect Ratio.
  - Single-click "Reset to Default (100%)" button.
- **Reset View**:
  - Located in the View Menu dropdown. Instantly recenters the board and resets zoom back to 100%.
- **Canvas Pan & Zoom**:
  - **Left-Click Drag Background**: Pan the board and noise background smoothly in lockstep across infinite space. Cursor changes to `grabbing`.
  - **Mouse Scroll Wheel**: Zoom in and out centered precisely around your cursor (zoom limits: 0.15x to 8.0x).
  - **Frameless Scaling**: The main scaling square outline has been removed for an unbounded canvas aesthetic while preserving coordinate mathematics and universe placement outside the original square.
- **Window Capabilities**:
  - **Movable**: Drag windows smoothly across the screen by their header bar (clamped to screen boundaries).
  - **Closable**: Click the `×` button to close any window.
  - **Reducible**: Click the `—` / `+` button to collapse or expand the window body.
  - **Z-Index Focus**: Clicking on any window brings it to the top.

### Window & Navigation Files
- [`Values/windowConfig.js`](file:///g:/AI%20Projects/InBetween%20Mapping/Values/windowConfig.js): Sizing, default positions, scaling ranges, and storage keys.
- [`Scripts/windowManager.js`](file:///g:/AI%20Projects/InBetween%20Mapping/Scripts/windowManager.js): Reusable draggable, closable, and reducible floating window component.
- [`Scripts/savingManager.js`](file:///g:/AI%20Projects/InBetween%20Mapping/Scripts/savingManager.js): Local board persistence, listing, opening, and deleting.
- [`Scripts/paramsManager.js`](file:///g:/AI%20Projects/InBetween%20Mapping/Scripts/paramsManager.js): Live noise parameter controls with 10%–1000% scaling.
- [`Scripts/viewMenu.js`](file:///g:/AI%20Projects/InBetween%20Mapping/Scripts/viewMenu.js): Top-left navigation trigger and dropdown menu.
