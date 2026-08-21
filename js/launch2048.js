/* =============================================================
   发射 LAUNCH · “射箭上盘”（带动画版）
   方块带唯一 id，绝对定位 + CSS transform，滑动位移动画丝滑；
   新发射的方块播放「自下而上发射 → 顶部下坠回落」飞行动画，
   合体方块播放弹跳。逻辑与胜负沿用值棋盘。
   ============================================================= */
(function () {
  "use strict";

  var COLS = 4;
  var ROWS = 5;         // 顶部 row=0，重力朝底 row=ROWS-1
  var WIN_VAL = 2048;
  // 与 launch.css 的 board 细节保持一致（gap=6,padding=7）
  var GAP = 6, PAD = 7;

  var _id = 0;
  function newT(v) { return { v: v, id: ++_id, merge: false, from: null }; }

  function emptyGrid() {
    var g = [];
    for (var r = 0; r < ROWS; r++) g.push([null, null, null, null]);
    return g;
  }
  function emptyCells(g) {
    var o = [];
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) if (!g[r][c]) o.push([r, c]);
    return o;
  }
  // 某列自底向顶的非空瓦片对象
  function colObjs(g, c) {
    var s = [];
    for (var r = ROWS - 1; r >= 0; r--) if (g[r][c]) s.push(g[r][c]);
    return s;
  }
  function colFull(g, c) { return colObjs(g, c).length >= ROWS; }
  function allFull(g) { for (var c = 0; c < COLS; c++) if (!colFull(g, c)) return false; return true; }
  function maxVal(g) {
    var m = 0;
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) if (g[r][c] && g[r][c].v > m) m = g[r][c].v;
    return m;
  }
  // 经典合并：向底部坍缩，同数相撞合并一次（低者存，翻倍）
  function collapseCol(arr) {
    var out = [], gain = 0, merges = 0;
    for (var i = 0; i < arr.length; i++) {
      if (i + 1 < arr.length && arr[i].v === arr[i + 1].v) {
        var s = newT(arr[i].v * 2); s.merge = true; s.from = [arr[i], arr[i + 1]];
        out.push(s); gain += s.v; merges++; i++;
      } else {
        out.push(arr[i]);
      }
    }
    return { out: out, gain: gain, merges: merges };
  }
  function genTray() {
    var t = [];
    for (var i = 0; i < 3; i++) t.push(Math.random() < 0.72 ? 2 : 4);
    return t;
  }

  function LaunchGame() {
    this.grid = emptyGrid();
    this.score = 0;
    this.best = parseInt(window.localStorage.getItem("launch-best") || "0", 10);
    this.won = false; this.over = false;
    this.armed = -1;
    this.tray = genTray();
    this.next = genTray();
    this.lastNewId = -1;      // 本次发射、未合体而存活的瓦片 id
    this.nodes = {};          // id -> { outer, inner }

    // DOM
    this.elBoard = document.getElementById("board-launch");
    this.elScore = document.getElementById("launch-score");
    this.elBest  = document.getElementById("launch-best");
    this.elMsg   = document.getElementById("launch-msg");
    this.elCombo = document.getElementById("launch-combo");

    this.measure();
    this.buildBg();
    this.seed();
    this.renderTray();
    this.render();
    this.bind();

    var self = this;
    window.addEventListener("resize", function () {
      var prev = self.cellW;
      self.measure();
      if (Math.abs(prev - self.cellW) > 1) self.reposition();
    });
  }

  LaunchGame.prototype.measure = function () {
    var w = this.elBoard.clientWidth || Math.min(320, window.innerWidth * 0.88);
    var h = this.elBoard.clientHeight || Math.round(w * ROWS / COLS);
    this.cellW = (w - 2 * PAD - (COLS - 1) * GAP) / COLS;
    this.cellH = (h - 2 * PAD - (ROWS - 1) * GAP) / ROWS;
  };

  // 一次性落子区底格（空槽视觉）
  LaunchGame.prototype.buildBg = function () {
    var bg = document.createElement("div");
    bg.className = "board-bg";
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
      var s = document.createElement("span");
      s.className = "board-bgcell";
      bg.appendChild(s);
    }
    this.elBoard.appendChild(bg);
  };

  LaunchGame.prototype.seed = function () {
    var e = emptyCells(this.grid);
    if (e.length) { var p = e.splice(Math.floor(Math.random() * e.length), 1)[0]; this.grid[p[0]][p[1]] = newT(2); }
    e = emptyCells(this.grid);
    if (e.length) { var q = e.splice(Math.floor(Math.random() * e.length), 1)[0]; this.grid[q[0]][q[1]] = newT(Math.random() < 0.9 ? 2 : 4); }
  };

  // 发射选中的牌到指定列
  LaunchGame.prototype.launch = function (col) {
    if (this.over || this.armed < 0) return;
    if (colFull(this.grid, col)) return;

    var val = this.tray[this.armed];
    var nt = newT(val);
    this.lastNewId = nt.id;
    this.armed = -1;
    this.tray = this.next; this.next = genTray();
    this.renderTray();

    // 把新瓦片放到该列栈顶，做一次向下坍缩合并
    var stack = colObjs(this.grid, col);
    stack.push(nt);
    var res = collapseCol(stack);

    // 清空该列，回填坍缩结果（自底向顶）
    for (var r = 0; r < ROWS; r++) this.grid[r][col] = null;
    for (var k = 0; k < res.out.length; k++) this.grid[ROWS - 1 - k][col] = res.out[k];

    this.score += res.gain;
    if (res.merges >= 2) this.flashCombo(res.merges);

    this.checkState();
    this.render();
  };

  LaunchGame.prototype.flashCombo = function (n) {
    if (!this.elCombo) return;
    this.elCombo.textContent = "×" + n + " 连击";
    this.elCombo.classList.remove("on");
    void this.elCombo.offsetWidth;
    this.elCombo.classList.add("on");
  };

  LaunchGame.prototype.checkState = function () {
    if (maxVal(this.grid) >= WIN_VAL && !this.won) this.won = true;
    if (allFull(this.grid)) this.over = true;
    if (this.score > this.best) { this.best = this.score; window.localStorage.setItem("launch-best", String(this.best)); }
    this.announce();
  };

  LaunchGame.prototype.announce = function () {
    if (this.over) this.say("棋盘已满 · 得分 " + this.score, false);
    else if (this.won) this.say('合出 <b>2048</b>！可继续发射冲更高', true);
    else if (this.elMsg) this.elMsg.style.display = "none";
  };
  LaunchGame.prototype.say = function (html, acts) {
    this.elMsg.innerHTML = "<div>" + html + "</div>" +
      '<button class="l-act" data-a="new">再来一发</button>';
    this.elMsg.style.display = "block";
    var self = this;
    var b = this.elMsg.querySelector("[data-a]");
    if (b) b.addEventListener("click", function () { self.restart(); });
  };

  LaunchGame.prototype.restart = function () {
    this.grid = emptyGrid(); this.score = 0; this.won = false; this.over = false; this.armed = -1;
    this.tray = genTray(); this.next = genTray(); this.lastNewId = -1;
    // 清空所有瓦片 DOM
    var self = this;
    Object.keys(this.nodes).forEach(function ( id ) { self.elBoard.removeChild(self.nodes[id].outer); });
    this.nodes = {};
    if (this.elCombo) this.elCombo.classList.remove("on");
    this.seed(); this.renderTray(); this.render();
    if (this.elMsg) this.elMsg.style.display = "none";
  };

  // ---------- 瓦片 DOM ----------
  LaunchGame.prototype.createNode = function (o) {
    var outer = document.createElement("div");
    outer.className = "ltile";
    outer.style.width = this.cellW + "px";
    outer.style.height = this.cellH + "px";

    var inner = document.createElement("div");
    inner.className = "ltile-inner t" + o.v;
    inner.textContent = o.v;
    if (o.v >= WIN_VAL) inner.className += " star";
    if (o.id === this.lastNewId && !o.merge) inner.className += " fly";   // 发射飞行
    else if (o.merge) inner.className += " pop";                          // 合体弹跳

    outer.appendChild(inner);
    this.nodes[o.id] = { outer: outer, inner: inner };
    return outer;
  };

  LaunchGame.prototype.reposition = function () {
    var self = this;
    var cw = this.cellW, ch = this.cellH;
    Object.keys(this.nodes).forEach(function (id) {
      var loc = self.findLoc(id);
      if (loc) {
        var x = PAD + loc.c * (cw + GAP), y = PAD + loc.r * (ch + GAP);
        self.nodes[id].outer.style.transform = "translate(" + x + "px," + y + "px)";
      }
    });
  };

  LaunchGame.prototype.findLoc = function (id) {
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) if (this.grid[r][c] && this.grid[r][c].id === id) return { r: r, c: c };
    return null;
  };

  LaunchGame.prototype.render = function () {
    this.elScore.textContent = this.score;
    this.elBest.textContent = this.best;
    this.measure();
    var self = this;
    var cw = this.cellW, ch = this.cellH;
    var wanted = {};

    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) if (this.grid[r][c]) wanted[this.grid[r][c].id] = { r: r, c: c, o: this.grid[r][c] };

    Object.keys(wanted).forEach(function (id) {
      var w = wanted[id];
      var node = self.nodes[id];
      var x = PAD + w.c * (cw + GAP), y = PAD + w.r * (ch + GAP);
      if (node) {
        node.outer.style.transform = "translate(" + x + "px," + y + "px)"; // 位移动画由 transition 驱动
      } else {
        var el = self.createNode(w.o);          // 先设好初始位置再挂载，避免创建即滑动
        el.style.transform = "translate(" + x + "px," + y + "px)";
        self.elBoard.appendChild(el);
      }
    });

    Object.keys(this.nodes).forEach(function (id) {
      if (!(id in wanted)) { self.elBoard.removeChild(self.nodes[id].outer); delete self.nodes[id]; }
    });

    this.lastNewId = -1; // 只对当次发射生效
  };

  // ---------- 候选牌 ----------
  LaunchGame.prototype.renderTray = function () {
    var wrap = document.getElementById("tray-launch");
    if (wrap) {
      var h = "";
      for (var i = 0; i < 3; i++) h += '<span class="pick' + (i === this.armed ? " on" : "") + '" data-i="' + i + '">' + this.tray[i] + '</span>';
      wrap.innerHTML = h;
      var self = this;
      wrap.querySelectorAll(".pick").forEach(function (el) {
        el.addEventListener("click", function () { self.armed = parseInt(el.getAttribute("data-i"), 10); self.renderTray(); });
      });
    }
    var nw = document.getElementById("next-launch");
    if (nw) nw.innerHTML = this.next.join(" · ");
  };

  // ---------- 操作 ----------
  LaunchGame.prototype.bind = function () {
    var self = this;
    var cols = document.getElementById("cols-launch");
    if (cols) {
      cols.querySelectorAll("[data-col]").forEach(function (el) {
        el.addEventListener("click", function () { self.launch(parseInt(el.getAttribute("data-col"), 10)); });
      });
    }

    window.addEventListener("keydown", function (e) {
      if (e.code === "Digit1") { self.armed = 0; self.renderTray(); e.preventDefault(); return; }
      if (e.code === "Digit2") { self.armed = 1; self.renderTray(); e.preventDefault(); return; }
      if (e.code === "Digit3") { self.armed = 2; self.renderTray(); e.preventDefault(); return; }
      if (e.code === "KeyQ") { self.launch(0); e.preventDefault(); return; }
      if (e.code === "KeyW") { self.launch(1); e.preventDefault(); return; }
      if (e.code === "KeyE") { self.launch(2); e.preventDefault(); return; }
      if (e.code === "KeyR") { self.launch(3); e.preventDefault(); return; }
      if (e.code === "Space") {
        e.preventDefault();
        if (self.armed >= 0) {
          var bestC = 0, best = -1;
          for (var c = 0; c < COLS; c++) { var f = ROWS - colObjs(self.grid, c).length; if (f > best) { best = f; bestC = c; } }
          self.launch(bestC);
        }
      }
    });

    var rb = document.getElementById("launch-restart");
    if (rb) rb.addEventListener("click", function () { self.restart(); });
  };

  window.LaunchGame = LaunchGame;
})();