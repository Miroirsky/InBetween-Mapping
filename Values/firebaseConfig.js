/**
 * Firebase Configuration Values
 * ------------------------------------------------------------------
 * Centralized settings for Firebase Realtime Database, Cloud Firestore,
 * online room configuration, presence settings, and synchronization options.
 * 
 * Accessible parameters:
 * - firebaseOptions: Project credentials (apiKey, databaseURL, projectId, etc.)
 * - roomId: The single shared online room ID (default: "global_room")
 * - dragThrottleMs: Throttle interval for sending bubble drag updates
 * - window: Default floating window dimensions and coordinates
 */

const FirebaseConfig = {
    /**
     * Firebase project credentials.
     * Fill in your Firebase project web configuration below,
     * or enter it directly via the "Firebase Settings" panel in the Online Menu.
     */
    firebaseOptions: {
        apiKey: "",
        authDomain: "",
        databaseURL: "",
        projectId: "",
        storageBucket: "",
        messagingSenderId: "",
        appId: ""
    },

    /**
     * Unique room ID for the single online room.
     * All online users collaborate inside this shared room.
     */
    roomId: 'global_room',

    /**
     * Display name for the room in the UI
     */
    roomName: 'Global Room',

    /**
     * Local storage keys
     */
    customConfigStorageKey: 'inbetween_mapping_custom_firebase_config',
    userProfileStorageKey: 'inbetween_mapping_user_profile',
    soloBackupStorageKey: 'inbetween_mapping_solo_board_backup',
    onlineSessionStateKey: 'inbetween_mapping_online_session_state',

    /**
     * Realtime Database path definitions
     */
    realtimeDb: {
        roomsPath: 'rooms',
        boardPath: 'board',
        bubblesPath: 'board/bubbles',
        connectionsPath: 'board/connections',
        presencePath: 'presence'
    },

    /**
     * Firestore collections and document paths
     */
    firestore: {
        roomsCollection: 'rooms',
        eventsSubcollection: 'session_events',
        snapshotsSubcollection: 'snapshots'
    },

    /**
     * Throttle rate (ms) for broadcasting bubble drag positions over Realtime Database.
     * Keeps sync fluid (approx 20 updates/sec maximum) without spamming the database.
     */
    dragThrottleMs: 50,

    /**
     * Fallback heartbeat interval (ms) for online presence check
     */
    heartbeatIntervalMs: 15000,

    /**
     * Default floating window size & position
     */
    window: {
        width: 360,
        defaultTop: 60,
        defaultLeft: 220
    }
};

if (typeof window !== 'undefined') {
    window.FirebaseConfig = FirebaseConfig;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FirebaseConfig;
}
