/**
 * Online Manager
 * ------------------------------------------------------------------
 * Coordinates the shared multiplayer room using Firebase Realtime Database
 * and Cloud Firestore:
 * - Single online room (join/leave)
 * - Realtime Database: powers live shared board synchronization
 * - Cloud Firestore: archives board snapshots ONLY when users join or leave
 * - Keeps local solo editor board totally intact when leaving
 */

class OnlineManager {
    constructor(bubbleManager, connectionManager, savingManager, noiseConfig, firebaseService = null, config = null) {
        this.bubbleManager = bubbleManager;
        this.connectionManager = connectionManager;
        this.savingManager = savingManager;
        this.noiseConfig = noiseConfig;
        this.config = config || window.FirebaseConfig;
        this.firebaseService = firebaseService || new window.FirebaseService(this.config);

        this.roomId = (this.config && this.config.roomId) || 'global_room';
        this.isOnline = false;
        this.isApplyingRemote = false;
        this.localBoardBackup = null;

        // User Identity
        this.user = this.initUserIdentity();
        this.onlineUsers = [];

        // Drag throttling
        this.dragThrottleTimer = null;
        this.lastDragTimestamp = 0;
        this.pendingDragUpdates = new Map(); // bubbleId -> { x, y }

        // Window & UI Elements
        this.window = null;
        this.topOnlineBtn = null;
        this.topStatusDot = null;
        this.topUserBadge = null;

        this.lastFirestoreSnapshotInfo = null;

        this.initWindow();
        this.initFirebaseService();
    }

