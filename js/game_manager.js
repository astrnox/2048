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

  // 经典变体：限步挑战 / 障碍格
  this.stepsLimit     = 60;            // 限步模式可用步数
  this.stepsLeft      = this.stepsLimit;
  this.blockCount     = 3;             // 障碍模式障碍格数量

  // 经典变体 v2：旋 / 熔 / 盲 / 裂 / 炸
  this.lavaMoves      = 0;             // 熔岩模式：岩浆上升的累计步数
  this.fissionChance  = 0.30;          // 裂变模式：单块分裂概率
  this.fuseLife       = 8;             // 炸弹模式：瓦片基础寿命（步）

  // 本次操作是否真实移动（true=需要重绘棋盘；false=无效滑动不刷新界面）
  this._lastMoved = true;

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
  this.stepsLeft = this.stepsLimit;
  this.lavaMoves = 0;

  // 2048+：重置增强状态；每日模式用当天日期播种，保证全天同一盘、运数相同
  this.moves      = 0;
  this.combo      = 0;
  this.comboBonus = 0;
  this.undoStack  = null;
  this.lastSpawn  = null;
  this.lastSpawnTile = null;
  this.lastExplosions = null;
  this._lastMoved = true; // 开局/重开总是全量绘制
  this.rng = (this.mode === "daily") ? this.mulberry32(this.todaySeed()) : Math.random;

  this.storageManager.clearGameState();
  this.actuator.continueGame(); // Clear the game won/lost message
  this.actuator.updateTimer(this.timeLeft);
  this.actuator.updateSteps(this.stepsLeft);
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
                                previousState.grid.cells,
                                previousState.grid.blocked); // Reload grid
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

    // 障碍模式：开局布置固定数量的障碍格
    if (this.mode === "block") {
      this.grid.addBlockedCells(this.blockCount, this.rng);
    }

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
  value = this.pickSpawnValue();
  cell = this.pickSpawnCell();
  if (!cell) return;

  var tile = new Tile(cell, value, this.fuseLife);
  this.grid.insertTile(tile);
  // 炸弹模式：记录本轮出生瓦片引用，避免立即倒计时
  this.lastSpawnTile = tile;
  this.lastSpawn = cell;
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
    stepsLeft:   this.stepsLeft,
    moved:       this._lastMoved,
    fuseLife:    this.fuseLife,
    lastExplosions: this.lastExplosions,
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
    comboBonus:  this.comboBonus,
    stepsLeft:   this.stepsLeft,
    lavaMoves:   this.lavaMoves
  };
};

// 一步悔棋：恢复到本步开始前
GameManager.prototype.undo = function () {
  if (this.isGameTerminated()) return;
  if (!this.undoStack) return;

  var s  = this.undoStack;
  var st = s.state;
  this.undoStack  = null;
  this.grid       = new Grid(st.grid.size, st.grid.cells, st.grid.blocked);
  this.score      = st.score;
  this.over       = false;
  this.won        = st.won;
  this.keepPlaying = false;
  this.combo      = 0;
  this.comboBonus = 0;
  this.stepsLeft  = (s.stepsLeft !== undefined) ? s.stepsLeft : this.stepsLeft;
  this.lavaMoves  = (s.lavaMoves !== undefined) ? s.lavaMoves : this.lavaMoves;
  this.actuator.updateSteps(this.stepsLeft);

  // 炸弹模式：撤销后所有瓦片寿命已随 serialize 恢复，无需额外处理
  this.lastSpawn = null;
  this.lastSpawnTile = null;
  this.lastExplosions = null;
  this._lastMoved = true; // 悔棋后棋盘已变，必须重绘

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
  this.lastExplosions = null;

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
          var merged = new Tile(positions.next, tile.value * 2, self.fuseLife);
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

          // Win classic, daily & new variant modes when reaching 2048; time & endless play on
          if (merged.value === 2048 &&
              (self.mode === "classic" || self.mode === "daily" ||
               self.mode === "steps" || self.mode === "block" ||
               self.mode === "spin" || self.mode === "lava" ||
               self.mode === "blind" || self.mode === "fission" ||
               self.mode === "fuse")) self.won = true;
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

    // 限步模式：每步扣一，用完即止
    if (this.mode === "steps") {
      this.stepsLeft = Math.max(0, this.stepsLeft - 1);
      this.actuator.updateSteps(this.stepsLeft);
    }

    if (this.comboBonus > 0) this.score += this.comboBonus;
    if (window.Sound && window.Sound.move) window.Sound.move(); // 滑动解压声（合并另有 啵）

    this.addRandomTile();

    // 变体副作用：旋转 / 裂变 / 熔岩 / 炸弹
    if (this.mode === "spin") this.rotateBoard();
    if (this.mode === "fission") this.maybeFission();
    if (this.mode === "lava") this.riseLava();
    if (this.mode === "fuse") this.tickFuses();
  } else {
    this.combo = 0;
    this.comboBonus = 0;
  }

  // 记录本次是否有真实移动：无效滑动时跳过棋盘重绘，避免界面闪烁刷新
  this._lastMoved = moved;

  // 统一收尾判定（无效果的一步也检查死局，障碍格可能造成"空位但无路可走"）
  if (this.mode === "n128" && this.maxTile() >= 128) {
    this.over = true; this.won = false;      // 造出 128 → 出局
  } else if (this.mode === "anti") {
    if (!this.movesAvailable()) { this.over = true; this.won = true; } // 填满 → 胜利
    else if (this.maxTile() >= 2048) { this.over = true; this.won = true; } // 也算达成
  } else if (this.mode === "steps" && this.stepsLeft <= 0) {
    this.over = true;                        // 步数用尽 → 结算
  } else if (!this.movesAvailable()) {
    this.over = true; // Game over!
  }

  this.actuate();
};

