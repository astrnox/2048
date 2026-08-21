/* =============================================================
   蜂窝·六边形 2048
   A 2048 variant on a hexagon board (axial coords), SVG-rendered.
   - 6 move directions: W/A/S/D + Q/E  (arrow keys + Q/E too)
   ============================================================= */
(function () {
  "use strict";

  var S = 7;             // tile "size" (center to vertex) in px, scaled by R
  var RADIUS = 42;       // hex radius in viewBox units
  var GRID_S = 2;        // hex region: -GRID_S..GRID_S (19 cells)
  var WIN_VAL = 2048;

  // Axial neighbors (6 directions)
  var DIRS = [
    { q: 1,  r: 0 },   // E
    { q: 0,  r: 1 },   // SE
    { q: -1, r: 1 },   // SW
    { q: -1, r: 0 },   // W
    { q: 0,  r: -1 },  // NW
    { q: 1,  r: -1 }   // NE
  ];

  // Key -> direction index (6 directions). Arrows + WASD / C / Z / Q.
  var KEYS = {
    ArrowRight: 0, KeyD: 0,
    ArrowDown:  1, KeyS: 1,
    KeyC: 2,      KeyZ: 2,
    ArrowLeft: 3, KeyA: 3,
    ArrowUp:   4, KeyW: 4,
    KeyQ: 5
  };

  function inRange(q, r) {
    return q >= -GRID_S && q <= GRID_S && r >= -GRID_S && r <= GRID_S &&
           (q + r) >= -GRID_S && (q + r) <= GRID_S;
  }

  function key(q, r) { return q + "," + r; }

  // Pixel center of a cell (pointy-top)
  function center(q, r) {
    return {
      x: RADIUS * Math.sqrt(3) * (q + 0.5 * r),
      y: RADIUS * 1.5 * r
    };
  }

  function hexPoints(cx, cy, rad) {
    var pts = [];
    for (var i = 0; i < 6; i++) {
      var a = Math.PI / 180 * (90 + 60 * i);
      pts.push(((cx + rad * Math.cos(a)).toFixed(2) + "," +
                (cy + rad * Math.sin(a)).toFixed(2)));
    }
    return pts.join(" ");
  }

  function tileColor(val) {
    var colors = {
      2: "#1c2824", 4: "#202f29", 8: "#24352e", 16: "#2a3b36",
      32: "#31453f", 64: "#38494e", 128: "#46584a", 256: "#546845",
      512: "#6c7a42", 1024: "#858a3e", 2048: "#7ad6a4",
      4096: "#dfe6dd", 8192: "#e8f2ea"
    };
    return colors[val] || "#dfe6dd";
  }
  function tileTextColor(val) {
    if (val === 2048) return "#07120c";
    if (val === 2 || val === 4) return "#8be0b4";
    if (val >= 4096) return "#0a0d11";
    return "#fffff0";
  }
  function tileFontSize(val) {
    if (val < 100)  return "28px";
    if (val < 1000) return "23px";
    if (val < 10000)return "16px";
    return "12px";
  }

  function HexGame(container) {
    this.container = container;
    this.board = {};    // key -> value
    this.score = 0;
    this.best = 0;
    this.won = false;
    this.over = false;
    this.keepPlaying = false;

    this.nodeByKey = {}; // key -> <g> element

    this.buildSVG();
    this.bindInput();
    this.setup();
  }

  HexGame.prototype.buildSVG = function () {
    var self = this;

    // compute bounds
    var xs = [], ys = [];
    for (var q = -GRID_S; q <= GRID_S; q++)
      for (var r = -GRID_S; r <= GRID_S; r++) {
        if (!inRange(q, r)) continue;
        var c = center(q, r);
        xs.push(c.x); ys.push(c.y);
      }
    var minX = Math.min.apply(null, xs) - RADIUS * 1.15;
    var maxX = Math.max.apply(null, xs) + RADIUS * 1.15;
    var minY = Math.min.apply(null, ys) - RADIUS * 1.15;
    var maxY = Math.max.apply(null, ys) + RADIUS * 1.15;
    var w = maxX - minX, h = maxY - minY;

    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("viewBox", minX.toFixed(1) + " " + minY.toFixed(1) + " " + w.toFixed(1) + " " + h.toFixed(1));
    this.svg.style.width = "100%";
    this.svg.style.maxWidth = "480px";
    this.svg.style.height = "auto";
    this.svg.setAttribute("role", "img");

    // background cells
    var cells = this.cellsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    for (var q = -GRID_S; q <= GRID_S; q++)
      for (var r = -GRID_S; r <= GRID_S; r++) {
        if (!inRange(q, r)) continue;
        var cen = center(q, r);
        var poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        poly.setAttribute("points", hexPoints(cen.x, cen.y, RADIUS));
        poly.setAttribute("fill", "rgba(238,228,218,0.35)");
        poly.setAttribute("stroke", "#bbada0");
        poly.setAttribute("stroke-width", "1");
        cells.appendChild(poly);
      }
    // tiles group
    this.tilesGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");

    this.svg.appendChild(cells);
    this.svg.appendChild(this.tilesGroup);

    function transform(svg, scale) {
      svg.style.transform = "scale(" + scale + ")";
      svg.style.transformOrigin = "50% 50%";
    }
    // responsive shrink for small screens
    if (window.innerWidth < 420) transform(self.svg, 0.8);

    this.container.appendChild(this.svg);
  };

  HexGame.prototype.bindInput = function () {
    var self = this;
    window.addEventListener("keydown", function (e) {
      var idx = KEYS[e.code];
      if (idx === undefined) return;
      e.preventDefault();
      this.move(DIRS[idx]);
    }.bind(this));

    // 手机八向滑动：含对角线，映射到六边网格的全部六个方向
    // 右=E(0) 右下=SE(1) 下≈SE(1) 左下=SW(2) 左=W(3) 左上=NW(4) 上≈NW(4) 右上=NE(5)
    var SWIPE8_TO = { 1: 0, 5: 1, 2: 1, 6: 2, 3: 3, 7: 4, 0: 4, 4: 5 };
    // 六边方向 → 用于视觉推力的四向
    var NUDGE_DIR = { 0: 1, 1: 2, 2: 2, 3: 3, 4: 0, 5: 0 };
    if (window.bindSwipe8) {
      window.bindSwipe8(this.container, function (code) {
        var idx = SWIPE8_TO[code];
        self.move(DIRS[idx]);
        if (window.nudge) window.nudge(self.container, NUDGE_DIR[idx]);
      });
    }
  };

  HexGame.prototype.emptyCells = function () {
    var out = [];
    for (var q = -GRID_S; q <= GRID_S; q++)
      for (var r = -GRID_S; r <= GRID_S; r++) {
        if (inRange(q, r) && !(key(q, r) in this.board)) out.push({ q: q, r: r });
      }
    return out;
  };

  HexGame.prototype.addStartTiles = function () {
    this.spawn(); this.spawn();
  };

  HexGame.prototype.spawn = function () {
    var empties = this.emptyCells();
    if (!empties.length) return;
    var c = empties[Math.floor(Math.random() * empties.length)];
    this.board[key(c.q, c.r)] = Math.random() < 0.9 ? 2 : 4;
  };

  HexGame.prototype.movesAvailable = function () {
    return this.emptyCells().length > 0 || this.tileMatchesAvailable();
  };

  HexGame.prototype.tileMatchesAvailable = function () {
    for (var i = 0; i < DIRS.length; i++) {
      var d = DIRS[i];
      for (var q = -GRID_S; q <= GRID_S; q++)
        for (var r = -GRID_S; r <= GRID_S; r++) {
          if (!inRange(q, r)) continue;
          var k = key(q, r);
          var nk = key(q + d.q, r + d.r);
          if ((k in this.board) && (nk in this.board) && this.board[k] === this.board[nk]) return true;
        }
    }
    return false;
  };

  HexGame.prototype.step = function (q, r, d) { return { q: q + d.q, r: r + d.r }; };

  HexGame.prototype.findFarthest = function (q, r, d) {
    var prev = { q: q, r: r };
    var cur = this.step(prev.q, prev.r, d);
    while (inRange(cur.q, cur.r) && !(key(cur.q, cur.r) in this.board)) {
      prev = cur;
      cur = this.step(prev.q, prev.r, d);
    }
    return { farthest: prev, next: cur };
  };

  HexGame.prototype.move = function (d) {
    if (this.over || (this.won && !this.keepPlaying)) return;

    // process cells from the far side of d
    var cells = [];
    for (var q = -GRID_S; q <= GRID_S; q++)
      for (var r = -GRID_S; r <= GRID_S; r++) {
        if (inRange(q, r) && (key(q, r) in this.board)) cells.push({ q: q, r: r });
      }
    cells.sort(function (a, b) {
      return (b.q * d.q + b.r * d.r) - (a.q * d.q + a.r * d.r);
    });

    var moved = false;
    var self = this;
    var mergedThisMove = {};

    cells.forEach(function (cell) {
      var fromK = key(cell.q, cell.r);
      if (!(fromK in self.board)) return;
      var val = self.board[fromK];

      var f = self.findFarthest(cell.q, cell.r, d);
      var nextK = key(f.next.q, f.next.r);

      if (inRange(f.next.q, f.next.r) &&
          (nextK in self.board) &&
          self.board[nextK] === val &&
          !(nextK in mergedThisMove)) {
        // merge
        delete self.board[fromK];
        self.board[nextK] = val * 2;
        mergedThisMove[nextK] = true;
        self.score += val * 2;
        if (val * 2 === WIN_VAL) self.won = true;
        self.flash = nextK;
        moved = true;
      } else if (fromK !== key(f.farthest.q, f.farthest.r)) {
        delete self.board[fromK];
        self.board[key(f.farthest.q, f.farthest.r)] = val;
        moved = true;
      }
    });

    if (moved) {
      this.spawn();
      if (!this.movesAvailable()) this.over = true;
      this.actuate();
    }
  };

  HexGame.prototype.restart = function () {
    this.board = {};
    this.score = 0;
    this.won = false;
    this.over = false;
    this.keepPlaying = false;
    this.addStartTiles();
    this.actuate();
  };

  HexGame.prototype.setup = function () {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem("hex2048")); } catch (e) {}
    if (saved && saved.board) {
      this.board = saved.board;
      this.score = saved.score || 0;
      this.won = saved.won || false;
      this.over = saved.over || false;
      this.keepPlaying = saved.keepPlaying || false;
    } else {
      this.addStartTiles();
    }
    this.best = parseInt(localStorage.getItem("hex2048-best") || "0", 10);
    this.actuate();
  };

  HexGame.prototype.actuate = function () {
    if (this.score > this.best) this.best = this.score;
    try {
      localStorage.setItem("hex2048-best", String(this.best));
      if (!this.over) localStorage.setItem("hex2048", JSON.stringify({ board: this.board, score: this.score, won: this.won, over: this.over, keepPlaying: this.keepPlaying }));
      else localStorage.removeItem("hex2048");
    } catch (e) {}

    this.updateHud();
    this.render();
  };

  HexGame.prototype.updateHud = function () {
    var scoreEl = document.getElementById("hex-score");
    var bestEl = document.getElementById("hex-best");
    var msgEl = document.getElementById("hex-message");
    if (scoreEl) scoreEl.textContent = this.score;
    if (bestEl) bestEl.textContent = this.best;

    if (this.over) {
      msgEl.textContent = "棋盘满了！得分 " + this.score;
      msgEl.style.display = "block";
    } else if (this.won && !this.keepPlaying) {
      msgEl.textContent = "你合成了 2048！";
      msgEl.innerHTML = '你合成了 <b>2048</b>！<button id="keep">继续</button> <button id="restart2">重来</button>';
      msgEl.style.display = "block";
    } else {
      msgEl.style.display = "none";
    }
  };

  HexGame.prototype.render = function () {
    // remove nodes no longer present
    var self = this;
    Object.keys(this.nodeByKey).forEach(function (k) {
      if (!(k in self.board)) {
        self.tilesGroup.removeChild(self.nodeByKey[k]);
        delete self.nodeByKey[k];
      }
    });

    for (var q = -GRID_S; q <= GRID_S; q++)
      for (var r = -GRID_S; r <= GRID_S; r++) {
        if (!inRange(q, r)) continue;
        var k = key(q, r);
        if (!(k in this.board)) continue;
        var isNew = !(k in this.nodeByKey);
        var g = isNew ? this.makeTile(k) : this.nodeByKey[k];
        this.positionTile(g, center(q, r), this.board[k], k === this.flash, isNew);
      }
    this.flash = null;
  };

  HexGame.prototype.makeTile = function (k) {
    var NS = "http://www.w3.org/2000/svg";
    var g = document.createElementNS(NS, "g");
    g.setAttribute("class", "hex-tile");

    var poly = document.createElementNS(NS, "polygon");
    poly.setAttribute("points", hexPoints(0, 0, RADIUS));
    var txt = document.createElementNS(NS, "text");

    g.appendChild(poly);
    g.appendChild(txt);

    this.tilesGroup.appendChild(g);
    this.nodeByKey[k] = g;
    return g;
  };

  HexGame.prototype.positionTile = function (g, c, val, isFlash, isNew) {
    var poly = g.childNodes[0];
    var txt = g.childNodes[1];
    poly.setAttribute("fill", tileColor(val));
    txt.setAttribute("fill", tileTextColor(val));
    txt.setAttribute("text-anchor", "middle");
    txt.setAttribute("dominant-baseline", "central");
    txt.setAttribute("class", "hex-text");
    txt.setAttribute("style", "font-size:" + tileFontSize(val));
    txt.textContent = val;

    // 用 CSS transform 驱动移动，让 .hex-tile 的 transition 平滑滑动
    g.style.transform = "translate(" + c.x.toFixed(2) + "px," + c.y.toFixed(2) + "px)";
    var cls = "hex-tile";
    if (isFlash) cls += " hex-merged";
    if (isNew) cls += " hex-new";
    g.setAttribute("class", cls);
  };

  window.HexGame = HexGame;
})();