// ==============================
// פרץיאס – Game Logic
// ==============================

const SAVE_KEY = 'peretzias_saved_game';

// ---- State ----
let gameState = {
    numTeams: 2,
    teams: [],
    mode: 'normal',
    difficulty: 'easy',
    goal: 30,
    skipPenalty: 'free',
    currentTeamIndex: 0,
    timerDuration: 60,
};

let turnState = {
    timer: null,
    timeLeft: 60,
    currentWord: null,
    currentCategory: null,
    roundScore: 0,
    wordHistory: [],
    usedWords: new Set(),
    wordQueue: [],
    isPaused: false,
};

let currentGameDocId = null;

// ---- Default team colors ----
const TEAM_COLORS = ['#C62828', '#1565C0', '#2E7D32', '#F57F17'];
const TEAM_DEFAULTS = ['קבוצה אדומה', 'קבוצה כחולה', 'קבוצה ירוקה', 'קבוצה צהובה'];

// ---- Screen management ----
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// ---- Setup: Teams ----
function setTeams(num) {
    gameState.numTeams = num;
    document.querySelectorAll('.team-btn').forEach(b => b.classList.remove('selected'));
    document.querySelectorAll('.team-btn').forEach(b => {
        if (parseInt(b.textContent) === num) b.classList.add('selected');
    });
    renderTeamNameInputs();
}

function renderTeamNameInputs() {
    const container = document.getElementById('team-names-inputs');
    container.innerHTML = '';
    for (let i = 0; i < gameState.numTeams; i++) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'team-name-input';
        input.placeholder = TEAM_DEFAULTS[i];
        input.dataset.index = i;
        input.style.borderRightColor = TEAM_COLORS[i];
        input.style.borderRightWidth = '4px';
        container.appendChild(input);
    }
}

// ---- Setup: Difficulty ----
function setDifficulty(diff) {
    gameState.difficulty = diff;
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('selected'));
    document.querySelector(`[data-diff="${diff}"]`).classList.add('selected');
}

// ---- Setup: Goal ----
function setGoal(goal) {
    gameState.goal = goal;
    document.querySelectorAll('.goal-btn').forEach(b => b.classList.remove('selected'));
    document.querySelectorAll('.goal-btn').forEach(b => {
        if (parseInt(b.textContent) === goal) b.classList.add('selected');
    });
}

// ---- Setup: Skip Penalty ----
function setSkipPenalty(penalty) {
    gameState.skipPenalty = penalty;
    document.querySelectorAll('.skip-btn').forEach(b => b.classList.remove('selected'));
    document.querySelector(`[data-skip="${penalty}"]`).classList.add('selected');
}

// ---- Start Game ----
function startGame() {
    // Collect team names
    gameState.teams = [];
    const inputs = document.querySelectorAll('.team-name-input');
    for (let i = 0; i < gameState.numTeams; i++) {
        const name = (inputs[i] && inputs[i].value.trim()) || TEAM_DEFAULTS[i];
        gameState.teams.push({ name, score: 0, color: TEAM_COLORS[i] });
    }

    // Set timer duration (60 seconds)
    gameState.timerDuration = 60;
    gameState.currentTeamIndex = 0;

    // Reset used words
    turnState.usedWords = new Set();

    // Log game start to Firestore
    DB.logGameStart(gameState).then(docId => {
        currentGameDocId = docId;
    });
    DB.incrementGamesCounter();

    saveGameState();
    prepareTurn();
    showScreen('screen-turn');
}

// ---- Prepare Turn ----
function prepareTurn() {
    const team = gameState.teams[gameState.currentTeamIndex];
    document.getElementById('turn-team-badge').textContent = team.name;
    document.getElementById('turn-team-badge').style.background = team.color + '44';
    document.getElementById('turn-team-badge').style.color = '#fff';
}

