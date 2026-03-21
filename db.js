// ==============================
// פרץיאס – Firestore Database
// ==============================

const DB = (() => {
    let db = null;

    function init() {
        try {
            db = firebase.firestore();
            console.log('✅ Firestore connected');
        } catch (e) {
            console.warn('⚠️ Firestore not available, stats will not be saved.', e);
        }
    }

    // Generate a simple session ID
    function sessionId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    }

    // Get or create a persistent device ID
    function getDeviceId() {
        let id = localStorage.getItem('peretzias_device_id');
        if (!id) {
            id = 'dev_' + sessionId();
            localStorage.setItem('peretzias_device_id', id);
        }
        return id;
    }

    // ---- Log game start ----
    async function logGameStart(gameData) {
        if (!db) return null;
        try {
            const docRef = await db.collection('games').add({
                deviceId: getDeviceId(),
                startedAt: firebase.firestore.FieldValue.serverTimestamp(),
                numTeams: gameData.numTeams,
                teams: gameData.teams.map(t => ({ name: t.name, color: t.color })),
                mode: gameData.mode,
                difficulty: gameData.difficulty,
                goal: gameData.goal,
                skipPenalty: gameData.skipPenalty,
                timerDuration: gameData.timerDuration,
                status: 'in_progress',
            });
            console.log('📝 Game logged:', docRef.id);
            return docRef.id;
        } catch (e) {
            console.warn('Failed to log game start:', e);
            return null;
        }
    }

    // ---- Log game end (winner found) ----
    async function logGameEnd(gameDocId, gameData, winner) {
        if (!db) return;
        try {
            const updateData = {
                endedAt: firebase.firestore.FieldValue.serverTimestamp(),
                status: 'completed',
                winner: winner.name,
                winnerScore: winner.score,
                finalScores: gameData.teams.map(t => ({ name: t.name, score: t.score })),
            };

            if (gameDocId) {
                await db.collection('games').doc(gameDocId).update(updateData);
            } else {
                // Fallback: create a new doc if we lost the ID
                updateData.deviceId = getDeviceId();
                updateData.numTeams = gameData.numTeams;
                updateData.teams = gameData.teams.map(t => ({ name: t.name, color: t.color }));
                updateData.mode = gameData.mode;
                updateData.difficulty = gameData.difficulty;
                updateData.goal = gameData.goal;
                await db.collection('games').add(updateData);
            }
            console.log('🏆 Game end logged');
        } catch (e) {
            console.warn('Failed to log game end:', e);
        }
    }

    // ---- Log turn result ----
    async function logTurn(gameDocId, turnData) {
        if (!db || !gameDocId) return;
        try {
            await db.collection('games').doc(gameDocId).collection('turns').add({
                teamName: turnData.teamName,
                teamIndex: turnData.teamIndex,
                roundScore: turnData.roundScore,
                wordsPlayed: turnData.wordHistory.length,
                correct: turnData.wordHistory.filter(w => w.result === 'correct').length,
                skipped: turnData.wordHistory.filter(w => w.result === 'skipped').length,
                fouls: turnData.wordHistory.filter(w => w.result === 'foul').length,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            });
        } catch (e) {
            console.warn('Failed to log turn:', e);
        }
    }

    // ---- Update total games counter ----
    async function incrementGamesCounter() {
        if (!db) return;
        try {
            const statsRef = db.collection('stats').doc('global');
            await statsRef.set({
                totalGames: firebase.firestore.FieldValue.increment(1),
                lastGameAt: firebase.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
        } catch (e) {
            console.warn('Failed to update games counter:', e);
        }
    }

    return {
        init,
        logGameStart,
        logGameEnd,
        logTurn,
        incrementGamesCounter,
    };
})();
