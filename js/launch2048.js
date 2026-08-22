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
  // 下坠到位的耗时、后续每步连锁合成的间隔
  var DROP_MS = 520, STEP_MS = 320;
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
  // 候选牌：加权随机 2/4/8/16，让选择存在风险与取舍
  function genTray() {
    var t = [];
    for (var i = 0; i < 3; i++) {
      var r = Math.random();
      t.push(r < 0.5 ? 2 : (r < 0.8 ? 4 : (r < 0.94 ? 8 : 16)));
    }
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
    this.lastNewId = -1;      // 上次新生成的瓦片 id
    this.fallMoves = {};      // id -> 落下的起始行 fromRow（默认顶部 0）
    this.mergeIds = [];       // 本步合成产生的瓦片 id → 弹 pop
    this.launching = null;    // 下坠/连锁中的 {id, col, row}
    this.launchBusy = false;  // 下落或连锁完成前禁止再次发射
    this.merges = 0;          // 本次发射内累计合成步数
    this.nodes = {};          // id -> { outer, inner }

    // DOM
    this.elBoard = document.getElementById("board-launch");
    this.elScore = document.getElementById("launch-score");
    this.elBest  = document.getElementById("launch-best");
    this.elMsg   = document.getElementById("launch-msg");
    this.elCombo = document.getElementById("launch-combo");
    this.elCols  = document.getElementById("cols-launch");

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

  // 发射：方块必先受重力下落（到栈顶/底），再一步一连锁向下合成
  LaunchGame.prototype.launch = function (col) {
    if (this.over || this.armed < 0 || this.launchBusy) return;
    if (colFull(this.grid, col)) return;

    var val = this.tray[this.armed];
    var nt = newT(val);
    this.armed = -1;
    this.tray = this.next; this.next = genTray();
    this.renderTray();

    // 落在该列“栈顶”：下方有方块就落定在它上面；空列先落到最底
    var landing = ROWS - 1 - colObjs(this.grid, col).length;
    this.grid[landing][col] = nt;

    this.launching = { id: nt.id, col: col, row: landing };
    this.launchBusy = true;
    this.merges = 0;
    this.fallMoves = {}; this.fallMoves[nt.id] = 0;   // 从顶部下坠到 landing
    this.mergeIds = [];
    if (window.Sound) window.Sound.drop();             // 这一步只播“下落”

    this.render();

    var self = this;
    window.setTimeout(function () { self.cascade(); }, DROP_MS);
  };

  // 一步连锁：方块落到下方同数上则合成，再继续向下；直到无处可合
  LaunchGame.prototype.cascade = function () {
    if (!this.launching) return;
    var L = this.launching;
    var cur = this.grid[L.row] ? this.grid[L.row][L.col] : null;
    if (!cur) { this.finish(); return; }

    var nr = L.row + 1;
    var below = (nr < ROWS) ? this.grid[nr][L.col] : null;

    if (below && below.v === cur.v) {
      // 合成一步：上一格落到下一格上，翻倍
      var nv = cur.v * 2;
      var res = newT(nv);
      this.grid[nr][L.col] = res;      // 结果占据下方格
      this.grid[L.row][L.col] = null;  // 腾空上方格
      this.fallMoves = {}; this.fallMoves[res.id] = L.row;  // 从上一行落到这一行
      this.mergeIds = [res.id];
      this.launching = { id: res.id, col: L.col, row: nr };
      this.score += nv;
      this.merges++;
      if (this.merges >= 2) this.flashCombo(this.merges);
      if (window.Sound) window.Sound.merge();
      if (maxVal(this.grid) >= WIN_VAL && !this.won) this.won = true;

      this.render();

      var self = this;
      window.setTimeout(function () { self.cascade(); }, STEP_MS);
    } else {
      this.finish();   // 无处可合，本次发射结束
    }
  };

  // 本次发射结束
  LaunchGame.prototype.finish = function () {
    this.launching = null;
    this.launchBusy = false;
    this.fallMoves = {};
    this.mergeIds = [];
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
    this.fallMoves = {}; this.mergeIds = []; this.launching = null; this.launchBusy = false; this.merges = 0;
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
    if (this.mergeIds.indexOf(o.id) >= 0) inner.className += " pop";   // 本步合成 → 弹跳

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

  // 满列的发射键禁用
  LaunchGame.prototype.refreshCols = function () {
    var cols = this.elCols;
    if (!cols) return;
    var self = this;
    cols.querySelectorAll("[data-col]").forEach(function (el) {
      var c = parseInt(el.getAttribute("data-col"), 10);
      el.classList.toggle("full", colFull(self.grid, c));
    });
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

    // 受重力下坠的这颗：从起始行(fallMoves[id])落到落点行
    Object.keys(this.fallMoves).forEach(function (rid) {
      var node = self.nodes[rid];
      if (!node) return;
      var loc = self.findLoc(parseInt(rid, 10));
      if (!loc) return;
      var x = PAD + loc.c * (cw + GAP);
      var y = PAD + loc.r * (ch + GAP);
      var fromRow = (self.fallMoves[rid] != null) ? self.fallMoves[rid] : 0;
      var startY = (fromRow - loc.r) * (ch + GAP); // 起点在起始行
      node.outer.style.transition = "none";
      node.outer.style.transform = "translate(" + x + "px," + (y + startY) + "px)";
      void node.outer.offsetWidth;
      node.outer.style.transition = "transform 0.5s cubic-bezier(0.45, 0.05, 0.8, 0.42)";
      node.outer.style.transform = "translate(" + x + "px," + y + "px)";
    });
    this.fallMoves = {};
    this.mergeIds = [];

    this.refreshCols();   // 满列禁用
    this.lastNewId = -1;  // 只对当次发射生效
  };

  // ---------- 候选牌 ----------
  LaunchGame.prototype.renderTray = function () {
    var wrap = document.getElementById("tray-launch");
    if (wrap) {
      var h = "";
      for (var i = 0; i < 3; i++) {
        h += '<span class="pick v' + this.tray[i] + (i === this.armed ? " on" : "") + '" data-i="' + i + '">' + this.tray[i] + '</span>';
      }
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