// ---- Start Turn ----
function startTurn() {
    turnState.timeLeft = gameState.timerDuration;
    turnState.roundScore = 0;
    turnState.wordHistory = [];
    turnState.wordQueue = buildWordQueue();

    const team = gameState.teams[gameState.currentTeamIndex];
    document.getElementById('play-team-name').textContent = team.name;
    document.getElementById('play-score-mini').textContent = '+0';

    showScreen('screen-play');
    nextWord();
    startTimer();
}

// ---- Word Queue ----
function buildWordQueue() {
    let pool = [];

    if (gameState.difficulty === 'mix') {
        // All categories
        for (const cat of Object.keys(WORDS)) {
            WORDS[cat].forEach(w => pool.push({ word: w, category: cat }));
        }
    } else {
        // Single difficulty
        const cat = gameState.difficulty;
        if (WORDS[cat]) {
            WORDS[cat].forEach(w => pool.push({ word: w, category: cat }));
        }
    }

    // Remove duplicates (same word in multiple categories – keep first occurrence)
    const seen = new Set();
    pool = pool.filter(item => {
        if (seen.has(item.word)) return false;
        seen.add(item.word);
        return true;
    });

    // Remove used words
    pool = pool.filter(item => !turnState.usedWords.has(item.word));

    // Only reset if pool is completely exhausted
    if (pool.length === 0) {
        turnState.usedWords.clear();
        pool = [];
        if (gameState.difficulty === 'mix') {
            for (const cat of Object.keys(WORDS)) {
                WORDS[cat].forEach(w => pool.push({ word: w, category: cat }));
            }
        } else {
            const cat = gameState.difficulty;
            if (WORDS[cat]) {
                WORDS[cat].forEach(w => pool.push({ word: w, category: cat }));
            }
        }
        // Deduplicate again after reset
        const seen2 = new Set();
        pool = pool.filter(item => {
            if (seen2.has(item.word)) return false;
            seen2.add(item.word);
            return true;
        });
    }

    // Shuffle
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    return pool;
}

// ---- Next Word ----
function nextWord() {
    if (turnState.wordQueue.length === 0) {
        turnState.wordQueue = buildWordQueue();
    }

    const item = turnState.wordQueue.pop();
    turnState.currentWord = item.word;
    turnState.currentCategory = item.category;
    turnState.usedWords.add(item.word);

    const card = document.getElementById('word-card');
    const points = DIFFICULTY_POINTS[item.category] || 1;

    // Animate
    card.className = 'word-card slide-out';
    setTimeout(() => {
        card.className = 'word-card ' + item.category;
        document.getElementById('word-text').textContent = item.word;
        document.getElementById('word-difficulty').textContent = DIFFICULTY_LABELS[item.category];
        document.getElementById('word-points').textContent = '+' + points;
        card.classList.add('slide-in');
    }, 200);
}

// ---- Correct ----
function correctWord() {
    if (!turnState.timer) return;
    const points = DIFFICULTY_POINTS[turnState.currentCategory] || 1;
    turnState.roundScore += points;
    turnState.wordHistory.push({ word: turnState.currentWord, result: 'correct', points });
    updatePlayScore();
    vibrate(30);

    // Check for immediate winner during gameplay
    const currentTeam = gameState.teams[gameState.currentTeamIndex];
    const potentialScore = currentTeam.score + turnState.roundScore;
    if (potentialScore >= gameState.goal) {
        // Stop timer and declare winner immediately
        clearInterval(turnState.timer);
        turnState.timer = null;
        turnState.isPaused = false;
        document.getElementById('pause-overlay').classList.remove('active');
        document.getElementById('word-card').classList.remove('paused');
        
        // Update team score
        currentTeam.score = potentialScore;
        saveGameState();
        
        // Log turn and game end
        DB.logTurn(currentGameDocId, {
            teamName: currentTeam.name,
            teamIndex: gameState.currentTeamIndex,
            roundScore: turnState.roundScore,
            wordHistory: turnState.wordHistory,
        });
        
        clearSavedGame();
        DB.logGameEnd(currentGameDocId, gameState, currentTeam);
        currentGameDocId = null;
        showWinner(currentTeam);
        return;
    }

    nextWord();
}

