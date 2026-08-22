/* =============================================================
   Tetris · 2048 Tetris（下落合成）
   一块带数字的方块从顶部落下：←→ 左右移动、空格/↓ 硬着陆。
   落地后与同列相邻同数作竖直 2048 合成（并向下坍缩），清出空间继续落。
   引擎独立，动画：下落 translate、合体 pop、新生浮现。
   ============================================================= */
(function () {
  "use strict";

  var W = 4, H = 8;                 // 4 宽、8 高
  var WIN_VAL = 2048, LOSE_VAL = 4096;
  var GAP = 6, PAD = 7;
  var FALL_MS = 560;                // 自动下落间隔
  var _id = 0;

  function empty() { var g = []; for (var r = 0; r < H; r++) g.push(new Array(W).fill(null)); return g; }
  function newT(v) { return { v: v, id: ++_id }; }
  function colObjs(g, c) { var s = []; for (var r = H - 1; r >= 0; r--) if (g[r][c]) s.push(g[r][c]); return s; }
  function maxVal(g) { var m = 0; for (var r = 0; r < H; r++) for (var c = 0; c < W; c++) if (g[r][c] && g[r][c].v > m) m = g[r][c].v; return m; }
  function clone(g) { return g.map(function (row) { return row.slice(); }); }

  function TetrisGame(elBoard) {
    this.elBoard = elBoard;
    this.elScore = document.getElementById("tt-score");
    this.elBest = document.getElementById("tt-best");
    this.elMsg = document.getElementById("tt-msg");
    this.g = empty();
    this.score = 0;
    this.best = parseInt(localStorage.getItem("tetris-best") || "0", 10);
    this.over = false; this.won = false;
    this.piece = null;
    this.timer = null;
    this.fallFrom = {};   // id -> 下落起始行
    this.mergeIds = [];   // 本步合成瓦片 → pop
    this.cellW = 0; this.cellH = 0;

    this.spawn();
    this.render(true);
    this.bind();
    this.startAuto();
  }

  TetrisGame.prototype.measure = function () {
    var w = this.elBoard.clientWidth || 240;
    this.cellW = (w - 2 * PAD - 3 * GAP) / W;
    this.cellH = (this.cellW / W) * H * 0.95;
  };

  TetrisGame.prototype.spawn = function () {
    if (this.over) return;
    var c = Math.floor(Math.random() * W);
    if (this.g[0][c]) { this.over = true; this.end(); return; }
    var v = Math.random() < 0.72 ? 2 : 4;
    this.piece = newT(v);
    this.piece.col = c;
    this.piece.r = 0;
    this.fallFrom = {};
    this.fallFrom[this.piece.id] = -1;   // 从棋盘顶外第一格落入
    if (window.Sound) window.Sound.drop();
    this.render();
  };

  TetrisGame.prototype.canStep = function (rr) {
    var p = this.piece;
    if (rr >= H) return false;
    return !this.g[rr][p.col];
  };

  TetrisGame.prototype.auto = function () {
    if (this.over) return;
    var p = this.piece;
    if (this.canStep(p.r + 1)) {
      this.fallFrom = {}; this.fallFrom[p.id] = p.r;
      p.r += 1;
      this.render();
    } else {
      this.lock();
    }
  };

  TetrisGame.prototype.movePiece = function (dc) {
    var p = this.piece;
    var nc = p.col + dc;
    if (nc < 0 || nc >= W) return;
    if (this.g[p.r][nc]) return;
    p.col = nc;
    this.render();
  };

  TetrisGame.prototype.hardDrop = function () {
    var p = this.piece;
    var r = p.r;
    while (this.canStep(r + 1)) r++;
    this.fallFrom = {}; this.fallFrom[p.id] = p.r;
    p.r = r;
    this.render();
    var self = this;
    setTimeout(function () { self.lock(); }, 90);
  };

  TetrisGame.prototype.lock = function () {
    if (!this.piece || this.over) return;
    var p = this.piece;
    this.g[p.r][p.col] = p;
    this.piece = null;
    // 竖直合成：从底向顶坍缩合并（整盘），清出可继续落的空间
    var res = this.resolveDown();
    this.score += res.gain;
    if (res.merges > 0 && window.Sound) window.Sound.merge();
    this.mergeIds = res.mergeIds;
    if (maxVal(this.g) >= WIN_VAL && !this.won) this.won = true;
    if (maxVal(this.g) >= LOSE_VAL) { this.over = true; }
    this.render();
    if (this.score > this.best) { this.best = this.score; localStorage.setItem("tetris-best", String(this.best)); }
    if (this.over) this.end();
    else this.spawn();
  };

  TetrisGame.prototype.resolveDown = function () {
    // 对每一列做向下坍缩 + 相邻同数合并（链式），返回增益与合成 id
    var gain = 0, mergeIds = [];
    for (var c = 0; c < W; c++) {
      var stack = colObjs(this.g, c);   // 自底向顶
      var out = [], j = 0;
      while (j < stack.length) {
        if (j + 1 < stack.length && stack[j].v === stack[j + 1].v) {
          var t = newT(stack[j].v * 2);
          out.push(t); gain += t.v; mergeIds.push(t.id); j += 2;
        } else { out.push(stack[j]); j++; }
      }
      for (var r = 0; r < H; r++) this.g[r][c] = null;
      for (var k = 0; k < out.length; k++) this.g[H - 1 - k][c] = out[k];
    }
    return { gain: gain, mergeIds: mergeIds };
  };

  // ---------- 渲染 ----------
  TetrisGame.prototype.render = function (initial) {
    this.elScore.textContent = this.score;
    this.elBest.textContent = this.best;
    this.measure();
    this.elBoard.innerHTML = "";
    var self = this;
    var cw = this.cellW, ch = this.cellH;

    for (var i = 0; i < H * W; i++) {
      var bg = document.createElement("div");
      bg.className = "tbg";
      bg.style.left = (PAD + (i % W) * (cw + GAP)) + "px";
      bg.style.top = (PAD + Math.floor(i / W) * (ch + GAP)) + "px";
      bg.style.width = cw + "px"; bg.style.height = ch + "px";
      this.elBoard.appendChild(bg);
    }

    var pieceId = this.piece ? this.piece.id : -1;
    // 画已落定的瓦片
    for (var r = 0; r < H; r++) for (var c = 0; c < W; c++) {
      var t = this.g[r][c];
      if (!t) continue;
      var node = this.makeTile(t.v, r, c, cw, ch, this.mergeIds.indexOf(t.id) >= 0);
      this.elBoard.appendChild(node);
    }
    // 画下落中的方块（含合成后本步的移动）
    if (this.piece) {
      var p = this.piece;
      var fr = (this.fallFrom[p.id] != null) ? this.fallFrom[p.id] : p.r;
      var node = this.makeTile(p.v, p.r, p.col, cw, ch, false);
      if (fr !== p.r) {
        // 从上往下落下：先放起始行，再过渡到当前行
        node.className += " tt-fly";
        var startY = (fr - p.r) * (ch + GAP);
        node.style.transition = "none";
        node.style.transform = "translate(" + (PAD + p.col * (cw + GAP)) + "px," + (PAD + p.r * (ch + GAP) + startY) + "px)";
        void node.offsetWidth;
        node.style.transition = "transform " + (FALL_MS / 1000) + "s cubic-bezier(0.5,0.05,0.85,0.4)";
        node.style.transform = "translate(" + (PAD + p.col * (cw + GAP)) + "px," + (PAD + p.r * (ch + GAP)) + "px)";
      }
      this.elBoard.appendChild(node);
    }
    this.mergeIds = [];
    this.fallFrom = {};
  };

  TetrisGame.prototype.makeTile = function (v, r, c, cw, ch, pop) {
    var el = document.createElement("div");
    el.className = "ttile t" + v + (pop ? " tt-pop" : "");
    el.textContent = v;
    el.style.left = (PAD + c * (cw + GAP)) + "px";
    el.style.top = (PAD + r * (ch + GAP)) + "px";
    el.style.width = cw + "px"; el.style.height = ch + "px";
    return el;
  };

  TetrisGame.prototype.end = function () {
    this.over = true;
    this.stopAuto();
    var msg = this.won ? "合成 <b>2048</b>，方块仍在落下！可继续" : (this.score > 0 ? "棋盘叠满，得分 " + this.score : "方块堵住了");
    this.elMsg.innerHTML = "<div>" + msg + "</div><button class=\"l-act\" data-a=\"new\">再来一局</button>";
    this.elMsg.style.display = "block";
    var self = this;
    this.elMsg.querySelector("[data-a]").addEventListener("click", function () { self.restart(); });
  };

  TetrisGame.prototype.restart = function () {
    this.g = empty(); this.score = 0; this.over = false; this.won = false; this.piece = null;
    if (this.elMsg) this.elMsg.style.display = "none";
    this.startAuto();
    this.spawn();
  };

  TetrisGame.prototype.startAuto = function () { var s = this; if (this.timer) clearInterval(this.timer); this.timer = setInterval(function () { s.auto(); }, FALL_MS); };
  TetrisGame.prototype.stopAuto = function () { if (this.timer) { clearInterval(this.timer); this.timer = null; } };

  TetrisGame.prototype.bind = function () {
    var self = this;
    var KEYS = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 };
    window.addEventListener("keydown", function (e) {
      var d = KEYS[e.code];
      if (d !== undefined) { e.preventDefault(); self.movePiece(d); return; }
      if (e.code === "ArrowDown" || e.code === "KeyS" || e.code === "Space") { e.preventDefault(); self.hardDrop(); return; }
    });
    // 滑动：左右移动，下滑硬着陆
    if (window.bindSwipe) window.bindSwipe(this.elBoard, function (dir) {
      if (dir === 1 || dir === 3) self.movePiece(dir === 1 ? 1 : -1);
      else if (dir === 2) self.hardDrop();
    });
  };

  window.TetrisGame = TetrisGame;
})();