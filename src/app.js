/**
 * YayChess App Controller
 * Manages user identity (ephemeral — no localStorage), Socket.io matchmaking,
 * real-time challenge flow, synchronized chess moves, and UI event bindings.
 */

// ─── Username Generation ───────────────────────────────────────────────────────
const ADJECTIVES = [
  'Swift', 'Crafty', 'Bold', 'Silent', 'Clever',
  'Fierce', 'Mighty', 'Nimble', 'Sneaky', 'Shadow',
  'Golden', 'Cosmic', 'Mystic', 'Radiant', 'Brave',
  'Wild', 'Astro', 'Alpha', 'Zenith', 'Apex'
];

const ANIMALS = [
  { name: 'Panther',  emoji: '🐆' },
  { name: 'Falcon',   emoji: '🦅' },
  { name: 'Cobra',    emoji: '🐍' },
  { name: 'Badger',   emoji: '🦡' },
  { name: 'Fox',      emoji: '🦊' },
  { name: 'Wolf',     emoji: '🐺' },
  { name: 'Tiger',    emoji: '🐯' },
  { name: 'Shark',    emoji: '🦈' },
  { name: 'Owl',      emoji: '🦉' },
  { name: 'Lynx',     emoji: '🐱' },
  { name: 'Raven',    emoji: '🐦' },
  { name: 'Grizzly',  emoji: '🐻' },
  { name: 'Stallion', emoji: '🐴' },
  { name: 'Viper',    emoji: '🐍' },
  { name: 'Phoenix',  emoji: '🔥' },
  { name: 'Hawk',     emoji: '🦅' },
  { name: 'Cheetah',  emoji: '🐆' },
  { name: 'Orca',     emoji: '🐋' }
];

function generateIdentity() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return { username: `${adj}${animal.name}`, emoji: animal.emoji };
}

import { ChessBoard } from './board.js';

// ─── App ───────────────────────────────────────────────────────────────────────
export class ChessApp {
  constructor() {
    this.board = null;
    this.socket = null;

    // Ephemeral identity (gone on reload)
    this.currentUser = generateIdentity();

    // Active match state
    this.activeMatch = null; // { matchId, color, opponent }

    // Pending incoming challenge info (for the modal)
    this.pendingChallenge = null; // { fromSocketId, username, emoji }

    // Online lobby list (from server)
    this.onlinePlayers = [];

    this.selectedColor = 'random';
    this.timers = { white: 0, black: 0 };
    this.incrementSeconds = 0;
    this.timerInterval = null;
    this._lastChallengedSocketId = null;

    this.pgnMoves = [];
    this.chatLog = [];
    this.matchTimeControl = { initial: 0, increment: 0 };
    this.matchResult = '*';
    this.matchTermination = 'unfinished';
  }

  init() {
    this.board = new ChessBoard('chessboard');
    this.board.init();

    this._renderUserProfile();
    this._connectSocket();
    this.bindEvents();
  }

  // ─── Identity ──────────────────────────────────────────────────────────────
  _renderUserProfile() {
    document.getElementById('user-name-display').innerText = this.currentUser.username;
    document.getElementById('header-username-display').innerText = this.currentUser.username;
    document.getElementById('user-avatar-placeholder').innerText = this.currentUser.emoji;
    document.getElementById('header-profile-avatar').innerText = this.currentUser.emoji;
    // Hide countdown — no session expiry anymore
    const countdown = document.getElementById('session-countdown');
    if (countdown) countdown.style.display = 'none';
  }

  regenIdentity() {
    this.currentUser = generateIdentity();
    this._renderUserProfile();
    // Re-register with the server
    if (this.socket) {
      this.socket.emit('register_user', {
        username: this.currentUser.username,
        emoji: this.currentUser.emoji
      });
    }
    this.board.playSynthSound('move');
  }

