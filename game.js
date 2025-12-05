class LudoGame {
    constructor() {
        this.canvas = document.getElementById('gameBoard');
        this.ctx = this.canvas.getContext('2d');
        this.boardSize = 600;
        this.cellSize = this.boardSize / 15;

        // Game state
        this.players = [];
        this.currentPlayerIndex = 0;
        this.diceValue = 0;
        this.gameStarted = false;
        this.isAnimating = false;
        this.sfxEnabled = true;
        this.voiceEnabled = true;
        this.diceRolls = 0;
        this.totalMoves = 0;
        this.consecutiveSixes = 0;
        this.selectedToken = null;
        this.validMoves = [];

        this.colors = {
            red: '#ff2e2e',
            green: '#00b300',
            yellow: '#ffcc00',
            blue: '#0066ff'
        };

        this.initializeBoardPaths();
        this.setupEventListeners();

        // Audio Context (created on interaction)
        this.audioCtx = null;
        window.speechSynthesis.getVoices();
        // If a saved game exists, auto-restore it (silent) for reliability
        try {
            const raw = localStorage.getItem('ludo_save_v1');
            if (raw) {
                try {
                    const s = JSON.parse(raw);
                    // perform silent restore to reduce accidental loss on refresh
                    this.loadState(s);
                    console.info('LudoGame: restored saved game from localStorage');
                } catch (e) {
                    console.warn('LudoGame: failed parsing saved state', e);
                }
            }
        } catch (e) { /* ignore */ }
    }

    // Animate a captured token with a short orbit/spin and then send it home
    animateCapturedToken(token) {
        return new Promise(resolve => {
            // mark animation in-progress so other interactions pause
            this.isAnimating = true;
            const c = this.cellSize;
            const start = this.getVisualPosition(token);
            const radius = c * 1.2 + Math.random() * c * 0.6;
            const rotations = 2 + Math.floor(Math.random() * 2);
            const duration = 600 + Math.random() * 300;
            const startTime = performance.now();

            const step = (now) => {
                const elapsed = now - startTime;
                const t = Math.min(1, elapsed / duration);
                const angle = t * rotations * Math.PI * 2;

                token._animX = start.x + Math.cos(angle) * radius * (1 - t * 0.3);
                token._animY = start.y + Math.sin(angle) * radius * (1 - t * 0.3) - Math.sin(t * Math.PI) * (c * 0.15);

                this.drawBoard();

                if (t < 1) requestAnimationFrame(step);
                else {
                    // cleanup orbit override then animate back to home position
                    delete token._animX;
                    delete token._animY;
                    // animate to home tile (-1 means home in getVisualPosition)
                    this.animateTokenMovement(token, -1, 600).then(() => {
                        token.position = -1;
                        token.isFinished = false;
                        this.drawBoard();
                        // clear animation flag
                        this.isAnimating = false;
                        resolve();
                    }).catch(() => {
                        token.position = -1;
                        token.isFinished = false;
                        this.isAnimating = false;
                        resolve();
                    });
                }
            };

            requestAnimationFrame(step);
        });
    }

    initAudio() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    initializeBoardPaths() {
        this.startPositions = { red: 0, green: 13, yellow: 26, blue: 39 };
        this.homeEntryPositions = { red: 50, green: 11, yellow: 24, blue: 37 };
        this.safePositions = [0, 8, 13, 21, 26, 34, 39, 47];
        this.calculateBoardPositions();
    }

    calculateBoardPositions() {
        this.boardPositions = [];
        const c = this.cellSize;
        const addPos = (gx, gy) => {
            this.boardPositions.push({ x: gx * c, y: gy * c });
        };

        // 1. Red Home Straight [0-4] -> Bottom-Left going Up
        addPos(1, 6); addPos(2, 6); addPos(3, 6); addPos(4, 6); addPos(5, 6);
        // 2. Up towards Top [5-10]
        addPos(6, 5); addPos(6, 4); addPos(6, 3); addPos(6, 2); addPos(6, 1); addPos(6, 0);
        // 3. Top Turn [11-12]
        addPos(7, 0); addPos(8, 0);
        // 4. Down towards Right [13-17]
        addPos(8, 1); addPos(8, 2); addPos(8, 3); addPos(8, 4); addPos(8, 5);
        // 5. Right into Green Arm [18-23]
        addPos(9, 6); addPos(10, 6); addPos(11, 6); addPos(12, 6); addPos(13, 6); addPos(14, 6);
        // 6. Right Turn [24-25]
        addPos(14, 7); addPos(14, 8);
        // 7. Left out of Green Arm [26-30]
        addPos(13, 8); addPos(12, 8); addPos(11, 8); addPos(10, 8); addPos(9, 8);
        // 8. Down towards Bottom [31-36]
        addPos(8, 9); addPos(8, 10); addPos(8, 11); addPos(8, 12); addPos(8, 13); addPos(8, 14);
        // 9. Bottom Turn [37-38]
        addPos(7, 14); addPos(6, 14);
        // 10. Up towards Left Arm [39-43]
        addPos(6, 13); addPos(6, 12); addPos(6, 11); addPos(6, 10); addPos(6, 9);
        // 11. Left into Blue Arm [44-49]
        addPos(5, 8); addPos(4, 8); addPos(3, 8); addPos(2, 8); addPos(1, 8); addPos(0, 8);
        // 12. Left Turn [50-51]
        addPos(0, 7); addPos(0, 6);

        // Home Paths [52-71]
        // Red
        addPos(1, 7); addPos(2, 7); addPos(3, 7); addPos(4, 7); addPos(5, 7);
        // Green
        addPos(7, 1); addPos(7, 2); addPos(7, 3); addPos(7, 4); addPos(7, 5);
        // Yellow
        addPos(13, 7); addPos(12, 7); addPos(11, 7); addPos(10, 7); addPos(9, 7);
        // Blue
        addPos(7, 13); addPos(7, 12); addPos(7, 11); addPos(7, 10); addPos(7, 9);

        // Center [72]
        addPos(7, 7);
    }

    setupEventListeners() {
        document.getElementById('gameMode').addEventListener('change', (e) => {
            document.getElementById('aiPlayersSetup').style.display = e.target.value === 'ai' ? 'block' : 'none';
        });

        // Show/hide player name inputs when player count changes
        const playerCountEl = document.getElementById('playerCount');
        const updateNameInputs = () => {
            const count = parseInt(playerCountEl.value);
            document.querySelectorAll('#playerNames .name-input').forEach((el, idx) => {
                el.style.display = idx < count ? 'flex' : 'none';
            });
        };
        playerCountEl.addEventListener('change', updateNameInputs);
        // initialize visibility
        setTimeout(updateNameInputs, 0);

        document.getElementById('startGameBtn').addEventListener('click', () => {
            this.initAudio();
            this.prepareStart();
        });

        // Names modal confirm/cancel handlers
        const confirmBtn = document.getElementById('confirmNamesBtn');
        const cancelBtn = document.getElementById('cancelNamesBtn');
        if (confirmBtn) confirmBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const inputs = Array.from(document.querySelectorAll('#namesInputs input'));
            const names = inputs.map(i => i.value.trim()).filter(v => v.length > 0);
            document.getElementById('namesModal').classList.remove('show');
            this.startGame(names);
        });
        if (cancelBtn) cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('namesModal').classList.remove('show');
        });

        document.querySelector('.dice-container').addEventListener('click', () => {
            this.initAudio();
            this.rollDice();
        });

        document.getElementById('newGameBtn').addEventListener('click', () => this.resetGame());
        document.getElementById('rulesBtn').addEventListener('click', () => this.showRules());
        document.getElementById('sfxToggle').addEventListener('click', () => this.toggleSfx());
        document.getElementById('voiceToggle').addEventListener('click', () => this.toggleVoice());
        // Fullscreen board toggle (mobile/full immersive view)
        const fsBtn = document.getElementById('fullscreenBtn');
        if (fsBtn) fsBtn.addEventListener('click', () => this.toggleBoardFullscreen());
        // Persistence is automatic; no manual save UI needed.
        document.getElementById('playAgainBtn').addEventListener('click', () => this.resetGame());

        this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));

        document.querySelectorAll('.close, .modal').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target === el || el.classList.contains('close')) {
                    e.target.closest('.modal')?.classList.remove('show');
                }
            });
        });

        // Sync state if user presses ESC or swipes out of fullscreen
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement) {
                document.body.classList.remove('board-fullscreen');
                const fsBtn = document.getElementById('fullscreenBtn');
                if (fsBtn) {
                    fsBtn.textContent = '⤢'; // Reset to enter fullscreen icon
                    fsBtn.title = 'Board Fullscreen';
                }
                // Reset canvas size logic
                setTimeout(() => this.handleResize(), 100);
            }
        });

        // Handle window resizing to keep board sharp
        window.addEventListener('resize', () => {
            if (this.gameStarted) this.handleResize();
        });
    }

    // Prepare start: ask for human player names based on player/AI count
    prepareStart() {
        const playerCount = parseInt(document.getElementById('playerCount').value);
        const gameMode = document.getElementById('gameMode').value;
        const aiCount = gameMode === 'ai' ? parseInt(document.getElementById('aiCount').value) : 0;
        const humanCount = Math.max(0, playerCount - aiCount);

        if (humanCount <= 0) {
            // no humans — start immediately
            this.startGame([]);
            return;
        }

        const container = document.getElementById('namesInputs');
        container.innerHTML = '';
        for (let i = 0; i < humanCount; i++) {
            const row = document.createElement('div');
            row.className = 'option-group name-input';
            const label = document.createElement('label');
            label.textContent = `Player ${i + 1} Name:`;
            const input = document.createElement('input');
            input.type = 'text';
            input.id = `nameInput${i}`;
            input.value = `Player ${i + 1}`;
            row.appendChild(label);
            row.appendChild(input);
            container.appendChild(row);
        }

        document.getElementById('namesModal').classList.add('show');
    }

    startGame(providedNames = []) {
        const playerCount = parseInt(document.getElementById('playerCount').value);
        const gameMode = document.getElementById('gameMode').value;
        const aiCount = gameMode === 'ai' ? parseInt(document.getElementById('aiCount').value) : 0;

        this.players = [];
        const colorNames = ['red', 'green', 'yellow', 'blue'];

        // Build players using providedNames for human players (skip CPU count)
        let humanIdx = 0;
        for (let i = 0; i < playerCount; i++) {
            const isAI = gameMode === 'ai' && i < aiCount;
            const defaultName = `${colorNames[i].charAt(0).toUpperCase() + colorNames[i].slice(1)} Player`;
            let finalName = defaultName;
            if (isAI) {
                finalName = `${defaultName} (CPU)`;
            } else {
                if (providedNames && providedNames[humanIdx]) {
                    finalName = providedNames[humanIdx];
                }
                humanIdx++;
            }

            this.players.push({
                id: i,
                color: colorNames[i],
                name: finalName,
                isAI: isAI,
                tokens: this.createTokens(colorNames[i]),
                finishedTokens: 0
            });
        }

        document.getElementById('gameSetup').style.display = 'none';
        document.getElementById('gameContainer').style.display = 'grid';

        for (let i = 0; i < 4; i++) {
            const card = document.getElementById(`player${i}`);
            card.style.display = i < playerCount ? 'flex' : 'none';
            if (i < playerCount) {
                card.querySelector('.player-status').textContent = this.players[i].isAI ? 'CPU' : 'Human';
                const titleEl = card.querySelector('h3');
                if (titleEl) titleEl.textContent = this.players[i].name;
            }
        }

        this.gameStarted = true;
        this.currentPlayerIndex = 0;
        // persist initial game state
        try { if (typeof this.saveState === 'function') this.saveState(); else console.warn('saveState not available at start'); } catch (e) { console.warn('Save failed:', e); }
        this.updateTurnIndicator();
        this.drawBoard();
        this.addLog(`Game started! ${this.players[0].name} plays first.`);

        if (this.getCurrentPlayer().isAI) {
            setTimeout(() => this.aiTurn(), 1000);
        }
    }

    createTokens(color) {
        return Array(4).fill(0).map((_, i) => ({
            id: i,
            position: -1,
            isFinished: false,
            color: color
        }));
    }

    // --- HELPER FOR ALIGNMENT (FIX 1) ---
    // Calculates the exact X, Y for a token, used by Drawing AND Highlighting
    getVisualPosition(token) {
        const c = this.cellSize;
        let x, y;
        let player = this.players.find(p => p.color === token.color);

        if (token.isFinished) {
            const map = { red: Math.PI, green: -Math.PI / 2, yellow: 0, blue: Math.PI / 2 };
            const angle = map[token.color];
            const center = 7.5 * c;
            const offset = (token.id - 1.5) * (c * 0.25);
            x = center + Math.cos(angle) * c + Math.sin(angle) * offset;
            y = center + Math.sin(angle) * c - Math.cos(angle) * offset;
        }
        else if (token.position === -1) {
            const basePos = { red: [0, 0], green: [9, 0], yellow: [9, 9], blue: [0, 9] };

            // UPDATED OFFSETS: Changed from [2, 2] etc. to [1.5, 1.5] to center perfectly
            const offsets = [[1.5, 1.5], [3.5, 1.5], [1.5, 3.5], [3.5, 3.5]];

            const b = basePos[token.color];
            const o = offsets[token.id];

            // This centers it exactly on the tile grid intersection
            x = (b[0] + o[0]) * c + c / 2;
            y = (b[1] + o[1]) * c + c / 2;
        }
        else {
            const pos = this.boardPositions[token.position];
            x = pos.x + c / 2;
            y = pos.y + c / 2;

            const stack = this.getTokensOnSquare(token.position);
            if (stack.length > 1) {
                const idx = stack.indexOf(token);
                const shift = c * 0.1;
                x -= (stack.length - 1) * shift / 2;
                x += idx * shift;
                y -= idx * shift * 0.5;
            }
        }

        // Add perspective offset here so it applies to both pawn and highlighter
        // This pushes the visual "feet" down slightly, looking 3D
        const visualY = y + (c * 0.8 * 0.2);
        return { x, y: visualY };
    }

    drawBoard() {
        const ctx = this.ctx;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, this.boardSize, this.boardSize);
        this.drawBoardStructure();

        // Draw last move indicator (faint highlights/arrows) before pawns
        this.drawLastMoveIndicator();

        this.drawTokens();
        if (this.validMoves.length > 0 && !this.isAnimating && !this.getCurrentPlayer().isAI) {
            this.highlightValidMoves();
        }
    }

    drawBoardStructure() {
        const ctx = this.ctx;
        const c = this.cellSize;

        // Base Grid
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= 15; i++) {
            ctx.moveTo(i * c, 0); ctx.lineTo(i * c, this.boardSize);
            ctx.moveTo(0, i * c); ctx.lineTo(this.boardSize, i * c);
        }
        ctx.stroke();

        this.drawHomeBase(0, 0, this.colors.red);
        this.drawHomeBase(9 * c, 0, this.colors.green);
        this.drawHomeBase(9 * c, 9 * c, this.colors.yellow);
        this.drawHomeBase(0, 9 * c, this.colors.blue);

        this.drawPathCells();
        this.drawCenterFinish();

        ctx.strokeStyle = '#333';
        ctx.lineWidth = 4;
        ctx.strokeRect(0, 0, this.boardSize, this.boardSize);
    }

    drawHomeBase(x, y, color) {
        const ctx = this.ctx;
        const c = this.cellSize;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 6 * c, 6 * c);
        ctx.fillStyle = '#fff';
        ctx.fillRect(x + c * 1, y + c * 1, 4 * c, 4 * c);

        // UPDATED OFFSETS: Changed to match getVisualPosition alignment
        const offsets = [[1.5, 1.5], [3.5, 1.5], [1.5, 3.5], [3.5, 3.5]];

        // Calculate hole positions to match getVisualPosition logic
        offsets.forEach(([ox, oy]) => {
            const circleX = x + ox * c + c / 2;
            const circleY = y + oy * c + c / 2;

            // The hole is drawn slightly lower to match the perspective of the pawn standing on it
            const visualY = circleY + (c * 0.8 * 0.2);

            ctx.beginPath();
            ctx.arc(circleX, visualY, c * 0.4, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,0,0,0.1)';
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#ccc';
            ctx.stroke();
        });
    }

    drawPathCells() {
        const ctx = this.ctx;
        const c = this.cellSize;

        for (let i = 0; i < 52; i++) {
            const pos = this.boardPositions[i];
            const isSafe = this.safePositions.includes(i);
            ctx.fillStyle = '#fff';
            if (i === 0) ctx.fillStyle = this.colors.red;
            else if (i === 13) ctx.fillStyle = this.colors.green;
            else if (i === 26) ctx.fillStyle = this.colors.yellow;
            else if (i === 39) ctx.fillStyle = this.colors.blue;

            ctx.fillRect(pos.x, pos.y, c, c);
            ctx.strokeRect(pos.x, pos.y, c, c);

            if (isSafe) {
                const isStart = [0, 13, 26, 39].includes(i);
                this.drawStar(pos.x + c / 2, pos.y + c / 2, c * 0.4, isStart ? '#fff' : '#aaa');
            }
        }
        const drawStrip = (startIdx, color) => {
            for (let i = 0; i < 5; i++) {
                const pos = this.boardPositions[startIdx + i];
                ctx.fillStyle = color;
                ctx.fillRect(pos.x, pos.y, c, c);
                ctx.strokeRect(pos.x, pos.y, c, c);
            }
        };
        drawStrip(52, this.colors.red);
        drawStrip(57, this.colors.green);
        drawStrip(62, this.colors.yellow);
        drawStrip(67, this.colors.blue);
    }

    drawStar(cx, cy, r, color) {
        const ctx = this.ctx;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.beginPath();
        ctx.fillStyle = color;
        for (let i = 0; i < 5; i++) {
            ctx.lineTo(Math.cos((18 + i * 72) * 0.0174533) * r, -Math.sin((18 + i * 72) * 0.0174533) * r);
            ctx.lineTo(Math.cos((54 + i * 72) * 0.0174533) * r / 2, -Math.sin((54 + i * 72) * 0.0174533) * r / 2);
        }
        ctx.fill();
        ctx.restore();
    }

    drawCenterFinish() {
        const ctx = this.ctx;
        const c = this.cellSize;
        const x = 6 * c, y = 6 * c, s = 3 * c;
        ctx.fillStyle = '#fff';
        ctx.fillRect(x, y, s, s);
        const mid = s / 2;
        const drawTri = (pts, color) => {
            ctx.beginPath();
            ctx.moveTo(x + pts[0], y + pts[1]);
            ctx.lineTo(x + pts[2], y + pts[3]);
            ctx.lineTo(x + mid, y + mid);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.stroke();
        };
        drawTri([0, 0, 0, s], this.colors.red);
        drawTri([0, 0, s, 0], this.colors.green);
        drawTri([s, 0, s, s], this.colors.yellow);
        drawTri([0, s, s, s], this.colors.blue);
    }

    drawTokens() {
        this.players.forEach(player => {
            player.tokens.forEach(token => {
                this.drawPawn3D(token);
            });
        });
    }

    drawPawn3D(token) {
        // Use unified visual position (FIX 1)
        // If the token has animation override coordinates, prefer those
        const animX = token._animX;
        const animY = token._animY;
        const pos = this.getVisualPosition(token);
        const x = typeof animX === 'number' ? animX : pos.x;
        const y = typeof animY === 'number' ? animY : pos.y;
        const size = this.cellSize * 0.8;
        const isSelected = this.validMoves.some(m => m.token === token) && !this.getCurrentPlayer().isAI && !this.isAnimating;

        // Pass X, Y exactly as calculated
        this.renderPawnShape(x, y, size, this.colors[token.color], isSelected);
    }

    // Smoothly animate a token from its current visual location to the visual
    // position of `toPosIndex`. Uses requestAnimationFrame and resolves when
    // finished. Does NOT mutate the token.position until the animation completes
    // (we update position afterwards so physics/logic act on final state).
    animateTokenMovement(token, toPosIndex, duration = 250) {
        return new Promise(resolve => {
            const start = this.getVisualPosition(token);

            // compute target by temporarily setting token state
            const oldPos = token.position;
            const oldFinished = token.isFinished;
            token.position = toPosIndex;
            token.isFinished = (toPosIndex === 72);
            const target = this.getVisualPosition(token);
            // restore
            token.position = oldPos;
            token.isFinished = oldFinished;

            const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
            let startTime = null;

            const step = (timestamp) => {
                if (!startTime) startTime = timestamp;
                const elapsed = timestamp - startTime;
                const t = Math.min(1, elapsed / duration);
                const tt = easeOutCubic(t);

                token._animX = start.x + (target.x - start.x) * tt;
                token._animY = start.y + (target.y - start.y) * tt;

                // redraw current frame
                this.drawBoard();

                if (t < 1) {
                    requestAnimationFrame(step);
                } else {
                    // cleanup animation overrides
                    delete token._animX;
                    delete token._animY;
                    resolve();
                }
            };

            requestAnimationFrame(step);
        });
    }

    // Draw a faint indicator for the last move made (start and end tiles + arrow)
    drawLastMoveIndicator() {
        if (!this.lastMove) return;
        const ctx = this.ctx;
        const c = this.cellSize;
        const lm = this.lastMove;

        // Use stored visuals when available
        const from = lm.from || lm.fromPos;
        const to = lm.to || lm.toPos;
        if (!from || !to) return;

        ctx.save();
        ctx.globalAlpha = 0.28;

        // highlight circles on start and end
        const r = c * 0.45;
        ctx.beginPath();
        ctx.fillStyle = this.adjustColor(this.colors[lm.color] || lm.color || '#667eea', -10);
        ctx.arc(from.x, from.y - (c * 0.8 * 0.0), r, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.fillStyle = this.colors[lm.color] || lm.color || 'rgba(102,126,234,0.6)';
        ctx.arc(to.x, to.y - (c * 0.8 * 0.0), r * 0.9, 0, Math.PI * 2);
        ctx.fill();

        // draw arrow from from -> to
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = this.colors[lm.color] || lm.color || '#667eea';
        ctx.lineWidth = Math.max(3, c * 0.12);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(from.x, from.y - (c * 0.16));
        ctx.lineTo(to.x, to.y - (c * 0.16));
        ctx.stroke();

        // arrow head
        const angle = Math.atan2((to.y - from.y), (to.x - from.x));
        const headLen = c * 0.32;
        ctx.beginPath();
        ctx.moveTo(to.x, to.y - (c * 0.16));
        ctx.lineTo(to.x - headLen * Math.cos(angle - Math.PI / 6), to.y - (c * 0.16) - headLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(to.x - headLen * Math.cos(angle + Math.PI / 6), to.y - (c * 0.16) - headLen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fillStyle = this.colors[lm.color] || lm.color || '#667eea';
        ctx.fill();

        ctx.restore();
    }

    renderPawnShape(x, y, size, colorHex, isSelected) {
        const ctx = this.ctx;
        const w = size * 0.6;
        const h = size * 0.9;
        const headR = w * 0.4;

        // Draw relative to the passed X, Y as the BOTTOM CENTER (Base) of the pawn
        const bx = x;
        const by = y;

        ctx.save();
        ctx.beginPath();
        ctx.ellipse(bx, by, w * 0.6, w * 0.2, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fill();

        const grad = ctx.createLinearGradient(bx - w / 2, by - h, bx + w / 2, by);
        grad.addColorStop(0, this.adjustColor(colorHex, 50));
        grad.addColorStop(0.5, colorHex);
        grad.addColorStop(1, this.adjustColor(colorHex, -50));

        ctx.beginPath();
        ctx.moveTo(bx - w / 2, by);
        ctx.bezierCurveTo(bx - w / 2, by - h * 0.6, bx - w * 0.2, by - h * 0.7, bx - w * 0.2, by - h * 0.85);
        ctx.lineTo(bx + w * 0.2, by - h * 0.85);
        ctx.bezierCurveTo(bx + w * 0.2, by - h * 0.7, bx + w / 2, by - h * 0.6, bx + w / 2, by);
        ctx.closePath();

        ctx.fillStyle = grad;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.stroke();

        const headY = by - h * 0.85 - headR * 0.2;
        const headGrad = ctx.createRadialGradient(bx - headR * 0.3, headY - headR * 0.3, headR * 0.1, bx, headY, headR);
        headGrad.addColorStop(0, '#fff');
        headGrad.addColorStop(0.3, colorHex);
        headGrad.addColorStop(1, this.adjustColor(colorHex, -60));

        ctx.beginPath();
        ctx.arc(bx, headY, headR, 0, Math.PI * 2);
        ctx.fillStyle = headGrad;
        ctx.fill();
        ctx.stroke();

        if (isSelected) {
            ctx.shadowColor = '#fff';
            ctx.shadowBlur = 15;
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
        ctx.restore();
    }

    adjustColor(hex, amt) {
        let usePound = false;
        if (hex[0] === "#") { hex = hex.slice(1); usePound = true; }
        let num = parseInt(hex, 16);
        let r = (num >> 16) + amt;
        if (r > 255) r = 255; else if (r < 0) r = 0;
        let b = ((num >> 8) & 0x00FF) + amt;
        if (b > 255) b = 255; else if (b < 0) b = 0;
        let g = (num & 0x0000FF) + amt;
        if (g > 255) g = 255; else if (g < 0) g = 0;
        return (usePound ? "#" : "") + (g | (b << 8) | (r << 16)).toString(16).padStart(6, '0');
    }

    toggleBoardFullscreen() {
        const isFullscreen = document.body.classList.contains('board-fullscreen');
        const fsBtn = document.getElementById('fullscreenBtn');

        if (!isFullscreen) {
            // ENTERING Fullscreen
            document.body.classList.add('board-fullscreen');
            if (fsBtn) {
                fsBtn.textContent = '⤓'; // Exit fullscreen icon
                fsBtn.title = 'Exit Fullscreen';
            }
            const el = document.documentElement;
            if (el.requestFullscreen) el.requestFullscreen().catch(() => { });
        } else {
            // EXITING Fullscreen
            document.body.classList.remove('board-fullscreen');
            if (fsBtn) {
                fsBtn.textContent = '⤢'; // Enter fullscreen icon
                fsBtn.title = 'Board Fullscreen';
            }
            if (document.fullscreenElement && document.exitFullscreen) {
                document.exitFullscreen().catch(() => { });
            }
        }

        // Delay resize to allow CSS transition to finish
        setTimeout(() => this.handleResize(), 100);
    }

    handleResize() {
        // This function ensures the canvas Resolution matches the CSS Size
        // preventing blurry text or stretched oval tokens
        const rect = this.canvas.getBoundingClientRect();

        // We want a square canvas. Take the smaller dimension.
        // In CSS we used vmin, so visually it is square. 
        // We set internal resolution to match.
        const size = Math.floor(Math.min(rect.width, rect.height));

        // Only resize if significantly different to prevent flickering
        if (Math.abs(this.canvas.width - size) > 5) {
            this.canvas.width = size;
            this.canvas.height = size;

            // We must re-calculate cell size based on new width
            this.boardSize = size;
            this.cellSize = this.boardSize / 15;

            // Recalculate positions based on new cell size
            this.initializeBoardPaths();

            // Redraw immediately
            this.drawBoard();
        }
    }

    highlightValidMoves() {
        const ctx = this.ctx;
        const c = this.cellSize;

        this.validMoves.forEach(move => {
            // Use unified visual position (FIX 1)
            // Now the highlight circle centers exactly where the pawn is drawn
            const { x, y } = this.getVisualPosition(move.token);

            // Adjust visual Y up slightly for the ring so it encompasses the pawn body
            // Since y is now the base (feet), we move the ring up to the waist
            const ringY = y - (c * 0.8 * 0.4);

            ctx.beginPath();
            ctx.arc(x, ringY, c * 0.4, 0, Math.PI * 2);
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 3;
            ctx.stroke();
            this.drawPulse(x, ringY, c * 0.4);
        });
    }

    drawPulse(x, y, r) {
        const time = Date.now() / 300;
        const scale = 1 + Math.sin(time) * 0.1;
        this.ctx.beginPath();
        this.ctx.arc(x, y, r * scale, 0, Math.PI * 2);
        this.ctx.strokeStyle = 'rgba(0, 255, 0, 0.6)';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
    }

    handleCanvasClick(e) {
        if (!this.gameStarted || this.diceValue === 0 || this.isAnimating) return;
        if (this.getCurrentPlayer().isAI) return;

        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        const clickedToken = this.getTokenAtPosition(x, y);

        if (clickedToken && this.validMoves.some(m => m.token === clickedToken)) {
            this.executeMove(clickedToken);
        }
    }

    getTokenAtPosition(x, y) {
        const c = this.cellSize;
        const clickRadius = c * 0.8; // Increased hit area

        for (let token of this.getCurrentPlayer().tokens) {
            if (token.isFinished) continue;

            // Use unified position for hit detection
            const pos = this.getVisualPosition(token);
            // Check distance to the "waist" of the pawn (up from feet)
            const waistY = pos.y - (c * 0.8 * 0.4);

            if (Math.hypot(x - pos.x, y - waistY) < clickRadius) {
                return token;
            }
        }
        return null;
    }

    rollDice() {
        if (!this.gameStarted || this.diceValue !== 0 || this.isAnimating) return;

        this.isAnimating = true;
        this.playSound('dice');

        const diceElement = document.getElementById('dice');
        const rolledValue = Math.floor(Math.random() * 6) + 1;

        diceElement.classList.add('swirling');

        setTimeout(() => {
            diceElement.classList.remove('swirling');
            const spins = 2;
            const baseRot = 360 * spins;
            let rotX = 0, rotY = 0;

            // Correct rotations to match CSS face positions:
            // face-1: translateZ(50px) - front face
            // face-2: rotateY(180deg) translateZ(50px) - back face
            // face-3: rotateY(90deg) translateZ(50px) - right face
            // face-4: rotateY(-90deg) translateZ(50px) - left face
            // face-5: rotateX(90deg) translateZ(50px) - top face
            // face-6: rotateX(-90deg) translateZ(50px) - bottom face
            switch (rolledValue) {
                case 1: rotX = baseRot + 0; rotY = baseRot + 0; break;      // front
                case 2: rotX = baseRot + 0; rotY = baseRot + 180; break;    // back
                case 3: rotX = baseRot + 0; rotY = baseRot - 90; break;     // right
                case 4: rotX = baseRot + 0; rotY = baseRot + 90; break;     // left
                case 5: rotX = baseRot - 90; rotY = baseRot + 0; break;     // top
                case 6: rotX = baseRot + 90; rotY = baseRot + 0; break;     // bottom
            }

            diceElement.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`;

            setTimeout(() => {
                this.diceValue = rolledValue;
                // record roll in history UI
                try { this.recordDiceRoll(rolledValue); } catch (e) { /* ignore */ }
                this.diceRolls++;
                document.getElementById('diceRolls').textContent = this.diceRolls;
                this.isAnimating = false;
                this.handleDiceRoll();
            }, 1000);
        }, 600);
    }

    handleDiceRoll() {
        const currentPlayer = this.getCurrentPlayer();
        this.addLog(`${currentPlayer.name} rolled ${this.diceValue}`);

        this.speak(`Rolled a ${this.diceValue}`);

        if (this.diceValue === 6) {
            this.consecutiveSixes++;
            if (this.consecutiveSixes === 3) {
                this.addLog("Three 6s! Turn skipped.");
                this.consecutiveSixes = 0;
                this.endTurn();
                return;
            }
        }
        // Note: consecutiveSixes is NOT reset here on non-6 rolls
        // It's only reset in endTurn() when turn actually ends

        this.validMoves = this.getValidMoves(currentPlayer, this.diceValue);

        if (this.validMoves.length === 0) {
            setTimeout(() => this.endTurn(), 800);
        } else if (this.validMoves.length === 1) {
            // Auto-move for both AI and human players when only one valid move
            setTimeout(() => this.executeMove(this.validMoves[0].token), 800);
        } else {
            if (currentPlayer.isAI) {
                setTimeout(() => this.aiChooseMove(), 800);
            } else {
                this.drawBoard();
            }
        }
    }

    getValidMoves(player, dice) {
        const moves = [];
        const startPos = this.startPositions[player.color];

        player.tokens.forEach(token => {
            if (token.isFinished) return;

            if (token.position === -1) {
                if (dice === 6) {
                    moves.push({ token: token, target: startPos, steps: [startPos] });
                }
                return;
            }

            const path = this.calculateMovePath(player.color, token.position, dice);
            if (path.length > 0) {
                const finalPos = path[path.length - 1];
                moves.push({ token: token, target: finalPos, steps: path });
            }
        });
        return moves;
    }

    calculateMovePath(color, currentPos, dice) {
        const path = [];
        let pos = currentPos;
        const homeStart = { red: 52, green: 57, yellow: 62, blue: 67 }[color];
        const homeEntry = this.homeEntryPositions[color];

        for (let i = 0; i < dice; i++) {
            let next;

            // 1. Entering Home
            if (pos === homeEntry) {
                next = homeStart;
            }
            // 2. Moving Inside Home (Indices 0 to 3 of the strip)
            // homeStart + 4 is the LAST tile. We move normally until we are ON the last tile.
            else if (pos >= homeStart && pos < homeStart + 4) {
                next = pos + 1;
            }
            // 3. Moving to Center (From Last Tile)
            // If we are on the last tile (e.g. 56 for Red), the next step is 72 (Center)
            else if (pos === homeStart + 4) {
                next = 72;
            }
            // 4. Normal Board Movement
            else {
                next = (pos + 1) % 52;
            }

            // OVERSHOOT CHECK
            // If the calculated next step is 72 (Center), but we still have dice steps remaining,
            // it's an overshoot. (e.g., At last tile, rolled 2. Step 1 goes to 72. Step 2 is invalid).
            if (next === 72 && i < dice - 1) return [];

            pos = next;
            path.push(pos);

            // Stop adding to path if we reached the center
            if (pos === 72) break;
        }
        return path;
    }

    async executeMove(token) {
        const move = this.validMoves.find(m => m.token === token);
        if (!move) return;

        this.isAnimating = true;
        this.selectedToken = null;
        this.validMoves = [];
        // Record last move visuals so we can draw an indicator for players
        const oldPos = token.position;
        const startVisual = this.getVisualPosition(token);
        // compute visual for target
        const oldFinished = token.isFinished;
        token.position = move.target;
        token.isFinished = (move.target === 72);
        const targetVisual = this.getVisualPosition(token);
        // restore
        token.position = oldPos;
        token.isFinished = oldFinished;

        this.lastMove = {
            color: token.color,
            fromIndex: oldPos,
            toIndex: move.target,
            from: startVisual,
            to: targetVisual,
            time: Date.now()
        };

        this.drawBoard();

        if (token.position === -1) {
            // Bringing a token out of home: animate from home to start
            this.playSound('move');
            await this.animateTokenMovement(token, move.target, 400);
            token.position = move.target;
        } else {
            for (let stepPos of move.steps) {
                // For each step, animate the visual from current to next
                this.playSound('move');
                await this.animateTokenMovement(token, stepPos, 250);

                // Once animation finished, update logical position
                token.position = stepPos;
                if (stepPos === 72) token.isFinished = true;

                // Ensure a final draw with the token placed exactly
                this.drawBoard();
            }
        }
        await this.handlePostMove(token, move.target);
    }

    async handlePostMove(token, finalPos) {
        const currentPlayer = this.getCurrentPlayer();

        if (token.isFinished) {
            currentPlayer.finishedTokens++;
            this.playSound('finish');
            this.addLog(`${currentPlayer.name} finished a token!`);

            this.speak("Token home!");

            if (currentPlayer.finishedTokens === 4) {
                this.handleWin(currentPlayer);
                return;
            }
        }

        // Capture Logic — animate captured pawns before sending them home
        let captured = false;
        if (finalPos < 52 && !this.safePositions.includes(finalPos)) {
            const others = this.getTokensOnSquare(finalPos).filter(t => t.color !== token.color);
            if (others.length > 0) {
                captured = true;
                this.playSound('capture');
                // Animate each enemy pawn being captured
                for (let enemy of others) {
                    // Announce capture
                    this.addLog(`${currentPlayer.name} captured ${enemy.color}!`);
                    this.speak(`Captured ${enemy.color}!`);
                    // Animate a brief orbit/spin and then send home
                    try {
                        await this.animateCapturedToken(enemy);
                    } catch (e) {
                        // fallback: immediate send home
                        enemy.position = -1;
                    }
                }
                // Force redraw after capture animations
                this.drawBoard();
            }
        }

        this.totalMoves++;
        document.getElementById('totalMoves').textContent = this.totalMoves;
        this.isAnimating = false;

        try { if (typeof this.saveState === 'function') this.saveState(); } catch (e) { /* ignore */ }

        // Bonus turn is granted for: rolling a 6, capturing, or finishing a token
        // (some rule-sets give a bonus on finishing — enable that here)
        const bonusTurn = (this.diceValue === 6) || captured || token.isFinished;

        if (bonusTurn) {
            this.addLog("Bonus Turn!");
            this.diceValue = 0;
            if (currentPlayer.isAI) {
                setTimeout(() => this.aiTurn(), 1000);
            }
        } else {
            this.endTurn();
        }
    }

    getTokensOnSquare(pos) {
        const list = [];
        this.players.forEach(p => {
            p.tokens.forEach(t => {
                if (t.position === pos && !t.isFinished) list.push(t);
            });
        });
        return list;
    }

    endTurn() {
        this.diceValue = 0;
        this.validMoves = [];
        // Reset consecutive sixes when turn actually ends
        this.consecutiveSixes = 0;
        let loops = 0;
        do {
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
            loops++;
        } while (this.getCurrentPlayer().finishedTokens === 4 && loops < 4);

        this.updateTurnIndicator();
        this.drawBoard();

        try { if (typeof this.saveState === 'function') this.saveState(); } catch (e) { /* ignore */ }

        if (this.getCurrentPlayer().isAI) {
            setTimeout(() => this.aiTurn(), 1000);
        }
    }

    aiTurn() {
        if (!this.gameStarted) return;
        this.rollDice();
    }

    aiChooseMove() {
        if (this.validMoves.length === 0) return;
        let best = this.validMoves[0];
        let maxScore = -9999;

        this.validMoves.forEach(move => {
            let score = 0;
            if (move.target === 72) score += 1000;
            if (move.token.position === -1) score += 200;
            if (move.target < 52 && !this.safePositions.includes(move.target)) {
                const enemies = this.getTokensOnSquare(move.target).filter(t => t.color !== move.token.color);
                if (enemies.length > 0) score += 500;
            }
            if (this.safePositions.includes(move.target)) score += 100;
            score += Math.random() * 50;

            if (score > maxScore) {
                maxScore = score;
                best = move;
            }
        });
        this.executeMove(best.token);
    }

    updateTurnIndicator() {
        const p = this.getCurrentPlayer();
        const el = document.getElementById('turnIndicator');
        el.textContent = p.name;
        el.style.color = this.colors[p.color];

        this.speak(`${p.name}'s turn`);

        this.players.forEach((pl, i) => {
            const card = document.getElementById(`player${i}`);
            if (i === this.currentPlayerIndex) card.classList.add('active');
            else card.classList.remove('active');
        });

        // Apply board glow matching active player's color
        const boardWrapper = document.querySelector('.game-board-wrapper');
        if (boardWrapper) {
            const color = this.colors[p.color] || '#667eea';
            boardWrapper.style.setProperty('--board-glow-color', color);
            boardWrapper.classList.add('board-glow');
        }

        if (!this.animationLoopStarted) {
            this.animationLoopStarted = true;
            const loop = () => {
                if (this.validMoves.length > 0 && !this.isAnimating) {
                    this.drawBoard();
                }
                requestAnimationFrame(loop);
            };
            loop();
        }
    }

    addLog(msg) {
        const box = document.getElementById('logMessages');
        const d = document.createElement('div');
        d.className = 'log-entry';
        d.textContent = msg;
        box.prepend(d);
        if (box.children.length > 10) box.lastChild.remove();
    }

    playSound(key) {
        // Master check for ALL effects (Dice, Move, Capture)
        if (!this.sfxEnabled || !this.audioCtx) return;

        const ctx = this.audioCtx;
        const now = ctx.currentTime;

        // --- SOUND TYPE 1: DICE RATTLE ---
        // Simulates plastic dice shaking in a cup
        if (key === 'dice') {
            for (let i = 0; i < 8; i++) {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);

                // Randomize timing for "shaking" effect
                const t = now + (Math.random() * 0.4);

                osc.type = 'square'; // "Clicky" sound
                osc.frequency.setValueAtTime(800 + Math.random() * 1200, t); // High pitch random

                gain.gain.setValueAtTime(0.05, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

                osc.start(t);
                osc.stop(t + 0.05);
            }
            return;
        }

        // --- SOUND TYPE 2: PAWN MOVEMENT & OTHERS ---
        // Standard game beeps
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        if (key === 'move') {
            // "Bloop" sound for pawn steps
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now); osc.stop(now + 0.1);
        }
        else if (key === 'capture') {
            // "Zap" sound for capture
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.linearRampToValueAtTime(50, now + 0.2);
            gain.gain.setValueAtTime(0.5, now);
            gain.gain.linearRampToValueAtTime(0, now + 0.2);
            osc.start(now); osc.stop(now + 0.2);
        }
        else if (key === 'finish') {
            // "Ping" sound for finishing
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1200, now);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
            osc.start(now); osc.stop(now + 0.5);
        }
    }



    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex];
    }

    handleWin(player) {
        this.gameStarted = false;
        try { this.clearSavedState(); } catch (e) { /* ignore */ }
        this.speak(`Congratulations! ${player.name} wins the game!`);
        document.getElementById('winnerText').textContent = `${player.name} Wins!`;
        document.getElementById('winnerModal').classList.add('show');
        // launch confetti celebration (non-blocking)
        try { this.launchConfetti(140); } catch (e) { console.warn('Confetti error:', e); }
    }

    resetGame() {
        // Clear persisted save so reload/restore doesn't bring old game back
        try { this.clearSavedState(); } catch (e) { /* ignore */ }

        // Reset runtime state
        this.players = [];
        this.currentPlayerIndex = 0;
        this.diceValue = 0;
        this.gameStarted = false;
        this.isAnimating = false;
        this.validMoves = [];
        this.diceRolls = 0;
        this.totalMoves = 0;
        this.consecutiveSixes = 0;
        this.selectedToken = null;

        // Update DOM: show setup, hide game container
        const gs = document.getElementById('gameSetup');
        const gc = document.getElementById('gameContainer');
        if (gc) gc.style.display = 'none';
        if (gs) gs.style.display = 'block';

        // Reset player cards to default labels/status
        const defaultNames = ['Red Player', 'Green Player', 'Yellow Player', 'Blue Player'];
        for (let i = 0; i < 4; i++) {
            const card = document.getElementById(`player${i}`);
            if (!card) continue;
            card.style.display = 'flex';
            const title = card.querySelector('.player-details h3');
            const status = card.querySelector('.player-status');
            if (title) title.textContent = defaultNames[i];
            if (status) status.textContent = 'Waiting...';
        }

        // Reset stats display
        const dr = document.getElementById('diceRolls'); if (dr) dr.textContent = '0';
        const tm = document.getElementById('totalMoves'); if (tm) tm.textContent = '0';

        // Redraw empty board
        try { this.drawBoard(); } catch (e) { /* ignore */ }
    }
    showRules() { document.getElementById('rulesModal').classList.add('show'); }
    toggleSfx() {
        this.sfxEnabled = !this.sfxEnabled;
        const btn = document.getElementById('sfxToggle');
        btn.textContent = this.sfxEnabled ? '🔊' : '🔇';
    }

    toggleVoice() {
        this.voiceEnabled = !this.voiceEnabled;
        const btn = document.getElementById('voiceToggle');
        btn.textContent = this.voiceEnabled ? '🗣️' : '😶';
        if (!this.voiceEnabled) window.speechSynthesis.cancel();
    }

    // Add this method inside the LudoGame class
    speak(text) {
        if (!this.voiceEnabled) return;

        // Stop any current speech so they don't overlap
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.1;  // Slightly faster than normal
        utterance.pitch = 1;
        utterance.volume = 1;

        // Optional: Try to find a good English voice
        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(v => v.lang.includes('en-GB')) || voices[0];
        if (preferredVoice) utterance.voice = preferredVoice;

        window.speechSynthesis.speak(utterance);
    }


    // Persistence methods: save/load/clear minimal game state to localStorage
    saveState() {
        try {
            const state = {
                players: this.players.map(p => ({
                    name: p.name,
                    color: p.color,
                    isAI: !!p.isAI,
                    tokens: p.tokens.map(t => ({ id: t.id, position: t.position, isFinished: !!t.isFinished, color: t.color }))
                })),
                currentPlayerIndex: this.currentPlayerIndex,
                diceValue: this.diceValue,
                diceRolls: this.diceRolls,
                totalMoves: this.totalMoves,
                consecutiveSixes: this.consecutiveSixes,
                gameStarted: !!this.gameStarted
            };
            localStorage.setItem('ludo_save_v1', JSON.stringify(state));
            console.info('LudoGame: state saved');
        } catch (e) {
            console.warn('LudoGame: failed to save state', e);
        }
    }

    loadSavedState() {
        try {
            const raw = localStorage.getItem('ludo_save_v1');
            if (!raw) return false;
            const s = JSON.parse(raw);
            if (!s || !s.players) return false;
            if (!confirm('A saved game was found. Restore it?')) return false;
            this.loadState(s);
            return true;
        } catch (e) {
            console.warn('LudoGame: failed to load saved state', e);
            return false;
        }
    }

    loadState(s) {
        try {
            this.players = (s.players || []).map(p => ({
                name: p.name || 'Player',
                color: p.color || 'red',
                isAI: !!p.isAI,
                tokens: (p.tokens || []).map(t => ({ id: t.id, position: t.position, isFinished: !!t.isFinished, color: t.color }))
            }));

            this.currentPlayerIndex = typeof s.currentPlayerIndex === 'number' ? s.currentPlayerIndex : 0;
            // Reset dice on load so players can roll after a refresh (avoid a stale non-zero dice blocking input)
            this.diceValue = 0;
            // Make sure no animation flag is left set from a previous session
            this.isAnimating = false;
            this.diceRolls = s.diceRolls || 0;
            this.totalMoves = s.totalMoves || 0;
            this.consecutiveSixes = s.consecutiveSixes || 0;
            this.gameStarted = !!s.gameStarted;

            const gs = document.getElementById('gameSetup');
            const gc = document.getElementById('gameContainer');
            if (gs) gs.style.display = 'none';
            if (gc) gc.style.display = 'grid';

            // Update player cards and hide any unused cards if fewer than 4 players
            for (let i = 0; i < 4; i++) {
                const card = document.getElementById(`player${i}`);
                if (!card) continue;
                if (i < this.players.length) {
                    const p = this.players[i];
                    card.style.display = 'flex';
                    const nameEl = card.querySelector('.player-details h3');
                    const statusEl = card.querySelector('.player-status');
                    if (nameEl) nameEl.textContent = p.name || `Player ${i + 1}`;
                    if (statusEl) statusEl.textContent = p.isAI ? 'CPU' : 'Human';
                } else {
                    // hide cards for players not participating
                    card.style.display = 'none';
                }
            }

            // If there's a player count selector, update it to the restored count
            try {
                const pc = document.getElementById('playerCount');
                if (pc) pc.value = String(this.players.length);
            } catch (e) { /* ignore */ }

            const dr = document.getElementById('diceRolls'); if (dr) dr.textContent = String(this.diceRolls);
            const tm = document.getElementById('totalMoves'); if (tm) tm.textContent = String(this.totalMoves);

            // Ensure dice visuals are in a neutral state
            try {
                const diceEl = document.getElementById('dice');
                if (diceEl) {
                    diceEl.classList.remove('swirling');
                    diceEl.style.transform = 'rotateX(0deg) rotateY(0deg)';
                }
            } catch (e) { /* ignore DOM issues */ }

            this.updateTurnIndicator();
            this.drawBoard();
        } catch (e) {
            console.warn('LudoGame: error applying saved state', e);
        }
    }

    clearSavedState() {
        try { localStorage.removeItem('ludo_save_v1'); console.info('LudoGame: saved state cleared'); } catch (e) { /* ignore */ }
    }


    // Simple confetti launcher — creates DOM pieces and animates them with CSS
    launchConfetti(count = 100) {
        const container = document.getElementById('confetti');
        if (!container) return;

        const colors = [this.colors.red, this.colors.green, this.colors.yellow, this.colors.blue, '#ff6b6b', '#ffd166', '#6bcB77', '#6b9cff'];
        const pieces = [];

        for (let i = 0; i < count; i++) {
            const el = document.createElement('div');
            el.className = 'confetti-piece';
            const w = 6 + Math.random() * 12;
            const h = 10 + Math.random() * 18;
            el.style.width = `${w}px`;
            el.style.height = `${h}px`;
            el.style.background = colors[Math.floor(Math.random() * colors.length)];
            el.style.left = `${Math.random() * 100}%`;
            el.style.top = `${-Math.random() * 10}%`;
            const duration = 3000 + Math.random() * 3000;
            const delay = Math.random() * 400;
            const rotation = Math.random() * 360;
            el.style.transform = `translateY(-10vh) rotate(${rotation}deg)`;
            el.style.opacity = '0.95';
            el.style.animation = `confetti-fall ${duration}ms cubic-bezier(.2,.7,.3,1) ${delay}ms forwards`;
            // remove the element when its animation finishes to avoid piling
            el.addEventListener('animationend', () => {
                try { el.remove(); } catch (e) { /* ignore */ }
            }, { once: true });

            container.appendChild(el);
            pieces.push(el);
        }

        // Remove pieces after animation finishes
        setTimeout(() => {
            pieces.forEach(p => p.remove());
        }, 8000);
    }

}

// Signature typing animation
// Signature typing animation (looping with backspace/delete effects)
function startSignatureAnimation() {
    const el = document.getElementById('signature');
    const caret = document.getElementById('signatureCaret');
    if (!el) return;

    // Phrases to cycle through; will type, pause, delete (partially or fully), and continue
    const phrases = [
        'Anup Yadav',
        'Anup Yadav — Ludo Dev'
    ];

    const typingSpeed = 110; // ms per character when typing
    const deletingSpeed = 60; // ms per character when deleting
    const pauseAfterType = 900; // ms pause after full type
    const pauseBetween = 350; // short pause between actions

    let pIndex = 0;

    if (caret) caret.style.visibility = 'visible';

    function typeText(text, onComplete) {
        let i = 0;
        el.textContent = '';
        const t = setInterval(() => {
            if (i < text.length) {
                el.textContent += text.charAt(i);
                i++;
            } else {
                clearInterval(t);
                onComplete && onComplete();
            }
        }, typingSpeed);
    }

    function deleteText(targetLength, onComplete) {
        let txt = el.textContent;
        const t = setInterval(() => {
            if (txt.length > targetLength) {
                txt = txt.slice(0, -1);
                el.textContent = txt;
            } else {
                clearInterval(t);
                onComplete && onComplete();
            }
        }, deletingSpeed);
    }

    function runCycle() {
        const phrase = phrases[pIndex];
        typeText(phrase, () => {
            setTimeout(() => {
                // Decide how much to delete: randomly delete partially or fully for natural effect
                const rand = Math.random();
                let deleteTo = 0;
                if (rand < 0.45) {
                    // delete to initials (e.g., "Anup Y.") if long enough
                    deleteTo = Math.min(phrase.length, Math.max(2, Math.floor(phrase.length / 3)));
                } else if (rand < 0.8) {
                    // delete half
                    deleteTo = Math.floor(phrase.length / 2);
                } else {
                    // delete fully
                    deleteTo = 0;
                }

                // But ensure we keep at least 1 character when using initials pattern
                if (phrase.includes(' ') && deleteTo > 0) {
                    // prefer to leave first name at least
                    deleteTo = Math.min(deleteTo, phrase.indexOf(' '));
                }

                deleteText(deleteTo, () => {
                    // small pause then move to next phrase
                    setTimeout(() => {
                        pIndex = (pIndex + 1) % phrases.length;
                        setTimeout(runCycle, pauseBetween);
                    }, pauseBetween);
                });
            }, pauseAfterType);
        });
    }

    runCycle();
}

window.addEventListener('DOMContentLoaded', () => {
    new LudoGame();
    try { startSignatureAnimation(); } catch (e) { /* ignore animation errors */ }
});