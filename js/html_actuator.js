function HTMLActuator() {
  this.tileContainer    = document.querySelector(".tile-container");
  this.scoreContainer   = document.querySelector(".score-container");
  this.bestContainer    = document.querySelector(".best-container");
  this.messageContainer = document.querySelector(".game-message");
  this.timerElement     = document.querySelector(".timer");
  this.hintElement      = document.querySelector("#mode-hint");

  // 2048+ 增强 UI
  this.comboElement   = document.querySelector("#comboBadge");
  this.comboText      = document.querySelector("#comboCount");
  this.undoButton     = document.querySelector(".undo-button");
  this.dailyHud       = document.querySelector("#dailyHud");
  this.dailyDateEl    = document.querySelector("#dailyDate");
  this.dailyBestEl    = document.querySelector("#dailyBest");
  this.movesElement   = document.querySelector("#movesCount");

  this.score = 0;
}

HTMLActuator.prototype.setMode = function (mode) {
  document.body.className = "mode-" + (mode || "classic");

  var hints = {
    classic: '相同数字相撞即合体，合成 <strong>2048</strong> 获胜！',
    time:    '限时 <strong>60 秒</strong>，尽可能多地得分！',
    endless: '没有终点——这一次你能合到多大？',
    daily:   '今日同一盘、运数相同，你能合到多高？按 <strong>Z</strong> 悔一步'
  };

  this.timerElement.classList.toggle("hidden", mode !== "time");

  // 每日模式：展示当天日期
  if (mode === "daily" && this.dailyDateEl) {
    var d = new Date();
    this.dailyDateEl.textContent = d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }

  if (this.hintElement) {
    this.hintElement.innerHTML = hints[mode] || hints.classic;
  }
};

// 切换模式/开新局时重置 2048+ 增强 UI
HTMLActuator.prototype.updateModeExtras = function (mode) {
  if (this.comboElement) this.comboElement.classList.add("hidden");
  if (this.dailyHud)     this.dailyHud.classList.toggle("hidden", mode !== "daily");
  if (this.undoButton)   this.undoButton.disabled = true;
  if (this.movesElement) this.movesElement.textContent = "0";
};

HTMLActuator.prototype.updateTimer = function (totalSeconds) {
  if (!this.timerElement) return;

  var minutes = Math.floor(totalSeconds / 60);
  var seconds = totalSeconds % 60;
  this.timerElement.textContent = minutes + ":" + (seconds < 10 ? "0" : "") + seconds;

  // Turn the countdown red for the final stretch
  this.timerElement.classList.toggle("timer-warning", totalSeconds <= 10);
};

HTMLActuator.prototype.actuate = function (grid, metadata) {
  var self = this;

  window.requestAnimationFrame(function () {
    self.clearContainer(self.tileContainer);

    grid.cells.forEach(function (column) {
      column.forEach(function (cell) {
        if (cell) {
          self.addTile(cell);
        }
      });
    });

    self.updateScore(metadata.score);
    self.updateBestScore(metadata.bestScore);

    // 2048+ 连击徽标
    if (self.comboElement && self.comboText) {
      if (metadata.combo > 1) {
        self.comboText.textContent = "×" + metadata.combo + "  ·  +" + metadata.comboBonus;
        self.comboElement.classList.remove("hidden");
      } else {
        self.comboElement.classList.add("hidden");
      }
    }
    // 2048+ 悔棋可用性
    if (self.undoButton) self.undoButton.disabled = !metadata.canUndo;
    // 2048+ 步数 / 今日最佳
    if (self.movesElement) self.movesElement.textContent = metadata.moves;
    if (self.dailyBestEl)  self.dailyBestEl.textContent = metadata.dailyBest;

    if (metadata.terminated) {
      var closingText = null;
      if (metadata.over) {
        if (metadata.mode === "time") {
          closingText = "时间到！你的得分：" + metadata.score;
        } else if (metadata.mode === "daily") {
          closingText = "今日收官！得分 " + metadata.score + " · 今日最佳 " + metadata.dailyBest;
        }
      } else if (metadata.won) {
        if (metadata.mode === "daily") {
          closingText = "今日达成 2048＋！得分 " + metadata.score;
        }
      }
      self.message(metadata.won && !metadata.over, closingText);
    }

  });
};

// Continues the game (both restart and keep playing)
HTMLActuator.prototype.continueGame = function () {
  this.clearMessage();
};

HTMLActuator.prototype.clearContainer = function (container) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
};

HTMLActuator.prototype.addTile = function (tile) {
  var self = this;

  var wrapper   = document.createElement("div");
  var inner     = document.createElement("div");
  var position  = tile.previousPosition || { x: tile.x, y: tile.y };
  var positionClass = this.positionClass(position);

  // We can't use classlist because it somehow glitches when replacing classes
  var classes = ["tile", "tile-" + tile.value, positionClass];

  if (tile.value > 2048) classes.push("tile-super");

  this.applyClasses(wrapper, classes);

  inner.classList.add("tile-inner");
  inner.textContent = tile.value;

  if (tile.previousPosition) {
    // Make sure that the tile gets rendered in the previous position first
    window.requestAnimationFrame(function () {
      classes[2] = self.positionClass({ x: tile.x, y: tile.y });
      self.applyClasses(wrapper, classes); // Update the position
    });
  } else if (tile.mergedFrom) {
    classes.push("tile-merged");
    this.applyClasses(wrapper, classes);

    // Render the tiles that merged
    tile.mergedFrom.forEach(function (merged) {
      self.addTile(merged);
    });
  } else {
    classes.push("tile-new");
    this.applyClasses(wrapper, classes);
  }

  // Add the inner part of the tile to the wrapper
  wrapper.appendChild(inner);

  // Put the tile on the board
  this.tileContainer.appendChild(wrapper);
};

HTMLActuator.prototype.applyClasses = function (element, classes) {
  element.setAttribute("class", classes.join(" "));
};

HTMLActuator.prototype.normalizePosition = function (position) {
  return { x: position.x + 1, y: position.y + 1 };
};

HTMLActuator.prototype.positionClass = function (position) {
  position = this.normalizePosition(position);
  return "tile-position-" + position.x + "-" + position.y;
};

HTMLActuator.prototype.updateScore = function (score) {
  this.clearContainer(this.scoreContainer);

  var difference = score - this.score;
  this.score = score;

  this.scoreContainer.textContent = this.score;

  if (difference > 0) {
    var addition = document.createElement("div");
    addition.classList.add("score-addition");
    addition.textContent = "+" + difference;

    this.scoreContainer.appendChild(addition);
  }
};

HTMLActuator.prototype.updateBestScore = function (bestScore) {
  this.bestContainer.textContent = bestScore;
};

HTMLActuator.prototype.message = function (won, text) {
  var type    = won ? "game-won" : "game-over";
  var message = text || (won ? "合成 2048！" : "棋盘满了！");

  this.messageContainer.classList.add(type);
  this.messageContainer.getElementsByTagName("p")[0].textContent = message;
};

HTMLActuator.prototype.clearMessage = function () {
  // IE only takes one value to remove at a time.
  this.messageContainer.classList.remove("game-won");
  this.messageContainer.classList.remove("game-over");
};
