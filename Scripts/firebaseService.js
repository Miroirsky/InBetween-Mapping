/**
 * Firebase Service
 * ------------------------------------------------------------------
 * Handles communication with Firebase Realtime Database and Cloud Firestore.
 * - Realtime Database: Synchronizes rapid live board changes (bubbles, connections, movement).
 * - Cloud Firestore: Archives room snapshots and logs session events ONLY when users join or leave.
 * - Automatic data sanitization & self-healing against corrupted/NaN nodes.
 * - Heartbeat + onDisconnect presence tracking with automatic stale peer eviction.
 */

class FirebaseService {
    constructor(config = null) {
        this.config = config || window.FirebaseConfig;
        this.isInitialized = false;
        this.isConnected = false;
        this.isSimulated = false;

        this.app = null;
        this.db = null;
        this.firestore = null;

        this.statusListeners = [];
        this.presenceRef = null;
        this.roomPresenceRef = null;
        this.presenceConnectedRef = null;
        this.presenceConnectedHandler = null;
        this.presenceHeartbeatTimer = null;
        this.presenceSweepTimer = null;
        this.peerHeartbeatTracker = new Map(); // peerId -> { lastSeenVal, observedAt }
        this.latestPresenceRaw = {};

        this.boardRef = null;
        this.connectedRef = null;

        // BroadcastChannel for instant local multi-tab simulation when Firebase credentials aren't set
        this.simBroadcast = null;
        if (typeof BroadcastChannel !== 'undefined') {
            try {
                this.simBroadcast = new BroadcastChannel('inbetween_mapping_room_channel');
            } catch (e) {
                this.simBroadcast = null;
            }
        }
    }

    onStatusChange(callback) {
        if (typeof callback === 'function') {
            this.statusListeners.push(callback);
        }
    }

    notifyStatus(status) {
        for (const cb of this.statusListeners) {
            try {
                cb(status);
            } catch (err) {
                console.error('Error in status listener:', err);
            }
        }
    }

    /**
     * Resolves active Firebase config from custom storage or default config.
     */
    getActiveConfig() {
        const key = (this.config && this.config.customConfigStorageKey) || 'inbetween_mapping_custom_firebase_config';
        let opts = Object.assign({}, (this.config && this.config.firebaseOptions) || {});
        try {
            const custom = localStorage.getItem(key);
            if (custom) {
                const parsed = JSON.parse(custom);
                if (parsed && (parsed.apiKey || parsed.projectId)) {
                    opts = Object.assign({}, opts, parsed);
                }
            }
        } catch (e) {
            console.warn('Could not read custom Firebase config from localStorage:', e);
        }

        // Auto-infer default databaseURL if missing but projectId is present
        if (opts.projectId && (!opts.databaseURL || opts.databaseURL.trim().length === 0)) {
            opts.databaseURL = `https://${opts.projectId}-default-rtdb.firebaseio.com`;
        }

        return opts;
    }

    /**
     * Checks whether valid Firebase credentials are provided.
     */
    hasValidCredentials() {
        const opts = this.getActiveConfig();
        return !!(opts.apiKey && opts.apiKey.trim().length > 5 &&
                  opts.projectId && opts.projectId.trim().length > 2);
    }

    /**
     * Sanitizes a bubble object so NaN or undefined values can never be written to Firebase.
     */
    sanitizeBubble(b, fallbackId = null) {
        if (!b || typeof b !== 'object') return null;
        const rawId = (b.id !== undefined && b.id !== null && b.id !== '') ? Number(b.id) : Number(fallbackId);
        const x = Number(b.x);
        const y = Number(b.y);

        if (!Number.isFinite(rawId) || rawId <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) {
            return null;
        }

        const id = Math.floor(rawId);
        const rawName = (b.name && typeof b.name === 'string' && !b.name.includes('NaN')) ? b.name.trim() : '';
        const rawScale = Number(b.scale);
        const scale = (Number.isFinite(rawScale) && rawScale > 0) ? Math.round(rawScale * 100) / 100 : 1.0;

        return {
            id,
            name: rawName.length > 0 ? rawName : `Universe ${id}`,
            color: (b.color && typeof b.color === 'string') ? b.color : '#000000',
            description: (b.description && typeof b.description === 'string') ? b.description.trim() : '',
            x: Math.round(x * 100) / 100,
            y: Math.round(y * 100) / 100,
            scale,
            isLocked: !!b.isLocked,
            updatedBy: (b.updatedBy && typeof b.updatedBy === 'string') ? b.updatedBy : 'peer',
            updatedAt: Number.isFinite(Number(b.updatedAt)) ? Number(b.updatedAt) : Date.now()
        };
    }

