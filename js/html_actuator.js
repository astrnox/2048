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
  this.stepsHud       = document.querySelector("#stepsHud");
  this.stepsElement   = document.querySelector("#stepsLeft");

  this.score = 0;
}

HTMLActuator.prototype.setMode = function (mode) {
  document.body.className = "mode-" + (mode || "classic");
  this.mode = mode;

  var hints = {
    classic: '相同数字相撞即合体，合成 <strong>2048</strong> 获胜！',
    time:    '限时 <strong>60 秒</strong>，尽可能多地得分！',
    endless: '没有终点——这一次你能合到多大？',
    daily:   '今日同一盘、运数相同，你能合到多高？按 <strong>Z</strong> 悔一步',
    n128:    '别造 <strong>128</strong>：一旦合成 128 立刻出局，分数越高越要小心！',
    anti:    '反转 2048：把棋盘 <strong>填到无路可走</strong> 才算赢！',
    steps:   '只有 <strong>60 步</strong>：省着用，尽量合出更大的数！',
    block:   '棋盘上有 <strong>3 个障碍格</strong>不可通行，绕开它们继续合体！',
    spin:    '每走一步，整个棋盘会<b>顺时针旋转 90°</b>！方向感是最大敌人。',
    lava:    '底部岩浆每 <strong>4 步</strong> 上升一行，被吞没的瓦片会消失！',
    blind:   '瓦片数值<b>藏在背面</b>，每走一步只闪现一瞬，靠记忆合体！',
    fission: '大数<b>不稳定</b>：每走一步，≥8 的瓦片可能分裂成两个半值！',
    fuse:    '每块瓦片都绑着<b>引信</b>，爆燃归零就会爆炸消失并扣分！'
  };

  this.timerElement.classList.toggle("hidden", mode !== "time");

  // 限步模式：显示剩余步数
  if (this.stepsHud) this.stepsHud.classList.toggle("hidden", mode !== "steps");

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
  if (this.stepsHud)     this.stepsHud.classList.toggle("hidden", mode !== "steps");
  if (this.undoButton)   this.undoButton.disabled = true;
  if (this.movesElement) this.movesElement.textContent = "0";
};

HTMLActuator.prototype.updateSteps = function (total) {
  if (!this.stepsElement) return;
  this.stepsElement.textContent = total;
  this.stepsElement.classList.toggle("timer-warning", total <= 10);
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
    // 无效滑动（棋盘无变化）时跳过整个瓦片层的重建，界面不再闪烁刷新；
    // 游戏结束/胜利/悔棋/新开局仍全量重绘
    var repaint = metadata.moved || metadata.over || metadata.won;

    if (repaint) {
      self.clearContainer(self.tileContainer);

      grid.cells.forEach(function (column) {
        column.forEach(function (cell) {
          if (cell) {
            self.addTile(cell);
          }
        });
      });
    }

    self.updateScore(metadata.score);
    self.updateBestScore(metadata.bestScore);

    // 障碍格渲染
    self.updateBlocked(grid);

    // 盲盒模式：数值藏起来，短暂揭示后盖回（仅真实移动时闪现）
    if (metadata.mode === "blind" && metadata.moved) self.blindReveal();

    // 旋模式：每步旋转时给棋盘一个轻转动画（仅真实移动时摆动）
    if (metadata.mode === "spin" && metadata.moved) self.spinFlash();

    // 炸模式：标记本步爆炸消失的格子（触发闪烁动画）
    if (metadata.lastExplosions && metadata.lastExplosions.length) {
      self.flashExplosions(metadata.lastExplosions);
    }

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
        } else if (metadata.mode === "n128") {
          closingText = "你合出了 128，出局！得分 " + metadata.score;
        } else if (metadata.mode === "anti") {
          closingText = "棋盘填满，了不起！得分 " + metadata.score;
        } else if (metadata.mode === "steps") {
          closingText = "步数用尽！最终得分 " + metadata.score;
        } else if (metadata.mode === "block") {
          closingText = "无路可走！得分 " + metadata.score;
        } else if (metadata.mode === "spin") {
          closingText = "转晕了！最终得分 " + metadata.score;
        } else if (metadata.mode === "lava") {
          closingText = "岩浆吞没了棋盘！得分 " + metadata.score;
        } else if (metadata.mode === "blind") {
          closingText = "记忆崩盘！得分 " + metadata.score;
        } else if (metadata.mode === "fission") {
          closingText = "大数裂光了！最终得分 " + metadata.score;
        } else if (metadata.mode === "fuse") {
          closingText = "引信烧尽！最终得分 " + metadata.score;
        }
      } else if (metadata.won) {
        if (metadata.mode === "daily") {
          closingText = "今日达成 2048！得分 " + metadata.score;
        }
      }
      self.message(metadata.won, closingText);
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

  // 盲盒模式：数值盖面朝下（内容仍在，靠 CSS 隐藏）
  if (this.mode === "blind") wrapper.classList.add("tile-blind");

  // 引信模式：瓦片挂剩余寿命徽标
  if (this.mode === "fuse" && tile.fuse !== undefined) {
    var badge = document.createElement("span");
    badge.className = "fuse-badge" + (tile.fuse <= 2 ? " fuse-hot" : "");
    badge.textContent = "⏱" + tile.fuse;
    wrapper.appendChild(badge);
  }

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

// 障碍格：在瓦片层下渲染不可通行的格子（熔岩模式样式更炽热）
HTMLActuator.prototype.updateBlocked = function (grid) {
  if (!this.tileContainer) return;
  var old = this.tileContainer.querySelectorAll(".cell-blocked");
  for (var i = 0; i < old.length; i++) old[i].remove();
  if (!grid.blocked || !grid.blocked.length) return;

  var self = this;
  var isLava = this.mode === "lava";
  grid.blocked.forEach(function (c) {
    var el = document.createElement("div");
    el.className = "cell-blocked" + (isLava ? " is-lava" : "") + " " + self.positionClass({ x: c.x, y: c.y });
    self.tileContainer.appendChild(el);
  });
};

// 盲盒：数值短暂揭示后盖回
HTMLActuator.prototype.blindReveal = function () {
  var self = this;
  if (this._blindTimer) clearTimeout(this._blindTimer);
  this.tileContainer.classList.add("reveal-all");
  this._blindTimer = setTimeout(function () {
    self.tileContainer.classList.remove("reveal-all");
    self._blindTimer = null;
  }, 900);
};

// 旋：每次旋转给棋盘一个轻摆
HTMLActuator.prototype.spinFlash = function () {
  var bc = document.querySelector(".game-container");
  if (!bc) return;
  bc.classList.remove("board-spun");
  void bc.offsetWidth; // 重启动画
  bc.classList.add("board-spun");
};

// 炸：爆炸过的格子闪烁警示（爆炸瓦片已不存在，需要现场渲染标记）
HTMLActuator.prototype.flashExplosions = function (explosions) {
  var self = this;
  explosions.forEach(function (p) {
    var el = document.createElement("div");
    el.className = "tile-explode-marker " + self.positionClass({ x: p.x, y: p.y });
    // 简报：显示爆炸作响的瓦片面值，让玩家知道是谁炸了
    var inner = document.createElement("span");
    inner.className = "tile-explode-inner";
    inner.textContent = p.value;
    el.appendChild(inner);
    self.tileContainer.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 700);
  });
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
