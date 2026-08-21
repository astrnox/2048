function GameManager(size, InputManager, Actuator, StorageManager) {
  this.size           = size; // Size of the grid
  this.inputManager   = new InputManager;
  this.storageManager = new StorageManager;
  this.actuator       = new Actuator;

  this.startTiles     = 2;

  // Game mode: "classic" | "time" | "endless" | "daily"
  this.mode           = "classic";
  this.timeLimit      = 60; // seconds, used in time mode
  this.timeLeft       = this.timeLimit;

  // 2048+ 增强：可复现随机(每日)、连击、悔棋、步数
  this.rng            = Math.random;   // 默认随机；每日模式替换为按日期播种
  this.combo          = 0;             // 当前一步内的连击数
  this.comboBonus     = 0;             // 连击额外加分
  this.undoStack      = null;          // 单步悔棋快照
  this.moves          = 0;             // 已走步数

  this.inputManager.on("move", this.move.bind(this));
  this.inputManager.on("restart", this.restart.bind(this));
  this.inputManager.on("keepPlaying", this.keepPlaying.bind(this));
  this.inputManager.on("undo", this.undo.bind(this));

  this.setup();
}

// Restart the game
GameManager.prototype.restart = function () {
  this.startNewGame(this.mode);
};

// Switch the active game mode and begin a fresh game
GameManager.prototype.setMode = function (mode) {
  this.startNewGame(mode);
};

// Reset the board, keeping (or adopting) the given mode
GameManager.prototype.startNewGame = function (mode) {
  this.stopTimer();

  if (mode) {
    this.mode = mode;
    this.actuator.setMode(mode); // Sync the UI (buttons / body class)
  }

  this.timeLeft = this.timeLimit;

  // 2048+：重置增强状态；每日模式用当天日期播种，保证全天同一盘、运数相同
  this.moves      = 0;
  this.combo      = 0;
  this.comboBonus = 0;
  this.undoStack  = null;
  this.rng = (this.mode === "daily") ? this.mulberry32(this.todaySeed()) : Math.random;

  this.storageManager.clearGameState();
  this.actuator.continueGame(); // Clear the game won/lost message
  this.actuator.updateTimer(this.timeLeft);
  this.actuator.updateModeExtras(this.mode);

  this.setup();

  if (this.mode === "time") {
    this.startTimer();
  }
};

// Kick off the countdown used by the time mode
GameManager.prototype.startTimer = function () {
  var self = this;

  this.stopTimer();
  this.timer = window.setInterval(function () {
    self.timeLeft--;

    if (self.timeLeft <= 0) {
      self.timeLeft = 0;
      self.stopTimer();
      self.over = true; // Time's up!
      self.actuate();
    } else {
      self.actuator.updateTimer(self.timeLeft);
    }
  }, 1000);
};

GameManager.prototype.stopTimer = function () {
  if (this.timer) {
    window.clearInterval(this.timer);
    this.timer = null;
  }
};

// Keep playing after winning (allows going over 2048)
GameManager.prototype.keepPlaying = function () {
  this.keepPlaying = true;
  this.actuator.continueGame(); // Clear the game won/lost message
};

// Return true if the game is lost, or has won and the user hasn't kept playing
GameManager.prototype.isGameTerminated = function () {
  return this.over || (this.won && !this.keepPlaying);
};

// Set up the game
GameManager.prototype.setup = function () {
  var previousState = this.storageManager.getGameState();

  // Reload the game from a previous game if present
  if (previousState) {
    this.grid        = new Grid(previousState.grid.size,
                                previousState.grid.cells); // Reload grid
    this.score       = previousState.score;
    this.over        = previousState.over;
    this.won         = previousState.won;
    this.keepPlaying = previousState.keepPlaying;
  } else {
    this.grid        = new Grid(this.size);
    this.score       = 0;
    this.over        = false;
    this.won         = false;
    this.keepPlaying = false;

    // Add the initial tiles
    this.addStartTiles();
  }

  // Update the actuator
  this.actuate();
};

// Set up the initial tiles to start the game with
GameManager.prototype.addStartTiles = function () {
  for (var i = 0; i < this.startTiles; i++) {
    this.addRandomTile();
  }
};

// Adds a tile in a position chosen by the active difficulty (scientifically: value distribution)
GameManager.prototype.addRandomTile = function () {
  if (!this.grid.cellsAvailable()) return;

  var cell, value;
  // 每日模式要求可复现：绕过难度(assist)，走后端可复现随机
  if (this.mode !== "daily" && window.Assist) {
    value = window.Assist.spawnValue(window.Assist.get());
    cell = { x: Math.floor(this.rng() * this.size), y: Math.floor(this.rng() * this.size) };
    if (!this.grid.cellAvailable(cell)) cell = this.pickSpawnCell();
  }
  if (!cell) {
    value = this.pickSpawnValue();
    cell = this.pickSpawnCell();
  }

  var tile = new Tile(cell, value);
  this.grid.insertTile(tile);
};