// 当前棋盘最大瓦片值
GameManager.prototype.maxTile = function () {
  var m = 0;
  this.grid.eachCell(function (x, y, t) { if (t && t.value > m) m = t.value; });
  return m;
};

// ============ 经典变体 v2：旋 / 裂 / 熔 / 炸 的副作用 ============

// 旋：整个棋盘顺时针旋转 90°（连同瓦片）
GameManager.prototype.rotateBoard = function () {
  var n = this.size;
  var cells = this.grid.cells;
  var out = [];
  for (var x = 0; x < n; x++) out[x] = [];

  // 数据棋盘可用，直接旋转 cell 数组（Tile 的 x/y 一并更新）
  for (var px = 0; px < n; px++) {
    for (var py = 0; py < n; py++) {
      var t = cells[px][py];
      // 顺时针：新(x,y) = 旧(y, n-1-x)
      var nx = py, ny = n - 1 - px;
      if (t) {
        out[nx][ny] = t;
        t.updatePosition({ x: nx, y: ny });
      } else {
        out[nx][ny] = null;
      }
    }
  }
  // 障碍格（熔岩/障碍模式）也一起旋转，保持位置一致
  var newBlocked = [];
  this.grid.blocked.forEach(function (b) {
    newBlocked.push({ x: b.y, y: n - 1 - b.x });
  });
  this.grid.blocked = newBlocked;
  this.grid.cells = out;
};

// 判断 (x,y) 是否被障碍(熔岩/障碍格)占据
GameManager.prototype.isBlockedCell = function (x, y) {
  return this.grid.isBlocked(x, y);
};

// 裂：每个 ≥8 且非本轮新生成的瓦片，有概率分裂成两个半值
GameManager.prototype.maybeFission = function () {
  // 先收集候选（避免在遍历中改格）
  var candidates = [];
  var self = this;
  this.grid.eachCell(function (x, y, t) {
    if (t && t.value >= 8 && !t.mergedFrom) candidates.push(t);
  });
  candidates.forEach(function (tile) {
    if (self.rng() >= self.fissionChance) return;
    var empty = self.grid.availableCells();
    if (!empty.length) return;
    var half = Math.floor(tile.value / 2);
    if (half < 1) return;
    var cell = empty[Math.floor(self.rng() * empty.length)];
    // 分裂：原块减半留在原位，新半块落到随机空位
    tile.value = half;
    var fresh = new Tile(cell, half, self.fuseLife);
    fresh.mergedFrom = null;
    self.grid.insertTile(fresh);
  });
};

// 熔：每 4 步岩浆从底部上升一行；新吞没的行封死并烧毁上面的瓦片
GameManager.prototype.riseLava = function () {
  this.lavaMoves++;
  var step = Math.floor((this.lavaMoves - 1) / 4);     // 已升起的行数
  var target = Math.min(Math.floor(this.lavaMoves / 4), this.size); // 应升到的行数（封顶）
  if (target <= step) return;

  for (var row = step; row < target; row++) {
    var y = this.size - 1 - row; // 从底层往上
    for (var x = 0; x < this.size; x++) {
      var t = this.grid.cellContent({ x: x, y: y });
      if (t) {
        this.grid.removeTile(t);
        // 烧毁扣分？熔岩只吞噬不扣分（丢了离散就是惩罚）
      }
    }
    // 该行全部封死
    for (x = 0; x < this.size; x++) {
      this.grid.blocked.push({ x: x, y: y });
    }
  }
};

// 炸：每个瓦片倒计时减一；归零则爆炸移除并扣分
GameManager.prototype.tickFuses = function () {
  var self = this;
  var explode = [];
  this.grid.eachCell(function (x, y, t) {
    if (!t) return;
    // 本轮新出生/新合成的不倒计时，寿命回满
    if (t.mergedFrom || t === self.lastSpawnTile) {
      t.fuse = self.fuseLife;
      return;
    }
    t.fuse--;
    if (t.fuse <= 0) explode.push({ x: x, y: y, value: t.value });
  });

  explode.forEach(function (p) {
    self.grid.removeTile({ x: p.x, y: p.y });
    // 爆炸扣分：扣掉该瓦片面值的一半
    self.score = Math.max(0, self.score - Math.floor(p.value / 2));
  });
  if (explode.length) {
    this.lastExplosions = explode.map(function (p) { return { x: p.x, y: p.y, value: p.value }; });
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
  if (this.tileMatchesAvailable()) return true;

  // 障碍格可能产生"有空位但被隔开"的局面：检查是否有任一瓦片能滑进相邻空位
  var canSlide = false;
  var self = this;
  this.grid.eachCell(function (x, y, tile) {
    if (!tile) return;
    for (var d = 0; d < 4; d++) {
      var v = self.getVector(d);
      var nb = { x: x + v.x, y: y + v.y };
      if (self.grid.withinBounds(nb) && self.grid.cellAvailable(nb)) { canSlide = true; }
    }
  });
  return canSlide;
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
