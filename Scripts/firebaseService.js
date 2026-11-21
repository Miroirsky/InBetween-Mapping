/**
 * Firebase Service
 * ------------------------------------------------------------------
 * Handles communication with Firebase Realtime Database and Cloud Firestore.
 * - Realtime Database: Synchronizes rapid live board changes (bubbles, connections, movement).
 * - Cloud Firestore: Archives room snapshots and logs session events ONLY when users join or leave.
 * - Graceful fallback / simulation: Seamlessly functions for local testing if credentials are not yet configured.
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
        this.auth = null;

        this.statusListeners = [];
        this.presenceRef = null;
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
        try {
            const custom = localStorage.getItem(key);
            if (custom) {
                const parsed = JSON.parse(custom);
                if (parsed && parsed.apiKey && parsed.projectId) {
                    return parsed;
                }
            }
        } catch (e) {
            console.warn('Could not read custom Firebase config from localStorage:', e);
        }

        return (this.config && this.config.firebaseOptions) || {};
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
     * Initializes Firebase App, Auth, Realtime Database, and Firestore.
     */
    async initialize() {
        if (this.isInitialized && (this.db || this.isSimulated)) {
            return { success: true, simulated: this.isSimulated };
        }

        const opts = this.getActiveConfig();
        const hasCreds = this.hasValidCredentials();

        // Check if Firebase SDK scripts are loaded
        if (typeof window.firebase === 'undefined' || !hasCreds) {
            // Enable Simulation Mode so user can test immediately
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
                this.db = window.firebase.database();
            }

            if (typeof window.firebase.firestore === 'function') {
                this.firestore = window.firebase.firestore();
            }

            if (typeof window.firebase.auth === 'function') {
                this.auth = window.firebase.auth();
                // Attempt anonymous sign-in if enabled
                try {
                    await this.auth.signInAnonymously();
                } catch (authErr) {
                    // Non-fatal if project allows unauthenticated or rules permit
                    console.info('Anonymous sign-in note:', authErr.message);
                }
            }

            this.isInitialized = true;
            this.isSimulated = false;

            // Monitor connection status via Realtime Database
            if (this.db) {
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
            // Fallback to simulation mode to avoid breaking application
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
     * Uses Realtime Database onDisconnect() to automatically clean up on disconnect.
     */
    setupPresence(roomId, user, onPresenceUpdate = null) {
        if (this.isSimulated || !this.db) {
            // Local simulation presence via BroadcastChannel / localStorage
            this.setupSimulatedPresence(roomId, user, onPresenceUpdate);
            return;
        }

        const path = `${this.config.realtimeDb.roomsPath}/${roomId}/${this.config.realtimeDb.presencePath}/${user.id}`;
        this.presenceRef = this.db.ref(path);

        const presenceData = {
            id: user.id,
            name: user.name || 'Anonymous',
            color: user.color || '#4da6ff',
            joinedAt: window.firebase.database.ServerValue.TIMESTAMP
        };

        // When disconnected or tab is closed, automatically delete user presence
        this.presenceRef.onDisconnect().remove();
        this.presenceRef.set(presenceData);

        // Listen for all users in the room
        const roomPresenceRef = this.db.ref(`${this.config.realtimeDb.roomsPath}/${roomId}/${this.config.realtimeDb.presencePath}`);
        roomPresenceRef.on('value', (snap) => {
            const val = snap.val() || {};
            const users = Object.values(val);
            if (typeof onPresenceUpdate === 'function') {
                onPresenceUpdate(users);
            }
        });
    }

    /**
     * Clears user presence when explicitly leaving the room.
     */
    clearPresence(roomId, userId) {
        if (this.isSimulated || !this.db) {
            this.clearSimulatedPresence(roomId, userId);
            return;
        }

        if (this.presenceRef) {
            this.presenceRef.remove();
            this.presenceRef = null;
        }
        const roomPresenceRef = this.db.ref(`${this.config.realtimeDb.roomsPath}/${roomId}/${this.config.realtimeDb.presencePath}`);
        roomPresenceRef.off();
    }

    /**
     * Attaches live listeners to the shared board in Realtime Database.
     */
    listenToBoard(roomId, callbacks = {}) {
        if (this.isSimulated || !this.db) {
            this.listenToSimulatedBoard(roomId, callbacks);
            return;
        }

        const boardPath = `${this.config.realtimeDb.roomsPath}/${roomId}/${this.config.realtimeDb.boardPath}`;
        this.boardRef = this.db.ref(boardPath);

        this.boardRef.on('value', (snapshot) => {
            const data = snapshot.val();
            if (typeof callbacks.onBoardValue === 'function') {
                callbacks.onBoardValue(data);
            }
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
     * Updates or creates a bubble in Realtime Database.
     */
    async updateBubble(roomId, bubbleId, bubbleData) {
        if (this.isSimulated || !this.db) {
            this.broadcastSimEvent('bubble_update', { roomId, bubbleId, bubbleData });
            return;
        }
        const ref = this.db.ref(`${this.config.realtimeDb.roomsPath}/${roomId}/${this.config.realtimeDb.bubblesPath}/${bubbleId}`);
        await ref.update(bubbleData);
    }

    /**
     * Throttled bubble position update in Realtime Database.
     */
    async updateBubblePosition(roomId, bubbleId, x, y) {
        if (this.isSimulated || !this.db) {
            this.broadcastSimEvent('bubble_position', { roomId, bubbleId, x, y });
            return;
        }
        const ref = this.db.ref(`${this.config.realtimeDb.roomsPath}/${roomId}/${this.config.realtimeDb.bubblesPath}/${bubbleId}`);
        await ref.update({
            x: Math.round(x * 100) / 100,
            y: Math.round(y * 100) / 100
        });
    }

    /**
     * Removes a bubble from Realtime Database.
     */
    async removeBubble(roomId, bubbleId) {
        if (this.isSimulated || !this.db) {
            this.broadcastSimEvent('bubble_remove', { roomId, bubbleId });
            return;
        }
        const ref = this.db.ref(`${this.config.realtimeDb.roomsPath}/${roomId}/${this.config.realtimeDb.bubblesPath}/${bubbleId}`);
        await ref.remove();
    }

    /**
     * Updates or creates a connection in Realtime Database.
     */
    async updateConnection(roomId, connId, connData) {
        if (this.isSimulated || !this.db) {
            this.broadcastSimEvent('conn_update', { roomId, connId, connData });
            return;
        }
        const ref = this.db.ref(`${this.config.realtimeDb.roomsPath}/${roomId}/${this.config.realtimeDb.connectionsPath}/${connId}`);
        await ref.set(connData);
    }

    /**
     * Removes a connection from Realtime Database.
     */
    async removeConnection(roomId, connId) {
        if (this.isSimulated || !this.db) {
            this.broadcastSimEvent('conn_remove', { roomId, connId });
            return;
        }
        const ref = this.db.ref(`${this.config.realtimeDb.roomsPath}/${roomId}/${this.config.realtimeDb.connectionsPath}/${connId}`);
        await ref.remove();
    }

    /**
     * Completely sets the full board state in Realtime Database.
     */
    async setBoard(roomId, boardData, user = null) {
        // Convert arrays to objects keyed by id for Realtime Database
        const bubblesMap = {};
        if (Array.isArray(boardData.bubbles)) {
            boardData.bubbles.forEach(b => {
                bubblesMap[b.id] = b;
            });
        }

        const connectionsMap = {};
        if (Array.isArray(boardData.connections)) {
            boardData.connections.forEach(c => {
                connectionsMap[c.id] = c;
            });
        }

        const payload = {
            bubbles: bubblesMap,
            connections: connectionsMap,
            noiseConfig: boardData.noiseConfig || null,
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
     * Resets the shared board in Realtime Database.
     */
    async clearBoard(roomId) {
        if (this.isSimulated || !this.db) {
            localStorage.removeItem(`inbetween_sim_board_${roomId}`);
            this.broadcastSimEvent('board_clear', { roomId });
            return;
        }
        const ref = this.db.ref(`${this.config.realtimeDb.roomsPath}/${roomId}/${this.config.realtimeDb.boardPath}`);
        await ref.remove();
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
     * Invoked exclusively when a user JOINS or LEAVES the online room,
     * ensuring frequent actions remain in Realtime Database without exhausting Firestore writes.
     */
    async saveFirestoreSnapshot(roomId, boardData, actionType, user) {
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
            bubbleCount: (boardData && boardData.bubbles) ? boardData.bubbles.length : 0,
            connectionCount: (boardData && boardData.connections) ? boardData.connections.length : 0,
            board: {
                bubbles: (boardData && boardData.bubbles) ? boardData.bubbles : [],
                connections: (boardData && boardData.connections) ? boardData.connections : [],
                noiseConfig: (boardData && boardData.noiseConfig) ? boardData.noiseConfig : null
            }
        };

        if (this.isSimulated || !this.firestore) {
            // Persist to local simulation log
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

            // 1. Update the main room document with latest snapshot
            await roomDocRef.set(payload, { merge: true });

            // 2. Add an audit entry in the session_events subcollection
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

    setupSimulatedPresence(roomId, user, onPresenceUpdate) {
        const presKey = `inbetween_sim_presence_${roomId}`;
        const registerPresence = () => {
            try {
                const raw = localStorage.getItem(presKey);
                const list = raw ? JSON.parse(raw) : [];
                const filtered = list.filter(u => u.id !== user.id && (Date.now() - u.lastSeen < 20000));
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
        this.simHeartbeat = setInterval(registerPresence, 5000);

        if (this.simBroadcast) {
            this.simBroadcast.addEventListener('message', (e) => {
                if (e.data && e.data.type === 'presence_ping' && typeof onPresenceUpdate === 'function') {
                    try {
                        const raw = localStorage.getItem(presKey);
                        if (raw) onPresenceUpdate(JSON.parse(raw));
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
                const list = JSON.parse(raw).filter(u => u.id !== userId);
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
                callbacks.onBoardValue({ bubbles: {}, connections: {} });
            } else if (type === 'bubble_position' && typeof callbacks.onBubblePosition === 'function') {
                callbacks.onBubblePosition(payload.bubbleId, payload.x, payload.y);
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