    /**
     * Sanitizes a connection object so NaN or undefined values can never be written to Firebase.
     */
    sanitizeConnection(c, fallbackId = null) {
        if (!c || typeof c !== 'object') return null;
        const rawId = (c.id !== undefined && c.id !== null && c.id !== '') ? Number(c.id) : Number(fallbackId);
        const fromId = Number(c.fromId);
        const toId = Number(c.toId);

        if (!Number.isFinite(rawId) || rawId <= 0 || !Number.isFinite(fromId) || fromId <= 0 || !Number.isFinite(toId) || toId <= 0) {
            return null;
        }

        const id = Math.floor(rawId);
        const rawName = (c.name && typeof c.name === 'string' && !c.name.includes('NaN')) ? c.name.trim() : '';

        const res = {
            id,
            fromId: Math.floor(fromId),
            toId: Math.floor(toId),
            name: rawName.length > 0 ? rawName : `Connection ${id}`
        };

        if (c.targetLength !== undefined && c.targetLength !== null && Number.isFinite(Number(c.targetLength)) && Number(c.targetLength) > 0) {
            res.targetLength = Math.round(Number(c.targetLength) * 10) / 10;
        }

        return res;
    }

    /**
     * Initializes Firebase App, Realtime Database, and Cloud Firestore.
     */
    async initialize() {
        if (this.isInitialized && (this.db || this.isSimulated)) {
            return { success: true, simulated: this.isSimulated };
        }

        const opts = this.getActiveConfig();
        const hasCreds = this.hasValidCredentials();

        if (typeof window.firebase === 'undefined' || !hasCreds) {
            this.isSimulated = true;
            this.isInitialized = true;
            this.isConnected = true;
            this.notifyStatus({
                initialized: true,
                connected: true,
                simulated: true,
                message: hasCreds ? 'Firebase SDK loading...' : 'Running in Local Multi-tab Simulator (Enter credentials in Firebase Settings for cloud)'
            });
            return { success: true, simulated: true };
        }

        try {
            if (!window.firebase.apps.length) {
                this.app = window.firebase.initializeApp(opts);
            } else {
                this.app = window.firebase.app();
            }

            if (typeof window.firebase.database === 'function') {
                try {
                    this.db = window.firebase.database();
                } catch (dbErr) {
                    console.warn('Realtime Database initialization warning:', dbErr.message);
                }
            }

            if (typeof window.firebase.firestore === 'function') {
                try {
                    this.firestore = window.firebase.firestore();
                } catch (fsErr) {
                    console.warn('Firestore initialization warning:', fsErr.message);
                }
            }

            this.isInitialized = true;
            this.isSimulated = false;

            if (this.db) {
                if (this.connectedRef) {
                    this.connectedRef.off();
                }
                this.connectedRef = this.db.ref('.info/connected');
                this.connectedRef.on('value', (snap) => {
                    this.isConnected = !!snap.val();
                    this.notifyStatus({
                        initialized: true,
                        connected: this.isConnected,
                        simulated: false,
                        message: this.isConnected ? 'Connected to Firebase' : 'Connecting to Firebase...'
                    });
                });
            } else {
                this.isConnected = true;
                this.notifyStatus({
                    initialized: true,
                    connected: true,
                    simulated: false,
                    message: 'Connected (Firestore only)'
                });
            }

            return { success: true, simulated: false };
        } catch (err) {
            console.error('Firebase initialization error:', err);
            this.isSimulated = true;
            this.isInitialized = true;
            this.isConnected = true;
            this.notifyStatus({
                initialized: true,
                connected: true,
                simulated: true,
                error: err.message,
                message: `Firebase error (${err.message}). Using Local Multi-tab Simulator.`
            });
            return { success: false, error: err.message, simulated: true };
        }
    }

