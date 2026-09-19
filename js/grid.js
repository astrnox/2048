function Grid(size, previousCells, blocked) {
  this.size = size;
  this.cells = previousCells ? this.fromState(previousCells) : this.empty();
  this.blocked = blocked || [];
}

// Build a grid of the specified size
Grid.prototype.empty = function () {
  var cells = [];

  for (var x = 0; x < this.size; x++) {
    var row = cells[x] = [];

    for (var y = 0; y < this.size; y++) {
      row.push(null);
    }
  }

  return cells;
};

Grid.prototype.fromState = function (state) {
  var cells = [];

  for (var x = 0; x < this.size; x++) {
    var row = cells[x] = [];

    for (var y = 0; y < this.size; y++) {
      var tile = state[x][y];
      row.push(tile ? new Tile(tile.position, tile.value, tile.fuse) : null);
    }
  }

  return cells;
};

// Find the first available random position
Grid.prototype.randomAvailableCell = function () {
  var cells = this.availableCells();

  if (cells.length) {
    return cells[Math.floor(Math.random() * cells.length)];
  }
};

Grid.prototype.availableCells = function () {
  var cells = [];

  this.eachCell(function (x, y, tile) {
    if (!tile && !this.isBlocked(x, y)) {
      cells.push({ x: x, y: y });
    }
  }, this);

  return cells;
};

// Call callback for every cell
Grid.prototype.eachCell = function (callback, ctx) {
  for (var x = 0; x < this.size; x++) {
    for (var y = 0; y < this.size; y++) {
      callback.call(ctx || this, x, y, this.cells[x][y]);
    }
  }
};

// Check if there are any cells available
Grid.prototype.cellsAvailable = function () {
  return !!this.availableCells().length;
};

// Check if the specified cell is taken
Grid.prototype.cellAvailable = function (cell) {
  return !this.cellOccupied(cell) && !this.isBlocked(cell.x, cell.y);
};

Grid.prototype.cellOccupied = function (cell) {
  return !!this.cellContent(cell);
};

Grid.prototype.cellContent = function (cell) {
  if (this.withinBounds(cell)) {
    return this.cells[cell.x][cell.y];
  } else {
    return null;
  }
};

// Inserts a tile at its position
Grid.prototype.insertTile = function (tile) {
  this.cells[tile.x][tile.y] = tile;
};

Grid.prototype.removeTile = function (tile) {
  this.cells[tile.x][tile.y] = null;
};

Grid.prototype.withinBounds = function (position) {
  return position.x >= 0 && position.x < this.size &&
         position.y >= 0 && position.y < this.size;
};

// ---------- 障碍格（block 模式） ----------

// 判断 (x, y) 是否为不可通行的障碍格
Grid.prototype.isBlocked = function (x, y) {
  if (x < 0 || x >= this.size || y < 0 || y >= this.size) return false;
  for (var i = 0; i < this.blocked.length; i++) {
    if (this.blocked[i].x === x && this.blocked[i].y === y) return true;
  }
  return false;
};

// 随机布置 n 个互不重叠的障碍格（用给定随机源，便于可复现）
Grid.prototype.addBlockedCells = function (n, rng) {
  rng = rng || Math.random;
  var cells = [];
  for (var x = 0; x < this.size; x++) {
    for (var y = 0; y < this.size; y++) {
      cells.push({ x: x, y: y });
    }
  }
  for (var i = cells.length - 1; i > 0; i--) {
    var j = Math.floor(rng() * (i + 1));
    var t = cells[i]; cells[i] = cells[j]; cells[j] = t;
  }
  this.blocked = cells.slice(0, Math.min(n, cells.length));
};

Grid.prototype.serialize = function () {
  var cellState = [];

  for (var x = 0; x < this.size; x++) {
    var row = cellState[x] = [];

    for (var y = 0; y < this.size; y++) {
      row.push(this.cells[x][y] ? this.cells[x][y].serialize() : null);
    }
  }

  return {
    size: this.size,
    cells: cellState,
    blocked: this.blocked
  };
};
