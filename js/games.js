/**
 * GameVerse - Oyun Mantığı Modülü
 * Tüm masa oyunları için ortak ve özel oyun fonksiyonları
 *
 * @version 1.1.0
 * @author GameVerse Team
 */

'use strict';

const GVGames = {
    version: '1.1.0',
    currentGame: null,
    gameState: null,

    init(gameType) {
        console.log('Oyun başlatılıyor:', gameType);
        this.currentGame = gameType;
        this.loadGameState(gameType);
        this.initRealtime();
    },

    loadGameState(gameType) {
        const saved = localStorage.getItem(`gv-game-${gameType}`);
        if (saved) {
            try { this.gameState = JSON.parse(saved); }
            catch (e) { this.gameState = this.getDefaultGameState(gameType); }
        } else {
            this.gameState = this.getDefaultGameState(gameType);
        }
    },

    getDefaultGameState(gameType) {
        return {
            type: gameType,
            players: [],
            currentPlayer: 0,
            board: null,
            score: {},
            history: [],
            status: 'waiting'
        };
    },

    resetGame() {
        if (this.currentGame) {
            this.gameState = this.getDefaultGameState(this.currentGame);
            this.saveGameState();
        }
    },

    saveGameState() {
        if (this.currentGame && this.gameState) {
            localStorage.setItem(`gv-game-${this.currentGame}`, JSON.stringify(this.gameState));
        }
    },

    makeMove(move) {
        if (!this.isValidMove(move)) {
            console.warn('Geçersiz hamle');
            return false;
        }

        this.gameState.history.push(move);
        if (this.gameState.players && this.gameState.players.length > 0) {
            this.gameState.currentPlayer = (this.gameState.currentPlayer + 1) % this.gameState.players.length;
        } else {
            this.gameState.currentPlayer = this.gameState.currentPlayer === 0 ? 1 : 0;
        }
        this.saveGameState();
        this.emitRealtimeMove(move);
        return true;
    },

    isValidMove(move) { return true; },
    checkWinner() { return null; },
    isGameOver() { return this.checkWinner() !== null; },

    updateScore(playerId, points) {
        if (!this.gameState.score[playerId]) this.gameState.score[playerId] = 0;
        this.gameState.score[playerId] += points;
        this.saveGameState();
    },

    okey: {
        init() { console.log('Okey oyunu başlatıldı'); this.setupBoard(); },
        setupBoard() { return this.shuffleTiles(this.generateTiles()); },
        generateTiles() {
            const colors = ['red', 'black', 'blue', 'yellow'];
            const numbers = [1,2,3,4,5,6,7,8,9,10,11,12,13];
            const tiles = [];
            colors.forEach(color => numbers.forEach(number => {
                tiles.push({ color, number });
                tiles.push({ color, number });
            }));
            tiles.push({ color: 'joker', number: 0 }, { color: 'joker', number: 0 });
            return tiles;
        },
        shuffleTiles(tiles) {
            for (let i = tiles.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
            }
            return tiles;
        },
        distributeTiles(players) {
            const allTiles = this.setupBoard();
            const hands = {};
            players.forEach((player, index) => {
                hands[player] = allTiles.slice(index * 14, (index + 1) * 14);
            });
            return hands;
        }
    },

    tavla: {
        init() { console.log('Tavla oyunu başlatıldı'); this.setupBoard(); },
        setupBoard() {
            const board = Array(24).fill(null).map(() => ({ player: null, count: 0 }));
            const positions = [
                { point: 0, player: 1, count: 2 }, { point: 5, player: 0, count: 5 },
                { point: 7, player: 0, count: 3 }, { point: 11, player: 1, count: 5 },
                { point: 12, player: 0, count: 5 }, { point: 16, player: 1, count: 3 },
                { point: 18, player: 1, count: 5 }, { point: 23, player: 0, count: 2 }
            ];
            positions.forEach(pos => { board[pos.point] = { player: pos.player, count: pos.count }; });
            return board;
        },
        rollDice() { return [1,2].map(() => Math.floor(Math.random() * 6) + 1); }
    },

    chess: {
        init() { console.log('Satranç oyunu başlatıldı'); this.setupBoard(); },
        setupBoard() {
            const board = Array(8).fill(null).map(() => Array(8).fill(null));
            for (let i = 0; i < 8; i++) {
                board[1][i] = { type: 'pawn', color: 'black' };
                board[6][i] = { type: 'pawn', color: 'white' };
            }
            const pieces = ['rook','knight','bishop','queen','king','bishop','knight','rook'];
            pieces.forEach((type, i) => {
                board[0][i] = { type, color: 'black' };
                board[7][i] = { type, color: 'white' };
            });
            return board;
        },
        isValidMove(board, from, to, piece) {
            const dx = to.x - from.x, dy = to.y - from.y;
            switch (piece.type) {
                case 'pawn': return this.validatePawnMove(dx, dy, piece.color);
                case 'rook': return dx === 0 || dy === 0;
                case 'bishop': return Math.abs(dx) === Math.abs(dy);
                case 'queen': return dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
                case 'knight': return (Math.abs(dx) === 2 && Math.abs(dy) === 1) || (Math.abs(dx) === 1 && Math.abs(dy) === 2);
                case 'king': return Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
                default: return false;
            }
        },
        validatePawnMove(dx, dy, color) { return dx === 0 && dy === (color === 'white' ? -1 : 1); }
    },

    dama: {
        init() { console.log('Dama oyunu başlatıldı'); this.setupBoard(); },
        setupBoard() {
            const board = Array(8).fill(null).map(() => Array(8).fill(null));
            for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
                if ((row + col) % 2 === 1) {
                    if (row < 3) board[row][col] = { color: 'black', isKing: false };
                    else if (row > 4) board[row][col] = { color: 'white', isKing: false };
                }
            }
            return board;
        }
    },

    pisti: {
        init() { console.log('Pisti oyunu başlatıldı'); this.deck = this.createDeck(); },
        createDeck() {
            const suits = ['♠','♥','♦','♣'];
            const values = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
            const deck = [];
            suits.forEach(suit => values.forEach(value => deck.push({ suit, value })));
            return this.shuffle(deck);
        },
        shuffle(deck) {
            for (let i = deck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [deck[i], deck[j]] = [deck[j], deck[i]];
            }
            return deck;
        },
        dealCards(players) {
            const hands = {};
            players.forEach(player => { hands[player] = this.deck.splice(0, 5); });
            return hands;
        }
    },

    // ==================== SOCKET.IO GERÇEK ZAMANLI SENKRONİZASYON ====================
    socket: null,
    realtimeReady: false,
    roomId: null,
    playerId: null,

    getRoomId() {
        return this.roomId ||
            window.currentRoomId ||
            window.roomId ||
            localStorage.getItem('gv-room-id') ||
            new URLSearchParams(location.search).get('roomId') ||
            new URLSearchParams(location.search).get('room');
    },

    initRealtime() {
        if (this.realtimeReady) return;
        this.roomId = this.getRoomId();
        if (!this.roomId) {
            console.warn('[Realtime] Oda ID bulunamadı; Socket.IO bağlantısı beklemeye alındı.');
            return;
        }

        const connect = () => {
            if (!window.io) {
                console.error('[Realtime] Socket.IO client yüklenemedi.');
                return;
            }
            if (this.socket) return;

            this.socket = window.io({ transports: ['websocket', 'polling'] });
            this.playerId = this.socket.id;
            this.realtimeReady = true;

            this.socket.on('connect', () => {
                this.playerId = this.socket.id;
                console.log('[Realtime] Bağlandı:', this.playerId);
                this.joinCurrentRoom();
            });

            this.socket.on('moveMade', payload => this.applyRemoteMove(payload));
            this.socket.on('receiveGameMove', move => this.applyRemoteMove({ moveData: move }));
            this.socket.on('gameStateUpdated', payload => this.applyRemoteState(payload));
        };

        if (window.io) connect();
        else {
            const script = document.createElement('script');
            script.src = '/socket.io/socket.io.js';
            script.onload = connect;
            script.onerror = () => console.error('[Realtime] Socket.IO client script yüklenemedi.');
            document.head.appendChild(script);
        }
    },

    joinCurrentRoom() {
        if (!this.socket || !this.roomId) return;
        const user = this.getCurrentUser();
        this.socket.emit('joinRoom', {
            roomId: this.roomId,
            userName: user?.name || user?.username || localStorage.getItem('gv-user-name') || 'Oyuncu',
            maxPlayers: 2,
            gameId: this.currentGame || 'chess'
        });
    },

    getCurrentUser() {
        try {
            const raw = localStorage.getItem('gv-user') || localStorage.getItem('user');
            return raw ? JSON.parse(raw) : null;
        } catch (_) { return null; }
    },

    emitRealtimeMove(move) {
        if (!this.socket || !this.roomId) return;
        this.socket.emit('makeMove', {
            roomId: this.roomId,
            gameId: this.currentGame || 'chess',
            moveData: move
        });
    },

    applyRemoteState(payload) {
        if (!payload || !payload.gameState) return;
        this.gameState = payload.gameState;
        this.saveGameState();
        if (payload.lastMove) this.dispatchRemoteMove(payload.lastMove.moveData || payload.lastMove);
        this.dispatchGameStateUpdate(payload.gameState);
    },

    applyRemoteMove(payload) {
        const move = payload && payload.moveData !== undefined ? payload.moveData : payload;
        if (move == null) return;

        // Sunucudan gelen hamleyi tekrar emit etme; sadece local state'i güncelle.
        if (!this.gameState) this.loadGameState(this.currentGame || 'chess');
        const serialized = (() => { try { return JSON.stringify(move); } catch (_) { return String(move); } })();
        const duplicate = (this.gameState.history || []).some(existing => {
            try { return JSON.stringify(existing) === serialized; } catch (_) { return false; }
        });
        if (!duplicate) {
            this.gameState.history = this.gameState.history || [];
            this.gameState.history.push(move);
            this.gameState.currentPlayer = this.gameState.currentPlayer === 0 ? 1 : 0;
            this.gameState.status = 'playing';
            this.saveGameState();
        }

        this.dispatchRemoteMove(move);
    },

    dispatchRemoteMove(move) {
        // Oyun ekranlarının bağlanabileceği standart event.
        window.dispatchEvent(new CustomEvent('gv:remoteMove', { detail: move }));

        // Var olan uygulamalarda kullanılan olası callback'leri de destekle.
        ['onRemoteMove', 'handleRemoteMove', 'applyRemoteMove', 'receiveRemoteMove'].forEach(name => {
            if (typeof window[name] === 'function' && window[name] !== this.applyRemoteMove) {
                try { window[name](move); } catch (error) { console.error(`[Realtime] ${name} hatası:`, error); }
            }
        });
    },

    dispatchGameStateUpdate(state) {
        window.dispatchEvent(new CustomEvent('gv:gameStateUpdated', { detail: state }));
        if (typeof window.onRemoteGameState === 'function') {
            try { window.onRemoteGameState(state); } catch (error) { console.error('[Realtime] onRemoteGameState hatası:', error); }
        }
    }
};

// Global erişim için export
window.GVGames = GVGames;

// Oyun başlatma daha sonra gerçekleşiyorsa realtime bağlantısını da kur.
window.addEventListener('gv:roomReady', event => {
    if (event.detail?.roomId) {
        GVGames.roomId = event.detail.roomId;
        localStorage.setItem('gv-room-id', event.detail.roomId);
        GVGames.initRealtime();
        if (GVGames.socket?.connected) GVGames.joinCurrentRoom();
    }
});

window.addEventListener('gv:makeMove', event => {
    if (event.detail !== undefined) GVGames.makeMove(event.detail);
});