    /**
     * Set up user presence in the online room.
     * Combines Realtime Database .info/connected + onDisconnect().remove() + active server-time heartbeats
     * and automatic stale-peer cleanup so disconnected players never remain visible.
     */
    setupPresence(roomId, user, onPresenceUpdate = null) {
        if (this.isSimulated || !this.db) {
            this.setupSimulatedPresence(roomId, user, onPresenceUpdate);
            return;
        }

        this.stopPresenceTimersAndListeners();

        const presenceBasePath = `${this.config.realtimeDb.roomsPath}/${roomId}/${this.config.realtimeDb.presencePath}`;
        const userPresencePath = `${presenceBasePath}/${user.id}`;
        this.presenceRef = this.db.ref(userPresencePath);
        this.roomPresenceRef = this.db.ref(presenceBasePath);

        const buildPresencePayload = () => ({
            id: user.id,
            name: user.name || 'Anonymous',
            color: user.color || '#4da6ff',
            lastSeen: window.firebase.database.ServerValue.TIMESTAMP
        });

        const registerOnServer = () => {
            if (!this.presenceRef) return;
            const payload = buildPresencePayload();
            this.presenceRef.onDisconnect().remove().then(() => {
                if (this.presenceRef) {
                    this.presenceRef.set(payload);
                }
            }).catch(() => {
                if (this.presenceRef) {
                    this.presenceRef.set(payload);
                }
            });
        };

        // 1. Register immediately and re-register whenever .info/connected transitions to true
        this.presenceConnectedRef = this.db.ref('.info/connected');
        this.presenceConnectedHandler = (snap) => {
            if (snap.val() === true) {
                registerOnServer();
            }
        };
        this.presenceConnectedRef.on('value', this.presenceConnectedHandler);
        registerOnServer();

        // 2. Heartbeat every 4 seconds using Firebase ServerValue.TIMESTAMP
        this.presenceHeartbeatTimer = setInterval(() => {
            if (this.presenceRef && this.isConnected) {
                this.presenceRef.update(buildPresencePayload()).catch(() => {});
            }
        }, 4000);

        // 3. Evaluate and filter active peers (evicting stale / disconnected entries)
        const evaluateActiveUsers = (rawMap) => {
            const entries = Object.entries(rawMap || {});
            const nowLocal = Date.now();
            const staleTimeoutMs = 13000; // 13 seconds (3+ missed 4s heartbeats)

            // Find highest server timestamp among current entries (our own heartbeat keeps this current)
            let maxServerTime = 0;
            for (const [, u] of entries) {
                if (u && Number.isFinite(Number(u.lastSeen)) && Number(u.lastSeen) > maxServerTime) {
                    maxServerTime = Number(u.lastSeen);
                }
            }

            const activeUsers = [];
            const seenIds = new Set();

            for (const [key, u] of entries) {
                if (!u || typeof u !== 'object' || !u.id || key === 'NaN' || key === 'undefined') {
                    if (this.roomPresenceRef) {
                        this.roomPresenceRef.child(key).remove().catch(() => {});
                    }
                    continue;
                }

                seenIds.add(u.id);

                if (u.id === user.id) {
                    activeUsers.push(u);
                    continue;
                }

                const peerServerTime = Number(u.lastSeen) || 0;
                const tracker = this.peerHeartbeatTracker.get(u.id);
                if (!tracker || tracker.lastSeenVal !== peerServerTime) {
                    this.peerHeartbeatTracker.set(u.id, {
                        lastSeenVal: peerServerTime,
                        observedAt: nowLocal
                    });
                }

                const currentTracker = this.peerHeartbeatTracker.get(u.id);
                const serverDiff = maxServerTime > 0 && peerServerTime > 0 ? (maxServerTime - peerServerTime) : 0;
                const localUnchangedDiff = currentTracker ? (nowLocal - currentTracker.observedAt) : 0;

                // A peer is stale if their server timestamp is >13s behind current server time,
                // or if their lastSeen timestamp hasn't updated in >13s of local time
                const isStale = (peerServerTime === 0) ||
                                (serverDiff > staleTimeoutMs) ||
                                (localUnchangedDiff > staleTimeoutMs);

                if (isStale) {
                    this.peerHeartbeatTracker.delete(u.id);
                    if (this.roomPresenceRef) {
                        this.roomPresenceRef.child(key).remove().catch(() => {});
                    }
                } else {
                    activeUsers.push(u);
                }
            }

            // Clean tracker for removed IDs
            for (const trackedId of this.peerHeartbeatTracker.keys()) {
                if (!seenIds.has(trackedId)) {
                    this.peerHeartbeatTracker.delete(trackedId);
                }
            }

            if (typeof onPresenceUpdate === 'function') {
                onPresenceUpdate(activeUsers);
            }
        };

        this.roomPresenceRef.on('value', (snap) => {
            this.latestPresenceRaw = snap.val() || {};
            evaluateActiveUsers(this.latestPresenceRaw);
        }, (err) => {
            console.warn('Realtime Database presence listener error:', err.message);
        });

        // Periodic sweep every 4 seconds to evict peers that stopped heartbeating
        this.presenceSweepTimer = setInterval(() => {
            evaluateActiveUsers(this.latestPresenceRaw);
        }, 4000);
    }