// 可复现落子值：用 this.rng（每日模式=按日期播种）替代 Math.random
GameManager.prototype.pickSpawnValue = function () {
  return this.rng() < 0.9 ? 2 : 4;
};

// 可复现落子格：基于空位列表 + this.rng
GameManager.prototype.pickSpawnCell = function () {
  var cells = this.grid.availableCells();
  if (!cells.length) return null;
  return cells[Math.floor(this.rng() * cells.length)];
};

// 导出当前棋盘数值矩阵，供援助打分用（0 表示空格）
GameManager.prototype.gridToBoard = function () {
  var b = [];
  for (var y = 0; y < this.size; y++) {
    var row = [];
    for (var x = 0; x < this.size; x++) {
      var t = this.grid.cellContent({ x: x, y: y });
      row.push(t ? t.value : 0);
    }
    b.push(row);
  }
  return b;
};

// Sends the updated grid to the actuator
GameManager.prototype.actuate = function () {
  if (this.storageManager.getBestScore() < this.score) {
    this.storageManager.setBestScore(this.score);
  }

  // Clear the state when the game is over (game over only, not win)
  if (this.over) {
    this.storageManager.clearGameState();
  } else {
    this.storageManager.setGameState(this.serialize());
  }

  this.actuator.actuate(this.grid, {
    score:      this.score,
    over:       this.over,
    won:        this.won,
    bestScore:  this.storageManager.getBestScore(),
    terminated: this.isGameTerminated(),
    mode:       this.mode,
    // 2048+ 增强数据
    combo:       this.combo,
    comboBonus:  this.comboBonus,
    canUndo:     !!this.undoStack,
    moves:       this.moves,
    dailyBest:   (this.mode === "daily") ? this.recordDaily() : 0
  });

};

// Represent the current game as an object
GameManager.prototype.serialize = function () {
  return {
    grid:        this.grid.serialize(),
    score:       this.score,
    over:        this.over,
    won:         this.won,
    keepPlaying: this.keepPlaying
  };
};

// ============ 2048+ 增强：悔棋 / 每日可复现 ============

// 悔棋快照：记录序列化局面 + 当步连击
GameManager.prototype.snapshot = function () {
  return {
    state:       this.serialize(),
    combo:       this.combo,
    comboBonus:  this.comboBonus
  };
};

// 一步悔棋：恢复到本步开始前
GameManager.prototype.undo = function () {
  if (this.isGameTerminated()) return;
  if (!this.undoStack) return;

  var s  = this.undoStack;
  var st = s.state;
  this.undoStack  = null;
  this.grid       = new Grid(st.grid.size, st.grid.cells);
  this.score      = st.score;
  this.over       = false;
  this.won        = st.won;
  this.keepPlaying = false;
  this.combo      = 0;
  this.comboBonus = 0;

  this.actuate();
};

// mulberry32：确定性 PRNG（每日模式用它替代 Math.random）
GameManager.prototype.mulberry32 = function (a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
};

// 当天日期整数种子（如 20260821）
GameManager.prototype.todaySeed = function () {
  var d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
};

// 每日纪录 localStorage 键（按日期区分）
GameManager.prototype.dailyKey = function () {
  var d = new Date();
  return "2048-daily-" + d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
};

// 读取今日最佳；非每日模式返回 0
GameManager.prototype.todayBest = function () {
  if (this.mode !== "daily") return 0;
  var v = window.localStorage.getItem(this.dailyKey());
  return v ? parseInt(v, 10) : 0;
};

// 尝试写入今日最佳，返回当前最高分
GameManager.prototype.recordDaily = function () {
  var key = this.dailyKey();
  var best = this.todayBest();
  if (this.score > best) {
    window.localStorage.setItem(key, this.score);
    best = this.score;
  }
  return best;
};

// Save all tile positions and remove merger info
GameManager.prototype.prepareTiles = function () {
  this.grid.eachCell(function (x, y, tile) {
    if (tile) {
      tile.mergedFrom = null;
      tile.savePosition();
    }
  });
};

// Move a tile and its representation
GameManager.prototype.moveTile = function (tile, cell) {
  this.grid.cells[tile.x][tile.y] = null;
  this.grid.cells[cell.x][cell.y] = tile;
  tile.updatePosition(cell);
};