  // ─── Socket.io ─────────────────────────────────────────────────────────────
  _connectSocket() {
    this.socket = window.io();

    this.socket.on('connect', () => {
      this.socket.emit('register_user', {
        username: this.currentUser.username,
        emoji: this.currentUser.emoji
      });
    });

    this.socket.on('registered', ({ username, emoji }) => {
      this.currentUser = { username, emoji };
      this._renderUserProfile();
    });

    // Receive the current lobby list
    this.socket.on('online_users_list', (users) => {
      this.onlinePlayers = users;
      this._renderLobby(this.onlinePlayers);
    });

    // Incoming challenge
    this.socket.on('challenge_received', ({ fromSocketId, username, emoji, requestedColor, timeSeconds, incrementSeconds }) => {
      this.pendingChallenge = { fromSocketId, username, emoji, requestedColor, timeSeconds, incrementSeconds };
      this._showChallengeModal(username, emoji, false);
    });

    // Challenge was declined
    this.socket.on('challenge_declined', ({ username }) => {
      this._hideChallengeModal();
      this._showStatusBanner(`${username} declined your challenge.`);
    });

    // Match started
    this.socket.on('match_started', ({ matchId, color, opponent, timeSeconds, incrementSeconds }) => {
      this._hideChallengeModal();
      this.activeMatch = { matchId, color, opponent };
      this._startMatch(color, opponent, timeSeconds, incrementSeconds);
    });

    // Incoming challenge was cancelled by challenger
    this.socket.on('challenge_cancelled', ({ fromSocketId }) => {
      if (this.pendingChallenge && this.pendingChallenge.fromSocketId === fromSocketId) {
        this._hideChallengeModal();
        this._showStatusBanner('Challenge was cancelled.');
      }
    });

    // Incoming move from opponent
    this.socket.on('move_received', ({ fromRow, fromCol, toRow, toCol }) => {
      this.board.executeMove(fromRow, fromCol, toRow, toCol, false);
      this._updateMaterialDisplay();

      // Apply increment to opponent
      const opponentColor = this.board.playerColor === 'white' ? 'black' : 'white';
      this.timers[opponentColor] += this.incrementSeconds;
      this._updateTimerDisplay();
      this._recordMoveMeta(this.board.getRawMoveHistory().slice(-1)[0]);

      this._updateTurnIndicator();
    });

    // Chat message received
    this.socket.on('chat_message_received', ({ message }) => {
      this._appendChatMessage(message, 'remote');
      this._logChatMessage(this.activeMatch?.opponent.username || 'Opponent', message);
    });

    // Game over from server
    this.socket.on('game_over', ({ winner, reason }) => {
      this._handleGameOver(winner, reason);
    });

    // Draw offer from opponent
    this.socket.on('draw_offered', () => {
      const modal = document.getElementById('draw-modal');
      if (modal) modal.classList.remove('hidden');
    });

    this.socket.on('draw_declined', () => {
      this._showStatusBanner('Opponent declined the draw offer.');
    });

    // Opponent left
    this.socket.on('opponent_disconnected', () => {
      this._showStatusBanner('Your opponent disconnected.');
      this._endMatch();
    });
  }

  // ─── Lobby Rendering ───────────────────────────────────────────────────────
  _renderLobby(players) {
    const container = document.getElementById('opponents-list-container');
    if (!container) return;
    container.innerHTML = '';

    if (players.length === 0) {
      container.innerHTML = '<div class="no-results">No players online right now</div>';
      return;
    }

    players.forEach(p => {
      const card = document.createElement('div');
      card.className = 'opponent-card';
      card.innerHTML = `
        <span class="opp-dot online"></span>
        <div class="opp-avatar">${p.emoji}</div>
        <div class="opp-details">
          <span class="opp-name">${p.username}</span>
          <span class="opp-status-text">Lobby — Ready</span>
        </div>
        <button class="challenge-btn" data-socket-id="${p.socketId}">Challenge</button>
      `;
      card.querySelector('.challenge-btn').addEventListener('click', () => {
        this._sendChallenge(p);
      });
      container.appendChild(card);
    });
  }

  // ─── Challenges ────────────────────────────────────────────────────────────
  _sendChallenge(opponent) {
    if (this.activeMatch) return;
    this._lastChallengedSocketId = opponent.socketId;

    const timeBtn = document.querySelector('.time-btn.active');
    const seconds = parseInt(timeBtn?.dataset.seconds) || 180;
    const increment = parseInt(timeBtn?.dataset.increment) || 0;

    this.socket.emit('send_challenge', { 
      targetSocketId: opponent.socketId,
      color: this.selectedColor,
      timeSeconds: seconds,
      incrementSeconds: increment
    });
    // Show outgoing challenge modal
    this._showChallengeModal(opponent.username, opponent.emoji, true);
    this.board.playSynthSound('select');
  }

  _showChallengeModal(username, emoji, isOutgoing) {
    const modal = document.getElementById('match-modal');
    if (!modal) return;

    document.getElementById('modal-title').innerText = isOutgoing ? 'Sending Challenge' : 'Incoming Challenge';
    document.getElementById('modal-subtitle').innerText = isOutgoing
      ? `Waiting for ${username} to respond...`
      : `${username} wants to play you!`;

    document.getElementById('modal-user-avatar').innerText = this.currentUser.emoji;
    document.getElementById('modal-user-name').innerText = this.currentUser.username;
    document.getElementById('modal-opponent-avatar').innerText = emoji;
    document.getElementById('modal-opponent-name').innerText = username;

    const acceptBtn = document.getElementById('modal-accept-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');

    if (isOutgoing) {
      acceptBtn.style.display = 'none';
      cancelBtn.innerText = 'Cancel';
    } else {
      acceptBtn.style.display = '';
      cancelBtn.innerText = 'Decline';
    }

    modal.classList.remove('hidden');
  }

  _hideChallengeModal() {
    const modal = document.getElementById('match-modal');
    if (modal) modal.classList.add('hidden');
    this.pendingChallenge = null;
  }