    stopPresenceTimersAndListeners() {
        if (this.presenceHeartbeatTimer) {
            clearInterval(this.presenceHeartbeatTimer);
            this.presenceHeartbeatTimer = null;
        }
        if (this.presenceSweepTimer) {
            clearInterval(this.presenceSweepTimer);
            this.presenceSweepTimer = null;
        }
        if (this.presenceConnectedRef && this.presenceConnectedHandler) {
            this.presenceConnectedRef.off('value', this.presenceConnectedHandler);
            this.presenceConnectedHandler = null;
            this.presenceConnectedRef = null;
        }
        if (this.roomPresenceRef) {
            this.roomPresenceRef.off();
            this.roomPresenceRef = null;
        }
        this.peerHeartbeatTracker.clear();
        this.latestPresenceRaw = {};
    }

    /**
     * Clears user presence when explicitly leaving the room or unloading the tab.
     */
    clearPresence(roomId, userId) {
        if (this.isSimulated || !this.db) {
            this.clearSimulatedPresence(roomId, userId);
            return;
        }

        this.stopPresenceTimersAndListeners();

        if (this.presenceRef) {
            try {
                this.presenceRef.onDisconnect().cancel().catch(() => {});
            } catch (e) {}
            this.presenceRef.remove().catch(() => {});
            this.presenceRef = null;
        } else if (roomId && userId) {
            const path = `${this.config.realtimeDb.roomsPath}/${roomId}/${this.config.realtimeDb.presencePath}/${userId}`;
            this.db.ref(path).remove().catch(() => {});
        }
    }

    /**
     * Attaches live listeners to the shared board in Realtime Database.
     */
    listenToBoard(roomId, callbacks = {}) {
        if (this.isSimulated || !this.db) {
            this.listenToSimulatedBoard(roomId, callbacks);
            return;
        }

        if (this.boardRef) {
            this.boardRef.off();
        }

        const boardPath = `${this.config.realtimeDb.roomsPath}/${roomId}/${this.config.realtimeDb.boardPath}`;
        this.boardRef = this.db.ref(boardPath);

        this.boardRef.on('value', (snapshot) => {
            const data = snapshot.val();
            if (typeof callbacks.onBoardValue === 'function') {
                callbacks.onBoardValue(data);
            }
        }, (err) => {
            console.warn('Realtime Database board listener error:', err.message);
        });
    }

    /**
     * Detaches live Realtime Database listeners when leaving the online room.
     */
    stopListeningToBoard(roomId) {
        if (this.boardRef) {
            this.boardRef.off();
            this.boardRef = null;
        }
        if (this.simBroadcast) {
            this.simBroadcast.onmessage = null;
        }
    }