// ---- Skip ----
function skipWord() {
    if (!turnState.timer) return;
    const penalty = gameState.skipPenalty === 'penalty' ? -1 : 0;
    turnState.roundScore += penalty;
    turnState.wordHistory.push({
        word: turnState.currentWord,
        result: 'skipped',
        points: penalty
    });
    updatePlayScore();
    nextWord();
    vibrate(15);
}

// ---- Foul ----
function foulWord() {
    if (!turnState.timer) return;
    const penalty = -1;
    turnState.roundScore += penalty;
    turnState.wordHistory.push({
        word: turnState.currentWord,
        result: 'foul',
        points: penalty
    });
    updatePlayScore();
    nextWord();
    vibrate([50, 30, 50]);
}

function updatePlayScore() {
    const el = document.getElementById('play-score-mini');
    el.textContent = (turnState.roundScore >= 0 ? '+' : '') + turnState.roundScore;
}

function vibrate(pattern) {
    if (navigator.vibrate) {
        navigator.vibrate(pattern);
    }
}

// ---- Timer ----
function startTimer() {
    const total = gameState.timerDuration;
    turnState.timeLeft = total;
    updateTimerDisplay();

    const timerContainer = document.getElementById('timer-ring');
    timerContainer.classList.remove('timer-warning');

    turnState.timer = setInterval(() => {
        turnState.timeLeft--;
        updateTimerDisplay();

        if (turnState.timeLeft <= 10) {
            timerContainer.classList.add('timer-warning');
        }

        if (turnState.timeLeft <= 0) {
            endTurn();
        }
    }, 1000);
}

function updateTimerDisplay() {
    const total = gameState.timerDuration;
    const circumference = 2 * Math.PI * 45; // r=45
    const offset = (1 - turnState.timeLeft / total) * circumference;

    document.getElementById('timer-fill').style.strokeDashoffset = offset;
    document.getElementById('timer-text').textContent = turnState.timeLeft;
}

// ---- End Turn ----
function endTurn() {
    clearInterval(turnState.timer);
    turnState.timer = null;
    turnState.isPaused = false;

    // Hide pause overlay if open
    document.getElementById('pause-overlay').classList.remove('active');
    document.getElementById('word-card').classList.remove('paused');

    // Play sound buzz
    playBuzz();

    // Update team score
    gameState.teams[gameState.currentTeamIndex].score += turnState.roundScore;
    if (gameState.teams[gameState.currentTeamIndex].score < 0) {
        gameState.teams[gameState.currentTeamIndex].score = 0;
    }

    // Save after each turn
    saveGameState();

    const team = gameState.teams[gameState.currentTeamIndex];

    // Log turn to Firestore
    DB.logTurn(currentGameDocId, {
        teamName: team.name,
        teamIndex: gameState.currentTeamIndex,
        roundScore: turnState.roundScore,
        wordHistory: turnState.wordHistory,
    });

    // Check for immediate winner - stop game if goal reached
    const winner = gameState.teams.find(t => t.score >= gameState.goal);
    if (winner) {
        clearSavedGame();
        DB.logGameEnd(currentGameDocId, gameState, winner);
        currentGameDocId = null;
        showWinner(winner);
        return;
    }

    // Show summary

    // Log turn to Firestore
    DB.logTurn(currentGameDocId, {
        teamName: team.name,
        teamIndex: gameState.currentTeamIndex,
        roundScore: turnState.roundScore,
        wordHistory: turnState.wordHistory,
    });

    document.getElementById('summary-team').textContent = team.name;

    const scoreEl = document.getElementById('summary-score');
    scoreEl.textContent = (turnState.roundScore >= 0 ? '+' : '') + turnState.roundScore;
    scoreEl.className = 'summary-score' + (turnState.roundScore < 0 ? ' negative' : '');

    // Render word list
    const listEl = document.getElementById('summary-list');
    listEl.innerHTML = '';
    turnState.wordHistory.forEach(item => {
        const div = document.createElement('div');
        div.className = 'summary-item';

        const resultClass = item.result === 'correct' ? 'correct' :
                           item.result === 'skipped' ? 'skipped' : 'foul';
        const resultLabel = item.result === 'correct' ? '+' + item.points :
                           item.result === 'skipped' ? (item.points === 0 ? '0' : item.points) :
                           item.points;

        div.innerHTML = `
            <span class="summary-item-word">${item.word}</span>
            <span class="summary-item-result ${resultClass}">${resultLabel}</span>
        `;
        listEl.appendChild(div);
    });

    showScreen('screen-summary');
}