  // ─── Match Flow ────────────────────────────────────────────────────────────
  _startMatch(color, opponent, timeSeconds, incrementSeconds) {
    this.board.resetBoard();
    this.board.setInteractable(true, color);
    this.board.setOrientation(color);

    this.incrementSeconds = incrementSeconds || 0;

    // Hide any lingering modals
    const overlay = document.getElementById('game-result-overlay');
    if (overlay) overlay.classList.add('hidden');
    const drawModal = document.getElementById('draw-modal');
    if (drawModal) drawModal.classList.add('hidden');
    this._hideChallengeModal();

    // Hook up board callbacks
    this.board.onMove = (fromRow, fromCol, toRow, toCol) => {
      this.socket.emit('make_move', {
        matchId: this.activeMatch.matchId,
        fromRow, fromCol, toRow, toCol
      });

      // Apply increment
      this.timers[this.board.playerColor] += this.incrementSeconds;
      this._updateTimerDisplay();
      this._recordMoveMeta(this.board.getRawMoveHistory().slice(-1)[0]);
      this._updateMaterialDisplay();
      
      this._updateTurnIndicator();
    };

    this.board.onCheck = () => {
      this._showStatusBanner('CHECK!');
    };

    this.board.onCheckmate = (winner) => {
      this.socket.emit('game_over', {
        matchId: this.activeMatch.matchId,
        winner,
        reason: winner === 'draw' ? 'stalemate' : 'checkmate'
      });
    };

    this.board.onDraw = () => {
      this.socket.emit('game_over', {
        matchId: this.activeMatch.matchId,
        winner: 'draw',
        reason: 'fifty_move_rule'
      });
      this._showStatusBanner('Draw by 50-move rule');
    };

    // Update materials constantly during the match
    this._updateMaterialDisplay();
    this._setInGameExportEnabled(false);
    this._setResultExportEnabled(false);

    // Update opponent profile panel
    document.getElementById('opponent-name-display').innerText = opponent.username;
    document.getElementById('opponent-avatar').innerHTML =
      `<div class="avatar-placeholder">${opponent.emoji}</div>`;
    document.getElementById('opponent-avatar').className = 'avatar-wrapper online';

    // Toggle UI: Players list -> Chat
    const lobbyPlayersView = document.getElementById('lobby-players-view');
    const gameChatView = document.getElementById('game-chat-view');
    const chatMessages = document.getElementById('chat-messages');
    const sectionVariant = document.getElementById('section-variant');
    const sectionTime = document.getElementById('section-time');

    if (lobbyPlayersView) lobbyPlayersView.classList.add('hidden');
    if (sectionVariant) sectionVariant.classList.add('hidden');
    if (sectionTime) sectionTime.classList.add('hidden');
    if (gameChatView) gameChatView.classList.remove('hidden');
    if (chatMessages) chatMessages.innerHTML = '';

    // Show action bar
    document.getElementById('game-actions').classList.remove('hidden');

    // Initialize metadata tracking
    this.pgnMoves = [];
    this.chatLog = [];
    this.matchTimeControl = { initial: timeSeconds || 180, increment: incrementSeconds || 0 };
    this.matchResult = '*';
    this.matchTermination = 'unfinished';

    // Initialize Timers
    const seconds = timeSeconds || 180;
    this.timers = { white: seconds, black: seconds };
    this._updateTimerDisplay();
    this._startTimer();

    // Update turn indicators
    this._updateTurnIndicator();

    this.board.playSynthSound('move');
  }

  _endMatch() {
    this.activeMatch = null;
    this.board.setInteractable(false);
    this.board.onMove = null;
    this.board.onCheck = null;
    this.board.onCheckmate = null;

    // Reset opponent panel
    document.getElementById('opponent-name-display').innerText = 'Opponent';
    document.getElementById('opponent-avatar').innerHTML = '<div class="avatar-placeholder">👤</div>';
    document.getElementById('opponent-avatar').className = 'avatar-wrapper offline';

    // Toggle UI: Chat -> Players list
    const lobbyPlayersView = document.getElementById('lobby-players-view');
    const gameChatView = document.getElementById('game-chat-view');
    const sectionVariant = document.getElementById('section-variant');
    const sectionTime = document.getElementById('section-time');
    
    if (lobbyPlayersView) lobbyPlayersView.classList.remove('hidden');
    if (sectionVariant) sectionVariant.classList.remove('hidden');
    if (sectionTime) sectionTime.classList.remove('hidden');
    if (gameChatView) gameChatView.classList.add('hidden');

    // Hide action bar
    document.getElementById('game-actions').classList.add('hidden');
    this._setPlayerMaterialBadges(0, 0);
    this._setInGameExportEnabled(false);
    this._setResultExportEnabled(false);

    // Stop Timers
    clearInterval(this.timerInterval);

    // Clear turn indicators
    document.getElementById('user-timer').classList.remove('active');
    document.getElementById('opponent-timer').classList.remove('active');
    this._updateTimerDisplay();
  }

