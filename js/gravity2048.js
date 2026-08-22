/* =============================================================
   星球引力 · “万有坠” 
   你不推，你倾斜。← → 旋转这颗星让重力换向，Space 让它坠落。
   每次坠落，瓦片顺着重力落到底、同数相撞合体，
   一颗新星从顶部落入。合成 2048 即抵达星心。
   ============================================================= */
(function () {
  "use strict";

  var WIN_VAL = 2048;
  // 棋盘内部几何（与 gravity.css 一致：gap=6, padding=7）
  var PAD = 7, GAP = 6;

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

  // 链式合体逐格追踪：entries 为按"重力目标端在前"排列的瓦片 {v, r, c}
  // 返回 { out:[{v, r, c, fromR, fromC, merge}], merges, gained }
  // 数组下标 0 是最靠近重力目标端的格。
  function collapseAimTiles(entries) {
    var list = entries.slice();
    var out = [];
    var merges = 0, gained = 0;
    var i = 0;
    while (i < list.length) {
      if (i + 1 < list.length && list[i].v === list[i + 1].v) {
        var v = list[i].v * 2;
        // 结果瓦片落在靠重力一端(list[i])，但从这一组最远处(list[j-1])落下 → 可见“下落再合体”
        var fr = list[i].r, fc = list[i].c;
        var here = 1, g = v;
        var j = i + 2;
        while (j < list.length && list[j].v === v) { v *= 2; here++; g += v; j++; }
        merges += here; gained += g;
        out.push({ v: v, r: fr, c: fc, fromR: list[j - 1].r, fromC: list[j - 1].c, merge: true });
        i = j;
      } else {
        var t = list[i];
        out.push({ v: t.v, r: t.r, c: t.c, fromR: t.r, fromC: t.c, merge: false });
        i++;
      }
    }
    return { out: out, merges: merges, gained: gained };
  }

  // 用链式合体执行一次坠落（dir 为棋盘方向），并逐格记录移动轨迹，供重力动画回放
  function fallBoard(board, dir) {
    var b = clone(board);
    var gained = 0, moved = false, merges = 0;
    var moves = []; // {fromR,fromC,toR,toC,value,merge}
    var axis = (dir === 0 || dir === 2) ? 1 : 0;
    var forward = (dir === 1 || dir === 2) ? -1 : 1;
    var lane;
    function coord(i) {
      return axis === 0 ? [lane, (forward === 1 ? i : 3 - i)] : [(forward === 1 ? i : 3 - i), lane];
    }
    for (lane = 0; lane < 4; lane++) {
      // 重力方向（i=0 为目标端）取值
      var entries = [];
      for (var i = 0; i < 4; i++) {
        var rc = coord(i);
        var v = b[rc[0]][rc[1]];
        if (v) entries.push({ v: v, r: rc[0], c: rc[1] });
      }
      var res = collapseAimTiles(entries);
      // 清干净这一 lane 再回填（i=0 是目标端）
      for (var m = 0; m < 4; m++) { var c3 = coord(m); b[c3[0]][c3[1]] = 0; }
      for (var k = 0; k < res.out.length; k++) {
        var c2 = coord(k);
        b[c2[0]][c2[1]] = res.out[k].v;
        var or = res.out[k].fromR, oc = res.out[k].fromC;
        if (!res.out[k].merge && (or !== c2[0] || oc !== c2[1])) moved = true;
        if (res.out[k].merge) moved = true;
        moves.push({ fromR: or, fromC: oc, toR: c2[0], toC: c2[1], value: res.out[k].v, merge: res.out[k].merge });
      }
      gained += res.gained; merges += res.merges;
    }
    return { board: b, gained: gained, moved: moved, merges: merges, moves: moves };
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
    this.moves = [];   // 本次坠落位移轨迹：{fromR,fromC,toR,toC,value,merge}
    this.fresh = null; // 坠落结束后新落之星：{r,c,v}
    this.cellW = 0; this.cellH = 0;

    this.el = el;
    this.elBoard = document.getElementById("board-grav");
    this.elPlanet = document.querySelector(".starpit");
    this.elScore = document.getElementById("grav-score");
    this.elBest = document.getElementById("grav-best");
    this.elMsg = document.getElementById("grav-msg");
    this.elCompass = document.getElementById("compass");
    this.elCombo = document.getElementById("grav-combo");
    this.merges = 0;

    this.seed();
    this.render(true);
    this.bind();
  }

  OrbitGame.prototype.seed = function () {
    // 三颗瓦片开局
    for (var i = 0; i < 3; i++) this.spawnAtRandom();
  };

  OrbitGame.prototype.pickCell = function () {
    var cells = emptyCells(this.board);
    if (!cells.length) return null;
    if (window.Assist && window.Assist.get() !== "off") {
      var s = window.Assist.strength(window.Assist.get());
      var p = window.Assist.pick4(this.board, s);
      if (p) return { r: p.r, c: p.c };
    }
    var rc = cells[Math.floor(Math.random() * cells.length)];
    return { r: rc[0], c: rc[1] };
  };

OrbitGame.prototype.spawnAtRandom = function () {
    var p = this.pickCell();
    if (!p) return;
    var v = (window.Assist)
      ? window.Assist.spawnValue(window.Assist.get())
      : (Math.random() < 0.9 ? 2 : 4);
    this.board[p.r][p.c] = v;
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
    var dir = [2, 1, 0, 3][this.rot];
    var res = fallBoard(this.board, dir); // 屏幕正下，支持链式合体 + 位移轨迹
    if (!res.moved) return;
    this.board = res.board;
    this.moves = res.moves;
    this.score += res.gained;
    this.merges = res.merges;
    if (window.Sound) { window.Sound.drop(); if (res.merges > 0) window.Sound.merge(); }
    this.flashCombo();
    if (maxVal(this.board) >= WIN_VAL && !this.won) this.won = true;
    this.spawnFalling();
    if (!this.settled()) this.over = true;
    this.save();
    if (window.nudge) window.nudge(this.elPlanet, 2); // 坠落轻微的星球回弹
    this.render();
    this.announce();
  };

  OrbitGame.prototype.flashCombo = function () {
    if (this.elCombo && this.merges >= 2) {
      this.elCombo.textContent = "+" + this.merges + " 连击";
      this.elCombo.classList.remove("on");
      void this.elCombo.offsetWidth;
      this.elCombo.classList.add("on");
    } else if (this.elCombo) {
      this.elCombo.classList.remove("on");
    }
  };

  OrbitGame.prototype.spawnFalling = function () {
    var p = this.pickCell();
    if (!p) return;
    var v = (window.Assist)
      ? window.Assist.spawnValue(window.Assist.get())
      : (Math.random() < 0.9 ? 2 : 4);
    this.board[p.r][p.c] = v;
    this.fresh = { r: p.r, c: p.c, v: v };
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
    this.moves = []; this.fresh = null; this.merges = 0;
    if (this.elCombo) this.elCombo.classList.remove("on");
    this.seed();
    this.render(true);
    if (this.elMsg) this.elMsg.style.display = "none";
  };

  OrbitGame.prototype.measure = function () {
    var w = this.elBoard.clientWidth || 200;
    var h = this.elBoard.clientHeight || w;
    this.cellW = (w - 2 * PAD - 3 * GAP) / 4;
    this.cellH = (h - 2 * PAD - 3 * GAP) / 4;
  };

  OrbitGame.prototype.render = function (initial) {
    this.elScore.textContent = this.score;
    this.elBest.textContent = this.best;
    this.setCompass();
    this.measure();
    this.elBoard.innerHTML = "";
    var self = this;

    // 空槽底格（绝对定位铺满 4x4）
    for (var i = 0; i < 16; i++) {
      var bg = document.createElement("div");
      bg.className = "gbg";
      bg.style.left = (PAD + (i % 4) * (this.cellW + GAP)) + "px";
      bg.style.top = (PAD + Math.floor(i / 4) * (this.cellH + GAP)) + "px";
      bg.style.width = this.cellW + "px";
      bg.style.height = this.cellH + "px";
      this.elBoard.appendChild(bg);
    }

    // 本次位移轨迹 → 每格“来自”位置
    var start = {};
    this.moves.forEach(function (m) { start[m.toR + "," + m.toC] = { fromR: m.fromR, fromC: m.fromC, merge: m.merge }; });
    if (this.fresh) {
      var fg = this.fresh;
      if (!start[fg.r + "," + fg.c]) start[fg.r + "," + fg.c] = { fromR: 0, fromC: fg.c, fresh: true };
    }

    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
      var v = this.board[r][c];
      if (!v) continue;
      var cell = document.createElement("div");
      cell.className = "gcell";
      var st = start[r + "," + c] || { fromR: r, fromC: c };
      cell.style.left = (PAD + c * (this.cellW + GAP)) + "px";
      cell.style.top = (PAD + r * (this.cellH + GAP)) + "px";
      cell.style.width = this.cellW + "px";
      cell.style.height = this.cellH + "px";

      // 内层面：承载数值颜色与合体弹跳，外层负责位移/下坠（避免 transform 冲突）
      var face = document.createElement("div");
      face.className = "gface t" + v;
      if (v >= 2048) face.className += " star";
      face.textContent = v;
      cell.appendChild(face);

      var dx = (st.fromC - c) * this.cellW;
      var dy = (st.fromR - r) * this.cellH;
      if (st.fresh) {
        // 新生成的方块：在所在格子里原地浮现，不是从上方移动过来
        face.className += " g-new";
      } else if (st.merge) {
        // 合体：外层照常受重力落下，内层同时弹跳
        var mdur = Math.min(0.66, 0.24 + Math.abs(st.fromR - r) * 0.12);
        face.className += " g-pop";
        cell.className += " g-fall";
        cell.style.transitionDuration = mdur + "s";
        cell.style.transform = "translate(" + dx + "px," + dy + "px)";
      } else if (dx !== 0 || dy !== 0) {
        cell.className += " g-fall";
        var dur = Math.min(0.72, 0.26 + Math.abs(st.fromR - r) * 0.13);
        cell.style.transitionDuration = dur + "s";
        cell.style.transform = "translate(" + dx + "px," + dy + "px)";
      } else if (!initial) {
        cell.className += " g-static";
      }
      this.elBoard.appendChild(cell);
    }

    // 下一帧让 g-fall 位移归零 → 触发重力下坠过渡
    window.requestAnimationFrame(function () {
      var els = self.elBoard.querySelectorAll(".g-fall");
      for (var k = 0; k < els.length; k++) els[k].style.transform = "translate(0,0)";
    });

    this.moves = [];
    this.fresh = null;
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

    // 统一 指针(鼠标/触摸)：按住并左右拖动 → 实时旋转这颗星，松手吸附到 0/90/180/270；
    // 轻点 / 向下拖动 → 坠落
    var downX = 0, downY = 0, startT = 0, dragging = false, liveAngle = 0;
    var board = this.elBoard;
    board.addEventListener("pointerdown", function (e) {
      downX = e.clientX; downY = e.clientY; startT = Date.now(); dragging = false;
      liveAngle = self.rot * 90;
      board.style.transition = "none"; // 拖动时实时跟手
    });
    board.addEventListener("pointermove", function (e) {
      var dx = e.clientX - downX;
      if (Math.abs(e.clientX - downX) > 14 || Math.abs(e.clientY - downY) > 14) dragging = true;
      if (dragging) {
        liveAngle = self.rot * 90 + dx * 0.45;
        board.style.transform = "rotate(" + liveAngle + "deg)";
      }
    });
    board.addEventListener("pointerup", function (e) {
      board.style.transition = ""; // 恢复过渡，用于吸附动画
      var dx = e.clientX - downX, dy = e.clientY - downY;
      var adx = Math.abs(dx), ady = Math.abs(dy);
      if (dragging && adx >= ady) {
        // 吸附到最近的 90° 倍数（0/90/180/270）
        var snapped = Math.round(liveAngle / 90) * 90;
        self.rot = ((Math.round(snapped / 90) % 4) + 4) % 4;
        board.style.transform = "rotate(" + (self.rot * 90) + "deg)";
        self.setCompass();
        return;
      }
      if (!dragging && (Date.now() - startT) < 600) { self.drop(); return; } // 轻点
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