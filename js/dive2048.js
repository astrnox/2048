/* =============================================================
   DIVE · 除数合成版 2048
   参考 alexfink/dive：瓦片不是加倍，而是与其【约数】合并 ——
   两枚相邻瓦片，若一枚能整除另一枚，则合并为二者的【和】。
   出生种子是前四个质数 [2,3,5,7]；合成出新数字后做质因数分解，
   遇不到解锁的新质数会作为新种子加入，可用瓦片也随之变多。
   引擎独立，动画沿用经典套路（绝对定位 + transform 过渡 + 合体弹跳 + 新生浮现）。
   ============================================================= */
(function () {
  "use strict";

  var SIZE = 4, WIN_VAL = 2048;
  var PAD = 8, GAP = 10;
  var SEED_START = [2, 3, 5, 7];
  var _id = 0;

  function empty() { var g = []; for (var r = 0; r < SIZE; r++) g.push([null, null, null, null]); return g; }
  function newT(v) { return { v: v, id: ++_id }; }
  function emptyCells(g) { var o = []; for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) if (!g[r][c]) o.push({ r: r, c: c }); return o; }
  function maxVal(g) { var m = 0; for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) if (g[r][c] && g[r][c].v > m) m = g[r][c].v; return m; }
  function clone(g) { return g.map(function (row) { return row.slice(); }); }

  // 除数判定：a、b 任一能整除另一枚 → 返回合并值(二者之和)；否则 0
  function divisorMerge(a, b) {
    if (b !== 0 && a % b === 0) return a + b;
    if (a !== 0 && b % a === 0) return a + b;
    return 0;
  }

  // 质因数提取（取最少剩余）：用当前 seeds 反复约分，剩>1 即未解锁的新质数
  function extractPrimesFrom(n, seeds, i) {
    if (i >= seeds.length) return n;
    var min = extractPrimesFrom(n, seeds, i + 1);
    while (n % seeds[i] === 0) {
      n /= seeds[i];
      var c = extractPrimesFrom(n, seeds, i + 1);
      if (c < min) min = c;
    }
    return min;
  }

  function DiveGame(elBoard) {
    this.elBoard = elBoard;
    this.elScore = document.getElementById("dv-score");
    this.elBest = document.getElementById("dv-best");
    this.elSeeds = document.getElementById("dv-seeds");
    this.elMsg = document.getElementById("dv-msg");
    this.g = empty();
    this.score = 0;
    this.best = parseInt(localStorage.getItem("dive-best") || "0", 10);
    this.over = false; this.won = false; this.keep = false;
    this.seeds = SEED_START.slice();
    this.tilesSeen = SEED_START.slice();
    this.moves = null;   // 本步移动/合成动画数据
    this.fresh = null;
    this.unlock = null;  // 新解锁的质数
    this.cellW = 0; this.cellH = 0;

    this.spawn(); this.spawn();
    this.render(true);
    this.updateSeeds();
    this.bind();
  }

  DiveGame.prototype.seedWhiteList = function () {
    // 出生值只来自当前已解锁 seeds
    return this.seeds.slice();
  };

  DiveGame.prototype.spawn = function () {
    var cells = emptyCells(this.g);
    if (!cells.length) return;
    var p = cells[Math.floor(Math.random() * cells.length)];
    var pool = this.seeds;
    var v = pool[Math.floor(Math.random() * pool.length)];
    this.g[p.r][p.c] = newT(v);
  };

  DiveGame.prototype.move = function (dir) {
    if (this.over || (this.won && !this.keep)) return;
    var axis = (dir === 0 || dir === 2) ? 1 : 0;      // 竖/横
    var forward = (dir === 1 || dir === 2) ? -1 : 1;  // i=0 为目标端
    var g = clone(this.g);
    var res = this.collapseAll(g, axis, forward);
    if (!res.moved) return;
    this.g = g;
    this.moves = res.moves;
    this.score += res.gain;

    // 解锁新质数：对每个新合成瓦片做 约分 → 剩>1 为新增
    if (res.mergedIds) {
      var self = this;
      var added = [];
      res.mergedIds.forEach(function (id, k) {
        var n = res.mergedVals[k];
        if (!n || n <= 1) return;
        var rem = extractPrimesFrom(n, self.seeds, 0);
        if (rem > 1 && self.seeds.indexOf(rem) < 0 && self.tilesSeen.indexOf(rem) < 0) {
          added.push(rem);
        }
      });
      if (added.length) {
        this.seeds = this.seeds.concat(added);
        this.tilesSeen = this.tilesSeen.concat(added);
        this.unlock = added;
      }
    }

    this.spawn();
    if (window.Sound) { window.Sound.move(); if (res.merges > 0) window.Sound.merge(); }

    if (maxVal(this.g) >= WIN_VAL && !this.won) this.won = true;
    if (!this.canMove()) this.over = true;

    if (this.score > this.best) { this.best = this.score; localStorage.setItem("dive-best", String(this.best)); }
    this.updateSeeds();
    this.render();
    this.announce();
  };

  DiveGame.prototype.canMove = function () {
    if (emptyCells(this.g).length) return true;
    for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) {
      var t = this.g[r][c];
      if (!t) continue;
      var d = [ [0, 1], [1, 0] ];
      for (var k = 0; k < 2; k++) {
        var rr = r + d[k][0], cc = c + d[k][1];
        if (rr < SIZE && cc < SIZE && this.g[rr][cc]) {
          if (divisorMerge(t.v, this.g[rr][cc].v) > 0) return true;
        }
      }
    }
    return false;
  };

  DiveGame.prototype.collapseAll = function (g, axis, forward) {
    var moves = [], gain = 0, merges = 0, moved = false, lane,
        mergedIds = [], mergedVals = [];
    function coord(i) { return axis === 1 ? [(forward === 1 ? i : SIZE - 1 - i), lane] : [lane, (forward === 1 ? i : SIZE - 1 - i)]; }
    for (lane = 0; lane < SIZE; lane++) {
      var entries = [];
      for (var i = 0; i < SIZE; i++) { var rc = coord(i); if (g[rc[0]][rc[1]]) entries.push({ t: g[rc[0]][rc[1]], r: rc[0], c: rc[1] }); }
      // 滑行合并（i=0 为目标端）
      var out = [], j = 0;
      while (j < entries.length) {
        if (j + 1 < entries.length) {
          var mv = divisorMerge(entries[j].t.v, entries[j + 1].t.v);
          if (mv > 0) {
            var a = entries[j], b = entries[j + 1];
            var vt = newT(mv);
            out.push({ v: mv, id: vt.id, fromR: a.r, fromC: a.c, merge: true });
            gain += mv; merges++; moved = true;
            mergedIds.push(vt.id); mergedVals.push(mv);
            j += 2;
            continue;
          }
        }
        var e = entries[j];
        out.push({ v: e.t.v, id: e.t.id, fromR: e.r, fromC: e.c, merge: false });
        j++;
      }
      for (var m = 0; m < SIZE; m++) { var c2 = coord(m); g[c2[0]][c2[1]] = null; }
      for (var k = 0; k < out.length; k++) {
        var c3 = coord(k);
        g[c3[0]][c3[1]] = { v: out[k].v, id: out[k].id };
        if (!out[k].merge && (out[k].fromR !== c3[0] || out[k].fromC !== c3[1])) moved = true;
        moves.push({ fromR: out[k].fromR, fromC: out[k].fromC, toR: c3[0], toC: c3[1], v: out[k].v, merge: out[k].merge });
      }
    }
    return { moved: moved, gain: gain, merges: merges, moves: moves, mergedIds: mergedIds, mergedVals: mergedVals };
  };

  DiveGame.prototype.updateSeeds = function () {
    if (!this.elSeeds) return;
    this.elSeeds.textContent = this.seeds.join(" · ");
  };

  DiveGame.prototype.announce = function () {
    var u = this.unlock;
    this.unlock = null;
    if (this.over) this.say("棋盘无约可分 · 无路可走", false);
    else if ((this.won && !this.keep)) this.say('抵达 <b>2048</b>，整除之力尽显！<button class="grv-act" data-a="keep">再来合成</button><button class="grv-act" data-a="new">重开</button>', true);
    else if (this.elMsg) this.elMsg.style.display = "none";
    if (u && u.length && !this.over && !(this.won && !this.keep)) this.flashUnlock(u);
  };
  DiveGame.prototype.say = function (html, acts) {
    this.elMsg.innerHTML = html; this.elMsg.style.display = "block";
    var self = this;
    if (acts) this.elMsg.querySelectorAll("[data-a]").forEach(function (b) {
      b.addEventListener("click", function () { if (b.getAttribute("data-a") === "keep") self.keep = true; self.restart(); });
    });
  };
  DiveGame.prototype.flashUnlock = function (list) {
    var u = document.getElementById("dv-unlock");
    if (!u) return;
    u.innerHTML = "解锁 " + list.join(" · ");
    u.classList.remove("on"); void u.offsetWidth; u.classList.add("on");
    var self = this;
    if (this._unlockTimer) clearTimeout(this._unlockTimer);
    this._unlockTimer = setTimeout(function () { u.classList.remove("on"); }, 1800);
  };

  DiveGame.prototype.restart = function () {
    this.g = empty(); this.score = 0; this.won = false; this.over = false; this.keep = false;
    this.seeds = SEED_START.slice(); this.tilesSeen = SEED_START.slice();
    this.moves = null; this.fresh = null;
    var u = document.getElementById("dv-unlock"); if (u) u.classList.remove("on");
    if (this.elMsg) this.elMsg.style.display = "none";
    this.spawn(); this.spawn(); this.updateSeeds(); this.render(true);
  };

  // ---------- 渲染（绝对定位 + transform 动画，参照经典） ----------
  DiveGame.prototype.measure = function () {
    var w = this.elBoard.clientWidth || 260;
    this.cellW = (w - 2 * PAD - 3 * GAP) / 4;
    this.cellH = this.cellW;
  };
  DiveGame.prototype.render = function (initial) {
    this.elScore.textContent = this.score;
    this.elBest.textContent = this.best;
    this.measure();
    this.elBoard.innerHTML = "";
    var self = this;
    var start = {};
    if (this.moves) this.moves.forEach(function (m) { start[m.toR + "," + m.toC] = m; });
    if (this.fresh) { var f = this.fresh; if (!start[f.r + "," + f.c]) start[f.r + "," + f.c] = { fromR: 0, fromC: f.c, fresh: true }; }

    for (var i = 0; i < 16; i++) {
      var bg = document.createElement("div");
      bg.className = "dgbg";
      bg.style.left = (PAD + (i % 4) * (this.cellW + GAP)) + "px";
      bg.style.top = (PAD + Math.floor(i / 4) * (this.cellH + GAP)) + "px";
      bg.style.width = this.cellW + "px"; bg.style.height = this.cellH + "px";
      this.elBoard.appendChild(bg);
    }

    for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) {
      var t = this.g[r][c];
      if (!t) continue;
      var st = start[r + "," + c] || { fromR: r, fromC: c };
      var cell = document.createElement("div");
      cell.className = "dgtile t" + t.v;
      cell.textContent = t.v;
      cell.style.left = (PAD + c * (this.cellW + GAP)) + "px";
      cell.style.top = (PAD + r * (this.cellH + GAP)) + "px";
      cell.style.width = this.cellW + "px"; cell.style.height = this.cellH + "px";
      var dx = (st.fromC - c) * this.cellW, dy = (st.fromR - r) * this.cellH;
      if (st.merge) {
        cell.className += " dg-pop";
      } else if (dx !== 0 || dy !== 0) {
        cell.className += " dg-slide";
        cell.style.transform = "translate(" + dx + "px," + dy + "px)";
      } else if (!initial) {
        cell.className += " dg-static";
      }
      this.elBoard.appendChild(cell);
    }
    void this.elBoard.offsetHeight;
    window.requestAnimationFrame(function () {
      var els = self.elBoard.querySelectorAll(".dg-slide");
      for (var k = 0; k < els.length; k++) els[k].style.transform = "translate(0,0)";
    });
    this.moves = null; this.fresh = null;
  };

  DiveGame.prototype.bind = function () {
    var self = this;
    var KEYS = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };
    window.addEventListener("keydown", function (e) {
      var d = KEYS[e.code];
      if (d === undefined) return;
      e.preventDefault(); self.move(d);
    });
    if (window.bindSwipe) window.bindSwipe(this.elBoard, function (d) { self.move(d); });
  };

  window.DiveGame = DiveGame;
})();