// ---- Next Turn ----
function nextTurn() {

    // Show scoreboard
    renderScoreboard();
    showScreen('screen-scoreboard');

    // Advance to next team
    gameState.currentTeamIndex = (gameState.currentTeamIndex + 1) % gameState.numTeams;
    saveGameState();
    prepareTurn();
}

// ---- Scoreboard ----
function renderScoreboard() {
    const container = document.getElementById('scoreboard');
    container.innerHTML = '';

    const sorted = [...gameState.teams].sort((a, b) => b.score - a.score);
    const maxScore = sorted[0]?.score || 0;

    sorted.forEach((team, i) => {
        const div = document.createElement('div');
        div.className = 'score-row' + (team.score === maxScore && maxScore > 0 ? ' leading' : '');
        div.style.borderRightColor = team.color;
        div.innerHTML = `
            <span class="score-row-name">${i === 0 && maxScore > 0 ? '👑 ' : ''}${team.name}</span>
            <span class="score-row-points">${team.score} / ${gameState.goal}</span>
        `;
        container.appendChild(div);
    });
}

// ---- Winner ----
function showWinner(winner) {
    document.getElementById('winner-team').textContent = winner.name;
    document.getElementById('winner-score').textContent = winner.score + ' נקודות';

    // Final scoreboard
    const container = document.getElementById('final-scoreboard');
    container.innerHTML = '';
    const sorted = [...gameState.teams].sort((a, b) => b.score - a.score);
    sorted.forEach((team, i) => {
        const places = ['🥇', '🥈', '🥉', '4️⃣'];
        const div = document.createElement('div');
        div.className = 'final-score-row';
        div.innerHTML = `
            <span><span class="place">${places[i]}</span> ${team.name}</span>
            <span>${team.score}</span>
        `;
        container.appendChild(div);
    });

    showScreen('screen-winner');
    launchConfetti();
}

// ---- Confetti ----
function launchConfetti() {
    const container = document.getElementById('confetti');
    container.innerHTML = '';
    const colors = ['#C62828', '#FFD700', '#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#E91E63'];

    for (let i = 0; i < 60; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        piece.style.left = Math.random() * 100 + '%';
        piece.style.top = -Math.random() * 20 + '%';
        piece.style.width = (6 + Math.random() * 8) + 'px';
        piece.style.height = (6 + Math.random() * 8) + 'px';
        piece.style.animationDuration = (2 + Math.random() * 3) + 's';
        piece.style.animationDelay = Math.random() * 2 + 's';
        if (Math.random() > 0.5) piece.style.borderRadius = '50%';
        container.appendChild(piece);
    }
}

// ---- Sound ----
function playBuzz() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 300;
        osc.type = 'square';
        gain.gain.value = 0.15;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
        osc.stop(ctx.currentTime + 0.8);
    } catch (e) {
        // Audio not supported
    }
}

// ---- Reset ----
function resetGame() {
    clearInterval(turnState.timer);
    turnState.timer = null;
    turnState.isPaused = false;
    gameState.teams = [];
    gameState.currentTeamIndex = 0;
    turnState.usedWords.clear();
    clearSavedGame();
    showScreen('screen-home');
    checkSavedGame();
}

// ==============================
// PAUSE / RESUME
// ==============================

