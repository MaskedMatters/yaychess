/**
 * ChessBoard - Interactive UI Chess Board Renderer
 * Handles grid representation, piece placements, visual highlights,
 * move validation, board theming, and interactivity controls.
 */
class ChessBoard {
  constructor(boardId) {
    this.boardEl = document.getElementById(boardId);
    this.squares = Array(8).fill(null).map(() => Array(8).fill(null));
    this.selectedSquare = null; // { row, col, piece, validMoves: [] }
    this.activeTheme = 'green';
    this.flipped = false;

    // Whether the board accepts user input
    this.interactable = false;
    // 'white' | 'black' — which color this client controls
    this.playerColor = null;
    // Whose turn it currently is
    this.activeTurn = 'white';

    // Callback fired after the local player executes a move
    // Signature: onMove(fromRow, fromCol, toRow, toCol)
    this.onMove = null;
    this.onCheck = null;
    this.onCheckmate = null;

    // Classic piece image resources
    this.pieceImages = {
      'P': 'https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg',
      'N': 'https://upload.wikimedia.org/wikipedia/commons/7/70/Chess_nlt45.svg',
      'B': 'https://upload.wikimedia.org/wikipedia/commons/b/b1/Chess_blt45.svg',
      'R': 'https://upload.wikimedia.org/wikipedia/commons/7/72/Chess_rlt45.svg',
      'Q': 'https://upload.wikimedia.org/wikipedia/commons/1/15/Chess_qlt45.svg',
      'K': 'https://upload.wikimedia.org/wikipedia/commons/4/42/Chess_klt45.svg',
      'p': 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Chess_pdt45.svg',
      'n': 'https://upload.wikimedia.org/wikipedia/commons/e/ef/Chess_ndt45.svg',
      'b': 'https://upload.wikimedia.org/wikipedia/commons/9/98/Chess_bdt45.svg',
      'r': 'https://upload.wikimedia.org/wikipedia/commons/f/ff/Chess_rdt45.svg',
      'q': 'https://upload.wikimedia.org/wikipedia/commons/4/47/Chess_qdt45.svg',
      'k': 'https://upload.wikimedia.org/wikipedia/commons/f/f0/Chess_kdt45.svg'
    };

    // Standard starting matrix
    this.boardState = [
      ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
      ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
      ['',  '',  '',  '',  '',  '',  '',  ''],
      ['',  '',  '',  '',  '',  '',  '',  ''],
      ['',  '',  '',  '',  '',  '',  '',  ''],
      ['',  '',  '',  '',  '',  '',  '',  ''],
      ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
      ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
    ];

    this.audioCtx = null;
    this.soundEnabled = true;
  }

