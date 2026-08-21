/* =============================================================
   星球引力 · “万有坠” 
   你不推，你倾斜。← → 旋转这颗星让重力换向，Space 让它坠落。
   每次坠落，瓦片顺着重力落到底、同数相撞合体，
   一颗新星从顶部落入。合成 2048 即抵达星心。
   ============================================================= */
(function () {
  "use strict";

  var WIN_VAL = 2048;

  function emptyBoard() {
    var b = [];
    for (var i = 0; i < 4; i++) b.push([0, 0, 0, 0]);
    return b;
  }
  function clone(b) { return b.map(function (r) { return r.slice(); }); }
  function emptyCells(b) {
    var out = [];
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) if (b[r][c] === 0) out.push([r, c]);
    return out;
  }
  function forEach(b, fn) { for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) fn(b[r][c], r, c); }
  function maxVal(b) { var m = 0; forEach(b, function (v) { if (v > m) m = v; }); return m; }

  // dir: 0 up,1 right,2 down,3 left. Returns {board, gained, moved}.
  function tryMove(board, dir) {
    var b = clone(board);
    var gained = 0, moved = false;
    var axis = (dir === 0 || dir === 2) ? 1 : 0;
    var forward = (dir === 1 || dir === 2) ? -1 : 1;
    for (var lane = 0; lane < 4; lane++) {
      var vals = [];
      for (var i = 0; i < 4; i++) {
        var rr = axis === 0 ? lane : (forward === 1 ? i : 3 - i);
        var cc = axis === 0 ? (forward === 1 ? i : 3 - i) : lane;
        vals.push(b[rr][cc]);
      }
      var res = slideMerge(vals);
      if (res.moved) moved = true;
      gained += res.gained;
      for (var j = 0; j < 4; j++) {
        var rr2 = axis === 0 ? lane : (forward === 1 ? j : 3 - j);
        var cc2 = axis === 0 ? (forward === 1 ? j : 3 - j) : lane;
        b[rr2][cc2] = res.line[j];
      }
    }
    return { board: b, gained: gained, moved: moved };
  }
  function slideMerge(vals) {
    var nz = vals.filter(function (v) { return v !== 0; });
    var out = [], moved = nz.length !== vals.length, gained = 0;
    for (var i = 0; i < nz.length; i++) {
      if (i + 1 < nz.length && nz[i] === nz[i + 1]) { out.push(nz[i] * 2); gained += nz[i] * 2; i++; moved = true; }
      else out.push(nz[i]);
    }
    while (out.length < 4) out.push(0);
    return { line: out, gained: gained, moved: moved };
  }
  function deadOr(b) {
    if (emptyCells(b).length) return false;
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
      var v = b[r][c];
      if (c + 1 < 4 && b[r][c + 1] === v) return false;
      if (r + 1 < 4 && b[r + 1][c] === v) return false;
    }
    return true;
  }

  /* ----------------- 渲染 · 观测台 ----------------- */

  function OrbitGame(el) {
    this.board = emptyBoard();
    this.rot = 0;         // 世界相对观测者的顺时针弧度(0..3) × 90°
    this.score = 0;
    this.best = parseInt(localStorage.getItem("grav-best") || "0", 10);
    this.won = false; this.over = false; this.keep = false;
    this.lastDrop = [];   // 记录本次坠落每个瓦片：{fromRow,toRow,toCol,val,isNew}

    this.el = el;
    this.elBoard = document.getElementById("board-grav");
    this.elScore = document.getElementById("grav-score");
    this.elBest = document.getElementById("grav-best");
    this.elMsg = document.getElementById("grav-msg");
    this.elCompass = document.getElementById("compass");

    this.seed();
    this.render(true);
    this.bind();
  }

  OrbitGame.prototype.seed = function () {
    // 三颗瓦片开局
    for (var i = 0; i < 3; i++) this.spawnAtRandom();
  };

  OrbitGame.prototype.spawnAtRandom = function () {
    var cells = emptyCells(this.board);
    if (!cells.length) return;
    var p = cells[Math.floor(Math.random() * cells.length)];
    this.board[p[0]][p[1]] = Math.random() < 0.9 ? 2 : 4;
  };

  OrbitGame.prototype.tilt = function (dv) {
    this.rot = (this.rot + dv + 4) % 4;
    this.elBoard.style.transform = "rotate(" + (this.rot * 90) + "deg)";
    this.setCompass();
  };

  OrbitGame.prototype.setCompass = function () {
    if (!this.elCompass) return;
    // 重力永远朝向屏幕正下；转动的是这颗星，而不是重力
    this.elCompass.textContent = "重力 ↓";
    var a = document.getElementById("compass-arrow");
    if (a) a.style.transform = "rotate(0deg)";
  };

  // 落：重力永远指向屏幕正下；转动的是星球本身，
  // 屏幕正下对应的棋盘方向随旋转变化（顺时针 0/1/2/3 → 下/右/上/左）
  OrbitGame.prototype.drop = function () {
    if (this.over || (this.won && !this.keep)) return;
    this.lastDrop = [];
    var dir = [2, 1, 0, 3][this.rot];
    var res = tryMove(this.board, dir); // 屏幕正下
    if (!res.moved) return;
    this.board = res.board;
    this.score += res.gained;
    if (maxVal(this.board) >= WIN_VAL && !this.won) this.won = true;
    this.spawnFalling();
    if (!this.settled()) this.over = true;
    this.save();
    this.render();
    this.announce();
  };

  OrbitGame.prototype.spawnFalling = function () {
    var cells = emptyCells(this.board);
    if (!cells.length) return;
    var p = cells[Math.floor(Math.random() * cells.length)];
    this.board[p[0]][p[1]] = Math.random() < 0.9 ? 2 : 4;
    this.lastDrop.push({ fromRow: 0, toRow: p[0], toCol: p[1], isNew: true });
  };

  OrbitGame.prototype.settled = function () {
    if (emptyCells(this.board).length) return true;
    for (var d = 0; d < 4; d++) if (tryMove(this.board, d).moved) return true;
    return false;
  };

  OrbitGame.prototype.save = function () {
    if (this.score > this.best) this.best = this.score;
    localStorage.setItem("grav-best", String(this.best));
  };

  OrbitGame.prototype.announce = function () {
    if (this.over) this.say("星心坍缩 · 已无路可走", false);
    else if (this.won && !this.keep) this.say('抵达 <b>2048</b> 星心！<button class="grv-act" data-a="keep">续航</button><button class="grv-act" data-a="new">再起</button>', true);
    else if (this.elMsg) this.elMsg.style.display = "none";
  };
  OrbitGame.prototype.say = function (html, showActions) {
    this.elMsg.innerHTML = html;
    this.elMsg.style.display = "block";
    var self = this;
    if (showActions) {
      this.elMsg.querySelectorAll("[data-a]").forEach(function (b) {
        b.addEventListener("click", function () {
          if (b.getAttribute("data-a") === "keep") self.keep = true;
          self.restart();
        });
      });
    }
  };

  OrbitGame.prototype.restart = function () {
    this.board = emptyBoard(); this.score = 0; this.won = false; this.over = false; this.keep = false;
    this.rot = 0; this.elBoard.style.transform = "rotate(0deg)"; this.setCompass();
    this.seed();
    this.render(true);
    if (this.elMsg) this.elMsg.style.display = "none";
  };

  OrbitGame.prototype.render = function (initial) {
    this.elScore.textContent = this.score;
    this.elBest.textContent = this.best;
    this.setCompass();
    this.elBoard.innerHTML = "";
    var self = this;
    var fresh = {};
    this.lastDrop.forEach(function (d) { fresh[d.toRow + "," + d.toCol] = true; });
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
      var cell = document.createElement("div");
      cell.className = "gcell";
      var v = this.board[r][c];
      if (v) {
        cell.textContent = v;
        cell.className += " t" + v;
        if (v >= 2048) cell.className += " star";
        if (fresh[r + "," + c]) cell.className += " t-new";
        cell.style.setProperty("--ph", self.phase(v));
      }
      this.elBoard.appendChild(cell);
    }
    this.lastDrop = [];
  };
  OrbitGame.prototype.phase = function (v) {
    // 金星冲日：数字越大相位越小
    return (v / WIN_VAL).toFixed(3);
  };

  OrbitGame.prototype.bind = function () {
    var self = this;

    // 键盘
    window.addEventListener("keydown", function (e) {
      var k = e.code;
      if (k === "ArrowLeft" || k === "KeyA") { e.preventDefault(); self.tilt(-1); return; }
      if (k === "ArrowRight" || k === "KeyD") { e.preventDefault(); self.tilt(1); return; }
      if (k === "Space" || k === "Enter" || k === "ArrowUp" || k === "KeyW" || k === "ArrowDown" || k === "KeyS") {
        e.preventDefault(); self.drop(); return;
      }
    });

    // 统一 指针(鼠标/触摸)：轻点 = 坠落；左右拖动 = 转动；向下拖动 = 坠落
    var downX = 0, downY = 0, startT = 0, dragging = false;
    var board = this.elBoard;
    board.addEventListener("pointerdown", function (e) {
      downX = e.clientX; downY = e.clientY; startT = Date.now(); dragging = false;
    });
    board.addEventListener("pointermove", function (e) {
      if (Math.abs(e.clientX - downX) > 14 || Math.abs(e.clientY - downY) > 14) dragging = true;
    });
    board.addEventListener("pointerup", function (e) {
      var dx = e.clientX - downX, dy = e.clientY - downY;
      var adx = Math.abs(dx), ady = Math.abs(dy);
      if (!dragging && (Date.now() - startT) < 600) { self.drop(); return; } // 轻点
      if (adx >= ady && adx > 20) { self.tilt(dx > 0 ? 1 : -1); return; } // 左右转
      if (ady > adx && dy > 20) { self.drop(); return; } // 向下坠落
    });

    // 首次进入：字幕引导
    var overlay = document.getElementById("howto");
    if (overlay) {
      var seen = localStorage.getItem("gravity-howto") === "1";
      if (!seen) overlay.classList.add("show");
      window.addEventListener("pointerdown", function () { dismiss(); }, { once: true });
      function dismiss() { overlay.classList.remove("show"); localStorage.setItem("gravity-howto", "1"); }
      var btn = document.getElementById("howto-ok");
      if (btn) btn.addEventListener("click", function (e) { e.stopPropagation(); dismiss(); });
    }
    var help = document.getElementById("how-link");
    if (help) help.addEventListener("click", function (e) { e.preventDefault(); document.getElementById("howto").classList.add("show"); });
  };

  window.OrbitGame = function (el) { return new OrbitGame(el); };
})();