    /**
     * Initializes or loads persisted user profile.
     */
    initUserIdentity() {
        const key = (this.config && this.config.userProfileStorageKey) || 'inbetween_mapping_user_profile';
        try {
            const raw = localStorage.getItem(key);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.id && parsed.name) {
                    return parsed;
                }
            }
        } catch (e) {}

        const colors = ['#38bdf8', '#4ade80', '#fbbf24', '#f87171', '#c084fc', '#fb923c', '#2dd4bf'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        const randomNum = Math.floor(100 + Math.random() * 900);

        const newUser = {
            id: `user_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`,
            name: `Explorer ${randomNum}`,
            color: randomColor
        };

        try {
            localStorage.setItem(key, JSON.stringify(newUser));
        } catch (e) {}

        return newUser;
    }

    saveUserIdentity(name, color) {
        if (name && name.trim()) this.user.name = name.trim();
        if (color) this.user.color = color;

        const key = (this.config && this.config.userProfileStorageKey) || 'inbetween_mapping_user_profile';
        try {
            localStorage.setItem(key, JSON.stringify(this.user));
        } catch (e) {}

        // If online, update presence
        if (this.isOnline) {
            this.firebaseService.setupPresence(this.roomId, this.user, (users) => this.onPresenceUpdated(users));
        }
    }

    initFirebaseService() {
        this.firebaseService.onStatusChange((status) => {
            this.updateStatusUI(status);
        });
    }

    /* ==================================================================
       Online Room Lifecycle: Join & Leave
       ================================================================== */

    /**
     * Joins the single online room:
     * 1. Backs up the local solo board state (to keep local version totally intact).
     * 2. Connects to Firebase Realtime Database for live sync.
     * 3. Saves room snapshot and join event in Cloud Firestore.
     */
    async joinRoom() {
        if (this.isOnline) return;

        // 1. Back up local solo editor state
        this.localBoardBackup = {
            state: this.savingManager.serializeCurrentState(),
            activeBoardId: this.savingManager.activeBoardId,
            activeBoardName: this.savingManager.activeBoardName
        };

        try {
            const backupKey = (this.config && this.config.soloBackupStorageKey) || 'inbetween_mapping_solo_board_backup';
            localStorage.setItem(backupKey, JSON.stringify(this.localBoardBackup));
        } catch (e) {
            console.warn('Could not store solo backup in localStorage:', e);
        }

        this.showToast('Connecting to Online Room...', 'info');

        // 2. Initialize Firebase service
        const initResult = await this.firebaseService.initialize();
        if (!initResult.success && !initResult.simulated) {
            this.showToast(`Firebase error: ${initResult.error || 'Connection failed'}`, 'error');
            return;
        }

        this.isOnline = true;

        // 3. Setup presence in Realtime Database
        this.firebaseService.setupPresence(this.roomId, this.user, (users) => {
            this.onPresenceUpdated(users);
        });

        // 4. Fetch current room board or initialize it
        try {
            const remoteBoard = await this.firebaseService.fetchCurrentBoard(this.roomId);

            if (remoteBoard && remoteBoard.bubbles) {
                // Room has existing board in Realtime Database -> load it
                this.loadRoomBoardIntoCanvas(remoteBoard);
            } else {
                // Check if Cloud Firestore has an archived snapshot
                const firestoreDoc = await this.firebaseService.getFirestoreSnapshot(this.roomId);
                if (firestoreDoc && firestoreDoc.board && firestoreDoc.board.bubbles && firestoreDoc.board.bubbles.length > 0) {
                    // Restore board from Firestore archive into Realtime Database
                    await this.firebaseService.setBoard(this.roomId, firestoreDoc.board, this.user);
                    this.loadRoomBoardIntoCanvas(firestoreDoc.board);
                } else {
                    // Brand new room -> initialize Realtime Database with current board snapshot
                    const initialBoard = this.savingManager.serializeCurrentState();
                    await this.firebaseService.setBoard(this.roomId, initialBoard, this.user);
                }
            }
        } catch (err) {
            console.error('Error fetching room board:', err);
        }

        // 5. Attach live Realtime Database listeners
        this.firebaseService.listenToBoard(this.roomId, {
            onBoardValue: (data) => this.onRemoteBoardValue(data),
            onBubblePosition: (id, x, y) => this.onRemoteBubblePosition(id, x, y),
            onBubbleUpdate: (id, data) => this.onRemoteBubbleUpdate(id, data),
            onBubbleRemove: (id) => this.onRemoteBubbleRemove(id),
            onConnUpdate: (id, data) => this.onRemoteConnUpdate(id, data),
            onConnRemove: (id) => this.onRemoteConnRemove(id)
        });

        // 6. Save in Cloud Firestore when joining (as requested)
        const currentBoardState = this.savingManager.serializeCurrentState();
        const firestoreResult = await this.firebaseService.saveFirestoreSnapshot(
            this.roomId,
            currentBoardState,
            'join',
            this.user
        );

        if (firestoreResult.success) {
            this.lastFirestoreSnapshotInfo = {
                action: 'join',
                timestamp: new Date().toLocaleTimeString(),
                user: this.user.name
            };
        }

        // 7. Update UI to Online Mode
        this.updateOnlineStateUI(true);
        this.showToast('Joined Online Room! Changes sync live via Realtime DB.', 'success');
    }

    /**
     * Leaves the online room:
     * 1. Saves final room snapshot and leave event in Cloud Firestore.
     * 2. Cleans up presence and detaches Realtime Database listeners.
     * 3. Restores the local solo editor board totally intact!
     */
    async leaveRoom() {
        if (!this.isOnline) return;

        this.showToast('Leaving Online Room...', 'info');

        // 1. Save in Cloud Firestore when leaving (as requested)
        try {
            const currentBoardState = this.savingManager.serializeCurrentState();
            await this.firebaseService.saveFirestoreSnapshot(
                this.roomId,
                currentBoardState,
                'leave',
                this.user
            );
        } catch (err) {
            console.error('Error saving leave snapshot to Firestore:', err);
        }

        // 2. Clean up Realtime Database presence and listeners
        this.firebaseService.clearPresence(this.roomId, this.user.id);
        this.firebaseService.stopListeningToBoard(this.roomId);

        this.isOnline = false;

        // 3. Restore the local solo editor board totally intact!
        this.restoreLocalSoloBoard();

        // 4. Update UI back to Solo Mode
        this.updateOnlineStateUI(false);
        this.showToast('Returned to Solo Editor. Local board intact.', 'success');
    }

    /**
     * Restores the local solo editor board exactly as it was before joining.
     */
    restoreLocalSoloBoard() {
        let backup = this.localBoardBackup;

        if (!backup) {
            try {
                const backupKey = (this.config && this.config.soloBackupStorageKey) || 'inbetween_mapping_solo_board_backup';
                const raw = localStorage.getItem(backupKey);
                if (raw) backup = JSON.parse(raw);
            } catch (e) {
                console.warn('Error reading solo backup:', e);
            }
        }

        if (!backup || !backup.state) {
            console.warn('No local solo board backup found to restore.');
            return;
        }

        this.isApplyingRemote = true;

        try {
            // Clear current canvas
            this.bubbleManager.clearBoard();

            const state = backup.state;

            // Restore bubbles
            if (Array.isArray(state.bubbles)) {
                state.bubbles.forEach(b => {
                    this.bubbleManager.createBubble(b.x, b.y, b.name, b.color, b.id, b.isLocked);
                });
            }

            // Restore connections
            if (this.connectionManager && Array.isArray(state.connections)) {
                state.connections.forEach(c => {
                    this.connectionManager.createConnection(c.fromId, c.toId, c.name, c.id);
                });
            }

            // Restore noise config
            if (state.noiseData && this.noiseConfig) {
                Object.assign(this.noiseConfig, state.noiseData);
            }

            // Restore active board status in savingManager
            if (this.savingManager) {
                this.savingManager.setActiveBoard(backup.activeBoardId || null, backup.activeBoardName || 'Current Board');
                // Save session snapshot to localStorage
                this.savingManager.saveSessionSnapshot();
            }
        } finally {
            this.isApplyingRemote = false;
        }
    }

    /**
     * Loads a room board state into the canvas.
     */
    loadRoomBoardIntoCanvas(boardData) {
        if (!boardData) return;

        this.isApplyingRemote = true;

        try {
            this.bubbleManager.clearBoard();

            // Convert bubbles object/array
            const bubbles = Array.isArray(boardData.bubbles) ? boardData.bubbles : (boardData.bubbles ? Object.values(boardData.bubbles) : []);
            bubbles.forEach(b => {
                this.bubbleManager.createBubble(b.x, b.y, b.name, b.color, b.id, b.isLocked);
            });

            // Convert connections object/array
            const connections = Array.isArray(boardData.connections) ? boardData.connections : (boardData.connections ? Object.values(boardData.connections) : []);
            if (this.connectionManager) {
                connections.forEach(c => {
                    this.connectionManager.createConnection(c.fromId, c.toId, c.name, c.id);
                });
            }

            // Noise config if provided
            if (boardData.noiseConfig && this.noiseConfig) {
                Object.assign(this.noiseConfig, boardData.noiseConfig);
            }
        } finally {
            this.isApplyingRemote = false;
        }
    }

    /* ==================================================================
       Incoming Realtime Database Sync
       ================================================================== */

    /**
     * Handles full or partial updates from Realtime Database.
     */
    onRemoteBoardValue(data) {
        if (!this.isOnline || !data) return;

        this.isApplyingRemote = true;

        try {
            // 1. Synchronize Bubbles
            const remoteBubblesMap = data.bubbles || {};
            const remoteBubbleList = Array.isArray(remoteBubblesMap) ? remoteBubblesMap.filter(Boolean) : Object.values(remoteBubblesMap);
            const remoteIds = new Set(remoteBubbleList.map(b => Number(b.id)));

            // Update or create remote bubbles
            remoteBubbleList.forEach(rb => {
                const id = Number(rb.id);
                const local = this.bubbleManager.getBubbleById(id);

                if (local) {
                    // If user is currently dragging this bubble, do not snap position to avoid fighting
                    if (!local.isDragging) {
                        local.x = rb.x;
                        local.y = rb.y;
                        local.vx = 0;
                        local.vy = 0;
                        this.bubbleManager.updateElementPosition(local);
                    }

                    if (local.name !== rb.name && rb.name) {
                        this.bubbleManager.renameBubble(id, rb.name);
                    }

                    if (local.color !== rb.color && rb.color) {
                        this.bubbleManager.setBubbleColor(id, rb.color);
                    }

                    if (!!local.isLocked !== !!rb.isLocked) {
                        local.isLocked = !!rb.isLocked;
                        if (local.isLocked) {
                            local.element.classList.add('is-locked');
                        } else {
                            local.element.classList.remove('is-locked');
                        }
                    }
                } else {
                    // Create newly added bubble from peer
                    this.bubbleManager.createBubble(rb.x, rb.y, rb.name, rb.color, id, rb.isLocked);
                }
            });

            // Remove local bubbles deleted by peers
            const localBubblesCopy = [...this.bubbleManager.bubbles];
            localBubblesCopy.forEach(lb => {
                if (!remoteIds.has(lb.id)) {
                    this.bubbleManager.removeBubble(lb.id);
                }
            });

            // 2. Synchronize Connections
            if (this.connectionManager) {
                const remoteConnsMap = data.connections || {};
                const remoteConnList = Array.isArray(remoteConnsMap) ? remoteConnsMap.filter(Boolean) : Object.values(remoteConnsMap);
                const remoteConnIds = new Set(remoteConnList.map(c => Number(c.id)));

                remoteConnList.forEach(rc => {
                    const id = Number(rc.id);
                    const localConn = this.connectionManager.getConnectionById(id);

                    if (localConn) {
                        if (localConn.name !== rc.name) {
                            this.connectionManager.renameConnection(id, rc.name);
                        }
                    } else {
                        // Check if both bubbles exist before creating connection
                        if (this.bubbleManager.getBubbleById(rc.fromId) && this.bubbleManager.getBubbleById(rc.toId)) {
                            this.connectionManager.createConnection(rc.fromId, rc.toId, rc.name, id);
                        }
                    }
                });

                // Remove connections deleted by peers
                const localConnsCopy = [...this.connectionManager.connections];
                localConnsCopy.forEach(lc => {
                    if (!remoteConnIds.has(lc.id)) {
                        this.connectionManager.removeConnection(lc.id);
                    }
                });

                this.connectionManager.render();
            }
        } finally {
            this.isApplyingRemote = false;
        }

        this.renderRoomDetails();
    }

    onRemoteBubblePosition(bubbleId, x, y) {
        if (!this.isOnline) return;
        const local = this.bubbleManager.getBubbleById(Number(bubbleId));
        if (local && !local.isDragging) {
            local.x = x;
            local.y = y;
            local.vx = 0;
            local.vy = 0;
            this.bubbleManager.updateElementPosition(local);
            if (this.connectionManager) {
                this.connectionManager.render();
            }
        }
    }

    onRemoteBubbleUpdate(bubbleId, data) {
        if (!this.isOnline) return;
        const id = Number(bubbleId);
        const local = this.bubbleManager.getBubbleById(id);
        if (local) {
            if (data.name !== undefined) this.bubbleManager.renameBubble(id, data.name);
            if (data.color !== undefined) this.bubbleManager.setBubbleColor(id, data.color);
            if (data.isLocked !== undefined && local.isLocked !== !!data.isLocked) {
                this.bubbleManager.toggleLock(id);
            }
        }
    }

    onRemoteBubbleRemove(bubbleId) {
        if (!this.isOnline) return;
        this.bubbleManager.removeBubble(Number(bubbleId));
    }

    onRemoteConnUpdate(connId, data) {
        if (!this.isOnline || !this.connectionManager) return;
        const id = Number(connId);
        const local = this.connectionManager.getConnectionById(id);
        if (local) {
            if (data.name !== undefined) this.connectionManager.renameConnection(id, data.name);
        } else if (data.fromId && data.toId) {
            this.connectionManager.createConnection(data.fromId, data.toId, data.name, id);
        }
    }

    onRemoteConnRemove(connId) {
        if (!this.isOnline || !this.connectionManager) return;
        this.connectionManager.removeConnection(Number(connId));
    }

    onPresenceUpdated(users) {
        this.onlineUsers = users || [];
        this.renderPresenceList();
        this.updateTopBarBadge();
    }

    /* ==================================================================
       Outgoing Local Changes -> Realtime Database Sync
       ================================================================== */

    /**
     * Broadcasts bubble creation to Realtime Database.
     */
    onBubbleCreated(bubble) {
        if (!this.isOnline || this.isApplyingRemote) return;
        this.firebaseService.updateBubble(this.roomId, bubble.id, {
            id: bubble.id,
            name: bubble.name,
            color: bubble.color,
            x: Math.round(bubble.x * 100) / 100,
            y: Math.round(bubble.y * 100) / 100,
            isLocked: !!bubble.isLocked
        });
        this.renderRoomDetails();
    }

    /**
     * Throttled bubble drag position sync.
     */
    onBubbleDrag(bubble) {
        if (!this.isOnline || this.isApplyingRemote) return;

        const now = Date.now();
        const throttle = (this.config && this.config.dragThrottleMs) || 50;

        this.pendingDragUpdates.set(bubble.id, { x: bubble.x, y: bubble.y });

        if (now - this.lastDragTimestamp >= throttle) {
            this.flushPendingDrags();
            this.lastDragTimestamp = now;
        } else if (!this.dragThrottleTimer) {
            this.dragThrottleTimer = setTimeout(() => {
                this.dragThrottleTimer = null;
                this.flushPendingDrags();
                this.lastDragTimestamp = Date.now();
            }, throttle - (now - this.lastDragTimestamp));
        }
    }

    flushPendingDrags() {
        for (const [id, pos] of this.pendingDragUpdates.entries()) {
            this.firebaseService.updateBubblePosition(this.roomId, id, pos.x, pos.y);
        }
        this.pendingDragUpdates.clear();
    }

    /**
     * Ensures final position is broadcast on drag release.
     */
    onBubbleDragEnd(bubble) {
        if (!this.isOnline || this.isApplyingRemote) return;
        if (this.dragThrottleTimer) {
            clearTimeout(this.dragThrottleTimer);
            this.dragThrottleTimer = null;
        }
        this.firebaseService.updateBubblePosition(this.roomId, bubble.id, bubble.x, bubble.y);
    }

    onBubbleLockChanged(bubble) {
        if (!this.isOnline || this.isApplyingRemote) return;
        this.firebaseService.updateBubble(this.roomId, bubble.id, { isLocked: !!bubble.isLocked });
    }

    onBubbleRenamed(bubble) {
        if (!this.isOnline || this.isApplyingRemote) return;
        this.firebaseService.updateBubble(this.roomId, bubble.id, { name: bubble.name });
    }

    onBubbleColorChanged(bubble) {
        if (!this.isOnline || this.isApplyingRemote) return;
        this.firebaseService.updateBubble(this.roomId, bubble.id, { color: bubble.color });
    }

    onBubbleRemoved(bubbleId) {
        if (!this.isOnline || this.isApplyingRemote) return;
        this.firebaseService.removeBubble(this.roomId, bubbleId);
        this.renderRoomDetails();
    }

    onBoardReset() {
        if (!this.isOnline || this.isApplyingRemote) return;
        this.firebaseService.clearBoard(this.roomId);
        this.renderRoomDetails();
    }

    onConnectionCreated(conn) {
        if (!this.isOnline || this.isApplyingRemote) return;
        this.firebaseService.updateConnection(this.roomId, conn.id, {
            id: conn.id,
            fromId: conn.fromId,
            toId: conn.toId,
            name: conn.name
        });
        this.renderRoomDetails();
    }

    onConnectionRenamed(conn) {
        if (!this.isOnline || this.isApplyingRemote) return;
        this.firebaseService.updateConnection(this.roomId, conn.id, { name: conn.name });
    }

    onConnectionRemoved(connId) {
        if (!this.isOnline || this.isApplyingRemote) return;
        this.firebaseService.removeConnection(this.roomId, connId);
        this.renderRoomDetails();
    }

    /* ==================================================================
       Online Menu Floating Window & UI
       ================================================================== */

    initWindow() {
        const winCfg = (this.config && this.config.window) || { width: 360, defaultTop: 60, defaultLeft: 220 };

        this.window = new window.FloatingWindow({
            id: 'online-room-window',
            title: 'Online Room',
            width: winCfg.width,
            defaultTop: winCfg.defaultTop,
            defaultLeft: winCfg.defaultLeft,
            contentHTML: this.getInitialWindowHTML()
        });

        this.bindWindowEvents();
    }

    getInitialWindowHTML() {
        return `
            <div class="online-window-content">
                <!-- Status Banner -->
                <div id="online-status-banner" class="online-status-banner solo">
                    <div class="online-status-indicator">
                        <span class="status-pulse-dot"></span>
                        <span id="online-status-text" class="status-title">Solo Editor (Offline)</span>
                    </div>
                    <span id="online-mode-pill" class="online-mode-pill">Local Mode</span>
                </div>

                <!-- User Profile Card -->
                <div class="online-profile-card">
                    <div class="profile-avatar" id="online-user-avatar" style="background-color: ${this.user.color};" title="Click to change color">
                        ${this.user.name.charAt(0).toUpperCase()}
                    </div>
                    <div class="profile-info">
                        <label class="profile-label">Your Display Name</label>
                        <div class="profile-input-wrapper">
                            <input type="text" id="online-username-input" class="profile-input" maxlength="24" value="${this.user.name}" placeholder="Your username...">
                            <button type="button" id="online-color-btn" class="profile-color-picker-btn" title="Pick Avatar Color">
                                <span class="color-preview-circle" id="online-color-preview" style="background-color: ${this.user.color};"></span>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Main Join / Leave Button -->
                <div class="online-action-row">
                    <button type="button" id="btn-toggle-online" class="online-primary-btn join">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="2" y1="12" x2="22" y2="12"></line>
                            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                        </svg>
                        <span id="btn-toggle-online-text">Join Online Room</span>
                    </button>
                </div>

                <!-- Online Room Details (Visible when online) -->
                <div id="online-room-details" class="online-room-details" style="display: none;">
                    <div class="room-stats-grid">
                        <div class="room-stat-card">
                            <span class="stat-number" id="room-stat-bubbles">0</span>
                            <span class="stat-label">Universes</span>
                        </div>
                        <div class="room-stat-card">
                            <span class="stat-number" id="room-stat-conns">0</span>
                            <span class="stat-label">Connections</span>
                        </div>
                        <div class="room-stat-card">
                            <span class="stat-number" id="room-stat-users">1</span>
                            <span class="stat-label">Peers</span>
                        </div>
                    </div>

                    <!-- Active Peers List -->
                    <div class="online-peers-section">
                        <div class="peers-header">
                            <span class="peers-title">Connected Explorers</span>
                            <span class="peers-badge" id="online-peers-count">1 Online</span>
                        </div>
                        <div id="online-peers-list" class="online-peers-list"></div>
                    </div>

                    <!-- Cloud Firestore Snapshot Status Card -->
                    <div class="firestore-status-card">
                        <div class="firestore-card-header">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                                <polyline points="17 21 17 13 7 13 7 21"></polyline>
                                <polyline points="7 3 7 8 15 8"></polyline>
                            </svg>
                            <span class="firestore-card-title">Firestore Snapshot Store</span>
                        </div>
                        <p class="firestore-card-desc">
                            Edits sync live via Realtime DB. Firestore saves room snapshots <strong>only on Join & Leave</strong>.
                        </p>
                        <div class="firestore-meta-row">
                            <span class="firestore-meta-label">Last Snapshot:</span>
                            <span id="firestore-last-saved" class="firestore-meta-val">Saved on Join</span>
                        </div>
                        <button type="button" id="btn-manual-firestore-snapshot" class="firestore-manual-btn" title="Archive snapshot to Firestore now">
                            Save Snapshot to Firestore Now
                        </button>
                    </div>
                </div>

                <!-- Firebase Configuration Collapsible -->
                <div class="firebase-config-collapsible">
                    <button type="button" id="btn-toggle-fb-config" class="fb-config-toggle-btn">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="3"></circle>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                        </svg>
                        <span>Firebase Configuration</span>
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" class="fb-chevron">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </button>
                    <div id="fb-config-panel" class="fb-config-panel" style="display: none;">
                        <p class="fb-config-hint">
                            Paste your Firebase Web credentials or edit <code>Values/firebaseConfig.js</code>.
                        </p>
                        <div class="fb-form-field">
                            <label>API Key</label>
                            <input type="text" id="fb-input-apiKey" class="fb-input" placeholder="AIzaSy...">
                        </div>
                        <div class="fb-form-field">
                            <label>Realtime Database URL</label>
                            <input type="text" id="fb-input-databaseURL" class="fb-input" placeholder="https://<project>-default-rtdb.firebaseio.com">
                        </div>
                        <div class="fb-form-field">
                            <label>Project ID</label>
                            <input type="text" id="fb-input-projectId" class="fb-input" placeholder="your-project-id">
                        </div>
                        <div class="fb-form-field">
                            <label>Auth Domain</label>
                            <input type="text" id="fb-input-authDomain" class="fb-input" placeholder="your-project-id.firebaseapp.com">
                        </div>
                        <div class="fb-actions-row">
                            <button type="button" id="btn-save-fb-config" class="fb-btn save">Save Credentials</button>
                            <button type="button" id="btn-reset-fb-config" class="fb-btn reset">Clear Custom</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    bindWindowEvents() {
        const body = this.window.getBodyElement();

        // 1. Join / Leave toggle button
        const toggleBtn = body.querySelector('#btn-toggle-online');
        toggleBtn.addEventListener('click', () => {
            if (this.isOnline) {
                this.leaveRoom();
            } else {
                this.joinRoom();
            }
        });

        // 2. Display Name input
        const nameInput = body.querySelector('#online-username-input');
        nameInput.addEventListener('change', () => {
            this.saveUserIdentity(nameInput.value, null);
            this.renderUserProfile();
        });
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                nameInput.blur();
            }
        });

        // 3. Color picker
        const colorBtn = body.querySelector('#online-color-btn');
        const colors = ['#38bdf8', '#4ade80', '#fbbf24', '#f87171', '#c084fc', '#fb923c', '#2dd4bf', '#e879f9'];
        colorBtn.addEventListener('click', () => {
            const nextIdx = (colors.indexOf(this.user.color) + 1) % colors.length;
            this.saveUserIdentity(null, colors[nextIdx]);
            this.renderUserProfile();
        });

        // 4. Manual Firestore Snapshot button
        const manualSnapshotBtn = body.querySelector('#btn-manual-firestore-snapshot');
        if (manualSnapshotBtn) {
            manualSnapshotBtn.addEventListener('click', async () => {
                if (!this.isOnline) return;
                const state = this.savingManager.serializeCurrentState();
                manualSnapshotBtn.disabled = true;
                manualSnapshotBtn.textContent = 'Saving to Firestore...';

                const res = await this.firebaseService.saveFirestoreSnapshot(this.roomId, state, 'manual_snapshot', this.user);
                if (res.success) {
                    this.lastFirestoreSnapshotInfo = {
                        action: 'manual',
                        timestamp: new Date().toLocaleTimeString(),
                        user: this.user.name
                    };
                    this.updateFirestoreCardUI();
                    this.showToast('Snapshot saved to Firestore! ✓', 'success');
                } else {
                    this.showToast('Failed to save to Firestore.', 'error');
                }

                manualSnapshotBtn.disabled = false;
                manualSnapshotBtn.textContent = 'Save Snapshot to Firestore Now';
            });
        }

        // 5. Firebase Configuration Collapsible
        const toggleConfigBtn = body.querySelector('#btn-toggle-fb-config');
        const configPanel = body.querySelector('#fb-config-panel');
        toggleConfigBtn.addEventListener('click', () => {
            const isOpen = configPanel.style.display !== 'none';
            configPanel.style.display = isOpen ? 'none' : 'block';
            toggleConfigBtn.classList.toggle('is-open', !isOpen);
            if (!isOpen) {
                this.populateConfigFields();
            }
        });

        // 6. Save Firebase credentials
        const saveConfigBtn = body.querySelector('#btn-save-fb-config');
        saveConfigBtn.addEventListener('click', () => {
            this.saveCustomFirebaseConfig();
        });

        const resetConfigBtn = body.querySelector('#btn-reset-fb-config');
        resetConfigBtn.addEventListener('click', () => {
            this.resetCustomFirebaseConfig();
        });
    }

    populateConfigFields() {
        const body = this.window.getBodyElement();
        const conf = this.firebaseService.getActiveConfig();
        body.querySelector('#fb-input-apiKey').value = conf.apiKey || '';
        body.querySelector('#fb-input-databaseURL').value = conf.databaseURL || '';
        body.querySelector('#fb-input-projectId').value = conf.projectId || '';
        body.querySelector('#fb-input-authDomain').value = conf.authDomain || '';
    }

    saveCustomFirebaseConfig() {
        const body = this.window.getBodyElement();
        const apiKey = body.querySelector('#fb-input-apiKey').value.trim();
        const databaseURL = body.querySelector('#fb-input-databaseURL').value.trim();
        const projectId = body.querySelector('#fb-input-projectId').value.trim();
        const authDomain = body.querySelector('#fb-input-authDomain').value.trim();

        const custom = {
            apiKey,
            databaseURL,
            projectId,
            authDomain,
            storageBucket: `${projectId}.appspot.com`,
            messagingSenderId: '',
            appId: ''
        };

        const key = (this.config && this.config.customConfigStorageKey) || 'inbetween_mapping_custom_firebase_config';
        try {
            localStorage.setItem(key, JSON.stringify(custom));
            this.showToast('Firebase credentials saved! Re-initializing...', 'success');
            // Reset service initialization to pick up new config
            this.firebaseService.isInitialized = false;
            this.firebaseService.initialize();
        } catch (e) {
            this.showToast('Could not save credentials.', 'error');
        }
    }

    resetCustomFirebaseConfig() {
        const key = (this.config && this.config.customConfigStorageKey) || 'inbetween_mapping_custom_firebase_config';
        localStorage.removeItem(key);
        this.populateConfigFields();
        this.showToast('Custom credentials cleared. Using default configuration.', 'info');
    }

    renderUserProfile() {
        const body = this.window.getBodyElement();
        const avatar = body.querySelector('#online-user-avatar');
        const colorPreview = body.querySelector('#online-color-preview');
        const nameInput = body.querySelector('#online-username-input');

        if (avatar) {
            avatar.style.backgroundColor = this.user.color;
            avatar.textContent = this.user.name.charAt(0).toUpperCase();
        }
        if (colorPreview) {
            colorPreview.style.backgroundColor = this.user.color;
        }
        if (nameInput && nameInput.value !== this.user.name) {
            nameInput.value = this.user.name;
        }
    }

    renderRoomDetails() {
        const body = this.window.getBodyElement();
        const bStat = body.querySelector('#room-stat-bubbles');
        const cStat = body.querySelector('#room-stat-conns');
        const uStat = body.querySelector('#room-stat-users');

        if (bStat) bStat.textContent = this.bubbleManager.bubbles.length;
        if (cStat && this.connectionManager) cStat.textContent = this.connectionManager.connections.length;
        if (uStat) uStat.textContent = Math.max(1, this.onlineUsers.length);
    }

    renderPresenceList() {
        const body = this.window.getBodyElement();
        const listEl = body.querySelector('#online-peers-list');
        const countBadge = body.querySelector('#online-peers-count');
        if (!listEl) return;

        const count = Math.max(1, this.onlineUsers.length);
        if (countBadge) countBadge.textContent = `${count} Online`;

        const displayUsers = this.onlineUsers.length > 0 ? this.onlineUsers : [this.user];

        listEl.innerHTML = displayUsers.map(u => {
            const isMe = u.id === this.user.id;
            return `
                <div class="peer-item">
                    <span class="peer-avatar" style="background-color: ${u.color || '#4da6ff'};">
                        ${(u.name || 'A').charAt(0).toUpperCase()}
                    </span>
                    <span class="peer-name">${u.name || 'Anonymous'}${isMe ? ' <span class="peer-you">(You)</span>' : ''}</span>
                    <span class="peer-dot"></span>
                </div>
            `;
        }).join('');

        this.renderRoomDetails();
    }

    updateFirestoreCardUI() {
        const body = this.window.getBodyElement();
        const lastEl = body.querySelector('#firestore-last-saved');
        if (lastEl && this.lastFirestoreSnapshotInfo) {
            lastEl.textContent = `${this.lastFirestoreSnapshotInfo.action.toUpperCase()} at ${this.lastFirestoreSnapshotInfo.timestamp}`;
        }
    }

    updateOnlineStateUI(online) {
        const body = this.window.getBodyElement();
        const banner = body.querySelector('#online-status-banner');
        const statusText = body.querySelector('#online-status-text');
        const modePill = body.querySelector('#online-mode-pill');
        const toggleBtn = body.querySelector('#btn-toggle-online');
        const toggleText = body.querySelector('#btn-toggle-online-text');
        const roomDetails = body.querySelector('#online-room-details');

        if (online) {
            banner.className = 'online-status-banner online';
            statusText.textContent = 'Connected to Online Room';
            modePill.textContent = 'Realtime DB';
            modePill.className = 'online-mode-pill online';
            toggleBtn.className = 'online-primary-btn leave';
            toggleText.textContent = 'Leave to Solo Editor';
            roomDetails.style.display = 'block';
            this.renderRoomDetails();
            this.renderPresenceList();
            this.updateFirestoreCardUI();
        } else {
            banner.className = 'online-status-banner solo';
            statusText.textContent = 'Solo Editor (Offline)';
            modePill.textContent = 'Local Mode';
            modePill.className = 'online-mode-pill';
            toggleBtn.className = 'online-primary-btn join';
            toggleText.textContent = 'Join Online Room';
            roomDetails.style.display = 'none';
        }

        // Top navigation button
        if (this.topOnlineBtn) {
            this.topOnlineBtn.classList.toggle('is-online', online);
            if (this.topStatusDot) {
                this.topStatusDot.classList.toggle('is-online', online);
            }
        }

        // Bottom-left active board indicator
        if (this.savingManager && this.savingManager.activeBoardNameEl) {
            if (online) {
                this.savingManager.activeBoardNameEl.textContent = 'Online Room (Global)';
                if (this.savingManager.activeBoardWidget) {
                    this.savingManager.activeBoardWidget.classList.add('is-online-active');
                }
            } else {
                if (this.savingManager.activeBoardWidget) {
                    this.savingManager.activeBoardWidget.classList.remove('is-online-active');
                }
            }
        }
    }

    updateTopBarBadge() {
        if (this.topUserBadge) {
            const count = this.onlineUsers.length;
            if (this.isOnline && count > 1) {
                this.topUserBadge.textContent = count;
                this.topUserBadge.style.display = 'inline-flex';
            } else {
                this.topUserBadge.style.display = 'none';
            }
        }
    }

    updateStatusUI(status) {
        // Can be used for connection status notices
        if (status.message) {
            console.info('[FirebaseService]', status.message);
        }
    }

    setTopNavElements(onlineBtn, statusDot, userBadge) {
        this.topOnlineBtn = onlineBtn;
        this.topStatusDot = statusDot;
        this.topUserBadge = userBadge;
    }

    open() {
        if (this.window) {
            this.renderUserProfile();
            this.renderRoomDetails();
            this.window.open();
        }
    }

    close() {
        if (this.window) {
            this.window.close();
        }
    }

    toggle() {
        if (this.window) {
            this.window.toggle();
        }
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `online-toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => toast.classList.add('is-visible'), 10);
        setTimeout(() => {
            toast.classList.remove('is-visible');
            setTimeout(() => toast.remove(), 250);
        }, 3200);
    }
}

if (typeof window !== 'undefined') {
    window.OnlineManager = OnlineManager;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = OnlineManager;
}