  init() {
    this.boardEl.innerHTML = '';

    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const squareEl = document.createElement('div');
        const isLight = (r + c) % 2 === 0;

        squareEl.className = `square ${isLight ? 'light' : 'dark'} row-${r} col-${c}`;
        squareEl.dataset.row = r;
        squareEl.dataset.col = c;
        squareEl.dataset.file = files[c];
        squareEl.dataset.rank = ranks[r];

        this.squares[r][c] = squareEl;
        squareEl.addEventListener('click', () => this.handleSquareClick(r, c));
        this.boardEl.appendChild(squareEl);
      }
    }

    this.render();
    this._updateBoardCursor();
  }

  // Render piece images onto squares
  render() {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const squareEl = this.squares[r][c];
        const piece = this.boardState[r][c];

        const oldImg = squareEl.querySelector('.piece');
        if (oldImg) oldImg.remove();

        if (piece) {
          const imgEl = document.createElement('img');
          imgEl.src = this.pieceImages[piece];
          imgEl.className = 'piece';
          imgEl.alt = `${piece === piece.toUpperCase() ? 'White' : 'Black'} Chess Piece`;
          imgEl.draggable = false;
          squareEl.appendChild(imgEl);
        }
      }
    }
  }

  handleSquareClick(row, col) {
    // Board is locked unless this client is playing and it is their turn
    if (!this.interactable) return;
    if (this.activeTurn !== this.playerColor) return;

    const squareEl = this.squares[row][col];
    const piece = this.boardState[row][col];

    // Deselect on same square click
    if (this.selectedSquare && this.selectedSquare.row === row && this.selectedSquare.col === col) {
      this.clearHighlights();
      return;
    }

    // If a piece is selected and this square is a valid move destination, execute
    if (this.selectedSquare) {
      const isValid = this.selectedSquare.validMoves.some(m => m.r === row && m.c === col);
      if (isValid) {
        this.executeMove(this.selectedSquare.row, this.selectedSquare.col, row, col, true);
        return;
      }
    }

    // Select piece — only if it belongs to the active player's color
    this.clearHighlights();
    if (piece) {
      const isWhitePiece = piece === piece.toUpperCase();
      const isMyPiece = (this.playerColor === 'white' && isWhitePiece) ||
                        (this.playerColor === 'black' && !isWhitePiece);
      if (!isMyPiece) return;

      const validMoves = this.getLegalMovesForPiece(row, col, piece);
      this.selectedSquare = { row, col, piece, validMoves };
      squareEl.classList.add('selected');
      this.playSynthSound('select');

      // Show highlights only if the setting is enabled
      if (document.getElementById('highlight-setting')?.checked) {
        validMoves.forEach(move => {
          const cell = this.squares[move.r][move.c];
          if (move.capture) {
            cell.classList.add('highlight-capture');
          } else {
            cell.classList.add('highlight-move');
            const dot = document.createElement('span');
            dot.className = 'move-dot';
            cell.appendChild(dot);
          }
        });
      }
    }
  }

  // Execute a move — local flag determines if we fire the onMove callback
  executeMove(fromRow, fromCol, toRow, toCol, isLocal = false) {
    const piece = this.boardState[fromRow][fromCol];

    this.boardState[toRow][toCol] = piece;
    this.boardState[fromRow][fromCol] = '';

    this.clearHighlights();
    this.render();

    this.squares[fromRow][fromCol].classList.add('last-move');
    this.squares[toRow][toCol].classList.add('last-move');

    this.playSynthSound('move');

    // Switch active turn
    this.activeTurn = this.activeTurn === 'white' ? 'black' : 'white';

    // Check for check/checkmate
    this.checkGameState();

    // Fire callback so app.js can relay move via socket
    if (isLocal && this.onMove) {
      this.onMove(fromRow, fromCol, toRow, toCol);
    }
  }

  clearHighlights() {
    this.selectedSquare = null;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const sq = this.squares[r][c];
        sq.classList.remove('selected', 'highlight-move', 'highlight-capture', 'last-move');
        const dot = sq.querySelector('.move-dot');
        if (dot) dot.remove();
      }
    }
  }

  resetBoard() {
    this.boardState = [
      ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
      ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
      ['',  '',  '',  '',  '',  '',  '',  ''],
      ['',  '',  '',  '',  '',  '',  '',  ''],
      ['',  '',  '',  '',  '',  '',  '',  ''],
      ['',  '',  '',  '',  '',  '',  '',  ''],
      ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
      ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
    ];
    this.activeTurn = 'white';
    this.clearHighlights();
    this.render();
  }

  setInteractable(interactable, playerColor = null) {
    this.interactable = interactable;
    if (playerColor) this.playerColor = playerColor;
    this._updateBoardCursor();
  }

  _updateBoardCursor() {
    this.boardEl.style.cursor = this.interactable ? '' : 'default';
    // Visual indication that board is locked
    if (this.interactable) {
      this.boardEl.classList.remove('board-locked');
    } else {
      this.boardEl.classList.add('board-locked');
    }
  }

  setTheme(theme) {
    this.activeTheme = theme;
    const colors = {
      'green': { light: '#eeeed2', dark: '#769656' },
      'wood':  { light: '#f0d9b5', dark: '#b58863' },
      'glass': { light: '#3e3e42', dark: '#1e1e1e' }
    };
    const chosen = colors[theme] || colors['green'];
    document.documentElement.style.setProperty('--board-light', chosen.light);
    document.documentElement.style.setProperty('--board-dark', chosen.dark);

    if (theme === 'glass') {
      this.boardEl.style.boxShadow = '0 8px 32px 0 rgba(0, 0, 0, 0.6)';
    } else {
      this.boardEl.style.boxShadow = 'var(--shadow-lg)';
    }
  }

  setCoordinatesVisible(visible) {
    this.boardEl.classList.toggle('hide-coordinates', !visible);
  }

  flipBoard() {
    this.flipped = !this.flipped;
    this.boardEl.classList.toggle('flipped', this.flipped);
  }

  setOrientation(color) {
    this.flipped = (color === 'black');
    this.boardEl.classList.toggle('flipped', this.flipped);
  }

  // ─── Move Calculation ──────────────────────────────────────────────────────
  // Returns an array of { r, c, capture } objects for valid destinations.
  // This is decoupled from any rendering so the bug (can't move without highlights)
  // is fixed — valid moves are always calculated, regardless of CSS highlight state.
  calculateValidMoves(row, col, piece, state = this.boardState, ignoreKing = false) {
    const isWhite = piece === piece.toUpperCase();
    const type = piece.toLowerCase();
    const moves = [];

    switch (type) {
      case 'p': {
        const dir = isWhite ? -1 : 1;
        const startRow = isWhite ? 6 : 1;
        const t1 = row + dir;
        if (t1 >= 0 && t1 < 8 && !state[t1][col]) {
          moves.push({ r: t1, c: col });
          const t2 = row + dir * 2;
          if (row === startRow && !state[t2][col]) {
            moves.push({ r: t2, c: col });
          }
        }
        [col - 1, col + 1].forEach(ac => {
          if (ac >= 0 && ac < 8) {
            const tp = state[t1]?.[ac];
            if (tp && (tp === tp.toUpperCase()) !== isWhite) {
              moves.push({ r: t1, c: ac, capture: true });
            }
          }
        });
        break;
      }
      case 'n': {
        [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(([dr, dc]) => {
          const nr = row + dr, nc = col + dc;
          if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
            const dp = state[nr][nc];
            if (!dp) moves.push({ r: nr, c: nc });
            else if ((dp === dp.toUpperCase()) !== isWhite) moves.push({ r: nr, c: nc, capture: true });
          }
        });
        break;
      }
      case 'b':
        this._slidingMoves(row, col, isWhite, [[-1,-1],[-1,1],[1,-1],[1,1]], moves, state);
        break;
      case 'r':
        this._slidingMoves(row, col, isWhite, [[-1,0],[1,0],[0,-1],[0,1]], moves, state);
        break;
      case 'q':
        this._slidingMoves(row, col, isWhite, [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]], moves, state);
        break;
      case 'k': {
        [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(([dr, dc]) => {
          const nr = row + dr, nc = col + dc;
          if (nr >= 0 && nr < 8 && nc >= 0 && nr < 8) {
            const dp = state[nr][nc];
            if (!dp) moves.push({ r: nr, c: nc });
            else if ((dp === dp.toUpperCase()) !== isWhite) moves.push({ r: nr, c: nc, capture: true });
          }
        });
        break;
      }
    }
    return moves;
  }

  _slidingMoves(row, col, isWhite, dirs, moves, state = this.boardState) {
    dirs.forEach(([dr, dc]) => {
      let nr = row + dr, nc = col + dc;
      while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const dp = state[nr][nc];
        if (!dp) {
          moves.push({ r: nr, c: nc });
        } else {
          if ((dp === dp.toUpperCase()) !== isWhite) moves.push({ r: nr, c: nc, capture: true });
          break;
        }
        nr += dr; nc += dc;
      }
    });
  }

  isSquareAttackedBy(row, col, attackerColor, state = this.boardState) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = state[r][c];
        if (!piece) continue;
        const isWhite = piece === piece.toUpperCase();
        if ((isWhite ? 'white' : 'black') !== attackerColor) continue;

        const rawMoves = this.calculateValidMoves(r, c, piece, state, true);
        if (rawMoves.some(m => m.r === row && m.c === col)) return true;
      }
    }
    return false;
  }

  isKingInCheck(color, state = this.boardState) {
    let kr, kc;
    const targetKing = color === 'white' ? 'K' : 'k';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (state[r][c] === targetKing) {
          kr = r; kc = c; break;
        }
      }
    }
    if (kr === undefined) return false;
    return this.isSquareAttackedBy(kr, kc, color === 'white' ? 'black' : 'white', state);
  }

  getLegalMovesForPiece(row, col, piece, state = this.boardState) {
    const rawMoves = this.calculateValidMoves(row, col, piece, state);
    const color = piece === piece.toUpperCase() ? 'white' : 'black';

    return rawMoves.filter(m => {
      // Simulate move
      const nextState = state.map(r => [...r]);
      nextState[m.r][m.c] = piece;
      nextState[row][col] = '';
      return !this.isKingInCheck(color, nextState);
    });
  }

  hasAnyLegalMove(color, state = this.boardState) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = state[r][c];
        if (!piece) continue;
        const isWhite = piece === piece.toUpperCase();
        if ((isWhite ? 'white' : 'black') !== color) continue;

        if (this.getLegalMovesForPiece(r, c, piece, state).length > 0) return true;
      }
    }
    return false;
  }

  checkGameState() {
    const opponentColor = this.activeTurn; // Already swapped in executeMove
    const isCheck = this.isKingInCheck(opponentColor);
    const hasMoves = this.hasAnyLegalMove(opponentColor);

    if (isCheck) {
      if (!hasMoves) {
        if (this.onCheckmate) this.onCheckmate(opponentColor === 'white' ? 'black' : 'white');
      } else {
        if (this.onCheck) this.onCheck(opponentColor);
      }
    } else if (!hasMoves) {
      // Stalemate
      if (this.onCheckmate) this.onCheckmate('draw');
    }
  }

  // ─── Audio ─────────────────────────────────────────────────────────────────
  playSynthSound(type) {
    if (!document.getElementById('sound-setting')?.checked) return;
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      const now = this.audioCtx.currentTime;

      if (type === 'select') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(400, now + 0.08);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.start(now); osc.stop(now + 0.08);
      } else if (type === 'move') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.12);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now); osc.stop(now + 0.12);
      }
    } catch (e) { /* Browser audio context may require user interaction first */ }
  }
}

window.ChessBoard = ChessBoard;
