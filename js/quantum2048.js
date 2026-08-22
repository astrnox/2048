/* =============================================================
   Quantum 2048 · 量子叠加
   每颗瓦片有确定值 v，且可能处于"叠加态"(q)。滑动合并时：
     - 两枚同数相遇，若任一在叠加态 → 随机：相干增强(合成) 或 干涉相消(湮灭，新生光子)。
     - 定态相遇 → 正常合成。
   引擎独立，动画沿用经典套路（绝对定位 + transform 过渡 + 合体弹跳 + 新生浮现）。
   ============================================================= */
(function () {
  "use strict";

  var SIZE = 4, WIN_VAL = 2048;
  var PAD = 8, GAP = 10;
  // 量子干涉：叠加态相遇时 增强/相消 的概率
  var REINFORCE = 0.62;
  var _id = 0;

  function empty() { var g = []; for (var r = 0; r < SIZE; r++) g.push([null, null, null, null]); return g; }
  function newT(v, q) { return { v: v, q: !!q, id: ++_id }; }
  function emptyCells(g) { var o = []; for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) if (!g[r][c]) o.push({ r: r, c: c }); return o; }
  function maxVal(g) { var m = 0; for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) if (g[r][c] && g[r][c].v > m) m = g[r][c].v; return m; }
  function clone(g) { return g.map(function (row) { return row.slice(); }); }

  function QuantumGame(elBoard) {
    this.elBoard = elBoard;
    this.elScore = document.getElementById("q-score");
    this.elBest = document.getElementById("q-best");
    this.elCombo = document.getElementById("q-combo");
    this.elMsg = document.getElementById("q-msg");
    this.g = empty();
    this.score = 0;
    this.best = parseInt(localStorage.getItem("quantum-best") || "0", 10);
    this.over = false; this.won = false; this.keep = false;
    this.moves = null; // {fromR,fromC,toR,toC,v,q,merge,cancel}
    this.fresh = null;
    this.merges = 0; this.cancels = 0;
    this.cellW = 0; this.cellH = 0;

    this.spawn(); this.spawn();
    this.render(true);
    this.bind();
  }

  QuantumGame.prototype.spawn = function () {
    var cells = emptyCells(this.g);
    if (!cells.length) return;
    var p = cells[Math.floor(Math.random() * cells.length)];
    var v = Math.random() < 0.9 ? 2 : 4;
    this.g[p.r][p.c] = newT(v, Math.random() < 0.35);   // 约 1/3 是叠加态
  };

  QuantumGame.prototype.move = function (dir) {
    if (this.over || (this.won && !this.keep)) return;
    var axis = (dir === 0 || dir === 2) ? 1 : 0;      // 竖/横
    var forward = (dir === 1 || dir === 2) ? -1 : 1;  // i=0 为目标端
    var g = clone(this.g);
    var res = this.collapseAll(g, axis, forward);
    if (!res.moved) return;
    this.g = g;
    this.moves = res.moves;
    this.merges = res.merges;
    this.cancels = res.cancels;
    this.score += res.gain;

    // 干涉相消 → 湮灭出一颗"光子"随机重演
    if (res.cancels > 0) this.photon();
    this.spawn();
    if (window.Sound) { window.Sound.move(); if (res.merges > 0) window.Sound.merge(); }

    if (this.cancels >= 2) this.flashCombo();
    if (maxVal(this.g) >= WIN_VAL && !this.won) this.won = true;
    if (!this.canMove()) this.over = true;

    if (this.score > this.best) { this.best = this.score; localStorage.setItem("quantum-best", String(this.best)); }
    this.render();
    this.announce();
  };

  QuantumGame.prototype.canMove = function () {
    if (emptyCells(this.g).length) return true;
    for (var d = 0; d < 4; d++) {
      var axis = (d === 0 || d === 2) ? 1 : 0, forward = (d === 1 || d === 2) ? -1 : 1;
      var res = this.collapseAll(clone(this.g), axis, forward);
      if (res.moved) return true;
    }
    return false;
  };

  QuantumGame.prototype.photon = function () {
    var cells = emptyCells(this.g);
    if (!cells.length) return;
    var p = cells[Math.floor(Math.random() * cells.length)];
    this.g[p.r][p.c] = newT(Math.random() < 0.75 ? 2 : 4, false);
  };

  QuantumGame.prototype.collapseAll = function (g, axis, forward) {
    var moves = [], gain = 0, merges = 0, cancels = 0, moved = false, lane;
    function coord(i) { return axis === 1 ? [(forward === 1 ? i : SIZE - 1 - i), lane] : [lane, (forward === 1 ? i : SIZE - 1 - i)]; }
    for (lane = 0; lane < SIZE; lane++) {
      var entries = [];
      for (var i = 0; i < SIZE; i++) { var rc = coord(i); if (g[rc[0]][rc[1]]) entries.push({ t: g[rc[0]][rc[1]], r: rc[0], c: rc[1] }); }
      // 滑行合并（i=0 为目标端）
      var out = [], j = 0;
      while (j < entries.length) {
        if (j + 1 < entries.length && entries[j].t.v === entries[j + 1].t.v) {
          var a = entries[j], b = entries[j + 1];
          var quantum = a.t.q || b.t.q;
          if (quantum && Math.random() > REINFORCE) {
            cancels++;
            moved = true;    // 湮灭改变了局面，算一次可行走法
            j += 2;
            continue;
          }
          var v = a.t.v * 2, q = quantum ? false : (a.t.q && b.t.q);
          out.push({ v: v, q: q, fromR: a.r, fromC: a.c, merge: true });
          gain += v; merges++; moved = true; j += 2;
        } else {
          var e = entries[j];
          out.push({ v: e.t.v, q: e.t.q, fromR: e.r, fromC: e.c, merge: false });
          j++;
        }
      }
      for (var m = 0; m < SIZE; m++) { var c2 = coord(m); g[c2[0]][c2[1]] = null; }
      for (var k = 0; k < out.length; k++) {
        var c3 = coord(k);
        g[c3[0]][c3[1]] = newT(out[k].v, out[k].q);
        if (!out[k].merge && (out[k].fromR !== c3[0] || out[k].fromC !== c3[1])) moved = true;
        moves.push({ fromR: out[k].fromR, fromC: out[k].fromC, toR: c3[0], toC: c3[1], v: out[k].v, q: out[k].q, merge: out[k].merge });
      }
    }
    return { moved: moved, gain: gain, merges: merges, cancels: cancels, moves: moves };
  };

  QuantumGame.prototype.flashCombo = function () {
    if (!this.elCombo) return;
    this.elCombo.textContent = "×" + this.cancels + " 干涉相消";
    this.elCombo.classList.remove("on"); void this.elCombo.offsetWidth; this.elCombo.classList.add("on");
  };

  QuantumGame.prototype.announce = function () {
    if (this.over) this.say("棋局坍缩 · 无路可走", false);
    else if (this.won && !this.keep) this.say('抵达 <b>2048</b> 叠加求心！<button class="grv-act" data-a="keep">观测继续</button><button class="grv-act" data-a="new">再坍缩一局</button>', true);
    else if (this.elMsg) this.elMsg.style.display = "none";
  };
  QuantumGame.prototype.say = function (html, acts) {
    this.elMsg.innerHTML = html; this.elMsg.style.display = "block";
    var self = this;
    if (acts) this.elMsg.querySelectorAll("[data-a]").forEach(function (b) {
      b.addEventListener("click", function () { if (b.getAttribute("data-a") === "keep") self.keep = true; self.restart(); });
    });
  };

  QuantumGame.prototype.restart = function () {
    this.g = empty(); this.score = 0; this.won = false; this.over = false; this.keep = false;
    this.merges = 0; this.cancels = 0;
    if (this.elCombo) this.elCombo.classList.remove("on");
    this.spawn(); this.spawn(); this.render(true);
    if (this.elMsg) this.elMsg.style.display = "none";
  };

  // ---------- 渲染（绝对定位 + transform 动画，参照经典） ----------
  QuantumGame.prototype.measure = function () {
    var w = this.elBoard.clientWidth || 260;
    this.cellW = (w - 2 * PAD - 3 * GAP) / 4;
    this.cellH = this.cellW;
  };
  QuantumGame.prototype.render = function (initial) {
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
      bg.className = "qbg";
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
      cell.className = "qtile" + (t.q ? " q-super" : "") + " t" + t.v;
      cell.textContent = t.v;
      cell.style.left = (PAD + c * (this.cellW + GAP)) + "px";
      cell.style.top = (PAD + r * (this.cellH + GAP)) + "px";
      cell.style.width = this.cellW + "px"; cell.style.height = this.cellH + "px";
      var dx = (st.fromC - c) * this.cellW, dy = (st.fromR - r) * this.cellH;
      if (st.merge) {
        cell.className += " q-pop";
      } else if (dx !== 0 || dy !== 0) {
        cell.className += " q-slide";
        cell.style.transform = "translate(" + dx + "px," + dy + "px)";
      } else if (!initial) {
        cell.className += " q-static";
      }
      this.elBoard.appendChild(cell);
    }
    void this.elBoard.offsetHeight;
    window.requestAnimationFrame(function () {
      var els = self.elBoard.querySelectorAll(".q-slide");
      for (var k = 0; k < els.length; k++) els[k].style.transform = "translate(0,0)";
    });
    this.moves = null; this.fresh = null;
  };

  QuantumGame.prototype.bind = function () {
    var self = this;
    // 键盘 + 四向滑动
    var KEYS = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };
    window.addEventListener("keydown", function (e) {
      var d = KEYS[e.code];
      if (d === undefined) return;
      e.preventDefault(); self.move(d);
    });
    if (window.bindSwipe) window.bindSwipe(this.elBoard, function (d) { self.move(d); });
  };

  window.QuantumGame = QuantumGame;
})();