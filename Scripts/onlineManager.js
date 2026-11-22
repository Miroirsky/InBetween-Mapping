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
        this.commentManager = null;
        this.savingManager = savingManager;
        this.noiseConfig = noiseConfig;
        this.config = config || window.FirebaseConfig;
        this.firebaseService = firebaseService || new window.FirebaseService(this.config);

        this.roomId = (this.config && this.config.roomId) || 'global_room';
        this.isOnline = false;
        this.isApplyingRemote = false;
        this.localBoardBackup = null;

        // User Identity (unique session ID per tab, shared name/color preference)
        this.user = this.initUserIdentity();
        this.onlineUsers = [];

        // Drag & Physics Sync Tracking
        this.dragThrottleTimer = null;
        this.lastDragTimestamp = 0;
        this.lastLocalActionAt = 0;
        this.physicsSyncTimer = null;
        this.pendingDragUpdates = new Map(); // bubbleId -> bubble
        this.commentDragThrottleTimer = null;
        this.lastCommentDragTimestamp = 0;
        this.pendingCommentDragUpdates = new Map(); // commentId -> comment

        // Window & UI Elements
        this.window = null;
        this.topOnlineBtn = null;
        this.topStatusDot = null;
        this.topUserBadge = null;

        this.lastFirestoreSnapshotInfo = null;

        this.initWindow();
        this.initFirebaseService();
        this.bindLifecycleEvents();
        this.recoverSoloBackupIfLeftUncleanly();
    }

    setCommentManager(commentManager) {
        this.commentManager = commentManager;
    }

    /**
     * Initializes user identity:
     * - Name & color are persisted in localStorage.
     * - Session ID is stored in sessionStorage so multiple tabs in the same browser
     *   act as distinct peers and never collide.
     */
    initUserIdentity() {
        const profileKey = (this.config && this.config.userProfileStorageKey) || 'inbetween_mapping_user_profile';
        const sessionKey = `${profileKey}_tab_session_id`;

        let tabUserId = null;
        try {
            tabUserId = sessionStorage.getItem(sessionKey);
            if (!tabUserId) {
                tabUserId = `user_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`;
                sessionStorage.setItem(sessionKey, tabUserId);
            }
        } catch (e) {
            tabUserId = `user_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`;
        }

        const colors = ['#38bdf8', '#4ade80', '#fbbf24', '#f87171', '#c084fc', '#fb923c', '#2dd4bf'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        const randomNum = Math.floor(100 + Math.random() * 900);

        let savedName = `Explorer ${randomNum}`;
        let savedColor = randomColor;

        try {
            const raw = localStorage.getItem(profileKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.name) savedName = parsed.name;
                if (parsed && parsed.color) savedColor = parsed.color;
            } else {
                localStorage.setItem(profileKey, JSON.stringify({ name: savedName, color: savedColor }));
            }
        } catch (e) {}

        return {
            id: tabUserId,
            name: savedName,
            color: savedColor
        };
    }

    saveUserIdentity(name, color) {
        if (name && name.trim()) this.user.name = name.trim();
        if (color) this.user.color = color;

        const profileKey = (this.config && this.config.userProfileStorageKey) || 'inbetween_mapping_user_profile';
        try {
            localStorage.setItem(profileKey, JSON.stringify({
                name: this.user.name,
                color: this.user.color
            }));
        } catch (e) {}

        if (this.isOnline) {
            this.firebaseService.setupPresence(this.roomId, this.user, (users) => this.onPresenceUpdated(users));
        }
    }

    initFirebaseService() {
        this.firebaseService.onStatusChange((status) => {
            this.updateStatusUI(status);
        });
    }

    /**
     * Ensures presence is immediately cleaned up if the user closes or refreshes the tab.
     */
    bindLifecycleEvents() {
        const handleUnload = () => {
            if (this.isOnline) {
                this.firebaseService.clearPresence(this.roomId, this.user.id);
                this.firebaseService.stopListeningToBoard(this.roomId);
            }
        };

        window.addEventListener('pagehide', handleUnload);
        window.addEventListener('beforeunload', handleUnload);
    }

    /**
     * Sanitizes any corrupted NaN bubbles that might have been stored in local session previously.
     */
    recoverSoloBackupIfLeftUncleanly() {
        if (!this.bubbleManager) return;
        const badBubbles = this.bubbleManager.bubbles.filter(b => !Number.isFinite(Number(b.id)) || Number(b.id) <= 0);
        if (badBubbles.length > 0) {
            badBubbles.forEach(b => {
                if (b.element && b.element.parentNode) {
                    b.element.parentNode.removeChild(b.element);
                }
            });
            this.bubbleManager.bubbles = this.bubbleManager.bubbles.filter(b => Number.isFinite(Number(b.id)) && Number(b.id) > 0);
            this.bubbleManager.syncNextId();
        }
    }

    /**
     * Serializes a bubble into a clean, NaN-free payload for Firebase.
     */
    serializeBubbleForSync(bubble) {
        if (!bubble) return null;
        return this.firebaseService.sanitizeBubble({
            id: bubble.id,
            name: bubble.name,
            color: bubble.color,
            description: bubble.description || '',
            x: bubble.x,
            y: bubble.y,
            scale: bubble.scale,
            isLocked: !!bubble.isLocked,
            updatedBy: this.user.id,
            updatedAt: Date.now()
        }, bubble.id);
    }

    serializeCommentForSync(comment) {
        if (!comment) return null;
        return this.firebaseService.sanitizeComment({
            id: comment.id,
            type: comment.type,
            text: comment.text || '',
            url: comment.url || '',
            color: comment.color,
            x: comment.x,
            y: comment.y,
            attachedBubbleId: comment.attachedBubbleId !== undefined ? comment.attachedBubbleId : null,
            offsetX: comment.offsetX || 0,
            offsetY: comment.offsetY || 0,
            updatedBy: this.user.id,
            updatedAt: Date.now()
        }, comment.id);
    }

    isLocalDragging() {
        const bubbleDragging = this.bubbleManager.bubbles.some(b => b.isDragging || b.isResizing);
        const commentDragging = this.commentManager ? this.commentManager.comments.some(c => c.isDragging) : false;
        return bubbleDragging || commentDragging;
    }

    startPhysicsSyncLoop() {
        this.stopPhysicsSyncLoop();
        this.physicsSyncTimer = setInterval(() => {
            if (!this.isOnline || this.isApplyingRemote) return;

            const now = Date.now();
            const isActivelyInteracting = this.isLocalDragging() || (now - this.lastLocalActionAt < 1200);
            if (!isActivelyInteracting) return;

            const movedBubbles = [];
            for (const b of this.bubbleManager.bubbles) {
                if (!Number.isFinite(Number(b.id)) || Number(b.id) <= 0) continue;
                const lastX = b._lastSyncedX !== undefined ? b._lastSyncedX : b.x;
                const lastY = b._lastSyncedY !== undefined ? b._lastSyncedY : b.y;
                const dist = Math.hypot(b.x - lastX, b.y - lastY);

                if (dist > 0.5) {
                    b._lastSyncedX = b.x;
                    b._lastSyncedY = b.y;
                    b._lastLocalEditAt = now;
                    const clean = this.serializeBubbleForSync(b);
                    if (clean) movedBubbles.push(clean);
                }
            }

            if (movedBubbles.length > 0) {
                this.firebaseService.batchUpdateBubbles(this.roomId, movedBubbles);
            }
        }, 70);
    }

    stopPhysicsSyncLoop() {
        if (this.physicsSyncTimer) {
            clearInterval(this.physicsSyncTimer);
            this.physicsSyncTimer = null;
        }
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
        this.pendingDragUpdates.clear();
        this.pendingCommentDragUpdates.clear();

        // 3. Setup presence in Realtime Database
        this.firebaseService.setupPresence(this.roomId, this.user, (users) => {
            this.onPresenceUpdated(users);
        });

        // 4. Fetch current room board or initialize it cleanly
        try {
            const remoteBoard = await this.firebaseService.fetchCurrentBoard(this.roomId);

            if (remoteBoard && (remoteBoard.bubbles || remoteBoard.comments || remoteBoard.isCleared || remoteBoard.updatedAt)) {
                // Room exists in Realtime Database -> load & sanitize it
                await this.purgeCorruptedRemoteNodes(remoteBoard);
                this.loadRoomBoardIntoCanvas(remoteBoard);
            } else {
                // Check if Cloud Firestore has an archived snapshot
                const firestoreDoc = await this.firebaseService.getFirestoreSnapshot(this.roomId);
                if (firestoreDoc && firestoreDoc.board) {
                    await this.firebaseService.setBoard(this.roomId, firestoreDoc.board, this.user);
                    this.loadRoomBoardIntoCanvas(firestoreDoc.board);
                } else {
                    // Brand new room -> start clean online board
                    const emptyOnlineBoard = {
                        bubbles: [],
                        connections: [],
                        comments: [],
                        commentLinks: [],
                        noiseConfig: this.savingManager.serializeCurrentState().noiseData
                    };
                    this.loadRoomBoardIntoCanvas(emptyOnlineBoard);
                    await this.firebaseService.setBoard(this.roomId, emptyOnlineBoard, this.user);
                }
            }
        } catch (err) {
            console.error('Error fetching room board:', err);
        }

        // 5. Attach live Realtime Database listeners
        this.firebaseService.listenToBoard(this.roomId, {
            onBoardValue: (data) => this.onRemoteBoardValue(data),
            onBubblePosition: (id, x, y, bubbleData) => this.onRemoteBubblePosition(id, x, y, bubbleData),
            onBubbleUpdate: (id, data) => this.onRemoteBubbleUpdate(id, data),
            onBubbleRemove: (id) => this.onRemoteBubbleRemove(id),
            onConnUpdate: (id, data) => this.onRemoteConnUpdate(id, data),
            onConnRemove: (id) => this.onRemoteConnRemove(id),
            onCommentUpdate: (id, data) => this.onRemoteCommentUpdate(id, data),
            onCommentRemove: (id) => this.onRemoteCommentRemove(id),
            onCommentLinkUpdate: (id, data) => this.onRemoteCommentLinkUpdate(id, data),
            onCommentLinkRemove: (id) => this.onRemoteCommentLinkRemove(id)
        });

        // Start physics position sync loop
        this.startPhysicsSyncLoop();

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
     * Purges any corrupted / NaN keys that may exist in Realtime Database from prior errors.
     */
    async purgeCorruptedRemoteNodes(boardData) {
        if (!boardData || typeof boardData !== 'object') return;

        if (boardData.bubbles && typeof boardData.bubbles === 'object') {
            for (const [key, rb] of Object.entries(boardData.bubbles)) {
                const clean = this.firebaseService.sanitizeBubble(rb, key);
                if (!clean || key === 'NaN' || key === 'undefined' || String(clean.id) !== String(key)) {
                    await this.firebaseService.removeBubble(this.roomId, key);
                    delete boardData.bubbles[key];
                }
            }
        }

        if (boardData.connections && typeof boardData.connections === 'object') {
            for (const [key, rc] of Object.entries(boardData.connections)) {
                const clean = this.firebaseService.sanitizeConnection(rc, key);
                if (!clean || key === 'NaN' || key === 'undefined' || String(clean.id) !== String(key)) {
                    await this.firebaseService.removeConnection(this.roomId, key);
                    delete boardData.connections[key];
                }
            }
        }

        if (boardData.comments && typeof boardData.comments === 'object') {
            for (const [key, rc] of Object.entries(boardData.comments)) {
                const clean = this.firebaseService.sanitizeComment(rc, key);
                if (!clean || key === 'NaN' || key === 'undefined' || String(clean.id) !== String(key)) {
                    await this.firebaseService.removeComment(this.roomId, key);
                    delete boardData.comments[key];
                }
            }
        }

        if (boardData.commentLinks && typeof boardData.commentLinks === 'object') {
            for (const [key, rl] of Object.entries(boardData.commentLinks)) {
                const clean = this.firebaseService.sanitizeCommentLink(rl, key);
                if (!clean || key === 'NaN' || key === 'undefined' || String(clean.id) !== String(key)) {
                    await this.firebaseService.removeCommentLink(this.roomId, key);
                    delete boardData.commentLinks[key];
                }
            }
        }
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
        this.stopPhysicsSyncLoop();

        if (this.dragThrottleTimer) {
            clearTimeout(this.dragThrottleTimer);
            this.dragThrottleTimer = null;
        }
        this.pendingDragUpdates.clear();
        if (this.commentDragThrottleTimer) {
            clearTimeout(this.commentDragThrottleTimer);
            this.commentDragThrottleTimer = null;
        }
        this.pendingCommentDragUpdates.clear();

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
            this.bubbleManager.clearBoard();

            const state = backup.state;

            if (Array.isArray(state.bubbles)) {
                state.bubbles.forEach(b => {
                    const clean = this.firebaseService.sanitizeBubble(b, b && b.id);
                    if (clean) {
                        this.bubbleManager.createBubble(clean.x, clean.y, clean.name, clean.color, clean.id, clean.isLocked, clean.scale, clean.description || '');
                    }
                });
            }

            if (this.connectionManager && Array.isArray(state.connections)) {
                state.connections.forEach(c => {
                    const clean = this.firebaseService.sanitizeConnection(c, c && c.id);
                    if (clean) {
                        this.connectionManager.createConnection(clean.fromId, clean.toId, clean.name, clean.id, clean.targetLength || null);
                    }
                });
            }

            if (this.commentManager && Array.isArray(state.comments)) {
                this.commentManager.loadComments(state.comments);
                if (Array.isArray(state.commentLinks)) {
                    this.commentManager.loadCommentLinks(state.commentLinks);
                }
            }

            if (state.noiseData && this.noiseConfig) {
                Object.assign(this.noiseConfig, state.noiseData);
            }

            if (this.savingManager) {
                if (backup.activeBoardId || backup.activeBoardName) {
                    this.savingManager.setActiveBoard(backup.activeBoardId || null, backup.activeBoardName || 'Current Board');
                } else {
                    this.savingManager.clearActiveBoard();
                }
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
        this.isApplyingRemote = true;

        try {
            this.bubbleManager.clearBoard();

            if (!boardData) return;

            const rawBubbles = boardData.bubbles
                ? (Array.isArray(boardData.bubbles) ? boardData.bubbles : Object.entries(boardData.bubbles).map(([k, v]) => (v && typeof v === 'object' ? Object.assign({ id: v.id ?? k }, v) : null)))
                : [];

            rawBubbles.forEach(b => {
                const clean = this.firebaseService.sanitizeBubble(b, b && b.id);
                if (clean) {
                    const created = this.bubbleManager.createBubble(clean.x, clean.y, clean.name, clean.color, clean.id, clean.isLocked, clean.scale, clean.description || '');
                    if (created) {
                        created._lastSyncedX = clean.x;
                        created._lastSyncedY = clean.y;
                    }
                }
            });

            const rawConns = boardData.connections
                ? (Array.isArray(boardData.connections) ? boardData.connections : Object.entries(boardData.connections).map(([k, v]) => (v && typeof v === 'object' ? Object.assign({ id: v.id ?? k }, v) : null)))
                : [];

            if (this.connectionManager) {
                rawConns.forEach(c => {
                    const clean = this.firebaseService.sanitizeConnection(c, c && c.id);
                    if (clean && this.bubbleManager.getBubbleById(clean.fromId) && this.bubbleManager.getBubbleById(clean.toId)) {
                        this.connectionManager.createConnection(clean.fromId, clean.toId, clean.name, clean.id, clean.targetLength || null);
                    }
                });
            }

            if (this.commentManager) {
                const rawComments = boardData.comments
                    ? (Array.isArray(boardData.comments) ? boardData.comments : Object.entries(boardData.comments).map(([k, v]) => (v && typeof v === 'object' ? Object.assign({ id: v.id ?? k }, v) : null)))
                    : [];
                const cleanComments = rawComments
                    .map(c => this.firebaseService.sanitizeComment(c, c && c.id))
                    .filter(Boolean);
                this.commentManager.loadComments(cleanComments);

                const rawCommentLinks = boardData.commentLinks
                    ? (Array.isArray(boardData.commentLinks) ? boardData.commentLinks : Object.entries(boardData.commentLinks).map(([k, v]) => (v && typeof v === 'object' ? Object.assign({ id: v.id ?? k }, v) : null)))
                    : [];
                const cleanLinks = rawCommentLinks
                    .map(l => this.firebaseService.sanitizeCommentLink(l, l && l.id))
                    .filter(Boolean);
                this.commentManager.loadCommentLinks(cleanLinks);
            }

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
        if (!this.isOnline) return;

        // If board node is null/empty (e.g. cleared), treat as empty board
        const safeData = data || { bubbles: {}, connections: {} };

        this.isApplyingRemote = true;
        const now = Date.now();

        try {
            // 1. Synchronize Bubbles
            const remoteBubblesMap = safeData.bubbles || {};
            const validRemoteBubbles = [];
            const remoteIds = new Set();

            for (const [key, rb] of Object.entries(remoteBubblesMap)) {
                if (!rb || typeof rb !== 'object') continue;
                const clean = this.firebaseService.sanitizeBubble(rb, key);
                if (!clean || key === 'NaN' || key === 'undefined') {
                    // Auto-heal corrupted entry in Firebase
                    this.firebaseService.removeBubble(this.roomId, key);
                    continue;
                }
                validRemoteBubbles.push(clean);
                remoteIds.add(clean.id);
            }

            // Update or create remote bubbles
            validRemoteBubbles.forEach(rb => {
                const id = rb.id;
                const local = this.bubbleManager.getBubbleById(id);

                if (local) {
                    const recentlyEditedLocally = (now - (local._lastLocalEditAt || 0) < 400) && (rb.updatedBy === this.user.id);
                    const beingMovedByLocalPhysics = this.isLocalDragging() && (now - (local._lastLocalEditAt || 0) < 350);

                    if (!local.isDragging && !recentlyEditedLocally && !beingMovedByLocalPhysics) {
                        local.x = rb.x;
                        local.y = rb.y;
                        local._lastSyncedX = rb.x;
                        local._lastSyncedY = rb.y;
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

                    if (!local.isResizing && rb.scale !== undefined && local.scale !== rb.scale) {
                        this.bubbleManager.setBubbleScale(id, rb.scale, false);
                    }

                    if (rb.description !== undefined && local.description !== rb.description) {
                        this.bubbleManager.setBubbleDescription(id, rb.description, false);
                    }

                    if (!!local.isLocked !== !!rb.isLocked) {
                        local.isLocked = !!rb.isLocked;
                        local.vx = 0;
                        local.vy = 0;
                        if (local.isLocked) {
                            local.element.classList.add('is-locked');
                        } else {
                            local.element.classList.remove('is-locked');
                        }
                    }
                } else {
                    const created = this.bubbleManager.createBubble(rb.x, rb.y, rb.name, rb.color, id, rb.isLocked, rb.scale, rb.description || '');
                    if (created) {
                        created._lastSyncedX = rb.x;
                        created._lastSyncedY = rb.y;
                    }
                }
            });

            // Remove local bubbles deleted by peers
            const localBubblesCopy = [...this.bubbleManager.bubbles];
            localBubblesCopy.forEach(lb => {
                if (!remoteIds.has(lb.id)) {
                    this.bubbleManager.removeBubble(lb.id);
                }
            });

            this.bubbleManager.syncNextId();

            // 2. Synchronize Connections
            if (this.connectionManager) {
                const remoteConnsMap = safeData.connections || {};
                const validRemoteConns = [];
                const remoteConnIds = new Set();

                for (const [key, rc] of Object.entries(remoteConnsMap)) {
                    if (!rc || typeof rc !== 'object') continue;
                    const clean = this.firebaseService.sanitizeConnection(rc, key);
                    if (!clean || key === 'NaN' || key === 'undefined') {
                        this.firebaseService.removeConnection(this.roomId, key);
                        continue;
                    }
                    validRemoteConns.push(clean);
                    remoteConnIds.add(clean.id);
                }

                validRemoteConns.forEach(rc => {
                    const id = rc.id;
                    const localConn = this.connectionManager.getConnectionById(id);

                    if (localConn) {
                        if (localConn.name !== rc.name) {
                            this.connectionManager.renameConnection(id, rc.name);
                        }

                        const resizingId = this.connectionManager.resizingConnectionId;
                        let isBeingResizedLocally = false;
                        if (resizingId !== null && resizingId !== undefined) {
                            if (Number(localConn.id) === Number(resizingId)) {
                                isBeingResizedLocally = true;
                            } else {
                                const resizingConn = this.connectionManager.getConnectionById(resizingId);
                                if (resizingConn && Number(resizingConn.fromId) === Number(localConn.toId) && Number(resizingConn.toId) === Number(localConn.fromId)) {
                                    isBeingResizedLocally = true;
                                }
                            }
                        }
                        const recentlyEditedLocally = (now - (localConn._lastLocalEditAt || 0) < 500);
                        const remoteTargetLength = (rc.targetLength !== undefined && rc.targetLength !== null) ? rc.targetLength : null;
                        const localTargetLength = (localConn.targetLength !== undefined && localConn.targetLength !== null) ? localConn.targetLength : null;

                        if (!isBeingResizedLocally && !recentlyEditedLocally && localTargetLength !== remoteTargetLength) {
                            this.connectionManager.setConnectionTargetLength(id, remoteTargetLength, false);
                        }
                    } else {
                        if (this.bubbleManager.getBubbleById(rc.fromId) && this.bubbleManager.getBubbleById(rc.toId)) {
                            this.connectionManager.createConnection(rc.fromId, rc.toId, rc.name, id, rc.targetLength || null);
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

                this.connectionManager.syncNextId();
                this.connectionManager.render();
            }

            // 3. Synchronize Comments
            if (this.commentManager) {
                const remoteCommentsMap = safeData.comments || {};
                const validRemoteComments = [];
                const remoteCommentIds = new Set();

                for (const [key, rc] of Object.entries(remoteCommentsMap)) {
                    if (!rc || typeof rc !== 'object') continue;
                    const clean = this.firebaseService.sanitizeComment(rc, key);
                    if (!clean || key === 'NaN' || key === 'undefined') {
                        this.firebaseService.removeComment(this.roomId, key);
                        continue;
                    }
                    validRemoteComments.push(clean);
                    remoteCommentIds.add(clean.id);
                }

                validRemoteComments.forEach(rc => {
                    const id = rc.id;
                    const local = this.commentManager.getCommentById(id);

                    if (local) {
                        const recentlyEditedLocally = (now - (local._lastLocalEditAt || 0) < 400) && (rc.updatedBy === this.user.id);

                        if (!local.isDragging && !recentlyEditedLocally) {
                            local.x = rc.x;
                            local.y = rc.y;
                            local.offsetX = rc.offsetX || 0;
                            local.offsetY = rc.offsetY || 0;

                            const nextBubbleId = (rc.attachedBubbleId !== null && this.bubbleManager.getBubbleById(rc.attachedBubbleId))
                                ? rc.attachedBubbleId
                                : null;
                            local.attachedBubbleId = nextBubbleId;
                            if (local.element) {
                                local.element.classList.toggle('is-attached', nextBubbleId !== null);
                            }
                            this.commentManager.updateElementPosition(local);
                        }

                        if (local.type !== rc.type || local.text !== rc.text || local.url !== rc.url || local.color !== rc.color) {
                            local.type = rc.type;
                            local.text = rc.text;
                            local.url = rc.url;
                            local.color = rc.color;
                            this.commentManager.applyCommentContent(local);
                            this.commentManager.applyCommentStyle(local);
                        }
                    } else {
                        this.commentManager.createComment({
                            x: rc.x,
                            y: rc.y,
                            type: rc.type,
                            text: rc.text,
                            url: rc.url,
                            color: rc.color,
                            attachedBubbleId: rc.attachedBubbleId,
                            offsetX: rc.offsetX,
                            offsetY: rc.offsetY,
                            customId: id,
                            saveSnapshot: false
                        });
                    }
                });

                // Remove local comments deleted by peers
                const localCommentsCopy = [...this.commentManager.comments];
                localCommentsCopy.forEach(lc => {
                    if (!remoteCommentIds.has(lc.id)) {
                        this.commentManager.removeComment(lc.id);
                    }
                });

                this.commentManager.syncNextId();

                // 4. Synchronize Comment-to-Comment Links
                const remoteLinksMap = safeData.commentLinks || {};
                const validRemoteLinks = [];
                const remoteLinkIds = new Set();

                for (const [key, rl] of Object.entries(remoteLinksMap)) {
                    if (!rl || typeof rl !== 'object') continue;
                    const clean = this.firebaseService.sanitizeCommentLink(rl, key);
                    if (!clean || key === 'NaN' || key === 'undefined') {
                        this.firebaseService.removeCommentLink(this.roomId, key);
                        continue;
                    }
                    validRemoteLinks.push(clean);
                    remoteLinkIds.add(clean.id);
                }

                validRemoteLinks.forEach(rl => {
                    const localLink = this.commentManager.getCommentLinkById(rl.id);
                    if (!localLink) {
                        if (this.commentManager.getCommentById(rl.fromCommentId) && this.commentManager.getCommentById(rl.toCommentId)) {
                            this.commentManager.connectComments(rl.fromCommentId, rl.toCommentId, rl.id, false);
                        }
                    }
                });

                const localLinksCopy = [...this.commentManager.commentLinks];
                localLinksCopy.forEach(ll => {
                    if (!remoteLinkIds.has(ll.id)) {
                        this.commentManager.removeCommentLink(ll.id, false);
                    }
                });

                this.commentManager.syncNextLinkId();
                this.commentManager.renderConnections();
            }
        } finally {
            this.isApplyingRemote = false;
        }

        this.renderRoomDetails();
    }

    onRemoteBubblePosition(bubbleId, x, y, bubbleData = null) {
        if (!this.isOnline) return;
        const id = Number(bubbleId);
        if (!Number.isFinite(id) || id <= 0) return;

        this.isApplyingRemote = true;
        try {
            const local = this.bubbleManager.getBubbleById(id);
            if (local && !local.isDragging) {
                if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
                    local.x = Number(x);
                    local.y = Number(y);
                    local._lastSyncedX = local.x;
                    local._lastSyncedY = local.y;
                    local.vx = 0;
                    local.vy = 0;
                    this.bubbleManager.updateElementPosition(local);
                }
                if (bubbleData && bubbleData.scale !== undefined && !local.isResizing && local.scale !== bubbleData.scale) {
                    this.bubbleManager.setBubbleScale(id, bubbleData.scale, false);
                }
                if (this.connectionManager) {
                    this.connectionManager.render();
                }
            } else if (!local && bubbleData) {
                const clean = this.firebaseService.sanitizeBubble(bubbleData, id);
                if (clean) {
                    this.bubbleManager.createBubble(clean.x, clean.y, clean.name, clean.color, clean.id, clean.isLocked, clean.scale, clean.description || '');
                }
            }
        } finally {
            this.isApplyingRemote = false;
        }
    }

    onRemoteBubbleUpdate(bubbleId, data) {
        if (!this.isOnline || !data) return;
        const id = Number(bubbleId);
        if (!Number.isFinite(id) || id <= 0) return;

        this.isApplyingRemote = true;
        try {
            const local = this.bubbleManager.getBubbleById(id);
            if (local) {
                if (Number.isFinite(Number(data.x)) && Number.isFinite(Number(data.y)) && !local.isDragging) {
                    local.x = Number(data.x);
                    local.y = Number(data.y);
                    local._lastSyncedX = local.x;
                    local._lastSyncedY = local.y;
                    this.bubbleManager.updateElementPosition(local);
                }
                if (data.name !== undefined && local.name !== data.name) {
                    this.bubbleManager.renameBubble(id, data.name);
                }
                if (data.color !== undefined && local.color !== data.color) {
                    this.bubbleManager.setBubbleColor(id, data.color);
                }
                if (data.scale !== undefined && !local.isResizing && local.scale !== data.scale) {
                    this.bubbleManager.setBubbleScale(id, data.scale, false);
                }
                if (data.description !== undefined && local.description !== data.description) {
                    this.bubbleManager.setBubbleDescription(id, data.description, false);
                }
                if (data.isLocked !== undefined && !!local.isLocked !== !!data.isLocked) {
                    this.bubbleManager.toggleLock(id);
                }
            } else {
                const clean = this.firebaseService.sanitizeBubble(data, id);
                if (clean) {
                    this.bubbleManager.createBubble(clean.x, clean.y, clean.name, clean.color, clean.id, clean.isLocked, clean.scale, clean.description || '');
                }
            }
        } finally {
            this.isApplyingRemote = false;
        }
        this.renderRoomDetails();
    }

    onRemoteBubbleRemove(bubbleId) {
        if (!this.isOnline) return;
        const id = Number(bubbleId);
        if (!Number.isFinite(id)) return;

        this.isApplyingRemote = true;
        try {
            this.bubbleManager.removeBubble(id);
        } finally {
            this.isApplyingRemote = false;
        }
        this.renderRoomDetails();
    }

    onRemoteConnUpdate(connId, data) {
        if (!this.isOnline || !this.connectionManager || !data) return;
        const id = Number(connId);
        if (!Number.isFinite(id) || id <= 0) return;

        this.isApplyingRemote = true;
        try {
            const local = this.connectionManager.getConnectionById(id);
            if (local) {
                if (data.name !== undefined && local.name !== data.name) {
                    this.connectionManager.renameConnection(id, data.name);
                }
                const remoteTargetLength = (data.targetLength !== undefined && data.targetLength !== null) ? data.targetLength : null;
                const localTargetLength = (local.targetLength !== undefined && local.targetLength !== null) ? local.targetLength : null;
                if (localTargetLength !== remoteTargetLength) {
                    this.connectionManager.setConnectionTargetLength(id, remoteTargetLength, false);
                }
            } else if (data.fromId && data.toId) {
                this.connectionManager.createConnection(data.fromId, data.toId, data.name, id, data.targetLength || null);
            }
        } finally {
            this.isApplyingRemote = false;
        }
        this.renderRoomDetails();
    }

    onRemoteConnRemove(connId) {
        if (!this.isOnline || !this.connectionManager) return;
        const id = Number(connId);
        if (!Number.isFinite(id)) return;

        this.isApplyingRemote = true;
        try {
            this.connectionManager.removeConnection(id);
        } finally {
            this.isApplyingRemote = false;
        }
        this.renderRoomDetails();
    }

    onRemoteCommentUpdate(commentId, data) {
        if (!this.isOnline || !this.commentManager || !data) return;
        const id = Number(commentId);
        if (!Number.isFinite(id) || id <= 0) return;

        const clean = this.firebaseService.sanitizeComment(data, id);
        if (!clean) return;

        this.isApplyingRemote = true;
        try {
            const local = this.commentManager.getCommentById(id);
            if (local) {
                if (!local.isDragging) {
                    local.x = clean.x;
                    local.y = clean.y;
                    local.offsetX = clean.offsetX || 0;
                    local.offsetY = clean.offsetY || 0;
                    const nextBubbleId = (clean.attachedBubbleId !== null && this.bubbleManager.getBubbleById(clean.attachedBubbleId))
                        ? clean.attachedBubbleId
                        : null;
                    local.attachedBubbleId = nextBubbleId;
                    if (local.element) {
                        local.element.classList.toggle('is-attached', nextBubbleId !== null);
                    }
                    this.commentManager.updateElementPosition(local);
                }
                if (local.type !== clean.type || local.text !== clean.text || local.url !== clean.url || local.color !== clean.color) {
                    local.type = clean.type;
                    local.text = clean.text;
                    local.url = clean.url;
                    local.color = clean.color;
                    this.commentManager.applyCommentContent(local);
                    this.commentManager.applyCommentStyle(local);
                }
                this.commentManager.renderConnections();
            } else {
                this.commentManager.createComment({
                    x: clean.x,
                    y: clean.y,
                    type: clean.type,
                    text: clean.text,
                    url: clean.url,
                    color: clean.color,
                    attachedBubbleId: clean.attachedBubbleId,
                    offsetX: clean.offsetX,
                    offsetY: clean.offsetY,
                    customId: id,
                    saveSnapshot: false
                });
            }
        } finally {
            this.isApplyingRemote = false;
        }
        this.renderRoomDetails();
    }

    onRemoteCommentRemove(commentId) {
        if (!this.isOnline || !this.commentManager) return;
        const id = Number(commentId);
        if (!Number.isFinite(id)) return;

        this.isApplyingRemote = true;
        try {
            this.commentManager.removeComment(id);
        } finally {
            this.isApplyingRemote = false;
        }
        this.renderRoomDetails();
    }

    onRemoteCommentLinkUpdate(linkId, data) {
        if (!this.isOnline || !this.commentManager || !data) return;
        const clean = this.firebaseService.sanitizeCommentLink(data, linkId);
        if (!clean) return;

        this.isApplyingRemote = true;
        try {
            if (!this.commentManager.getCommentLinkById(clean.id)) {
                this.commentManager.connectComments(clean.fromCommentId, clean.toCommentId, clean.id, false);
            }
        } finally {
            this.isApplyingRemote = false;
        }
    }

    onRemoteCommentLinkRemove(linkId) {
        if (!this.isOnline || !this.commentManager) return;
        const id = Number(linkId);
        if (!Number.isFinite(id)) return;

        this.isApplyingRemote = true;
        try {
            this.commentManager.removeCommentLink(id, false);
        } finally {
            this.isApplyingRemote = false;
        }
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
        if (!this.isOnline || this.isApplyingRemote || !bubble) return;
        this.lastLocalActionAt = Date.now();
        bubble._lastSyncedX = bubble.x;
        bubble._lastSyncedY = bubble.y;
        bubble._lastLocalEditAt = this.lastLocalActionAt;

        const clean = this.serializeBubbleForSync(bubble);
        if (clean) {
            this.firebaseService.updateBubble(this.roomId, clean.id, clean);
        }
        this.renderRoomDetails();
    }

    /**
     * Throttled bubble drag position sync.
     */
    onBubbleDrag(bubble) {
        if (!this.isOnline || this.isApplyingRemote || !bubble) return;

        const now = Date.now();
        this.lastLocalActionAt = now;
        bubble._lastLocalEditAt = now;

        const throttle = (this.config && this.config.dragThrottleMs) || 50;
        this.pendingDragUpdates.set(bubble.id, bubble);

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
        if (!this.isOnline || this.pendingDragUpdates.size === 0) return;

        const batch = [];
        const now = Date.now();

        for (const [id, bubble] of this.pendingDragUpdates.entries()) {
            // Ensure bubble still exists on board
            if (!this.bubbleManager.getBubbleById(id)) continue;
            bubble._lastSyncedX = bubble.x;
            bubble._lastSyncedY = bubble.y;
            bubble._lastLocalEditAt = now;
            const clean = this.serializeBubbleForSync(bubble);
            if (clean) batch.push(clean);
        }
        this.pendingDragUpdates.clear();

        if (batch.length > 0) {
            this.firebaseService.batchUpdateBubbles(this.roomId, batch);
        }
    }

    /**
     * Ensures final position is broadcast on drag release.
     */
    onBubbleDragEnd(bubble) {
        if (!this.isOnline || this.isApplyingRemote || !bubble) return;
        const now = Date.now();
        this.lastLocalActionAt = now;
        bubble._lastLocalEditAt = now;

        if (this.dragThrottleTimer) {
            clearTimeout(this.dragThrottleTimer);
            this.dragThrottleTimer = null;
        }
        this.pendingDragUpdates.set(bubble.id, bubble);
        this.flushPendingDrags();
    }

    onBubbleLockChanged(bubble) {
        if (!this.isOnline || this.isApplyingRemote || !bubble) return;
        this.lastLocalActionAt = Date.now();
        bubble._lastLocalEditAt = this.lastLocalActionAt;
        const clean = this.serializeBubbleForSync(bubble);
        if (clean) {
            this.firebaseService.updateBubble(this.roomId, clean.id, clean);
        }
    }

    onBubbleRenamed(bubble) {
        if (!this.isOnline || this.isApplyingRemote || !bubble) return;
        this.lastLocalActionAt = Date.now();
        bubble._lastLocalEditAt = this.lastLocalActionAt;
        const clean = this.serializeBubbleForSync(bubble);
        if (clean) {
            this.firebaseService.updateBubble(this.roomId, clean.id, clean);
        }
    }

    onBubbleColorChanged(bubble) {
        if (!this.isOnline || this.isApplyingRemote || !bubble) return;
        this.lastLocalActionAt = Date.now();
        bubble._lastLocalEditAt = this.lastLocalActionAt;
        const clean = this.serializeBubbleForSync(bubble);
        if (clean) {
            this.firebaseService.updateBubble(this.roomId, clean.id, clean);
        }
    }

    onBubbleRemoved(bubbleId) {
        if (!this.isOnline || this.isApplyingRemote) return;
        this.lastLocalActionAt = Date.now();
        this.pendingDragUpdates.delete(Number(bubbleId));
        this.firebaseService.removeBubble(this.roomId, bubbleId);
        this.renderRoomDetails();
    }

    onBoardReset() {
        if (!this.isOnline || this.isApplyingRemote) return;
        this.lastLocalActionAt = Date.now();
        if (this.dragThrottleTimer) {
            clearTimeout(this.dragThrottleTimer);
            this.dragThrottleTimer = null;
        }
        this.pendingDragUpdates.clear();
        if (this.commentDragThrottleTimer) {
            clearTimeout(this.commentDragThrottleTimer);
            this.commentDragThrottleTimer = null;
        }
        this.pendingCommentDragUpdates.clear();
        this.firebaseService.clearBoard(this.roomId, this.user);
        this.renderRoomDetails();
    }

    onConnectionCreated(conn) {
        if (!this.isOnline || this.isApplyingRemote || !conn) return;
        this.lastLocalActionAt = Date.now();
        conn._lastLocalEditAt = this.lastLocalActionAt;
        this.firebaseService.updateConnection(this.roomId, conn.id, {
            id: conn.id,
            fromId: conn.fromId,
            toId: conn.toId,
            name: conn.name,
            targetLength: conn.targetLength ?? null
        });
        this.renderRoomDetails();
    }

    onConnectionRenamed(conn) {
        if (!this.isOnline || this.isApplyingRemote || !conn) return;
        this.lastLocalActionAt = Date.now();
        conn._lastLocalEditAt = this.lastLocalActionAt;
        this.firebaseService.updateConnection(this.roomId, conn.id, {
            id: conn.id,
            fromId: conn.fromId,
            toId: conn.toId,
            name: conn.name,
            targetLength: conn.targetLength ?? null
        });
    }

    onConnectionRemoved(connId) {
        if (!this.isOnline || this.isApplyingRemote) return;
        this.lastLocalActionAt = Date.now();
        this.firebaseService.removeConnection(this.roomId, connId);
        this.renderRoomDetails();
    }

    onCommentCreated(comment) {
        if (!this.isOnline || this.isApplyingRemote || !comment) return;
        this.lastLocalActionAt = Date.now();
        comment._lastLocalEditAt = this.lastLocalActionAt;
        const clean = this.serializeCommentForSync(comment);
        if (clean) {
            this.firebaseService.updateComment(this.roomId, clean.id, clean);
        }
        this.renderRoomDetails();
    }

    onCommentUpdated(comment) {
        if (!this.isOnline || this.isApplyingRemote || !comment) return;
        this.lastLocalActionAt = Date.now();
        comment._lastLocalEditAt = this.lastLocalActionAt;
        const clean = this.serializeCommentForSync(comment);
        if (clean) {
            this.firebaseService.updateComment(this.roomId, clean.id, clean);
        }
    }

    onCommentDrag(commentsList) {
        if (!this.isOnline || this.isApplyingRemote || !commentsList) return;
        const list = Array.isArray(commentsList) ? commentsList : [commentsList];
        const now = Date.now();
        this.lastLocalActionAt = now;

        for (const c of list) {
            if (!c) continue;
            c._lastLocalEditAt = now;
            this.pendingCommentDragUpdates.set(c.id, c);
        }

        const throttle = (this.config && this.config.dragThrottleMs) || 50;
        if (now - this.lastCommentDragTimestamp >= throttle) {
            this.flushPendingCommentDrags();
            this.lastCommentDragTimestamp = now;
        } else if (!this.commentDragThrottleTimer) {
            this.commentDragThrottleTimer = setTimeout(() => {
                this.commentDragThrottleTimer = null;
                this.flushPendingCommentDrags();
                this.lastCommentDragTimestamp = Date.now();
            }, throttle - (now - this.lastCommentDragTimestamp));
        }
    }

    flushPendingCommentDrags() {
        if (!this.isOnline || this.pendingCommentDragUpdates.size === 0) return;
        const batch = [];
        const now = Date.now();

        for (const [id, c] of this.pendingCommentDragUpdates.entries()) {
            if (this.commentManager && !this.commentManager.getCommentById(id)) continue;
            c._lastLocalEditAt = now;
            const clean = this.serializeCommentForSync(c);
            if (clean) batch.push(clean);
        }
        this.pendingCommentDragUpdates.clear();

        if (batch.length > 0) {
            this.firebaseService.batchUpdateComments(this.roomId, batch);
        }
    }

    onCommentDragEnd(commentsList) {
        if (!this.isOnline || this.isApplyingRemote || !commentsList) return;
        const list = Array.isArray(commentsList) ? commentsList : [commentsList];
        const now = Date.now();
        this.lastLocalActionAt = now;

        if (this.commentDragThrottleTimer) {
            clearTimeout(this.commentDragThrottleTimer);
            this.commentDragThrottleTimer = null;
        }

        for (const c of list) {
            if (!c) continue;
            c._lastLocalEditAt = now;
            this.pendingCommentDragUpdates.set(c.id, c);
        }
        this.flushPendingCommentDrags();
    }

    onCommentRemoved(commentId) {
        if (!this.isOnline || this.isApplyingRemote) return;
        this.lastLocalActionAt = Date.now();
        this.pendingCommentDragUpdates.delete(Number(commentId));
        this.firebaseService.removeComment(this.roomId, commentId);
        this.renderRoomDetails();
    }

    onCommentLinkCreated(link) {
        if (!this.isOnline || this.isApplyingRemote || !link) return;
        this.lastLocalActionAt = Date.now();
        this.firebaseService.updateCommentLink(this.roomId, link.id, {
            id: link.id,
            fromCommentId: link.fromCommentId,
            toCommentId: link.toCommentId
        });
    }

    onCommentLinkRemoved(linkId) {
        if (!this.isOnline || this.isApplyingRemote) return;
        this.lastLocalActionAt = Date.now();
        this.firebaseService.removeCommentLink(this.roomId, linkId);
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
        let databaseURL = body.querySelector('#fb-input-databaseURL').value.trim();
        const projectId = body.querySelector('#fb-input-projectId').value.trim();
        const authDomain = body.querySelector('#fb-input-authDomain').value.trim();

        if (projectId && !databaseURL) {
            databaseURL = `https://${projectId}-default-rtdb.firebaseio.com`;
            body.querySelector('#fb-input-databaseURL').value = databaseURL;
        }

        const custom = {
            apiKey,
            databaseURL,
            projectId,
            authDomain: authDomain || (projectId ? `${projectId}.firebaseapp.com` : ''),
            storageBucket: projectId ? `${projectId}.appspot.com` : '',
            messagingSenderId: '',
            appId: ''
        };

        const key = (this.config && this.config.customConfigStorageKey) || 'inbetween_mapping_custom_firebase_config';
        try {
            localStorage.setItem(key, JSON.stringify(custom));
            this.showToast('Firebase credentials saved! Re-initializing...', 'success');
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

        // Ensure current user is always visible while online even before server roundtrip
        const hasSelf = this.onlineUsers.some(u => u && u.id === this.user.id);
        const displayUsers = hasSelf ? this.onlineUsers : [this.user, ...this.onlineUsers];
        const count = displayUsers.length;

        if (countBadge) countBadge.textContent = `${count} Online`;

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
            this.onlineUsers = [];
            this.updateTopBarBadge();
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
                    this.savingManager.activeBoardWidget.classList.add('is-visible');
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
            const hasSelf = this.onlineUsers.some(u => u && u.id === this.user.id);
            const count = this.isOnline ? (hasSelf ? this.onlineUsers.length : this.onlineUsers.length + 1) : 0;
            if (this.isOnline && count > 0) {
                this.topUserBadge.textContent = count;
                this.topUserBadge.style.display = 'inline-flex';
            } else {
                this.topUserBadge.style.display = 'none';
            }
        }
    }

    updateStatusUI(status) {
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