    /**
     * Writes or updates a complete sanitized bubble in Realtime Database.
     */
    async updateBubble(roomId, bubbleId, bubbleData) {
        const clean = this.sanitizeBubble(bubbleData, bubbleId);
        if (!clean) {
            console.warn('Skipped writing invalid bubble data:', bubbleId, bubbleData);
            return;
        }

        if (this.isSimulated || !this.db) {
            this.updateSimStorageBubble(roomId, clean.id, clean);
            this.broadcastSimEvent('bubble_update', { roomId, bubbleId: clean.id, bubbleData: clean });
            return;
        }

        const ref = this.db.ref(`${this.config.realtimeDb.roomsPath}/${roomId}/${this.config.realtimeDb.bubblesPath}/${clean.id}`);
        await ref.set(clean);
    }

    /**
     * Batch updates multiple bubbles in Realtime Database in a single atomic operation.
     */
    async batchUpdateBubbles(roomId, bubblesList) {
        if (!Array.isArray(bubblesList) || bubblesList.length === 0) return;

        const updates = {};
        const cleanList = [];

        for (const b of bubblesList) {
            const clean = this.sanitizeBubble(b, b && b.id);
            if (clean) {
                updates[clean.id] = clean;
                cleanList.push(clean);
            }
        }

        if (cleanList.length === 0) return;

        if (this.isSimulated || !this.db) {
            for (const clean of cleanList) {
                this.updateSimStorageBubble(roomId, clean.id, clean);
                this.broadcastSimEvent('bubble_position', { roomId, bubbleId: clean.id, x: clean.x, y: clean.y, bubbleData: clean });
            }
            return;
        }

        const bubblesRef = this.db.ref(`${this.config.realtimeDb.roomsPath}/${roomId}/${this.config.realtimeDb.bubblesPath}`);
        await bubblesRef.update(updates);
    }

    /**
     * Removes a bubble from Realtime Database.
     */
    async removeBubble(roomId, bubbleId) {
        if (bubbleId === undefined || bubbleId === null || bubbleId === '') return;
        const key = String(bubbleId);

        if (this.isSimulated || !this.db) {
            this.removeSimStorageBubble(roomId, key);
            this.broadcastSimEvent('bubble_remove', { roomId, bubbleId: key });
            return;
        }
        const ref = this.db.ref(`${this.config.realtimeDb.roomsPath}/${roomId}/${this.config.realtimeDb.bubblesPath}/${key}`);
        await ref.remove();
    }

    /**
     * Updates or creates a connection in Realtime Database.
     */
    async updateConnection(roomId, connId, connData) {
        const clean = this.sanitizeConnection(connData, connId);
        if (!clean) {
            console.warn('Skipped writing invalid connection data:', connId, connData);
            return;
        }

        if (this.isSimulated || !this.db) {
            this.updateSimStorageConn(roomId, clean.id, clean);
            this.broadcastSimEvent('conn_update', { roomId, connId: clean.id, connData: clean });
            return;
        }
        const ref = this.db.ref(`${this.config.realtimeDb.roomsPath}/${roomId}/${this.config.realtimeDb.connectionsPath}/${clean.id}`);
        await ref.set(clean);
    }

    /**
     * Removes a connection from Realtime Database.
     */
    async removeConnection(roomId, connId) {
        if (connId === undefined || connId === null || connId === '') return;
        const key = String(connId);

        if (this.isSimulated || !this.db) {
            this.removeSimStorageConn(roomId, key);
            this.broadcastSimEvent('conn_remove', { roomId, connId: key });
            return;
        }
        const ref = this.db.ref(`${this.config.realtimeDb.roomsPath}/${roomId}/${this.config.realtimeDb.connectionsPath}/${key}`);
        await ref.remove();
    }