// Move tiles on the grid in the specified direction
GameManager.prototype.move = function (direction) {
  // 0: up, 1: right, 2: down, 3: left
  var self = this;

  if (this.isGameTerminated()) return; // Don't do anything if the game's over

  // 2048+：记录本步开始状态（用于悔棋），并重置当步连击
  var preMove = this.snapshot();
  this.combo = 0;
  this.comboBonus = 0;

  var cell, tile;

  var vector     = this.getVector(direction);
  var traversals = this.buildTraversals(vector);
  var moved      = false;

  // Save the current tile positions and remove merger information
  this.prepareTiles();

  // Traverse the grid in the right direction and move tiles
  traversals.x.forEach(function (x) {
    traversals.y.forEach(function (y) {
      cell = { x: x, y: y };
      tile = self.grid.cellContent(cell);

      if (tile) {
        var positions = self.findFarthestPosition(cell, vector);
        var next      = self.grid.cellContent(positions.next);

        // Only one merger per row traversal?
        if (next && next.value === tile.value && !next.mergedFrom) {
          var merged = new Tile(positions.next, tile.value * 2);
          merged.mergedFrom = [tile, next];

          self.grid.insertTile(merged);
          self.grid.removeTile(tile);

          // Converge the two tiles' positions
          tile.updatePosition(positions.next);

          // 2048+：连击 —— 一步内多次合并叠加倍率，额外加分
          self.combo++;
          self.score += merged.value;
          if (window.Sound && window.Sound.merge) window.Sound.merge(); // 合体果冻声
          if (self.combo > 1) {
            self.comboBonus += merged.value;
          }

          // Win classic & daily when reaching 2048; time & endless play on
          if (merged.value === 2048 && (this.mode === "classic" || this.mode === "daily")) self.won = true;
        } else {
          self.moveTile(tile, positions.farthest);
        }

        if (!self.positionsEqual(cell, tile)) {
          moved = true; // The tile moved from its original cell!
        }
      }
    });
  });

  if (moved) {
    // 2048+：保留悔棋快照、累计连击加分与步数
    this.undoStack  = preMove;
    this.moves++;
    if (this.comboBonus > 0) this.score += this.comboBonus;
    if (window.Sound && window.Sound.move) window.Sound.move(); // 滑动解压声（合并另有 啵）

    this.addRandomTile();

    if (!this.movesAvailable()) {
      this.over = true; // Game over!
    }

    this.actuate();
  } else {
    this.combo = 0;
    this.comboBonus = 0;
  }
};

// Get the vector representing the chosen direction
GameManager.prototype.getVector = function (direction) {
  // Vectors representing tile movement
  var map = {
    0: { x: 0,  y: -1 }, // Up
    1: { x: 1,  y: 0 },  // Right
    2: { x: 0,  y: 1 },  // Down
    3: { x: -1, y: 0 }   // Left
  };

  return map[direction];
};

// Build a list of positions to traverse in the right order
GameManager.prototype.buildTraversals = function (vector) {
  var traversals = { x: [], y: [] };

  for (var pos = 0; pos < this.size; pos++) {
    traversals.x.push(pos);
    traversals.y.push(pos);
  }

  // Always traverse from the farthest cell in the chosen direction
  if (vector.x === 1) traversals.x = traversals.x.reverse();
  if (vector.y === 1) traversals.y = traversals.y.reverse();

  return traversals;
};

GameManager.prototype.findFarthestPosition = function (cell, vector) {
  var previous;

  // Progress towards the vector direction until an obstacle is found
  do {
    previous = cell;
    cell     = { x: previous.x + vector.x, y: previous.y + vector.y };
  } while (this.grid.withinBounds(cell) &&
           this.grid.cellAvailable(cell));

  return {
    farthest: previous,
    next: cell // Used to check if a merge is required
  };
};

GameManager.prototype.movesAvailable = function () {
  return this.grid.cellsAvailable() || this.tileMatchesAvailable();
};

// Check for available matches between tiles (more expensive check)
GameManager.prototype.tileMatchesAvailable = function () {
  var self = this;

  var tile;

  for (var x = 0; x < this.size; x++) {
    for (var y = 0; y < this.size; y++) {
      tile = this.grid.cellContent({ x: x, y: y });

      if (tile) {
        for (var direction = 0; direction < 4; direction++) {
          var vector = self.getVector(direction);
          var cell   = { x: x + vector.x, y: y + vector.y };

          var other  = self.grid.cellContent(cell);

          if (other && other.value === tile.value) {
            return true; // These two tiles can be merged
          }
        }
      }
    }
  }

  return false;
};

GameManager.prototype.positionsEqual = function (first, second) {
  return first.x === second.x && first.y === second.y;
};