function pauseGame() {
    if (!turnState.timer && !turnState.isPaused) return;

    turnState.isPaused = true;
    clearInterval(turnState.timer);
    turnState.timer = null;

    // Blur the word card & show overlay
    document.getElementById('word-card').classList.add('paused');
    document.getElementById('pause-overlay').classList.add('active');
}

function resumeGame() {
    if (!turnState.isPaused) return;

    turnState.isPaused = false;

    // Hide overlay & unblur
    document.getElementById('pause-overlay').classList.remove('active');
    document.getElementById('word-card').classList.remove('paused');

    // Resume timer
    const timerContainer = document.getElementById('timer-ring');
    if (turnState.timeLeft <= 10) {
        timerContainer.classList.add('timer-warning');
    }

    turnState.timer = setInterval(() => {
        turnState.timeLeft--;
        updateTimerDisplay();

        if (turnState.timeLeft <= 10) {
            timerContainer.classList.add('timer-warning');
        }

        if (turnState.timeLeft <= 0) {
            endTurn();
        }
    }, 1000);
}

function endTurnEarly() {
    // End the current turn immediately (counts what was done so far)
    turnState.isPaused = false;
    document.getElementById('pause-overlay').classList.remove('active');
    document.getElementById('word-card').classList.remove('paused');
    endTurn();
}

function quitGame() {
    // Save current scores before quitting (don't count current turn)
    clearInterval(turnState.timer);
    turnState.timer = null;
    turnState.isPaused = false;

    document.getElementById('pause-overlay').classList.remove('active');
    document.getElementById('word-card').classList.remove('paused');

    saveGameState();
    showScreen('screen-home');
    checkSavedGame();
}

// ==============================
// SAVE / LOAD GAME STATE
// ==============================

function saveGameState() {
    if (!gameState.teams || gameState.teams.length === 0) return;

    const saveData = {
        numTeams: gameState.numTeams,
        teams: gameState.teams,
        mode: gameState.mode,
        difficulty: gameState.difficulty,
        goal: gameState.goal,
        skipPenalty: gameState.skipPenalty,
        currentTeamIndex: gameState.currentTeamIndex,
        timerDuration: gameState.timerDuration,
        usedWords: [...turnState.usedWords],
        savedAt: Date.now(),
    };

    try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(saveData));
    } catch (e) {
        // Storage full or unavailable
    }
}

function loadGameState() {
    try {
        const data = localStorage.getItem(SAVE_KEY);
        if (!data) return null;
        return JSON.parse(data);
    } catch (e) {
        return null;
    }
}

function clearSavedGame() {
    try {
        localStorage.removeItem(SAVE_KEY);
    } catch (e) {}
    checkSavedGame();
}

function checkSavedGame() {
    const saved = loadGameState();
    const btn = document.getElementById('btn-resume');
    if (saved && saved.teams && saved.teams.length > 0) {
        btn.style.display = 'flex';
        // Show team names and scores in button
        const teamsPreview = saved.teams.map(t => `${t.name}: ${t.score}`).join(' | ');
        btn.innerHTML = `<span>▶️</span> המשך משחק<br><small style="font-size:0.7rem; font-weight:400; opacity:0.9;">${teamsPreview}</small>`;
    } else {
        btn.style.display = 'none';
    }
}

function resumeSavedGame() {
    const saved = loadGameState();
    if (!saved) return;

    // Restore game state
    gameState.numTeams = saved.numTeams;
    gameState.teams = saved.teams;
    gameState.mode = saved.mode;
    gameState.difficulty = saved.difficulty;
    gameState.goal = saved.goal;
    gameState.skipPenalty = saved.skipPenalty;
    gameState.currentTeamIndex = saved.currentTeamIndex;
    gameState.timerDuration = saved.timerDuration;
    turnState.usedWords = new Set(saved.usedWords || []);

    // Go to scoreboard to show current state, then continue
    renderScoreboard();
    prepareTurn();
    showScreen('screen-scoreboard');
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
    DB.init();
    renderTeamNameInputs();
    checkSavedGame();
});