    /**
     * Completely sets the full board state in Realtime Database.
     */
    async setBoard(roomId, boardData, user = null) {
        const bubblesMap = {};
        const rawBubbles = boardData && boardData.bubbles
            ? (Array.isArray(boardData.bubbles) ? boardData.bubbles : Object.values(boardData.bubbles))
            : [];

        rawBubbles.forEach(b => {
            const clean = this.sanitizeBubble(b, b && b.id);
            if (clean) {
                bubblesMap[clean.id] = clean;
            }
        });

        const connectionsMap = {};
        const rawConns = boardData && boardData.connections
            ? (Array.isArray(boardData.connections) ? boardData.connections : Object.values(boardData.connections))
            : [];

        rawConns.forEach(c => {
            const clean = this.sanitizeConnection(c, c && c.id);
            if (clean && bubblesMap[clean.fromId] && bubblesMap[clean.toId]) {
                connectionsMap[clean.id] = clean;
            }
        });

        const payload = {
            bubbles: bubblesMap,
            connections: connectionsMap,
            noiseConfig: (boardData && (boardData.noiseConfig || boardData.noiseData)) || null,
            isCleared: Object.keys(bubblesMap).length === 0,
            updatedAt: this.db ? window.firebase.database.ServerValue.TIMESTAMP : Date.now(),
            updatedBy: user ? user.name : 'System'
        };

        if (this.isSimulated || !this.db) {
            localStorage.setItem(`inbetween_sim_board_${roomId}`, JSON.stringify(payload));
            this.broadcastSimEvent('board_set', { roomId, payload });
            return;
        }

        const ref = this.db.ref(`${this.config.realtimeDb.roomsPath}/${roomId}/${this.config.realtimeDb.boardPath}`);
        await ref.set(payload);
    }

    /**
     * Resets the shared board in Realtime Database while leaving a valid board marker.
     */
    async clearBoard(roomId, user = null) {
        const payload = {
            bubbles: null,
            connections: null,
            isCleared: true,
            updatedAt: this.db ? window.firebase.database.ServerValue.TIMESTAMP : Date.now(),
            updatedBy: user ? user.name : 'System'
        };

        if (this.isSimulated || !this.db) {
            localStorage.setItem(`inbetween_sim_board_${roomId}`, JSON.stringify({
                bubbles: {},
                connections: {},
                isCleared: true,
                updatedAt: Date.now()
            }));
            this.broadcastSimEvent('board_clear', { roomId });
            return;
        }
        const ref = this.db.ref(`${this.config.realtimeDb.roomsPath}/${roomId}/${this.config.realtimeDb.boardPath}`);
        await ref.set(payload);
    }

    /**
     * Fetches the current board once from Realtime Database.
     */
    async fetchCurrentBoard(roomId) {
        if (this.isSimulated || !this.db) {
            const raw = localStorage.getItem(`inbetween_sim_board_${roomId}`);
            if (raw) {
                try { return JSON.parse(raw); } catch (e) { return null; }
            }
            return null;
        }

        const ref = this.db.ref(`${this.config.realtimeDb.roomsPath}/${roomId}/${this.config.realtimeDb.boardPath}`);
        const snap = await ref.once('value');
        return snap.val();
    }

    /* ==================================================================
       Cloud Firestore Persistence (Join / Leave Snapshot Archiving)
       ================================================================== */

