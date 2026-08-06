/**
 * GameVerse - Oyun Mantığı Modülü
 * Tüm masa oyunları için ortak ve özel oyun fonksiyonları
 * 
 * @version 1.0.0
 * @author GameVerse Team
 */

'use strict';

const GVGames = {
    version: '1.0.0',
    
    // Aktif oyun durumu
    currentGame: null,
    gameState: null,
    
    /**
     * Oyun motorunu başlatır
     */
    init(gameType) {
        console.log('Oyun başlatılıyor:', gameType);
        this.currentGame = gameType;
        this.loadGameState(gameType);
    },
    
    /**
     * Oyun durumunu yükler
     */
    loadGameState(gameType) {
        const saved = localStorage.getItem(`gv-game-${gameType}`);
        if (saved) {
            this.gameState = JSON.parse(saved);
        } else {
            this.gameState = this.getDefaultGameState(gameType);
        }
    },
    
    /**
     * Varsayılan oyun durumu
     */
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
    
    /**
     * Oyunu sıfırlar
     */
    resetGame() {
        if (this.currentGame) {
            this.gameState = this.getDefaultGameState(this.currentGame);
            this.saveGameState();
        }
    },
    
    /**
     * Oyun durumunu kaydeder
     */
    saveGameState() {
        if (this.currentGame && this.gameState) {
            localStorage.setItem(`gv-game-${this.currentGame}`, JSON.stringify(this.gameState));
        }
    },
    
    /**
     * Hamle yapar
     */
    makeMove(move) {
        if (!this.isValidMove(move)) {
            console.warn('Geçersiz hamle');
            return false;
        }
        
        this.gameState.history.push(move);
        this.gameState.currentPlayer = (this.gameState.currentPlayer + 1) % this.gameState.players.length;
        this.saveGameState();
        
        return true;
    },
    
    /**
     * Hamle geçerliliğini kontrol eder (alt sınıflar override eder)
     */
    isValidMove(move) {
        return true;
    },
    
    /**
     * Kazananı belirler
     */
    checkWinner() {
        // Alt sınıflar tarafından implement edilecek
        return null;
    },
    
    /**
     * Oyun bitti mi kontrolü
     */
    isGameOver() {
        return this.checkWinner() !== null;
    },
    
    /**
     * Puan günceller
     */
    updateScore(playerId, points) {
        if (!this.gameState.score[playerId]) {
            this.gameState.score[playerId] = 0;
        }
        this.gameState.score[playerId] += points;
        this.saveGameState();
    },
    
    // ==================== OYUN ÖZEL FONKSİYONLARI ====================
    
    /**
     * Okey oyunu için özel fonksiyonlar
     */
    okey: {
        init() {
            console.log('Okey oyunu başlatıldı');
            this.setupBoard();
        },
        
        setupBoard() {
            // Okey tahtası kurulumu
            const tiles = this.generateTiles();
            const shuffled = this.shuffleTiles(tiles);
            return shuffled;
        },
        
        generateTiles() {
            const colors = ['red', 'black', 'blue', 'yellow'];
            const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
            const tiles = [];
            
            colors.forEach(color => {
                numbers.forEach(num => {
                    tiles.push({ color, number: num });
                    tiles.push({ color, number: num });
                });
            });
            
            // 2 adet joker
            tiles.push({ color: 'joker', number: 0 });
            tiles.push({ color: 'joker', number: 0 });
            
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
    
    /**
     * Tavla oyunu için özel fonksiyonlar
     */
    tavla: {
        init() {
            console.log('Tavla oyunu başlatıldı');
            this.setupBoard();
        },
        
        setupBoard() {
            // 24 nokta, her oyuncu için 15 pul
            const board = Array(24).fill(null).map(() => ({ player: null, count: 0 }));
            
            // Başlangıç pozisyonu
            const positions = [
                { point: 0, player: 1, count: 2 },
                { point: 5, player: 0, count: 5 },
                { point: 7, player: 0, count: 3 },
                { point: 11, player: 1, count: 5 },
                { point: 12, player: 0, count: 5 },
                { point: 16, player: 1, count: 3 },
                { point: 18, player: 1, count: 5 },
                { point: 23, player: 0, count: 2 }
            ];
            
            positions.forEach(pos => {
                board[pos.point] = { player: pos.player, count: pos.count };
            });
            
            return board;
        },
        
        rollDice() {
            const die1 = Math.floor(Math.random() * 6) + 1;
            const die2 = Math.floor(Math.random() * 6) + 1;
            return [die1, die2];
        }
    },
    
    /**
     * Satranç oyunu için özel fonksiyonlar
     */
    chess: {
        init() {
            console.log('Satranç oyunu başlatıldı');
            this.setupBoard();
        },
        
        setupBoard() {
            // 8x8 satranç tahtası
            const board = Array(8).fill(null).map(() => Array(8).fill(null));
            
            // Piyonlar
            for (let i = 0; i < 8; i++) {
                board[1][i] = { type: 'pawn', color: 'black' };
                board[6][i] = { type: 'pawn', color: 'white' };
            }
            
            // Diğer taşlar
            const pieces = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
            pieces.forEach((type, i) => {
                board[0][i] = { type, color: 'black' };
                board[7][i] = { type, color: 'white' };
            });
            
            return board;
        },
        
        isValidMove(board, from, to, piece) {
            // Satranç hareket kuralları
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            
            switch (piece.type) {
                case 'pawn':
                    return this.validatePawnMove(dx, dy, piece.color);
                case 'rook':
                    return dx === 0 || dy === 0;
                case 'bishop':
                    return Math.abs(dx) === Math.abs(dy);
                case 'queen':
                    return dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
                case 'knight':
                    return (Math.abs(dx) === 2 && Math.abs(dy) === 1) || 
                           (Math.abs(dx) === 1 && Math.abs(dy) === 2);
                case 'king':
                    return Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
                default:
                    return false;
            }
        },
        
        validatePawnMove(dx, dy, color) {
            const direction = color === 'white' ? -1 : 1;
            return dx === 0 && dy === direction;
        }
    },
    
    /**
     * Dama oyunu için özel fonksiyonlar
     */
    dama: {
        init() {
            console.log('Dama oyunu başlatıldı');
            this.setupBoard();
        },
        
        setupBoard() {
            // 8x8 dama tahtası
            const board = Array(8).fill(null).map(() => Array(8).fill(null));
            
            // Taşları yerleştir (sadece siyah karelerde)
            for (let row = 0; row < 8; row++) {
                for (let col = 0; col < 8; col++) {
                    if ((row + col) % 2 === 1) {
                        if (row < 3) board[row][col] = { color: 'black', isKing: false };
                        else if (row > 4) board[row][col] = { color: 'white', isKing: false };
                    }
                }
            }
            
            return board;
        }
    },
    
    /**
     * Pisti oyunu için özel fonksiyonlar
     */
    pisti: {
        init() {
            console.log('Pisti oyunu başlatıldı');
            this.deck = this.createDeck();
        },
        
        createDeck() {
            const suits = ['♠', '♥', '♦', '♣'];
            const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
            const deck = [];
            
            suits.forEach(suit => {
                values.forEach(value => {
                    deck.push({ suit, value });
                });
            });
            
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
            players.forEach(player => {
                hands[player] = this.deck.splice(0, 5);
            });
            return hands;
        }
    }
};

// Global erişim için export
window.GVGames = GVGames;