  // ─── Chat ──────────────────────────────────────────────────────────────────
  _sendChatMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg || !this.activeMatch) return;

    this.socket.emit('send_chat_message', {
      matchId: this.activeMatch.matchId,
      message: msg
    });

    this._appendChatMessage(msg, 'local');
    this._logChatMessage(this.currentUser.username, msg);
    input.value = '';
    this.board.playSynthSound('move');
  }

  _appendChatMessage(message, type) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    const msgEl = document.createElement('div');
    msgEl.className = `chat-msg ${type}`;
    msgEl.innerText = message;
    container.appendChild(msgEl);
    container.scrollTop = container.scrollHeight;
  }

  _logChatMessage(author, message) {
    const historyLength = this.board?.getRawMoveHistory().length || 0;
    const moveIndex = historyLength > 0 ? historyLength - 1 : null;
    this.chatLog.push({ author, message, timestamp: new Date(), moveIndex });
    return moveIndex;
  }

  _handleGameOver(winner, reason) {
    const overlay = document.getElementById('game-result-overlay');
    const title = document.getElementById('result-title');
    const subtitle = document.getElementById('result-subtitle');

    if (winner === 'draw') {
      title.innerText = 'Draw';
      this.matchResult = '1/2-1/2';
      this.matchTermination = reason;
    } else {
      title.innerText = winner === this.board.playerColor ? 'You Won!' : 'You Lost';
      this.matchResult = winner === 'white' ? '1-0' : '0-1';
      this.matchTermination = reason;
    }

    subtitle.innerText = reason.charAt(0).toUpperCase() + reason.slice(1).replace('_', ' ');
    
    // Stop timers immediately
    clearInterval(this.timerInterval);

    setTimeout(() => {
      overlay.classList.remove('hidden');
      this._setInGameExportEnabled(false);
      this._setResultExportEnabled(true);
    }, 2000);
  }

  _startTimer() {
    clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      const activeColor = this.board.activeTurn;
      this.timers[activeColor]--;

      if (this.timers[activeColor] <= 0) {
        this.timers[activeColor] = 0;
        clearInterval(this.timerInterval);
        
        // Timeout
        if (activeColor === this.board.playerColor) {
          this.socket.emit('game_over', {
            matchId: this.activeMatch.matchId,
            winner: activeColor === 'white' ? 'black' : 'white',
            reason: 'timeout'
          });
        }
      } else if (this.timers[activeColor] <= 10) {
        this.board.playSynthSound('warning');
      }
      this._updateTimerDisplay();
    }, 1000);
  }

  _updateTimerDisplay() {
    if (!this.activeMatch) {
      document.getElementById('user-timer').innerText = '—';
      document.getElementById('opponent-timer').innerText = '—';
      document.getElementById('user-timer').classList.remove('running-down');
      document.getElementById('opponent-timer').classList.remove('running-down');
      return;
    }
    const format = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
    const isWhite = this.board.playerColor === 'white';
    const myTimer = isWhite ? this.timers.white : this.timers.black;
    const opponentTimer = isWhite ? this.timers.black : this.timers.white;
    const myEl = document.getElementById('user-timer');
    const oppEl = document.getElementById('opponent-timer');

    myEl.innerText = format(myTimer);
    oppEl.innerText = format(opponentTimer);

    myEl.classList.toggle('running-down', this.board.activeTurn === this.board.playerColor && myTimer <= 15 && myTimer > 0);
    oppEl.classList.toggle('running-down', this.board.activeTurn !== this.board.playerColor && opponentTimer <= 15 && opponentTimer > 0);
  }

  _updateTurnIndicator() {
    const isMyTurn = this.board.activeTurn === this.board.playerColor;
    document.getElementById('user-timer').classList.toggle('active', isMyTurn);
    document.getElementById('opponent-timer').classList.toggle('active', !isMyTurn);
  }

  _formatClock(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  _cloneGameState(state) {
    return {
      castling: {
        whiteK: state.castling.whiteK,
        whiteQ: state.castling.whiteQ,
        blackK: state.castling.blackK,
        blackQ: state.castling.blackQ
      },
      enPassantTarget: state.enPassantTarget,
      halfMoveClock: state.halfMoveClock,
      fullMoveNumber: state.fullMoveNumber
    };
  }

  _createPgnTempBoard() {
    const temp = {
      boardState: [
        ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
        ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
        ['', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', ''],
        ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
        ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
      ],
      gameState: this._cloneGameState(this.board.gameState),
      activeTurn: 'white'
    };

    ['calculateValidMoves', '_slidingMoves', 'isSquareAttackedBy', 'isKingInCheck', 'getLegalMovesForPiece', 'hasAnyLegalMove', '_positionToAlgebraic', '_algebraicToPosition']
      .forEach(fn => {
        temp[fn] = this.board[fn].bind(temp);
      });

    return temp;
  }

  _formatTimeControl(initial, increment) {
    const base = initial % 60 === 0 ? `${initial / 60}` : `${initial}`;
    return increment ? `${base}+${increment}` : base;
  }

  _escapePgnString(value) {
    return String(value).replace(/"/g, '\\"');
  }

  _escapePgnComment(text) {
    return String(text).replace(/}/g, ']');
  }

  _findSanDisambiguation(temp, move) {
    const piece = move.piece.toUpperCase();
    if (piece === 'P') return '';

    const [targetRow, targetCol] = temp._algebraicToPosition(move.to);
    const source = move.from;
    const [sourceRow, sourceCol] = temp._algebraicToPosition(source);
    const color = move.piece === move.piece.toUpperCase() ? 'white' : 'black';
    const candidates = [];

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const pieceAt = temp.boardState[r][c];
        if (!pieceAt) continue;
        if (pieceAt.toUpperCase() !== piece) continue;
        const isWhite = pieceAt === pieceAt.toUpperCase();
        if ((isWhite ? 'white' : 'black') !== color) continue;
        const fromSquare = temp._positionToAlgebraic(r, c);
        if (fromSquare === source) continue;

        const legalMoves = temp.getLegalMovesForPiece(r, c, pieceAt, temp.boardState);
        if (legalMoves.some(m => m.r === targetRow && m.c === targetCol)) {
          candidates.push({ row: r, col: c, square: fromSquare });
        }
      }
    }

    if (!candidates.length) return '';
    const fileCollision = candidates.some(c => c.square[0] === source[0]);
    const rankCollision = candidates.some(c => c.square[1] === source[1]);
    if (fileCollision && rankCollision) return source;
    if (fileCollision) return source[1];
    return source[0];
  }

  _applyPgnMove(temp, move) {
    const [fromRow, fromCol] = temp._algebraicToPosition(move.from);
    const [toRow, toCol] = temp._algebraicToPosition(move.to);
    const piece = temp.boardState[fromRow][fromCol];
    const isWhite = piece === piece.toUpperCase();
    const color = isWhite ? 'white' : 'black';
    const opponent = color === 'white' ? 'black' : 'white';

    if (move.enPassant) {
      const captureRow = toRow + (isWhite ? 1 : -1);
      temp.boardState[captureRow][toCol] = '';
    }

    if (move.castling) {
      const kingRow = isWhite ? 7 : 0;
      if (move.castling === 'O-O') {
        temp.boardState[kingRow][6] = piece;
        temp.boardState[kingRow][5] = temp.boardState[kingRow][7];
        temp.boardState[kingRow][4] = '';
        temp.boardState[kingRow][7] = '';
      } else {
        temp.boardState[kingRow][2] = piece;
        temp.boardState[kingRow][3] = temp.boardState[kingRow][0];
        temp.boardState[kingRow][4] = '';
        temp.boardState[kingRow][0] = '';
      }
    } else {
      temp.boardState[toRow][toCol] = move.promotion ? (isWhite ? move.promotion.toUpperCase() : move.promotion.toLowerCase()) : piece;
      temp.boardState[fromRow][fromCol] = '';
    }

    if (piece.toLowerCase() === 'k') {
      if (color === 'white') {
        temp.gameState.castling.whiteK = false;
        temp.gameState.castling.whiteQ = false;
      } else {
        temp.gameState.castling.blackK = false;
        temp.gameState.castling.blackQ = false;
      }
    }
    if (piece.toLowerCase() === 'r') {
      if (color === 'white' && fromRow === 7 && fromCol === 7) temp.gameState.castling.whiteK = false;
      if (color === 'white' && fromRow === 7 && fromCol === 0) temp.gameState.castling.whiteQ = false;
      if (color === 'black' && fromRow === 0 && fromCol === 7) temp.gameState.castling.blackK = false;
      if (color === 'black' && fromRow === 0 && fromCol === 0) temp.gameState.castling.blackQ = false;
    }

    if (move.capture && !move.enPassant) {
      const capturedPiece = temp.boardState[toRow][toCol];
      if (capturedPiece?.toLowerCase() === 'r') {
        if (toRow === 7 && toCol === 7) temp.gameState.castling.whiteK = false;
        if (toRow === 7 && toCol === 0) temp.gameState.castling.whiteQ = false;
        if (toRow === 0 && toCol === 7) temp.gameState.castling.blackK = false;
        if (toRow === 0 && toCol === 0) temp.gameState.castling.blackQ = false;
      }
    }

    if (piece.toLowerCase() === 'p' && Math.abs(toRow - fromRow) === 2) {
      temp.gameState.enPassantTarget = temp._positionToAlgebraic((fromRow + toRow) / 2, fromCol);
    } else {
      temp.gameState.enPassantTarget = null;
    }

    if (!isWhite) temp.gameState.fullMoveNumber += 1;
    temp.activeTurn = opponent;
  }

  _getSan(move, temp) {
    if (!move) return '';
    if (move.castling) return move.castling;

    const piece = move.piece.toUpperCase();
    const isPawn = piece === 'P';
    const capture = move.capture;
    let san = '';

    if (isPawn) {
      if (capture) {
        san = `${move.from[0]}x${move.to}`;
      } else {
        san = move.to;
      }
      if (move.promotion) {
        san += `=${move.promotion.toUpperCase()}`;
      }
    } else {
      const disambiguation = this._findSanDisambiguation(temp, move);
      san = `${piece}${disambiguation}${capture ? 'x' : ''}${move.to}`;
    }

    const simulated = {
      boardState: temp.boardState.map(row => [...row]),
      gameState: this._cloneGameState(temp.gameState),
      activeTurn: temp.activeTurn
    };
    ['calculateValidMoves', '_slidingMoves', 'isSquareAttackedBy', 'isKingInCheck', 'getLegalMovesForPiece', 'hasAnyLegalMove', '_positionToAlgebraic', '_algebraicToPosition']
      .forEach(fn => { simulated[fn] = this.board[fn].bind(simulated); });
    this._applyPgnMove(simulated, move);

    const opponent = simulated.activeTurn;
    if (simulated.isKingInCheck(opponent, simulated.boardState)) {
      const isMate = !simulated.hasAnyLegalMove(opponent, simulated.boardState);
      san += isMate ? '#' : '+';
    }

    return san;
  }

  _recordMoveMeta(move) {
    const moveColor = move.piece === move.piece.toUpperCase() ? 'white' : 'black';
    const clock = this._formatClock(this.timers[moveColor]);
    this.pgnMoves.push({ move, color: moveColor, clock });
  }

  _formatMaterialBadge(value) {
    if (value === 0) return '0';
    return value > 0 ? `+${value}` : `${value}`;
  }

  _setPlayerMaterialBadges(whiteDiff, blackDiff) {
    const userBadge = document.getElementById('user-material');
    const opponentBadge = document.getElementById('opponent-material');
    const isWhite = this.board.playerColor === 'white';
    if (userBadge) {
      userBadge.innerText = this._formatMaterialBadge(isWhite ? whiteDiff : blackDiff);
      userBadge.classList.toggle('hidden', !this.activeMatch);
    }
    if (opponentBadge) {
      opponentBadge.innerText = this._formatMaterialBadge(isWhite ? blackDiff : whiteDiff);
      opponentBadge.classList.toggle('hidden', !this.activeMatch);
    }
  }

  _setInGameExportEnabled(enabled) {
    const exportPgnBtn = document.getElementById('action-export-pgn');
    const exportFenBtn = document.getElementById('action-export-fen');
    if (exportPgnBtn) {
      exportPgnBtn.disabled = !enabled;
      exportPgnBtn.classList.toggle('hidden', !enabled);
    }
    if (exportFenBtn) {
      exportFenBtn.disabled = !enabled;
      exportFenBtn.classList.toggle('hidden', !enabled);
    }
  }

  _setResultExportEnabled(enabled) {
    const exportPgnBtn = document.getElementById('result-export-pgn');
    const exportFenBtn = document.getElementById('result-export-fen');
    if (exportPgnBtn) exportPgnBtn.disabled = !enabled;
    if (exportFenBtn) exportFenBtn.disabled = !enabled;
  }

  _updateMaterialDisplay() {
    const panel = document.getElementById('material-panel');
    if (!this.activeMatch) {
      panel?.classList.add('hidden');
      this._setPlayerMaterialBadges(0, 0);
      return;
    }

    const material = this.board.getMaterialScore();
    const whiteEl = document.getElementById('material-white');
    const blackEl = document.getElementById('material-black');
    const diff = material.white - material.black;
    if (whiteEl) whiteEl.innerText = `White: ${material.white}`;
    if (blackEl) blackEl.innerText = `Black: ${material.black}`;
    panel?.classList.remove('hidden');

    this._setPlayerMaterialBadges(diff, -diff);
  }

  _formatTagValue(value) {
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
  }

  _renderPgnTag(tag, value) {
    return `[${tag} "${this._formatTagValue(value)}"]`;
  }

  _escapePgnComment(value) {
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/\}/g, '\\}');
  }

  _formatPgnComment(clock) {
    return clock ? ` {[%clk ${clock}]}` : '';
  }

  _formatChatComment(entry) {
    return `{${this._escapePgnComment(`${entry.author}: ${entry.message}`)}}`;
  }

  _formatPgnMoveText(moves) {
    if (!moves.length) return '';
    const tokens = [];
    const temp = this._createPgnTempBoard();

    for (let i = 0; i < moves.length; i += 2) {
      const moveNumber = Math.floor(i / 2) + 1;
      const whiteMeta = moves[i];
      const blackMeta = moves[i + 1];

      const whiteSan = whiteMeta && whiteMeta.move ? this._getSan(whiteMeta.move, temp) : '';
      const blackSan = blackMeta && blackMeta.move ? this._getSan(blackMeta.move, temp) : '';
      const whiteClock = whiteMeta ? this._formatPgnComment(whiteMeta.clock) : '';
      const blackClock = blackMeta ? this._formatPgnComment(blackMeta.clock) : '';
      const pairComments = this.chatLog
        .filter(entry => entry.moveIndex === i || entry.moveIndex === i + 1)
        .map(entry => this._formatChatComment(entry))
        .join(' ');

      tokens.push(`${moveNumber}. ${whiteSan}${whiteClock}${blackMeta ? ` ${blackSan}${blackClock}` : ''}`);

      if (whiteMeta && whiteMeta.move) this._applyPgnMove(temp, whiteMeta.move);
      if (blackMeta && blackMeta.move) this._applyPgnMove(temp, blackMeta.move);

      if (pairComments) {
        tokens[tokens.length - 1] += ` ${pairComments}`;
      }
    }
    return this._wrapPgnLines(tokens.join(' '));
  }

  _wrapPgnLines(text) {
    const maxLength = 80;
    const words = text.split(' ');
    let line = '';
    const lines = [];
    words.forEach(word => {
      if (line.length + word.length + 1 > maxLength && line.length > 0) {
        lines.push(line.trim());
        line = '';
      }
      line += (line.length ? ' ' : '') + word;
    });
    if (line.length) lines.push(line.trim());
    return lines.join('\n');
  }

  _generatePgn() {
    const history = this.board.getRawMoveHistory();
    const moves = this.pgnMoves.length === history.length
      ? this.pgnMoves
      : history.map(move => ({ move, color: move.piece === move.piece.toUpperCase() ? 'white' : 'black', clock: '' }));

    const tagWhite = this.activeMatch?.color === 'white' ? this.currentUser.username : this.activeMatch?.opponent.username || 'Opponent';
    const tagBlack = this.activeMatch?.color === 'black' ? this.currentUser.username : this.activeMatch?.opponent.username || 'Opponent';
    const result = this.matchResult || '*';
    const termination = this.matchTermination.replace(/_/g, ' ');
    const now = new Date();
    const dateTag = now.toISOString().slice(0, 10).replace(/-/g, '.');
    const utcDate = dateTag;
    const utcTime = now.toISOString().slice(11, 19);
    const timeControl = this._formatTimeControl(this.matchTimeControl.initial, this.matchTimeControl.increment);
    const comments = this.chatLog
      .filter(entry => entry.moveIndex === null)
      .map(entry => this._formatChatComment(entry))
      .join(' ');

    const tags = [
      this._renderPgnTag('Event', 'YayChess Online Match'),
      this._renderPgnTag('Site', 'YayChess'),
      this._renderPgnTag('Date', dateTag),
      this._renderPgnTag('UTCDate', utcDate),
      this._renderPgnTag('UTCTime', utcTime),
      this._renderPgnTag('Round', '?'),
      this._renderPgnTag('White', tagWhite),
      this._renderPgnTag('Black', tagBlack),
      this._renderPgnTag('Result', result),
      this._renderPgnTag('TimeControl', timeControl),
      this._renderPgnTag('Termination', termination),
      this._renderPgnTag('Annotator', 'YayChess')
    ].join('\n');

    const movetext = this._formatPgnMoveText(moves);
    const gameText = movetext.length ? `${movetext} ${result}` : result;
    const commentText = comments ? `\n\n${comments}` : '';

    return `${tags}\n\n${gameText}${commentText}\n`;
  }

  _downloadTextFile(filename, contents) {
    const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  _downloadPgn() {
    this._downloadTextFile('yaychess-game.pgn', this._generatePgn());
  }

  _downloadFen() {
    const fen = this.board.getFen();
    this._downloadTextFile('yaychess-position.fen', fen);
    this._showStatusBanner('FEN exported');
  }

  // ─── Status Banner ─────────────────────────────────────────────────────────
  _showStatusBanner(message) {
    let banner = document.getElementById('status-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'status-banner';
      document.body.appendChild(banner);
    }
    banner.innerText = message;
    banner.classList.add('visible');
    setTimeout(() => banner.classList.remove('visible'), 4000);
  }

  // ─── Event Bindings ────────────────────────────────────────────────────────
  bindEvents() {
    // Regen identity button
    document.getElementById('regen-username-btn').addEventListener('click', () => {
      if (!this.activeMatch) this.regenIdentity();
    });

    // Tab switching
    const playTab = document.getElementById('tab-play');
    const customTab = document.getElementById('tab-custom');
    const playPanel = document.getElementById('panel-play');
    const customPanel = document.getElementById('panel-custom');

    playTab.addEventListener('click', () => {
      playTab.classList.add('active');
      customTab.classList.remove('active');
      playPanel.classList.remove('hidden');
      customPanel.classList.add('hidden');
      this.board.playSynthSound('select');
    });

    customTab.addEventListener('click', () => {
      customTab.classList.add('active');
      playTab.classList.remove('active');
      customPanel.classList.remove('hidden');
      playPanel.classList.add('hidden');
      this.board.playSynthSound('select');
    });

    // Board theme selector
    const themeSelectBtns = document.querySelectorAll('.theme-select-btn');
    themeSelectBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        themeSelectBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.board.setTheme(btn.dataset.boardTheme);
        this.board.playSynthSound('move');
      });
    });

    // Sidebar quick theme cycler
    document.getElementById('theme-toggle').addEventListener('click', () => {
      const themes = ['green', 'wood', 'glass'];
      const idx = (themes.indexOf(this.board.activeTheme) + 1) % themes.length;
      const next = themes[idx];
      themeSelectBtns.forEach(b => {
        b.classList.toggle('active', b.dataset.boardTheme === next);
      });
      this.board.setTheme(next);
      this.board.playSynthSound('move');
    });

    // Coordinates toggle
    document.getElementById('coords-setting').addEventListener('change', (e) => {
      this.board.setCoordinatesVisible(e.target.checked);
    });

    // Time control tabs
    const timeTabBtns = document.querySelectorAll('.time-tab-btn');
    const allTimeBtns = document.querySelectorAll('.time-btn');
    timeTabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        timeTabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const cat = btn.dataset.category;
        allTimeBtns.forEach(tb => {
          tb.classList.toggle('hidden', !tb.classList.contains(`${cat}-time`));
        });
        const first = document.querySelector(`.time-btn.${cat}-time`);
        if (first) { allTimeBtns.forEach(b => b.classList.remove('active')); first.classList.add('active'); }
        this.board.playSynthSound('select');
      });
    });

    allTimeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        allTimeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.board.playSynthSound('select');
      });
    });

    // Variant selector (only enabled ones)
    document.querySelectorAll('.variant-btn:not(.disabled)').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.variant-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.board.playSynthSound('select');
      });
    });

    // Opponent search filter
    const searchInput = document.getElementById('opponent-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase().trim();
        const filtered = this.onlinePlayers.filter(p => p.username.toLowerCase().includes(val));
        this._renderLobby(filtered);
      });
    }

    // Challenge modal — Accept button
    const acceptBtn = document.getElementById('modal-accept-btn');
    if (acceptBtn) {
      acceptBtn.addEventListener('click', () => {
        if (this.pendingChallenge) {
          this.socket.emit('challenge_response', {
            fromSocketId: this.pendingChallenge.fromSocketId,
            accepted: true,
            color: this.pendingChallenge.requestedColor,
            timeSeconds: this.pendingChallenge.timeSeconds,
            incrementSeconds: this.pendingChallenge.incrementSeconds
          });
        }
        this._hideChallengeModal();
      });
    }

    // Challenge modal — Cancel/Decline button
    const cancelBtn = document.getElementById('modal-cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        if (this.pendingChallenge) {
          // Declining an incoming challenge
          this.socket.emit('challenge_response', {
            fromSocketId: this.pendingChallenge.fromSocketId,
            accepted: false
          });
        } else {
          // Cancelling an outgoing challenge
          this.socket.emit('cancel_challenge', { 
            targetSocketId: this._lastChallengedSocketId 
          });
        }
        this._hideChallengeModal();
        this.board.playSynthSound('move');
      });
    }

    // Color Pickers
    const colorPickBtns = document.querySelectorAll('.color-pick-btn');
    colorPickBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        colorPickBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedColor = btn.dataset.color;
        this.board.playSynthSound('select');
      });
    });

    // Action Bar
    const exportPgnBtn = document.getElementById('action-export-pgn');
    if (exportPgnBtn) {
      exportPgnBtn.addEventListener('click', () => {
        if (!this.activeMatch) return;
        this._downloadPgn();
      });
    }

    const exportFenBtn = document.getElementById('action-export-fen');
    if (exportFenBtn) {
      exportFenBtn.addEventListener('click', () => {
        if (!this.activeMatch) return;
        this._downloadFen();
      });
    }

    const resignBtn = document.getElementById('action-resign');
    if (resignBtn) {
      resignBtn.addEventListener('click', () => {
        if (!this.activeMatch) return;
        if (confirm('Are you sure you want to resign?')) {
          this.socket.emit('resign', { matchId: this.activeMatch.matchId });
        }
      });
    }

    const drawBtn = document.getElementById('action-draw');
    if (drawBtn) {
      drawBtn.addEventListener('click', () => {
        if (!this.activeMatch) return;
        this.socket.emit('draw_offer', { matchId: this.activeMatch.matchId });
        this._showStatusBanner('Draw offer sent.');
      });
    }

    const flipBtn = document.getElementById('action-flip');
    if (flipBtn) {
      flipBtn.addEventListener('click', () => {
        this.board.flipBoard();
        this.board.playSynthSound('move');
      });
    }

    // Result Overlay
    const closeOverlayBtn = document.getElementById('result-close-btn');
    if (closeOverlayBtn) {
      closeOverlayBtn.addEventListener('click', () => {
        const overlay = document.getElementById('game-result-overlay');
        if (overlay) overlay.classList.add('hidden');
        this._endMatch();
      });
    }

    const resultExportPgnBtn = document.getElementById('result-export-pgn');
    if (resultExportPgnBtn) {
      resultExportPgnBtn.addEventListener('click', () => {
        this._downloadPgn();
      });
    }

    const resultExportFenBtn = document.getElementById('result-export-fen');
    if (resultExportFenBtn) {
      resultExportFenBtn.addEventListener('click', () => {
        this._downloadFen();
      });
    }

    // Draw Modal Buttons
    const drawAcceptBtn = document.getElementById('draw-accept-btn');
    if (drawAcceptBtn) {
      drawAcceptBtn.addEventListener('click', () => {
        if (!this.activeMatch) return;
        this.socket.emit('draw_response', { matchId: this.activeMatch.matchId, accepted: true });
        document.getElementById('draw-modal').classList.add('hidden');
      });
    }

    const drawDeclineBtn = document.getElementById('draw-decline-btn');
    if (drawDeclineBtn) {
      drawDeclineBtn.addEventListener('click', () => {
        if (!this.activeMatch) return;
        this.socket.emit('draw_response', { matchId: this.activeMatch.matchId, accepted: false });
        document.getElementById('draw-modal').classList.add('hidden');
      });
    }

    // Chat Events
    const chatInput = document.getElementById('chat-input');
    const chatSendBtn = document.getElementById('chat-send-btn');

    if (chatSendBtn) {
      chatSendBtn.addEventListener('click', () => this._sendChatMessage());
    }

    if (chatInput) {
      chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this._sendChatMessage();
        }
      });
    }
  }
}