    /**
     * Archives current board snapshot and records an event in Cloud Firestore.
     * Invoked exclusively when a user JOINS or LEAVES the online room.
     */
    async saveFirestoreSnapshot(roomId, boardData, actionType, user) {
        const cleanBubbles = [];
        if (boardData && Array.isArray(boardData.bubbles)) {
            boardData.bubbles.forEach(b => {
                const clean = this.sanitizeBubble(b, b && b.id);
                if (clean) cleanBubbles.push(clean);
            });
        }

        const cleanConnections = [];
        if (boardData && Array.isArray(boardData.connections)) {
            boardData.connections.forEach(c => {
                const clean = this.sanitizeConnection(c, c && c.id);
                if (clean) cleanConnections.push(clean);
            });
        }

        const payload = {
            roomId: roomId,
            roomName: (this.config && this.config.roomName) || 'Global Room',
            lastAction: actionType, // 'join' | 'leave'
            lastUser: {
                id: user ? user.id : 'unknown',
                name: user ? user.name : 'Anonymous',
                color: user ? user.color : '#ffffff'
            },
            updatedAt: (window.firebase && window.firebase.firestore) ? window.firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString(),
            bubbleCount: cleanBubbles.length,
            connectionCount: cleanConnections.length,
            board: {
                bubbles: cleanBubbles,
                connections: cleanConnections,
                noiseConfig: (boardData && (boardData.noiseConfig || boardData.noiseData)) ? (boardData.noiseConfig || boardData.noiseData) : null
            }
        };

        if (this.isSimulated || !this.firestore) {
            try {
                const firestoreKey = `inbetween_sim_firestore_${roomId}`;
                const historyKey = `inbetween_sim_firestore_history_${roomId}`;
                localStorage.setItem(firestoreKey, JSON.stringify(payload));

                const rawHist = localStorage.getItem(historyKey);
                const history = rawHist ? JSON.parse(rawHist) : [];
                history.unshift({
                    action: actionType,
                    user: user ? user.name : 'Anonymous',
                    time: new Date().toLocaleTimeString(),
                    bubbleCount: payload.bubbleCount,
                    connectionCount: payload.connectionCount
                });
                if (history.length > 20) history.pop();
                localStorage.setItem(historyKey, JSON.stringify(history));
            } catch (e) {
                console.warn('Simulation firestore write error:', e);
            }
            return { success: true, simulated: true, payload };
        }

        try {
            const roomDocRef = this.firestore.collection(this.config.firestore.roomsCollection).doc(roomId);

            await roomDocRef.set(payload, { merge: true });

            await roomDocRef.collection(this.config.firestore.eventsSubcollection).add({
                eventType: actionType,
                userId: user ? user.id : 'unknown',
                userName: user ? user.name : 'Anonymous',
                timestamp: window.firebase.firestore.FieldValue.serverTimestamp(),
                bubbleCount: payload.bubbleCount,
                connectionCount: payload.connectionCount
            });

            return { success: true, simulated: false, payload };
        } catch (err) {
            console.error('Firestore snapshot write error:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Reads the last saved snapshot from Cloud Firestore.
     */
    async getFirestoreSnapshot(roomId) {
        if (this.isSimulated || !this.firestore) {
            const raw = localStorage.getItem(`inbetween_sim_firestore_${roomId}`);
            if (raw) {
                try { return JSON.parse(raw); } catch (e) { return null; }
            }
            return null;
        }

        try {
            const doc = await this.firestore.collection(this.config.firestore.roomsCollection).doc(roomId).get();
            if (doc.exists) {
                return doc.data();
            }
            return null;
        } catch (err) {
            console.error('Firestore snapshot read error:', err);
            return null;
        }
    }

    /* ==================================================================
       Multi-Tab Local Simulator (BroadcastChannel + LocalStorage)
       ================================================================== */

    updateSimStorageBubble(roomId, id, cleanBubble) {
        try {
            const key = `inbetween_sim_board_${roomId}`;
            const raw = localStorage.getItem(key);
            const board = raw ? JSON.parse(raw) : { bubbles: {}, connections: {} };
            if (!board.bubbles) board.bubbles = {};
            board.bubbles[id] = cleanBubble;
            board.isCleared = false;
            localStorage.setItem(key, JSON.stringify(board));
        } catch (e) {}
    }

    removeSimStorageBubble(roomId, id) {
        try {
            const key = `inbetween_sim_board_${roomId}`;
            const raw = localStorage.getItem(key);
            if (!raw) return;
            const board = JSON.parse(raw);
            if (board.bubbles) delete board.bubbles[id];
            localStorage.setItem(key, JSON.stringify(board));
        } catch (e) {}
    }

    updateSimStorageConn(roomId, id, cleanConn) {
        try {
            const key = `inbetween_sim_board_${roomId}`;
            const raw = localStorage.getItem(key);
            const board = raw ? JSON.parse(raw) : { bubbles: {}, connections: {} };
            if (!board.connections) board.connections = {};
            board.connections[id] = cleanConn;
            localStorage.setItem(key, JSON.stringify(board));
        } catch (e) {}
    }

    removeSimStorageConn(roomId, id) {
        try {
            const key = `inbetween_sim_board_${roomId}`;
            const raw = localStorage.getItem(key);
            if (!raw) return;
            const board = JSON.parse(raw);
            if (board.connections) delete board.connections[id];
            localStorage.setItem(key, JSON.stringify(board));
        } catch (e) {}
    }

    setupSimulatedPresence(roomId, user, onPresenceUpdate) {
        const presKey = `inbetween_sim_presence_${roomId}`;
        const registerPresence = () => {
            try {
                const raw = localStorage.getItem(presKey);
                const list = raw ? JSON.parse(raw) : [];
                const filtered = list.filter(u => u && u.id && u.id !== user.id && (Date.now() - u.lastSeen < 12000));
                filtered.push({
                    id: user.id,
                    name: user.name,
                    color: user.color,
                    lastSeen: Date.now()
                });
                localStorage.setItem(presKey, JSON.stringify(filtered));
                if (typeof onPresenceUpdate === 'function') {
                    onPresenceUpdate(filtered);
                }
            } catch (e) {}
        };

        registerPresence();
        if (this.simHeartbeat) clearInterval(this.simHeartbeat);
        this.simHeartbeat = setInterval(registerPresence, 4000);

        if (this.simBroadcast) {
            this.simBroadcast.addEventListener('message', (e) => {
                if (e.data && e.data.type === 'presence_ping' && typeof onPresenceUpdate === 'function') {
                    try {
                        const raw = localStorage.getItem(presKey);
                        if (raw) {
                            const list = JSON.parse(raw).filter(u => u && u.id && (Date.now() - u.lastSeen < 12000));
                            onPresenceUpdate(list);
                        }
                    } catch (err) {}
                }
            });
            this.simBroadcast.postMessage({ type: 'presence_ping' });
        }
    }

    clearSimulatedPresence(roomId, userId) {
        if (this.simHeartbeat) {
            clearInterval(this.simHeartbeat);
            this.simHeartbeat = null;
        }
        try {
            const presKey = `inbetween_sim_presence_${roomId}`;
            const raw = localStorage.getItem(presKey);
            if (raw) {
                const list = JSON.parse(raw).filter(u => u && u.id !== userId);
                localStorage.setItem(presKey, JSON.stringify(list));
            }
            if (this.simBroadcast) {
                this.simBroadcast.postMessage({ type: 'presence_ping' });
            }
        } catch (e) {}
    }

    listenToSimulatedBoard(roomId, callbacks) {
        if (!this.simBroadcast) return;
        this.simBroadcast.onmessage = (e) => {
            if (!e.data || e.data.roomId !== roomId) return;
            const { type, ...payload } = e.data;

            if (type === 'board_set' && typeof callbacks.onBoardValue === 'function') {
                callbacks.onBoardValue(payload.payload);
            } else if (type === 'board_clear' && typeof callbacks.onBoardValue === 'function') {
                callbacks.onBoardValue({ bubbles: {}, connections: {}, isCleared: true });
            } else if (type === 'bubble_position' && typeof callbacks.onBubblePosition === 'function') {
                callbacks.onBubblePosition(payload.bubbleId, payload.x, payload.y, payload.bubbleData);
            } else if (type === 'bubble_update' && typeof callbacks.onBubbleUpdate === 'function') {
                callbacks.onBubbleUpdate(payload.bubbleId, payload.bubbleData);
            } else if (type === 'bubble_remove' && typeof callbacks.onBubbleRemove === 'function') {
                callbacks.onBubbleRemove(payload.bubbleId);
            } else if (type === 'conn_update' && typeof callbacks.onConnUpdate === 'function') {
                callbacks.onConnUpdate(payload.connId, payload.connData);
            } else if (type === 'conn_remove' && typeof callbacks.onConnRemove === 'function') {
                callbacks.onConnRemove(payload.connId);
            }
        };
    }

    broadcastSimEvent(type, data) {
        if (this.simBroadcast) {
            this.simBroadcast.postMessage({ type, ...data });
        }
    }
}

if (typeof window !== 'undefined') {
    window.FirebaseService = FirebaseService;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FirebaseService;
}
