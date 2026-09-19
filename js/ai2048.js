/* =============================================================
   AI 对抗模式 · 人机双棋盘 + 双向捣乱 + 情绪化反馈
   =============================================================
   规则
   - 你(左)与 AI(右)各占一棋盘，各自正常合成。
   - 先合成 2048 者胜；任一棋盘无有效移动立即判负；双死比得分。
   - 捣乱技能点：每完成 1 轮（你 1 步 + AI 1 步）双方各 +1 点（上限 2）。
     攒≥1 点可自愿在对方盘空位放一个 2/4（可跳过、可自动插桩）。
   - 地狱：AI 接管玩家盘对抗生成、自盘用可复现生成(自 know)；其余难度中立/未知。
   - AI 走子：MCTS（UCB1/PUCT + 贪婪 rollout），地狱放内联 Blob Web Worker 后台跑。
   ============================================================= */
(function () {
  "use strict";

  var WIN_VAL = 2048;
  var DIRS4 = [0, 1, 2, 3]; // up / right / down / left

  /* ================= 基础棋盘工具 ================= */
  function emptyBoard() {
    var b = [];
    for (var i = 0; i < 4; i++) b.push([0, 0, 0, 0]);
    return b;
  }
  function clone(b) { return b.map(function (r) { return r.slice(); }); }
  function emptyCells(b) {
    var out = [];
    for (var r = 0; r < 4; r++)
      for (var c = 0; c < 4; c++)
        if (b[r][c] === 0) out.push([r, c]);
    return out;
  }
  function forEach(b, fn) {
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) fn(b[r][c], r, c);
  }

  function placeTile(board, r, c, val) { if (!board[r][c]) board[r][c] = val; }
  // 在随机空位放 val；无空位返回 -1
  function addTileEmpty(board, val, cells) {
    var cs = cells || emptyCells(board);
    if (!cs.length) return -1;
    var p = cs[(Math.random() * cs.length) | 0];
    board[p[0]][p[1]] = val;
    return p[0] * 4 + p[1];
  }
  function spawn(b, p4) { // 中立随机生成（兼容旧调用）
    var cells = emptyCells(b);
    if (!cells.length) return false;
    var p = cells[(Math.random() * cells.length) | 0];
    b[p[0]][p[1]] = Math.random() < (p4 == null ? 0.1 : p4) ? 4 : 2;
    return true;
  }

  /* ---- 从空位随机抽样（限制计算量） ---- */
  function sampleCells(cells, k) {
    var copy = cells.slice(), res = [];
    while (copy.length && res.length < k) {
      var i = (Math.random() * copy.length) | 0;
      res.push(copy[i]); copy.splice(i, 1);
    }
    return res;
  }

  var PAD = 8, GAP = 8; // 棋盘几何（与 ai.css 一致）

  /* ================= 移动引擎（与经典一致） ================= */
  function tryMove(board, dir) {
    var b = clone(board), gained = 0, moved = false, merges = 0;
    var axis = (dir === 0 || dir === 2) ? 1 : 0;
    var forward = (dir === 1 || dir === 2) ? -1 : 1;
    function slideMerge(vals) {
      var nz = vals.filter(function (v) { return v !== 0; });
      var out = [], m = nz.length !== vals.length, g = 0, mg = 0;
      for (var i = 0; i < nz.length; i++) {
        if (i + 1 < nz.length && nz[i] === nz[i + 1]) {
          out.push(nz[i] * 2); g += nz[i] * 2; mg++; i++; m = true;
        } else out.push(nz[i]);
      }
      while (out.length < 4) out.push(0);
      return { line: out, gained: g, moved: m, merges: mg };
    }
    for (var lane = 0; lane < 4; lane++) {
      var vals = [];
      for (var i = 0; i < 4; i++) {
        var rr = axis === 0 ? lane : (forward === 1 ? i : 3 - i);
        var cc = axis === 0 ? (forward === 1 ? i : 3 - i) : lane;
        vals.push(b[rr][cc]);
      }
      var res = slideMerge(vals);
      if (res.moved) moved = true;
      gained += res.gained; merges += res.merges;
      for (var j = 0; j < 4; j++) {
        var rr2 = axis === 0 ? lane : (forward === 1 ? j : 3 - j);
        var cc2 = axis === 0 ? (forward === 1 ? j : 3 - j) : lane;
        b[rr2][cc2] = res.line[j];
      }
    }
    return { board: b, gained: gained, moved: moved, merges: merges };
  }

  function maxVal(b) { var m = 0; forEach(b, function (v) { if (v > m) m = v; }); return m; }
  function lg(v) { return v ? Math.log(v) / Math.LN2 : 0; }

  var W = [
    [16, 15, 14, 13],
    [ 9,  8,  7, 12],
    [ 5,  4,  6, 11],
    [ 1,  2,  3, 10]
  ];

  function heuristic(board) {
    var empty = 0, corner = 0, smooth = 0, mono = 0, mergable = 0;
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
      var v = board[r][c];
      if (!v) { empty++; continue; }
      var l = lg(v);
      corner += l * W[r][c];
      if (c + 1 < 4 && board[r][c + 1]) {
        smooth -= Math.abs(l - lg(board[r][c + 1]));
        if (board[r][c + 1] === v) mergable += v;
      }
      if (r + 1 < 4 && board[r + 1][c]) {
        smooth -= Math.abs(l - lg(board[r + 1][c]));
        if (board[r + 1][c] === v) mergable += v;
      }
    }
    for (var x = 0; x < 4; x++) {
      for (var y = 0; y < 3; y++) {
        var a = board[x][y], b = board[x][y + 1];
        if (b && a) mono -= (lg(a) > lg(b)) ? 0 : (lg(b) - lg(a));
        var u = board[y][x], w = board[y + 1][x];
        if (w && u) mono -= (lg(u) > lg(w)) ? 0 : (lg(w) - lg(u));
      }
    }
    return corner + smooth * 2.8 + mono * 1.3 + empty * 270 + mergable * 0.7;
  }

  function deadOr(b) {
    if (emptyCells(b).length) return false;
    for (var r = 0; r < 4; r++)
      for (var c = 0; c < 4; c++) {
        if (c + 1 < 4 && b[r][c + 1] === b[r][c]) return false;
        if (r + 1 < 4 && b[r + 1][c] === b[r][c]) return false;
      }
    return true;
  }

  /* 纯胜负判定：先达 2048 胜 > 死盘立即判负 > 双死比分。
     opt: {ceil, ps, bs, winVal} */
  function decideWinner(p, b, opt) {
    opt = opt || {};
    var win = opt.winVal || WIN_VAL;
    var p2048 = maxVal(p) >= win;
    var CEILED = (opt.ceil > 0 && maxVal(b) > opt.ceil);
    var b2048 = CEILED ? false : maxVal(b) >= win;
    var pd = deadOr(p), bd = deadOr(b);
    if (p2048) return { winner: "p", reason: "reach2048" };
    if (b2048) return { winner: "b", reason: "reach2048" };
    if (pd && bd) return { winner: (opt.ps >= opt.bs) ? "p" : "b", reason: "both-dead" }; // 同时死 → 比得分
    if (pd) return { winner: "b", reason: "player-dead" };
    if (bd) return { winner: "p", reason: "bot-dead" };
    if (CEILED) return { winner: "p", reason: "bot-ceil" };
    return { winner: null, reason: null };
  }

  /* ================= 可复现 PRNG（Mulberry32） ================= */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // 简单整数哈希：给定 (counter, len) -> [0,len)
  function hashIndex(counter, salt, len) {
    var h = (counter >>> 0) ^ (salt * 0x9E3779B9);
    h = (h ^ (h >>> 16)) * 0x21F0AAAD >>> 0;
    h = (h ^ (h >>> 15)) >>> 0;
    return h % len;
  }

  /* 地狱自盘生成：以 counter 为种子的确定性生成。
     纯函数(board, counter)：AI 只要模拟同一序列即可"精确预知自盘 (格,值)"。 */
  function hellOwnSpawn(board, counter) {
    var cells = emptyCells(board);
    if (!cells.length) return null;
    var idx = hashIndex(counter, 12, cells.length);
    var val = (hashIndex(counter, 77, 5) === 0) ? 4 : 2; // 确定性 4 率
    return { r: cells[idx][0], c: cells[idx][1], v: val };
  }

  /* ================= 对抗/助益放置 ================= */
  function playerBestAfter(board, dir) {
    var res = tryMove(board, dir);
    if (!res.moved) return -Infinity;
    return heuristic(res.board);
  }
  // 对抗放置：落"玩家最优应对后评分最低"的空位；minGap 保证最少空位数（不无限堵死）
  function spawnWorst(b, minGap) {
    var cells = emptyCells(b);
    if (!cells.length) return false;
    if (minGap && cells.length <= minGap) return false; // 保留最小可玩间隙
    var bestCell = null, bestVal = 2, worstVal = Infinity;
    var cands = sampleCells(cells, Math.min(cells.length, 14));
    for (var i = 0; i < cands.length; i++) {
      var rc = cands[i];
      for (var vi = 0; vi < 2; vi++) {
        var v = vi === 0 ? 2 : 4;
        var nb = clone(b); placeTile(nb, rc[0], rc[1], v);
        var best = -Infinity;
        for (var d = 0; d < 4; d++) { var s = playerBestAfter(nb, d); if (s > best) best = s; }
        if (best < worstVal) { worstVal = best; bestCell = rc; bestVal = v; }
      }
    }
    if (bestCell) placeTile(b, bestCell[0], bestCell[1], bestVal);
    return true;
  }
  function spawnHelp(b) {
    var cells = emptyCells(b);
    if (!cells.length) return false;
    var bestCell = null, hi = -Infinity;
    var cands = sampleCells(cells, Math.min(cells.length, 12));
    for (var i = 0; i < cands.length; i++) {
      var nb = clone(b); placeTile(nb, cands[i][0], cands[i][1], 2);
      var best = -Infinity;
      for (var d = 0; d < 4; d++) { var s = playerBestAfter(nb, d); if (s > best) best = s; }
      if (best > hi) { hi = best; bestCell = cands[i]; }
    }
    if (bestCell) placeTile(b, bestCell[0], bestCell[1], 2);
    return true;
  }

  /* ================= 地狱「猫腻」· 操控玩家盘生成 =================
     开局看起来与普通档完全一样（中立随机 2/4），
     但之后的每次“系统补子”，AI 都暗中把【落点 + 数值】都往对玩家
     最不利的方向刁钻：三种伪装策略轮换，玩家只当是系统随机生成。
       策略 A（精准落刀）：找"放 2/4/8 后玩家最优应对评分最低"的空位，落最狠。
       策略 B（次恶伪装）：在前几个次痛空位里随机掷价值，看似随机实则针对性。
       策略 C（完全伪装）：纯随机空位 + 标准 10% 出 4，彻底迷惑。
      数值随盘面变紧而升级（空位少→更多 4/8），越后期越凶狠，但仍“像随机”。 */
  function hellPlayerSpawn(b) {
    var cells = emptyCells(b);
    if (!cells.length) return false;
    var e = cells.length;
    function rollVal() {
      var r = Math.random();
      if (e <= 4)  return r < 0.22 ? 8 : (r < 0.62 ? 4 : 2); // 紧盘：喷 8
      if (e <= 7)  return r < 0.08 ? 8 : (r < 0.45 ? 4 : 2); // 中压
      return r < 0.35 ? 4 : 2;                                // 松盘：大致像普通
    }
    function harm(rc, v) {
      var nb = clone(b); placeTile(nb, rc[0], rc[1], v);
      var best = -Infinity;
      for (var d = 0; d < 4; d++) { var s = playerBestAfter(nb, d); if (s > best) best = s; }
      return best;
    }
    var cands = sampleCells(cells, Math.min(cells.length, 16));
    var mode = Math.random();
    if (mode < 0.55) {
      // 策略 A：精准落刀（最痛点，微激励 4）
      var worstCell = null, worstV = 2, wv = Infinity;
      for (var i = 0; i < cands.length; i++)
        for (var vi = 0; vi < 3; vi++) {
          var v = vi === 0 ? 2 : (vi === 1 ? 4 : 8);
          if (v === 8 && e > 6) continue;                 // 松盘不放 8，避免显眼
          var h = harm(cands[i], v);
          if (v === 4 && e >= 5) h -= 12;                 // 悄悄多用 4（更隐蔽更伤）
          if (h < wv) { wv = h; worstCell = cands[i]; worstV = v; }
        }
      if (worstCell) placeTile(b, worstCell[0], worstCell[1], worstV);
      return true;
    }
    if (mode < 0.85) {
      // 策略 B：次恶伪装（前 K 个次痛空位里随机掷价值）
      var ranked = [];
      for (var rk = 0; rk < cands.length; rk++) ranked.push({ rc: cands[rk], h: harm(cands[rk], 2) });
      ranked.sort(function (a, b) { return a.h - b.h; });
      var pick = ranked[(Math.random() * Math.min(4, ranked.length)) | 0];
      placeTile(b, pick.rc[0], pick.rc[1], rollVal());
      return true;
    }
    // 策略 C：完全伪装（标准随机，迷惑玩家）
    var p = cells[(Math.random() * cells.length) | 0];
    placeTile(b, p[0], p[1], Math.random() < 0.1 ? 4 : 2);
    return true;
  }

  /* ================= MCTS 工厂（自包含，Worker 与主线程共用） =================
     设计成 `mctsFactory.toString()` 直接注入内联 Blob Worker，零重复、零依赖。 */
  function mctsFactory() {
    function emptyCells(b) { var o = []; for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) if (!b[r][c]) o.push([r, c]); return o; }
    function clone(b) { return b.map(function (r) { return r.slice(); }); }
    function tryMove(board, dir) {
      var b = clone(board), axis = (dir === 0 || dir === 2) ? 1 : 0, fw = (dir === 1 || dir === 2) ? -1 : 1;
      for (var lane = 0; lane < 4; lane++) {
        var vals = [];
        for (var i = 0; i < 4; i++) { var rr = axis === 0 ? lane : (fw === 1 ? i : 3 - i); var cc = axis === 0 ? (fw === 1 ? i : 3 - i) : lane; vals.push(b[rr][cc]); }
        var nz = vals.filter(function (x) { return x !== 0; }), out = [];
        for (var j = 0; j < nz.length; j++) { if (j + 1 < nz.length && nz[j] === nz[j + 1]) { out.push(nz[j] * 2); j++; } else out.push(nz[j]); }
        while (out.length < 4) out.push(0);
        for (var k = 0; k < 4; k++) { b[axis === 0 ? lane : (fw === 1 ? k : 3 - k)][axis === 0 ? (fw === 1 ? k : 3 - k) : lane] = out[k]; }
      }
      return b;
    }
    function lg(v) { return v ? Math.log(v) / Math.LN2 : 0; }
    var W = [[16,15,14,13],[9,8,7,12],[5,4,6,11],[1,2,3,10]];
    function heuristic(b) {
      var e = 0, co = 0, sm = 0, mo = 0, mg = 0;
      for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
        var v = b[r][c]; if (!v) { e++; continue; }
        var l = lg(v); co += l * W[r][c];
        if (c + 1 < 4 && b[r][c + 1]) { sm -= Math.abs(l - lg(b[r][c + 1])); if (b[r][c + 1] === v) mg += v; }
        if (r + 1 < 4 && b[r + 1][c]) { sm -= Math.abs(l - lg(b[r + 1][c])); if (b[r + 1][c] === v) mg += v; }
      }
      for (var x = 0; x < 4; x++) for (var y = 0; y < 3; y++) {
        var a = b[x][y], bb = b[x][y + 1]; if (bb && a) mo -= (lg(a) > lg(bb)) ? 0 : (lg(bb) - lg(a));
        var u = b[y][x], w = b[y + 1][x]; if (w && u) mo -= (lg(u) > lg(w)) ? 0 : (lg(w) - lg(u));
      }
      return co + sm * 2.8 + mo * 1.3 + e * 270 + mg * 0.7;
    }
    function deadOr(b) { if (emptyCells(b).length) return false; for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) { if (c + 1 < 4 && b[r][c + 1] === b[r][c]) return false; if (r + 1 < 4 && b[r + 1][c] === b[r][c]) return false; } return true; }
    function maxVal(b) { var m = 0; for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) if (b[r][c] > m) m = b[r][c]; return m; }
    function hashIndex(counter, salt, len) { var h = (counter >>> 0) ^ (salt * 0x9E3779B9); h = ((h ^ (h >>> 16)) * 0x21F0AAAD) >>> 0; h = (h ^ (h >>> 15)) >>> 0; return h % len; }
    function hellOwnSpawn(board, counter) { var cells = emptyCells(board); if (!cells.length) return null; var idx = hashIndex(counter, 12, cells.length); var val = (hashIndex(counter, 77, 5) === 0) ? 4 : 2; return { r: cells[idx][0], c: cells[idx][1], v: val }; }

    function run(cfg) {
      var board = cfg.board, timeMs = cfg.timeMs || 400, nodeCap = cfg.nodes || 20000;
      var known = cfg.spawn === "known", p4 = cfg.p4 || 0.1;
      var ROLL = cfg.roll || 10, C = 1.4;
      var t0 = (typeof performance !== "undefined") ? performance.now() : Date.now();
      function doSpawn(b, counter) {
        var c2 = counter + 1;
        if (known) { var s = hellOwnSpawn(b, c2); if (s) b[s.r][s.c] = s.v; }
        else { var cs = emptyCells(b); if (cs.length) { var p = cs[(Math.random() * cs.length) | 0]; b[p[0]][p[1]] = Math.random() < p4 ? 4 : 2; } }
        return c2;
      }
      function legal(b, counter) {
        var out = [];
        for (var d = 0; d < 4; d++) {
          var nb = tryMove(b, d);
          if (nb === null || JSON.stringify(nb) === JSON.stringify(board)) continue;
          // 有移动：再补一个新块
          var c2 = doSpawn(clone(nb), counter);
          out.push({ dir: d, board: nb, counter: c2 });
        }
        return out;
      }
      function Node(b, parent, dir, counter) {
        this.board = b; this.parent = parent || null; this.dir = dir;
        this.counter = counter || 0; this.children = []; this.untried = [];
        this.visits = 0; this.acc = 0; this.expanded = false;
      }
      Node.prototype.build = function () {
        // 展开前先按启发式排序（优先搜好分支）
        var specs = [];
        for (var d = 0; d < 4; d++) {
          var nb = tryMove(this.board, d);
          if (nb === null) continue;
          var eq = true;
          for (var r = 0; r < 4 && eq; r++) for (var c = 0; c < 4 && eq; c++) if (nb[r][c] !== this.board[r][c]) eq = false;
          if (eq) continue;
          var child = clone(nb);
          var counter2 = this.counter;
          if (known) { var s = hellOwnSpawn(child, this.counter + 1); if (s) { child[s.r][s.c] = s.v; } counter2 = this.counter + 1; }
          else { var cs = emptyCells(child); if (cs.length) { var p = cs[(Math.random() * cs.length) | 0]; child[p[0]][p[1]] = Math.random() < p4 ? 4 : 2; } counter2 = this.counter + 1; }
          specs.push({ dir: d, board: child, counter: counter2 });
        }
        specs.sort(function (a, b) { return heuristic(b.board) - heuristic(a.board); });
        this.untried = specs.slice(0); // 可扩展的待扩展分支（会被 pop）
        this.specs = specs;            // 保留完整分支列表（供根级决策）
      };
      function expand(n) { var s = n.untried.pop(); var cnode = new Node(s.board, n, s.dir, s.counter); n.children.push(cnode); return cnode; }
      function bestChild(n) {
        var best = null, bv = -Infinity;
        for (var i = 0; i < n.children.length; i++) {
          var ch = n.children[i];
          var ucb = ch.acc / ch.visits + C * Math.sqrt(2 * Math.log(n.visits + 1) / ch.visits);
          if (ucb > bv) { bv = ucb; best = ch; }
        }
        return best;
      }
      function rollout(node) {
        var b = clone(node.board), counter = node.counter;
        for (var i = 0; i < ROLL; i++) {
          if (deadOr(b)) break;
          var bd = -1, bh = -Infinity;
          for (var d = 0; d < 4; d++) {
            var nb = tryMove(b, d);
            if (nb === null) continue;
            var eq = true;
            for (var r = 0; r < 4 && eq; r++) for (var c = 0; c < 4 && eq; c++) if (nb[r][c] !== b[r][c]) eq = false;
            if (eq) continue;
            var child = clone(nb);
            if (known) { var s = hellOwnSpawn(child, counter + 1); if (s) child[s.r][s.c] = s.v; }
            else { var cs = emptyCells(child); if (cs.length) { var pr = cs[(Math.random() * cs.length) | 0]; child[pr[0]][pr[1]] = Math.random() < p4 ? 4 : 2; } }
            var h = heuristic(child) + maxVal(child) * 1.5;
            if (h > bh) { bh = h; bd = d; }
          }
          if (bd < 0) break;
          b = tryMove(b, bd);
          if (known) { var s2 = hellOwnSpawn(b, counter + 1); if (s2) b[s2.r][s2.c] = s2.v; counter++; }
          else { var cs2 = emptyCells(b); if (cs2.length) { var p2 = cs2[(Math.random() * cs2.length) | 0]; b[p2[0]][p2[1]] = Math.random() < p4 ? 4 : 2; } counter++; }
        }
        return heuristic(b) + maxVal(b) * 2;
      }
      function backprop(node, val) { while (node) { node.visits++; node.acc += val; node = node.parent; } }
      function now() { return (typeof performance !== "undefined") ? performance.now() : Date.now(); }

      var root = new Node(board);
      root.build();
      if (!root.untried.length) return null; // 无合法移动
      var iters = 0;
      while (iters < nodeCap && (now() - t0) < timeMs) {
        iters++;
        var n = root;
        // selection
        while (!deadOr(n.board)) {
          if (n.untried.length) { n = expand(n); break; }
          if (!n.children.length) break;
          var bc = bestChild(n);
          if (!bc) break;
          n = bc;
        }
        var val = rollout(n);
        backprop(n, val);
      }
      // 根级决策：对每个分支取平均分最高的子（未访问的用启发式兜底）
      var bestDir = null, bestV = -Infinity;
      var childByDir = {};
      for (var ci = 0; ci < root.children.length; ci++) {
        var _c = root.children[ci];
        childByDir[_c.dir] = _c;
      }
      for (var si = 0; si < root.specs.length; si++) {
        var sp = root.specs[si];
        var ch = childByDir[sp.dir];
        var v = ch ? ch.acc / ch.visits : heuristic(sp.board);
        if (v > bestV) { bestV = v; bestDir = sp.dir; }
      }
      return bestDir;
    }

    return { run: run };
  }
  var MCTS_SRC_STRING = null;
  // 暴露给外部以生成 Worker 源码
  function mctsFactorySource() { return mctsFactory.toString(); }
  function makeMCTS() { return mctsFactory(); }
  function mctsRunSync(board, cfg) {
    cfg = cfg || {}; cfg.board = board;
    try { var m = makeMCTS(); var r = m.run(cfg); return r; }
    catch (e) { return null; }
  }

  function mctsBest(board, cfg) {
    return mctsRunSync(board, cfg);
  }

  /* ================= 难度配置 ================= */
  var DIFF_TARGET = { easy: 0.90, normal: 0.60, hard: 0.30, hell: 0.01 };
  // 新增：controlSpawn(地狱接管玩家盘) / selfKnown(自盘已知) / timeMs / nodes(算力)
  var DIFF_CFG = {
    easy:   { pow: 0.5,  blunder: 0.8,  aiStart: 2,  ceil: 64,  floor: 0,   depthFl: 3, winK: 1.7, loseK: 0.4, spawn: "help",    p4b: 0.10, p4p: 0.06, controlSpawn: false, selfKnown: false, timeMs: 40,  nodes: 200 },
    normal: { pow: 1.0,  blunder: 0.45, aiStart: 2,  ceil: 256, floor: 0,   depthFl: 4, winK: 1.0, loseK: 1.0, spawn: "neutral", p4b: 0.10, p4p: 0.14, controlSpawn: false, selfKnown: false, timeMs: 90,  nodes: 700 },
    hard:   { pow: 1.8,  blunder: 0.08, aiStart: 4,  ceil: 1024,floor: 0,   depthFl: 5, winK: 0.8, loseK: 1.3, spawn: "worst",  p4b: 0.10, p4p: 0.30, controlSpawn: false, selfKnown: false, timeMs: 320, nodes: 3600 },
    hell:   { pow: 4.0,  blunder: 0.0,  aiStart: 2,  ceil: 0,   floor: 60000, depthFl: 8, winK: 0.2, loseK: 2.0, spawn: "neutral", p4b: 0.16, p4p: 0.25, controlSpawn: true,  selfKnown: true,  timeMs: 880, nodes: 50000 }
  };
  var DIFF_DESC = {
    easy:   "电脑温和陪跑到 64 再认输 · 你必胜且玩得久",
    normal: "电脑随时能摸到 256，势均力敌",
    hard:   "电脑少失误 + 落点针对，逼近 1024 才止步",
    hell:   "看似公平开局 · 实则电脑暗中操控你棋盘的落子与数字，必败"
  };

  /* 情绪状态机（只调表达与预算上浮，绝不低于难度基线） */
  var EMOTIONS = {
    calm:      { mult: 1.0, taunt: 0.03, sabotageP: 0.10, help: 0.55, jitter: 0 },
    confident: { mult: 1.1, taunt: 0.10, sabotageP: 0.35, help: 0.30, jitter: 0 },
    tsundere:  { mult: 1.0, taunt: 0.12, sabotageP: 0.30, help: 0.30, jitter: 0 },
    deadpan:   { mult: 1.0, taunt: 0.00, sabotageP: 0.05, help: 0.20, jitter: 0 },
    angry:     { mult: 1.35, taunt: 0.25, sabotageP: 0.70, help: 0,    jitter: 0.5 },
    rage:      { mult: 1.7,  taunt: 0.40, sabotageP: 0.90, help: 0,    jitter: 1.0 }
  };
  var EMOTION_ORDER = ["calm", "confident", "tsundere", "deadpan", "angry", "rage"];
  var EMOTION_NAME = {
    calm: "冷静", confident: "自信", tsundere: "傲娇", deadpan: "咸鱼", angry: "恼怒", rage: "暴怒"
  };

  /* ================= 文案库（情绪分组） ================= */
  var LINES = {
    tsundere: [ "哼，这次算你蒙对了吧……", "才、才不是夸你呢！", "上一步……勉强合格啦。", "你要是早这么认真，我早就输啦，哼。" ],
    praise:   [ "漂亮！这步连我都没想到……说笑的。", "不错不错，继续保持。", "有点意思，我开始认真了。" ],
    milestone: [ "居然合出了 {v}！有点本事嘛。", "{v} 都出来了？看来不能小瞧你。" ],
    comeback: [ "嘁，给你几回合缓缓，可别浪费哦。", "看你可怜，先不压你。", "（故意让了一步）" ],
    taunt:    [ "就这？", "你的棋盘像一锅粥。", "哼，离 2048 还早着呢。", "要不要我来示范一下？", "你堵我？我谢谢你啊。" ],
    rage:     [ "你激怒我了！！", "很好，那就别怪我不留情面。", "我会让你后悔的。", "燃烧吧，这盘棋。" ],
    save:     [ "（悄咪咪帮你清出一条路）", "诶，居然放你一马。", "看在你快死的份上……" ],
    fakeWorst: [ "哎呀，系统又给你生了个最差的块。", "这可不是我干的哦。", "……好像放错位置了？" ],
    lure:     [ "看见角落那个大数了吗？追得上吗？", "想合大数？来，往那走。", "转角，有大鱼哦。" ],
    help     : [ "给你个 2，别谢我。", "（放了个有利的方块）", "看着整齐，心情不错。" ]
  };

  // 简单整数 hash 供话术随机取
  function hashCodeIndex(len, seed) {
    var s = (seed || (Math.random() * 1e9)) >>> 0;
    var h = (s ^ (s >>> 16)) * 0x45d9f3b; h = (h ^ (h >>> 16)) >>> 0;
    return h % len;
  }
  function pickLine(arr) { return arr[hashCodeIndex(arr.length)]; }

  /* ================= ELO 隐藏分（沿用） ================= */
  var RP_KEY = "2048-ai-elo";
  var RECENT_KEY = "2048-ai-recent";
  var RP_DEF = 1200, K_BASE = 36;
  function recentResults() { try { var v = JSON.parse(localStorage.getItem(RECENT_KEY)); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function pushResult(S) { var r = recentResults(); r.push(S); if (r.length > 12) r.shift(); try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch (e) {} }
  function recentWinRate(diff) { var r = recentResults(); if (!r.length) return DIFF_TARGET[diff] || 0.5; var t = 0; for (var i = 0; i < r.length; i++) t += r[i]; return t / r.length; }
  function dynamicK(diff, src) {
    var t = DIFF_TARGET[diff] == null ? 0.5 : DIFF_TARGET[diff];
    var diffRate = Math.abs(recentWinRate(diff) - t);
    var adapt = 1 + 2.2 * diffRate;
    var act = (recentResults().length >= 6) ? 1 : 0.6;
    var k = K_BASE * adapt * act;
    var cfg = DIFF_CFG[diff] || DIFF_CFG.normal;
    k *= (src === "win") ? cfg.winK : cfg.loseK;
    return k;
  }
  function playerRating() { try { var v = parseInt(localStorage.getItem(RP_KEY), 10); return isNaN(v) ? RP_DEF : v; } catch (e) { return RP_DEF; } }
  function saveRating(r) { try { localStorage.setItem(RP_KEY, String(Math.round(r))); } catch (e) {} }
  function eloExpected(playerR, aiR) { return 1 / (1 + Math.pow(10, (aiR - playerR) / 400)); }
  function eloGap(target) { return 400 * Math.log10((1 - target) / target); }
  function scoreToBudget(Ra, pow) { var s = Math.max(0, Math.min(1, (Ra - 1000) / 1600)); var base = Math.round(700 * Math.pow(10, 2.4 * s)); var b = Math.round(base * (pow || 1)); return Math.min(b, 60000); }
  function depthCap(b) { if (b < 2000) return 3; if (b < 8000) return 5; if (b < 30000) return 7; if (b < 90000) return 8; return 10; }

  /* ================= Worker 封装（内联 Blob） ================= */
  function buildWorker() {
    try {
      if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") return null;
      var src = "(function(){\n" + mctsFactory.toString() +
        "\nself.onmessage=function(e){var m=mctsFactory();var r=m.run(e.data);self.postMessage(r);};\n})();";
      var blob = new Blob([src], { type: "text/javascript" });
      return new Worker(URL.createObjectURL(blob));
    } catch (e) { return null; }
  }

  /* ================= 走子入口 ================= */
  function chooseBotMove(board, cfg) {
    var timeMs = cfg.timeMs, nodes = cfg.nodes, known = cfg.selfKnown;
    var blunder = cfg.blunder || 0, ceil = cfg.ceil || 0, mult = cfg.mult || 1.0;
    // 全部合法走法（blunder 路径不限 ceil）：简单档 AI 随机乱走会自爆越过上限 → bot-ceil/自灭，玩家必胜
    var all = [];
    for (var dd = 0; dd < 4; dd++) { var r = tryMove(board, dd); if (r.moved) all.push(dd); }
    if (!all.length) return null;
    if (blunder > 0 && Math.random() < blunder) return all[(Math.random() * all.length) | 0];
    // 搜索路径仍受 ceil 约束（AI 清醒时不越界）
    var opts = [];
    for (var oi = 0; oi < all.length; oi++) {
      var r2 = tryMove(board, all[oi]);
      if (!ceil || maxVal(r2.board) <= ceil) opts.push(all[oi]);
    }
    if (!opts.length) return null;
    // 单步思考硬上限：情绪放大后仍 ≤950ms，叠加调度开销也不超过 1 秒
    var eff = Math.min(950, Math.max(8, Math.round(timeMs * mult)));
    var d = mctsBest(board, { timeMs: eff, nodes: nodes, spawn: known ? "known" : "random", p4: cfg.p4b });
    if (d === null || opts.indexOf(d) < 0) return opts[0];
    return d;
  }

  // ---------------- Rendering ----------------
  var TILE_COLOR = {
    2: "#eee4da", 4: "#ede0c8", 8: "#f2b179", 16: "#f59563",
    32: "#f67c5f", 64: "#f65e3b", 128: "#edcf72", 256: "#edcc61",
    512: "#edc850", 1024: "#edc53f", 2048: "#edc22e",
    4096: "#3c3a32", 8192: "#5bca57"
  };
  function slideTrack(board, dir) {
    var axis = (dir === 0 || dir === 2) ? 1 : 0;
    var forward = (dir === 1 || dir === 2) ? -1 : 1;
    var cells = [];
    for (var lane = 0; lane < 4; lane++) {
      var lane0 = [];
      for (var i = 0; i < 4; i++) {
        var rr = axis === 1 ? (forward === 1 ? i : 3 - i) : lane;
        var cc = axis === 1 ? lane : (forward === 1 ? i : 3 - i);
        var v = board[rr][cc];
        if (v) lane0.push({ v: v, r: rr, c: cc });
      }
      var out = [], j = 0;
      while (j < lane0.length) {
        if (j + 1 < lane0.length && lane0[j].v === lane0[j + 1].v) { out.push({ v: lane0[j].v * 2, r: lane0[j].r, c: lane0[j].c, fromR: lane0[j].r, fromC: lane0[j].c, merged: true }); j += 2; }
        else { var t = lane0[j]; out.push({ v: t.v, r: t.r, c: t.c, fromR: t.r, fromC: t.c, merged: false }); j++; }
      }
      for (var k = 0; k < out.length; k++) {
        var r2 = axis === 1 ? (forward === 1 ? k : 3 - k) : lane;
        var c2 = axis === 1 ? lane : (forward === 1 ? k : 3 - k);
        out[k].r = r2; out[k].c = c2; cells.push(out[k]);
      }
    }
    return cells;
  }

  function renderBoard(container, board, slideCells, highlight) {
    container.innerHTML = "";
    var size = container.clientWidth || 260;
    var cw = (size - 2 * PAD - 3 * GAP) / 4, ch = cw;
    var start = {};
    if (slideCells) slideCells.forEach(function (s) { start[s.r + "," + s.c] = s; });
    var i, r, c;
    for (i = 0; i < 16; i++) {
      var bg = document.createElement("div");
      bg.className = "cell";
      bg.setAttribute("data-rc", ((i / 4) | 0) + "," + (i % 4));
      bg.style.left = (PAD + (i % 4) * (cw + GAP)) + "px";
      bg.style.top = (PAD + ((i / 4) | 0) * (ch + GAP)) + "px";
      bg.style.width = cw + "px"; bg.style.height = ch + "px";
      container.appendChild(bg);
    }
    for (r = 0; r < 4; r++) for (c = 0; c < 4; c++) {
      var v = board[r][c];
      if (!v) continue;
      var st = start[r + "," + c];
      var cell = document.createElement("div");
      cell.className = "cell a-tile has-tile";
      cell.setAttribute("data-rc", r + "," + c);
      cell.style.left = (PAD + c * (cw + GAP)) + "px";
      cell.style.top = (PAD + r * (ch + GAP)) + "px";
      cell.style.width = cw + "px"; cell.style.height = ch + "px";
      cell.style.background = TILE_COLOR[v] || "#3c3a32";
      cell.style.color = (v === 2 || v === 4) ? "#776e65" : "#f9f6f2";
      cell.textContent = v;
      cell.style.fontSize = (v < 100 ? 26 : (v < 1000 ? 22 : (v < 10000 ? 15 : 12))) + "px";
      if (st && st.merged) cell.className += " a-merged";
      else if (!st) cell.className += " a-new";
      else { var dx = (st.fromC - c) * cw, dy = (st.fromR - r) * ch; if (dx !== 0 || dy !== 0) { cell.className += " a-slide"; cell.style.transform = "translate(" + dx + "px," + dy + "px)"; } }
      container.appendChild(cell);
    }
    // 方向高亮
    if (highlight && highlight.length) {
      for (var hi = 0; hi < highlight.length; hi++) {
        var el = document.createElement("div");
        el.className = "ai-reco ai-reco-" + highlight[hi];
        el.textContent = ["↑", "→", "↓", "←"][highlight[hi]];
        container.appendChild(el);
      }
    }
    void container.offsetHeight;
    // 双重 rAF：确保起始 transform 先落版、再触发过渡，PC 与移动端都能看到滑动动画
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        var els = container.querySelectorAll(".a-slide, .a-new, .a-merged");
        for (var k = 0; k < els.length; k++) {
          if (els[k].classList.contains("a-slide")) els[k].style.transform = "translate(0,0)";
        }
      });
    });
  }

  /* ================= Duel 主类 ================= */
  function Duel() {
    this.p = emptyBoard(); this.ps = 0;
    this.b = emptyBoard(); this.bs = 0;
    this.winner = null; this.reason = null;
    this.sabotPts = 0; this.aSabotPts = 0;
    this.round = 0; this.pMovesInRound = 0; this.aMovesInRound = 0;
    this.t0 = Date.now();
    this.locked = false;
    this.sabotaging = false;      // 玩家捣乱交互中
    this.emotion = "calm";
    this.lastPlayerDir = null;    // 推荐高亮防利用
    this.thisRoundRecoBest = null;
    this.milestones = {};
    this.streakBest = 0;          // 连走最优计数（P1）
    this.loseStreak = 0;          // 连败/劣势回合计数（P7）
    this.mctsWorker = null;
    this.thinking = false;

    this.el = {
      container: document.querySelector(".container"),
      status: document.getElementById("ai-status"),
      pBoard: document.getElementById("board-p"),
      bBoard: document.getElementById("board-b"),
      pScore: document.getElementById("score-p"),
      bScore: document.getElementById("score-b"),
      pMerges: document.getElementById("merges-p"),
      bMerges: document.getElementById("merges-b"),
      timer: document.getElementById("race-timer"),
      banner: document.getElementById("banner"),
      bannerText: document.getElementById("banner-text"),
      aiStatus: document.getElementById("ai-status"),
      combo: document.getElementById("ai-combo"),
      winbar: document.getElementById("winbar-fill"),
      winpct: document.getElementById("winpct"),
      bubble: document.getElementById("ai-bubble"),
      sabotPts: document.getElementById("sabot-pts"),
      sabotBtn: document.getElementById("sabot-btn"),
      sabotAuto: document.getElementById("sabot-auto"),
      sabotPanel: document.getElementById("sabot-panel"),
      sabotVal: document.getElementById("sabot-val"),
      sabotHint: document.getElementById("sabot-hint"),
      feedToggle: document.getElementById("feed-toggle")
    };
    this.feedbackOn = this.loadPref("2048-fb", true);
    this.sabotAutoOn = this.loadPref("2048-auto-sabot", false);
    this.sabotVal = this.loadPref("2048-sabot-val", 2);
    this.newRound();
  }

  Duel.prototype.loadPref = function (k, def) {
    try { var v = localStorage.getItem(k); if (v === null) return def; return v === "1" || v === "true" ? true : v; } catch (e) { return def; }
  };
  Duel.prototype.savePref = function (k, v) { try { localStorage.setItem(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v)); } catch (e) {} };

  Duel.prototype.newRound = function () {
    var self = this;
    this.round++; this.p = emptyBoard(); this.ps = 0; this.pMerges = 0;
    this.b = emptyBoard(); this.bs = 0; this.bMerges = 0;
    this.winner = null; this.reason = null;
    this.sabotPts = 0; this.aSabotPts = 0;
    this.pMovesInRound = 0; this.aMovesInRound = 0;
    this.locked = false; this.sabotaging = false;
    this.emotion = "calm"; this.streakBest = 0; this.loseStreak = 0;
    this.lastPlayerDir = null; this.thisRoundRecoBest = null;
    this.milestones = {};

    var diff = (window.Assist && window.Assist.get("2048-botdiff")) || "normal";
    this.diff = diff; this.hell = (diff === "hell");
    var cfg = DIFF_CFG[diff] || DIFF_CFG.normal;
    var target = DIFF_TARGET[diff] == null ? 0.5 : DIFF_TARGET[diff];
    this.aiRating = playerRating() + eloGap(target);
    this.aiBudget = Math.max(scoreToBudget(this.aiRating, cfg.pow), cfg.floor || 0);
    this.aiDepth = Math.max(depthCap(this.aiBudget), cfg.depthFl || 0);
    this.playerSpawn = cfg.spawn;
    this.blunder = cfg.blunder;
    this.ceil = cfg.ceil || 0;
    this.p4b = cfg.p4b == null ? 0.1 : cfg.p4b;
    this.p4p = cfg.p4p == null ? 0.1 : cfg.p4p;
    this.selfKnown = cfg.selfKnown === true;
    this.controlSpawn = cfg.controlSpawn === true;
    this.timeMs = cfg.timeMs || 200;
    this.nodes = cfg.nodes || 1000;
    this.hellMinGap = 1;  // 地狱对抗生成保留的最小空位（填得极狠但仍有活路）

    if (this.el.container && this.el.container.classList) this.el.container.classList.toggle("is-hell", this.hell);
    this.setStatus(this.hell ? "地狱开局 · 电脑与你同起点" : "你的回合");
    this.updateSkillBar();

    function seedPlayerBlock() {
      if (self.playerSpawn === "worst") spawnWorst(self.p, self.hellMinGap);
      else if (self.playerSpawn === "help") spawnHelp(self.p);
      else spawn(self.p, self.p4p);
    }
    seedPlayerBlock(); seedPlayerBlock(); seedPlayerBlock();
    if (cfg.aiStart > 2) {
      var corner = [[0,0],[0,3],[3,0],[3,3]][(Math.random() * 4) | 0];
      this.b[corner[0]][corner[1]] = cfg.aiStart;
      this.bs = cfg.aiStart;
      spawn(this.b, this.p4b); spawn(this.b, this.p4b);
    } else { spawn(this.b, this.p4b); spawn(this.b, this.p4b); spawn(this.b, this.p4b); }

    this.t0 = Date.now();
    if (this.el.banner) this.el.banner.style.display = "none";
    this.bubbleHide();
    this.updateSabotUI();
    this.updateWinbar();
    this.render();
    this.showReco();
  };

  Duel.prototype.updateSkillBar = function () {
    var el = document.getElementById("skill-info");
    if (!el) return;
    var d = DIFF_DESC[this.diff] || "";
    el.innerHTML = '<span class="skill-elo">隐藏分 <b>' + playerRating() + '</b></span>' +
      '<span class="skill-target">目标胜率 <b>' + Math.round(DIFF_TARGET[this.diff] * 100) + '%</b></span>' +
      '<span class="skill-emotion">情绪 <b class="b-em-' + this.emotion + '">' + EMOTION_NAME[this.emotion] + '</b></span>' +
      '<span class="skill-ai">电脑强度 ' + Math.round(this.aiRating) + '</span>' +
      (d ? '<span class="skill-desc">' + d + '</span>' : '');
  };

  /* ---- 情绪转移 ---- */
  Duel.prototype.setEmotion = function (e) {
    if (e !== this.emotion) {
      this.emotion = e;
      if (this.el.container) this.el.container.setAttribute("data-emotion", e);
      this.updateSkillBar();
    }
  };
  Duel.prototype.reactToPlayerMove = function (wasBest, gained, mergesNo) {
    var em = EMOTIONS[this.emotion] || EMOTIONS.calm;
    // P1：连走最优 / 合大数 → 傲娇
    if (wasBest || (gained >= 128)) {
      this.streakBest++;
    } else { this.streakBest = 0; }
    if (this.streakBest >= 2 || gained >= 128) {
      this.setEmotion("tsundere");
      this.say(pickLine(LINES.tsundere));
    } else if (gained >= 32) {
      this.setEmotion("confident"); // 你合了个不小的块
    }
  };

  /* ---- 指令气泡（已下线：不再展示台词） ---- */
  Duel.prototype.say = function () {};
  Duel.prototype.bubbleHide = function () {};

  /* ---- 胜率进度条（真实评估差） ---- */
  Duel.prototype.playerWinEstimate = function () {
    var hp = heuristic(this.p), hb = heuristic(this.b);
    var diffScore = hp - hb;           // 局面对比
    var t = DIFF_TARGET[this.diff] == null ? 0.5 : DIFF_TARGET[this.diff];
    // 归一化：±8000 映射 ±0.5；再叠加难度目标
    var sig = 1 / (1 + Math.exp(-diffScore / 2600));
    var base = sig;
    // 引入难度目标平滑：普通及以上 AI 有优势，进度条轻微偏 AI
    var est = base * (1 - 0.4) + (1 - t) * 0.4;
    return Math.max(0.01, Math.min(0.99, est));
  };
  Duel.prototype.updateWinbar = function () {
    var el = this.el.winbar, pct = this.el.winpct;
    if (!el) return;
    var est = this.playerWinEstimate();
    var show = est;
    // N2：真实邻域轻波动（35–65%）
    var em = EMOTIONS[this.emotion] || EMOTIONS.calm;
    if (this.feedbackOn && em.jitter > 0 && show > 0.35 && show < 0.65) {
      show = show + (Math.random() - 0.5) * 0.04 * em.jitter;
      show = Math.max(0.05, Math.min(0.95, show));
    }
    el.style.width = (show * 100) + "%";
    if (pct) pct.textContent = Math.round(show * 100) + "%";
  };

  /* ---- 捣乱 UI ---- */
  Duel.prototype.updateSabotUI = function () {
    if (this.el.sabotPts) this.el.sabotPts.textContent = "×" + this.sabotPts;
    if (this.el.sabotBtn) {
      this.el.sabotBtn.classList.toggle("on", this.sabotPts > 0 && !this.locked && !this.winner && !this.sabotaging);
      this.el.sabotBtn.disabled = Boolean(this.winner || this.locked || this.sabotPts <= 0);
      this.el.sabotBtn.textContent = "捣乱 ×" + this.sabotPts;
    }
    if (this.el.sabotAuto) this.el.sabotAuto.classList.toggle("on", this.sabotAutoOn);
    if (this.el.sabotVal) this.el.sabotVal.textContent = "放 " + this.sabotVal;
  };

  // 玩家手动进入捣乱模式：在 AI 盘选格放置
  Duel.prototype.beginSabotage = function () {
    if (this.winner || this.locked || this.sabotPts <= 0 || this.sabotaging) return;
    this.sabotaging = true;
    this.sabotPts--;
    this.updateSabotUI();
    this.highlightSabotCells(true);
    this.setStatus("在电脑棋盘选一个空位放 " + this.sabotVal + "（再点切换 / 点空位放置）");
  };
  Duel.prototype.highlightSabotCells = function (on) {
    var board = this.el.bBoard, self = this;
    if (!board) return;
    var cs = document.querySelectorAll(".cell");
    for (var i = 0; i < cs.length; i++) cs[i].classList.remove("sabot-target");
    if (!on) return;
    // 重渲染空位可点
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
      if (!this.b[r][c]) {
        // 添加 click 放到棋盘上的空位
      }
    }
  };
  Duel.prototype.toggleSabotVal = function () {
    this.sabotVal = this.sabotVal === 2 ? 4 : 2;
    this.savePref("2048-sabot-val", this.sabotVal);
    this.updateSabotUI();
    if (this.el.sabotHint) this.el.sabotHint.textContent = "将放置 " + this.sabotVal;
  };
  Duel.prototype.cancelSabotage = function () {
    if (this.sabotaging) { this.sabotaging = false; this.sabotPts++; this.highlightSabotCells(false); this.updateSabotUI(); this.setStatus("你的回合"); }
  };
  // 在 AI 盘点选放置
  Duel.prototype.playerPlaceOnAI = function (r, c) {
    if (!this.sabotaging) return;
    if (this.b[r][c]) return; // 非空
    placeTile(this.b, r, c, this.sabotVal);
    this.sabotaging = false;
    this.highlightSabotCells(false);
    this.checkWin();
    this.renderB(null);
    this.afterSabotageRound();
  };
  // 玩家自动插桩
  Duel.prototype.playerAutoSabotage = function () {
    if (this.winner || this.sabotPts <= 0) return;
    if (this.sabotVal === 4 && false) { /* 预留 */ }
    var cellsLast = null;
    // 简单策略：放 AI 盘当前启发式最高分角落附近尽量低的空位，干扰其布局
    var cells = emptyCells(this.b);
    if (!cells.length) { this.sabotPts--; this.updateSabotUI(); return; }
    var bestCell = cells[0], lo = Infinity;
    for (var i = 0; i < cells.length; i++) {
      var rc = cells[i];
      var score = 4 - Math.abs(0 - rc[0]) + 4 - Math.abs(0 - rc[1]); // 靠近左上
      if (score < lo) { lo = score; bestCell = rc; }
    }
    placeTile(this.b, bestCell[0], bestCell[1], this.sabotVal);
    this.sabotPts--;
    this.updateSabotUI();
    this.checkWin();
    this.renderB(null);
    this.afterSabotageRound();
  };
  // 捣乱阶段收尾（AI 反击在 aiAct 末尾判定，这里只是解锁）
  Duel.prototype.afterSabotageRound = function () {
    if (this.winner) return;
    this.locked = false;
    this.setStatus("你的回合");
    this.updateWinbar();
    this.showReco();
  };

  // AI 捣乱：在玩家盘放子
  Duel.prototype.aiSabotage = function (opts) {
    var em = EMOTIONS[this.emotion] || EMOTIONS.calm;
    if (this.aSabotPts <= 0 || this.winner) return;
    if (Math.random() > em.sabotP) return; // 由情绪/难度决定是否用
    var cells = emptyCells(this.p);
    if (!cells.length) { this.aSabotPts--; this.updateSabotUI(); return; }
    var val = (this.hell || Math.random() < 0.35) ? 4 : 2;
    var target = cells[(Math.random() * cells.length) | 0];
    if (this.playerSpawn === "worst" || this.hell) {
      // 针对性：放"玩家最难受"位置附近
      var best = cells[0], worst = -Infinity;
      for (var i = 0; i < cells.length; i++) {
        var nb = clone(this.p); placeTile(nb, cells[i][0], cells[i][1], val);
        var bestAfter = -Infinity;
        for (var d = 0; d < 4; d++) { var s = playerBestAfter(nb, d); if (s > bestAfter) bestAfter = s; }
        if (bestAfter > worst) { worst = bestAfter; best = cells[i]; }
      }
      target = best;
    }
    placeTile(this.p, target[0], target[1], val);
    this.aSabotPts--;
    this.checkWin();
    this.renderP(null);
    this.updateSabotUI();
    this.updateWinbar();
  };

  /* ---- 关键触发器（正/负反馈） ---- */
  Duel.prototype.emptyCount = function (b) { var e = 0; forEach(b, function (v) { if (!v) e++; }); return e; };
  Duel.prototype.maybeFeedback = function (ev) {
    if (!this.feedbackOn) return;
    var em = EMOTIONS[this.emotion] || EMOTIONS.calm;
    var self = this;
    function maybe(p, fn) { if (Math.random() < p) self.say(fn()); }
    if (ev === "round") {
      // N1 嘲讽（随情绪频率）
      maybe(em.taunt, function () { return pickLine(LINES.taunt); });
      // P3 稳定盘帮助块
      if (em.help > 0 && this.playerStable() && Math.random() < em.help * 0.5) {
        if (this.playerSpawn === "help" || this.diff === "easy" || this.diff === "normal") { this.giveHelpTile(); }
      }
      // N3 死里逃生 + 假最差：你濒死时 AI 低调救场，随即"系统生成最差块"
      if (!this.winner && this.emptyCount(this.p) <= 3 && (this.diff === "easy" || this.diff === "normal") && Math.random() < 0.3) {
        this.giveHelpTile();
        this.say(pickLine(LINES.fakeWorst));
      }
      // N4 温水煮青蛙：简单/普通 分差接近时，AI 嘴上不急（真实强度由难度保证）
      if ((this.diff === "easy" || this.diff === "normal") && Math.abs(this.ps - this.bs) <= 400 && Math.random() < 0.12) {
        this.say("还差一点点哦，追上我呀～");
      }
      // N7 假走神：罕见地"漏"一句，营造它没那么认真
      maybe(0.03, function () { return pickLine(LINES.praise); });
      // N5 边缘大数诱惑
      maybe(0.04, function () { return pickLine(LINES.lure); });
    } else if (ev === "save") {
      this.say(pickLine(LINES.save));
    } else if (ev === "fakeWorst") {
      this.say(pickLine(LINES.fakeWorst));
    }
  };
  Duel.prototype.playerStable = function () {
    var e = 0; forEach(this.p, function (v) { if (!v) e++; });
    return e >= 7;
  };
  Duel.prototype.giveHelpTile = function () {
    spawnHelp(this.p);
    this.renderP(null);
    this.say(pickLine(LINES.help));
  };

  /* ---- 思考（AI 走子，Worker 或同步） ---- */
  Duel.prototype.think = function () {
    var self = this;
    if (this.winner) return;
    this.locked = true;
    this.setStatus("电脑走子中…");
    var mult = (EMOTIONS[this.emotion] || EMOTIONS.calm).mult;
    var cfg = {
      board: this.b, timeMs: this.timeMs, nodes: this.nodes,
      spawn: this.selfKnown ? "known" : "random", p4: this.p4b,
      blunder: this.blunder, ceil: this.ceil, mult: mult
    };
    var worker = this.ensuredWorker();
    if (worker) {
      worker.onmessage = function (e) { self.onAIResult(e.data); };
      worker.postMessage(cfg);
    } else {
      // 同步兜底：预算够小，或模拟一段以确保流畅
      var d = this.syncChoose(cfg);
      var self2 = this;
      window.setTimeout(function () { self2.onAIResult(d); }, 260);
    }
  };
  Duel.prototype.ensuredWorker = function () {
    if (this.mctsWorker) return this.mctsWorker;
    // 仅地狱用 Worker；其余同步（延迟已由超时兜底）
    if (!this.hell) return null;
    try {
      this.mctsWorker = buildWorker();
    } catch (e) { this.mctsWorker = null; }
    return this.mctsWorker;
  };
  Duel.prototype.syncChoose = function (cfg) {
    return chooseBotMove(cfg.board, {
      timeMs: cfg.timeMs, nodes: cfg.nodes, selfKnown: cfg.spawn === "known",
      p4b: cfg.p4, blunder: cfg.blunder, ceil: cfg.ceil, mult: cfg.mult
    });
  };
  Duel.prototype.onAIResult = function (dir) {
    if (this.winner) return;
    var sc, old, res;
    if (dir === null) { this.checkWin(); this.locked = false; this.renderB(null); this.setStatus(this.winner ? "" : "电脑已至上限 · 等待你反超"); return; }
    var d = dir;
    old = this.b;
    res = tryMove(this.b, d);
    sc = slideTrack(old, d);
    this.bs += res.gained; this.bMerges += res.gained;
    this.b = res.board;
    // 自盘补子：地狱用可复现生成（AI 预知），其余中立随机
    if (this.selfKnown) { var s = hellOwnSpawn(this.b, this.round); if (s) placeTile(this.b, s.r, s.c, s.v); }
    else spawn(this.b, this.p4b);
    this.checkWin();
    this.renderB(sc);
    this.afterAIRound();
  };
  Duel.prototype.afterAIRound = function () {
    // 一轮（玩家+AI 各一次）完成
    this.aMovesInRound++;
    if (this.aMovesInRound >= 1 && this.pMovesInRound >= 1) {
      this.pMovesInRound = 0; this.aMovesInRound = 0;
      // +1 捣乱点
      if (this.sabotPts < 2) this.sabotPts++;
      if (this.aSabotPts < 2) this.aSabotPts++;
      this.updateSabotUI();
      // AI 趁此机会捣乱
      this.aiSabotage();
      // 玩家自动插桩（若开启且有分）
      if (this.sabotAutoOn && !this.winner && this.sabotPts > 0) {
        this.playerAutoSabotage();
      }
    }
    if (this.winner) return;
    // N8 时差压迫：胶着时偶尔拉长思考暗示（并不真影响强度）
    this.locked = false;
    this.setStatus("你的回合");
    // 情绪转变：AI 被反超 → 暴怒（N6）；大比分领先 → 冷静
    if (this.bs < this.ps - 200) this.setEmotion(this.emotion === "rage" ? "rage" : "angry");
    else if (this.bs > this.ps + 600) this.setEmotion("calm");
    this.maybeFeedback("round");
    this.updateWinbar();
    this.showReco();
  };

  /* ---- 玩家回合 ---- */
  Duel.prototype.playerMove = function (dir) {
    if (this.winner || this.locked || this.sabotaging) return;
    var old = this.p, res = tryMove(this.p, dir);
    if (!res.moved) return;
    this.p = res.board;
    var sc = slideTrack(old, dir);
    this.ps += res.gained; this.pMerges += res.gained;
    var gained = res.gained, mergesNo = res.merges;
    // 玩家盘补子：地狱用「操控生成」（落点+数值都做手脚）；否则常规
    if (this.controlSpawn) hellPlayerSpawn(this.p);
    else if (this.playerSpawn === "worst") spawnWorst(this.p, this.hellMinGap);
    else if (this.playerSpawn === "help") spawnHelp(this.p);
    else spawn(this.p, this.p4p);
    if (window.Sound) { window.Sound.drop(); if (mergesNo > 0) window.Sound.merge(); }
    this.pMovesInRound = 1;
    this.checkWin();
    if (window.nudge) window.nudge(this.el.pBoard, dir);
    this.renderP(sc);
    this.flashCombo(mergesNo);
    // P6 里程碑
    this.checkMilestones();
    // P1 反馈：是否为 MCTS 最优解
    var wasBest = this.recoBestDir === dir;
    this.reactToPlayerMove(wasBest, gained, mergesNo);
    this.updateWinbar();
    if (!this.winner) this.think();
  };

  Duel.prototype.checkMilestones = function () {
    var mv = maxVal(this.p);
    var list = [64, 128, 256, 512, 1024];
    for (var i = 0; i < list.length; i++) {
      if (mv >= list[i] && !this.milestones[list[i]]) {
        this.milestones[list[i]] = true;
        if (this.feedbackOn) this.say(pickLine(LINES.milestone).replace("{v}", list[i]));
      }
    }
  };

  Duel.prototype.flashCombo = function (mergesNo) {
    var c = this.el.combo;
    if (!c) return;
    if (mergesNo >= 2) { c.textContent = "×" + mergesNo + " 连击"; c.classList.remove("on"); void c.offsetWidth; c.classList.add("on"); }
    else c.classList.remove("on");
  };

  /* ---- 推荐高亮（已下线：不再提示玩家该怎么走） ---- */
  Duel.prototype.showReco = function () {};
  Duel.prototype.renderReco = function (d) {
    // 在玩家盘加方向提示
    var el = this.el.pBoard, cw = (el.clientWidth - 2 * PAD - 3 * GAP) / 4;
    var posC = { up: 2, down: 2, left: 0, right: 3 };
    var pos = [{ x: 0, y: 0.45 }, { x: 1, y: 0.45 }, { x: 0, y: 0.45 }, { x: 1, y: 0.45 }][d];
    var arrow = document.createElement("div");
    arrow.className = "ai-arrow ai-arrow-" + d;
    arrow.textContent = ["↑", "→", "↓", "←"][d];
    el.appendChild(arrow);
  };
  Duel.prototype.hideReco = function () {
    var arr = document.querySelectorAll(".ai-arrow");
    for (var i = 0; i < arr.length; i++) arr[i].remove();
  };

  /* ---- 胜负判定 + 原因 ---- */
  Duel.prototype.checkWin = function () {
    var d = decideWinner(this.p, this.b, { ceil: this.ceil, ps: this.ps, bs: this.bs, winVal: WIN_VAL });
    if (d.winner) { this.winner = d.winner; this.reason = d.reason; this.applyElo(); this.actuateBanner(); }
  };

  Duel.prototype.applyElo = function () {
    if (this.eloApplied) return;
    this.eloApplied = true;
    var S = this.winner === "p" ? 1 : (this.winner === "tie" ? 0.5 : 0);
    var Rp = playerRating(), E = eloExpected(Rp, this.aiRating);
    var src = (S === 1) ? "win" : (S === 0 ? "lose" : "win");
    var K = dynamicK(this.diff, src);
    saveRating(Rp + K * (S - E));
    pushResult(S);
    var el = document.getElementById("skill-info");
    if (el) this.updateSkillBar();
  };

  Duel.prototype.actuateBanner = function () {
    if (!this.el.banner) return;
    this.el.banner.style.display = "flex";
    var txt;
    if (this.winner === "p") {
      txt = (this.reason === "reach2048") ? "你赢了 · 抢先合成 2048"
        : (this.reason === "bot-dead") ? "你赢了 · 电脑被堵死了"
        : (this.reason === "bot-ceil") ? "你赢了 · AI 触顶" : "你赢了 · 得分更高";
    } else {
      txt = (this.reason === "player-dead") ? "电脑赢了 · 你被堵死了"
        : "电脑赢了 · 它先合成了 2048";
    }
    this.el.bannerText.textContent = txt;
  };

  Duel.prototype.resolve = function () { this.checkWin(); };

  Duel.prototype.render = function () { this.renderStats(); renderBoard(this.el.pBoard, this.p, null); renderBoard(this.el.bBoard, this.b, null); };
  Duel.prototype.renderP = function (sc) { this.renderStats(); renderBoard(this.el.pBoard, this.p, sc || null); };
  Duel.prototype.renderB = function (sc) { this.renderStats(); renderBoard(this.el.bBoard, this.b, sc || null); };
  Duel.prototype.renderStats = function () {
    if (!this.el.pScore) return;
    this.el.pScore.textContent = this.ps;
    this.el.bScore.textContent = this.bs;
    this.el.pMerges.textContent = "+" + this.pMerges;
    this.el.bMerges.textContent = "+" + this.bMerges;
    var secs = Math.floor((Date.now() - this.t0) / 1000);
    this.el.timer.textContent = Math.floor(secs / 60) + ":" + ("0" + (secs % 60)).slice(-2);
  };
  Duel.prototype.setStatus = function (txt) { if (this.el.aiStatus) this.el.aiStatus.textContent = txt; };

  // ---------------- input ----------------
  var KEYS = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };

  if (typeof window !== "undefined") {
    window.AiDuel = function () {
      var game = new Duel();
      window.addEventListener("keydown", function (e) {
        var d = KEYS[e.code];
        if (d === undefined) { if (e.code === "Escape" && game.sabotaging) { game.cancelSabotage(); } return; }
        e.preventDefault();
        if (game.sabotaging) { game.toggleSabotVal(); return; }
        game.playerMove(d);
      });
      if (window.bindSwipe) window.bindSwipe(document.getElementById("board-p"), function (d) { game.playerMove(d); });
      var rp = document.getElementById("replay");
      if (rp) rp.addEventListener("click", function () { game.newRound(); });
      // 捣乱按钮
      if (document.getElementById("sabot-btn")) {
        document.getElementById("sabot-btn").addEventListener("click", function (e) {
          e.stopPropagation(); game.beginSabotage();
        });
      }
      // AI 盘点选放置
      if (document.getElementById("board-b")) {
        document.getElementById("board-b").addEventListener("click", function (e) {
          if (!game.sabotaging) return;
          var r = e.target.getAttribute("data-rc");
          if (!r) return;
          var parts = r.split(",");
          game.playerPlaceOnAI(parseInt(parts[0], 10), parseInt(parts[1], 10));
        });
      }
      if (document.getElementById("sabot-auto")) {
        document.getElementById("sabot-auto").addEventListener("click", function () {
          game.sabotAutoOn = !game.sabotAutoOn; game.savePref("2048-auto-sabot", game.sabotAutoOn); game.updateSabotUI();
        });
      }
      if (document.getElementById("sabot-val")) {
        document.getElementById("sabot-val").addEventListener("click", function () { game.toggleSabotVal(); });
      }
      if (document.getElementById("sabot-cancel")) {
        document.getElementById("sabot-cancel").addEventListener("click", function () { game.cancelSabotage(); });
      }
      if (document.getElementById("feed-toggle")) {
        document.getElementById("feed-toggle").addEventListener("click", function () {
          game.feedbackOn = !game.feedbackOn; game.savePref("2048-fb", game.feedbackOn); this.classList.toggle("on", game.feedbackOn);
        });
      }
      // 每轮玩家回合展示一次推荐
      game.showReco();
      return game;
    };
  }

  // ---- 无头测试导出 ----
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      WIN_VAL: WIN_VAL,
      DIFF_CFG: DIFF_CFG, DIFF_TARGET: DIFF_TARGET,
      emptyBoard: emptyBoard, clone: clone, emptyCells: emptyCells,
      tryMove: tryMove, spawn: spawn, placeTile: placeTile, addTileEmpty: addTileEmpty,
      spawnWorst: spawnWorst, spawnHelp: spawnHelp, hellPlayerSpawn: hellPlayerSpawn, maxVal: maxVal, deadOr: deadOr, decideWinner: decideWinner,
      heuristic: heuristic, mulberry32: mulberry32, hellOwnSpawn: hellOwnSpawn,
      mctsBest: mctsBest, chooseBotMove: chooseBotMove, mctsFactory: mctsFactory,
      scoreToBudget: scoreToBudget, eloGap: eloGap, depthCap: depthCap,
      EMOTIONS: EMOTIONS, EMOTION_ORDER: EMOTION_ORDER
    };
  }
})();