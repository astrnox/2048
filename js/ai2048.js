/* =============================================================
   AI 对抗模式 · 人机双棋盘竞速
   你在左、机器人在右，同一规则各自的棋盘上比快——
   谁先合成 2048 谁赢；若双方都卡死则比得分。
   ============================================================= */
(function () {
  "use strict";

  var WIN_VAL = 2048;
  var DIRS4 = [0, 1, 2, 3]; // up / right / down / left

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

  /* =============================================================
     SKILL 系统 ·「目标胜率 × 玩家隐藏分(ELO)」动态难度（R2）
     -------------------------------------------------------------
     相对初版的关键修正，直击"简单≈地狱"：
       A. 分难度【独立强度乘数】。强度的决定式改为
             effectiveBudget = scoreToBudget(Ra) × pow[diff]
          简单乘数低保底低、地狱乘数最大化，从根上保证
          简单≪普通<困难≪地狱，即使隐藏分涨上天也很难收敛齐平。
       B. 反馈非对称 + 动态灵敏度：
            - easy  → 正反馈拉满：你赢时隐藏分上涨更多、输时掉得更少；
                      且 AI 预算增长被压低，始终宽松。
            - hell  → 负反馈拉满：你赢地狱才大幅回血、输掉几乎不动；
                      AI 预算乘数拉满 + 生成常给玩家最差的方块。
            - 灵敏度随"活动+表现"变化：近期胜率偏离目标越多，K 越大、
              适应越快；越稳则 K 收敛，避免震荡。
       C. 生成策略随难度：地狱/困难在玩家盘用最难落点(spawnWorst)、
          简单用最顺手助益(spawnHelp)，AI 自己始终中立（只靠搜索强度，
          不靠"生成偏向自己"）。
     ========================================================= */
  var RP_KEY = "2048-ai-elo";
  var RP_DEF = 1200;        // 新玩家基准分
  var K_BASE = 36;          // 灵敏度基准（会再被 dynamicK 修正）
  var DIFF_TARGET = { easy: 0.90, normal: 0.60, hard: 0.30, hell: 0.01 };
  // 分难度配置（R4 · 确定性兜底优先）。
  //   pow      —— 搜索预算乘数（隐藏分经验强度之上再乘难度系数）
  //   blunder  —— AI 每次动手随机乱走的概率（简单高 / 地狱 0）
  //   aiStart  —— AI 起手高位块；开局即握高额分，制造"物理分差"
  //   ceil     —— AI 可达瓦片值上限；0 = 不限。
  //               *只要 AI 超过上限即判负*（checkWin 强制），这是
  //              "简单随便划也稳赢 / 普通有得打"的确定性保证，
  //              与概率式的失误率互补，杜绝 AI 靠运气冲到高位。
  //   floor    —— AI 搜索预算下限；0 = 不设下限（信任隐藏分）。
  //               地狱用它做"强度地板"：无论你隐藏分压得多低，地狱
  //               AI 的深度/算力都不缩水，保证"30 秒内追不回来"。
  //   depthFl  —— AI 深度下限（同上，为地狱/困难兜底）。
  //   winK/LK  —— ELO 灵敏度方向（正/负反馈不对称）。
  //   spawn    —— 玩家盘生成策略（help/neutral/worst）。
  var DIFF_CFG = {
    easy:   { pow: 0.5,  blunder: 0.85, aiStart: 2,  ceil: 8,   floor: 0,   depthFl: 3, winK: 1.7, loseK: 0.4, spawn: "help",   p4b: 0.10, p4p: 0.06 },
    normal: { pow: 1.0,  blunder: 0.45, aiStart: 2,  ceil: 256, floor: 0,   depthFl: 4, winK: 1.0, loseK: 1.0, spawn: "neutral", p4b: 0.10, p4p: 0.14 },
    hard:   { pow: 1.8,  blunder: 0.08, aiStart: 4,  ceil: 1024,floor: 0,   depthFl: 5, winK: 0.8, loseK: 1.3, spawn: "worst",  p4b: 0.10, p4p: 0.28 },
    hell:   { pow: 4.0,  blunder: 0.0,  aiStart: 1024,ceil: 0,   floor: 60000, depthFl: 8, winK: 0.2, loseK: 2.0, spawn: "worst", p4b: 0.10, p4p: 0.40 }
  };
  // 各档体验描述（UI 用）
  var DIFF_DESC = {
    easy:   "确定性封顶 · AI 撑不过 8 且常失误，随便划也能大比分赢",
    normal: "AI 随时能摸到 256，势均力敌",
    hard:   "AI 少失误 + 落点针对，逼近 1024 才止步",
    hell:   "负反馈拉满 · AI 零失误持 1024 起手，分数/棋面全程碾压、不可破"
  };

  // —— 近期战绩滑动窗：驱动动态灵敏度（随活动与表现变化） ——
  var RECENT_KEY = "2048-ai-recent";
  function recentResults() {
    try { var v = JSON.parse(localStorage.getItem(RECENT_KEY)); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function pushResult(S) {
    var r = recentResults(); r.push(S);
    if (r.length > 12) r.shift();               // 只看最近 12 局
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch (e) {}
  }

  // 当前难度下的近期胜率（无纪录 → 用目标值，介于中间避免突发跳变）
  function recentWinRate(diff) {
    var r = recentResults(); if (!r.length) return DIFF_TARGET[diff] || 0.5;
    var t = 0; for (var i = 0; i < r.length; i++) t += r[i];
    return t / r.length;
  }

  // 动态灵敏度：偏离目标越大 → K 放大（更快适应）；越稳 → K 收敛
  function dynamicK(diff, src) {
    var t = DIFF_TARGET[diff] == null ? 0.5 : DIFF_TARGET[diff];
    var diffRate = Math.abs(recentWinRate(diff) - t);
    var adapt = 1 + 2.2 * diffRate;              // 偏离越大适应越快
    var act = (recentResults().length >= 6) ? 1 : 0.6; // 活跃度：局数多更灵敏
    var k = K_BASE * adapt * act;
    // 按胜负方向不对称（easy 正反馈 / hell 负反馈）
    var cfg = DIFF_CFG[diff] || DIFF_CFG.normal;
    k *= (src === "win") ? cfg.winK : cfg.loseK;
    return k;
  }

  function playerRating() {
    try { var v = parseInt(localStorage.getItem(RP_KEY), 10); return isNaN(v) ? RP_DEF : v; }
    catch (e) { return RP_DEF; }
  }
  function saveRating(r) { try { localStorage.setItem(RP_KEY, String(Math.round(r))); } catch (e) {} }

  // Elo 期望（玩家胜率）
  function eloExpected(playerR, aiR) { return 1 / (1 + Math.pow(10, (aiR - playerR) / 400)); }
  // 目标胜率 → 需要的 AI 相对分差
  function eloGap(target) { return 400 * Math.log10((1 - target) / target); }

  // 强度分 + 分难度乘数 → 节点预算（指数 + 独立乘子），并设上限控时
  function scoreToBudget(Ra, pow) {
    var s = Math.max(0, Math.min(1, (Ra - 1000) / 1600));   // 归一 0..1
    var base = Math.round(700 * Math.pow(10, 2.4 * s));      // 700 → ~200000
    var b = Math.round(base * (pow || 1));                   // 乘上难度独立乘数
    return Math.min(b, 60000);                               // 上限：单步≤约几秒
  }
  // 预算 → 深度上限（限制递归层数，控时）
  function depthCap(b) {
    if (b < 2000) return 3;
    if (b < 8000) return 5;
    if (b < 30000) return 7;
    if (b < 90000) return 8;
    return 10;
  }

  // 生成：随机落 2/4（中立）
  function spawn(b, p4) {
    var cells = emptyCells(b);
    if (!cells.length) return false;
    var p = cells[Math.floor(Math.random() * cells.length)];
    b[p[0]][p[1]] = Math.random() < (p4 == null ? 0.1 : p4) ? 4 : 2;
    return true;
  }

  /* ---- 生成策略三种——随难度选择 ----
     spawnWorst —— 玩家盘对抗：挑(落点,取值)使玩家最优应对后局面最差。
                  (困难 / 地狱的"负反馈"来源，地狱每步都用)
     spawnHelp  —— 玩家盘助益：尽量放玩家随手可合的低位(2)在角落附近，
                  正反馈打的轻松感来源（简单档）。
     中立随机    —— 普通档。地狱只对玩家用最差，AI 自己始终中立，
                  保证"算法碾压"而非"生成偏向自己"。 */
  // 一层玩家最优应对后的评分（Placer 想着 Slider 下一步会怎么走）
  function playerBestAfter(board, dir) {
    var res = tryMove(board, dir);
    if (!res.moved) return -Infinity;
    return heuristic(res.board);
  }
  function spawnWorst(b, depth) {
    var cells = emptyCells(b);
    if (!cells.length) return false;
    var bestCell = null, bestVal = 2, worstVal = Infinity;
    // 采样空位上限，控制计算量（空位多时不必全算）
    var cands = sampleCells(cells, Math.min(cells.length, 14));
    for (var i = 0; i < cands.length; i++) {
      var rc = cands[i];
      for (var vi = 0; vi < 2; vi++) {
        var v = vi === 0 ? 2 : 4;
        var nb = clone(b); nb[rc[0]][rc[1]] = v;
        // 对手最优应对 = max{玩家四向最佳后的评分}；选使这个值最小的落子
        var best = -Infinity;
        for (var d = 0; d < 4; d++) {
          var s = playerBestAfter(nb, d);
          if (s > best) best = s;
        }
        if (best < worstVal) { worstVal = best; bestCell = rc; bestVal = v; }
      }
    }
    if (bestCell) b[bestCell[0]][bestCell[1]] = bestVal;
    return true;
  }
  // 助益生成：选"放 2 后玩家最优应对评分最高"的空位（= 最顺手的位置）
  function spawnHelp(b) {
    var cells = emptyCells(b);
    if (!cells.length) return false;
    var bestCell = null, hi = -Infinity;
    var cands = sampleCells(cells, Math.min(cells.length, 12));
    for (var i = 0; i < cands.length; i++) {
      var rc = cands[i];
      var nb = clone(b); nb[rc[0]][rc[1]] = 2;
      var best = -Infinity;
      for (var d = 0; d < 4; d++) {
        var s = playerBestAfter(nb, d);
        if (s > best) best = s;
      }
      if (best > hi) { hi = best; bestCell = rc; }
    }
    if (bestCell) b[bestCell[0]][bestCell[1]] = 2;
    return true;
  }

  // 棋盘几何（与 ai.css 一致：padding=8, gap=8）
  var PAD = 8, GAP = 8;

  // 追踪一次滑动的每个瓦片“来自”哪格（只用于渲染动画，不参与搜索）
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
        if (j + 1 < lane0.length && lane0[j].v === lane0[j + 1].v) {
          out.push({ v: lane0[j].v * 2, r: lane0[j].r, c: lane0[j].c, fromR: lane0[j].r, fromC: lane0[j].c, merged: true });
          j += 2;
        } else {
          var t = lane0[j];
          out.push({ v: t.v, r: t.r, c: t.c, fromR: t.r, fromC: t.c, merged: false });
          j++;
        }
      }
      for (var k = 0; k < out.length; k++) {
        var r2 = axis === 1 ? (forward === 1 ? k : 3 - k) : lane;
        var c2 = axis === 1 ? lane : (forward === 1 ? k : 3 - k);
        out[k].r = r2; out[k].c = c2;
        cells.push(out[k]);
      }
    }
    return cells;
  }

  // Move board towards dir. dir: 0 up,1 right,2 down,3 left.
  // Returns { board, gained, moved, merges } (board is a fresh copy).
  function tryMove(board, dir) {
    var b = clone(board);
    var gained = 0;
    var moved = false;
    var merges = 0;

    var line = function (r, c, axis) { return axis === 0 ? r : c; };

    // Build traverse order based on dir axis/value.
    // axis=1 slides along a column, axis=0 along a row.
    var axis = (dir === 0 || dir === 2) ? 1 : 0;
    // forward=+1 merges toward top/left (index 0); -1 toward bottom/right (index 3).
    var forward = (dir === 1 || dir === 2) ? -1 : 1;

    // Represent each "lane" as an array in travel direction, process, write back.
    for (var lane = 0; lane < 4; lane++) {
      // extract lane (merge target ends up at index 0)
      var vals = [];
      for (var i = 0; i < 4; i++) {
        var rr = axis === 0 ? lane : (forward === 1 ? i : 3 - i);
        var cc = axis === 0 ? (forward === 1 ? i : 3 - i) : lane;
        vals.push(b[rr][cc]);
      }
      // slide + merge toward index 0 of vals
      var res = slideMerge(vals);
      if (res.moved) moved = true;
      gained += res.gained;
      merges += res.merges;
      // write back
      for (var j = 0; j < 4; j++) {
        var rr2 = axis === 0 ? lane : (forward === 1 ? j : 3 - j);
        var cc2 = axis === 0 ? (forward === 1 ? j : 3 - j) : lane;
        b[rr2][cc2] = res.line[j];
      }
    }

    return { board: b, gained: gained, moved: moved, merges: merges };
  }

  // Slide a 4-lane left (existing values first), merge equals once.
  function slideMerge(vals) {
    var nz = vals.filter(function (v) { return v !== 0; });
    var out = [];
    var moved = nz.length !== vals.length;
    var gained = 0;
    var merges = 0;
    for (var i = 0; i < nz.length; i++) {
      if (i + 1 < nz.length && nz[i] === nz[i + 1]) {
        out.push(nz[i] * 2);
        gained += nz[i] * 2;
        merges++;
        i++; // consume next
        moved = true;
      } else {
        out.push(nz[i]);
      }
    }
    while (out.length < 4) out.push(0);
    // compare to original to detect if moved (merge already flagged)
    return { line: out, gained: gained, moved: moved, merges: merges };
  }

  function maxVal(b) {
    var m = 0;
    forEach(b, function (v) { if (v > m) m = v; });
    return m;
  }
  function forEach(b, fn) {
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) fn(b[r][c], r, c);
  }

  function deadOr(b) {
    if (emptyCells(b).length) return false;
    for (var r = 0; r < 4; r++)
      for (var c = 0; c < 4; c++) {
        var v = b[r][c];
        if (c + 1 < 4 && b[r][c + 1] === v) return false;
        if (r + 1 < 4 && b[r + 1][c] === v) return false;
      }
    return true;
  }

  /* ---- Bot: Expectimax (2048-style) ----
     AI 在反"随便滑动必输"的意义上要够硬：走一步前把所有可能局面
     （自己的走法 + 对手随机放 2/4）往前推几层，用蛇形角位权重打分，
     让大数始终压向角落、留空位，从而稳定合成 2048。 */
  // 蛇形权重：大数越靠近左上角分越高
  var W = [
    [16, 15, 14, 13],
    [ 9,  8,  7, 12],
    [ 5,  4,  6, 11],
    [ 1,  2,  3, 10]
  ];

  function lg(v) { return v ? Math.log(v) / Math.LN2 : 0; }

  function heuristic(board) {
    var empty = 0, corner = 0, smooth = 0, mono = 0;
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
      var v = board[r][c];
      if (!v) { empty++; continue; }
      var l = lg(v);
      corner += l * W[r][c];                       // 大数压向角
      if (c + 1 < 4 && board[r][c + 1]) smooth -= Math.abs(l - lg(board[r][c + 1]));
      if (r + 1 < 4 && board[r + 1][c]) smooth -= Math.abs(l - lg(board[r + 1][c]));
    }
    // 列/行单调性：靠角一侧数值应更大（贪心保持递增）
    for (var x = 0; x < 4; x++) {
      for (var y = 0; y < 3; y++) {
        var a = board[x][y], b = board[x][y + 1];
        if (b && a) mono -= (lg(a) > lg(b)) ? 0 : (lg(b) - lg(a));
        var u = board[y][x], w = board[y + 1][x];
        if (w && u) mono -= (lg(u) > lg(w)) ? 0 : (lg(w) - lg(u));
      }
    }
    return corner + smooth * 2.8 + mono * 1.3 + empty * 270;
  }

  // 从空位里随机抽样至多 k 个，作为"对手随机放子"的采样（限制计算量）
  function sampleCells(cells, k) {
    var copy = cells.slice(), res = [];
    while (copy.length && res.length < k) {
      var i = Math.floor(Math.random() * copy.length);
      res.push(copy[i]);
      copy.splice(i, 1);
    }
    return res;
  }

  // 全局节点预算：让每次决策的计算量严格受控，深度再高也不至于卡顿
  var budget = 0;

  // 按局面优劣排序候选方向，先试有希望的分支 → 更好的 alpha-beta 剪枝
  function moveOrder(board) {
    var arr = [];
    for (var d = 0; d < 4; d++) {
      var res = tryMove(board, d);
      if (res.moved) arr.push({ d: d, h: heuristic(res.board) });
    }
    arr.sort(function (a, b) { return b.h - a.h; });
    var order = [];
    for (var i = 0; i < arr.length; i++) order.push(arr[i].d);
    return order;
  }

  // chanceNode=true 轮到随机放子（对手），false 轮到 _max 挑最好走法（带 alpha-beta）
  function chanceNode(board, depth, alpha, beta) {
    if (depth <= 0 || --budget <= 0) return heuristic(board);
    var cells = emptyCells(board);
    if (!cells.length) return heuristic(board);
    var samples = sampleCells(cells, Math.min(3, cells.length));
    var total = 0;
    for (var i = 0; i < samples.length; i++) {
      var rc = samples[i];
      var b2 = clone(board); b2[rc[0]][rc[1]] = 2;
      var b4 = clone(board); b4[rc[0]][rc[1]] = 4;
      total += 0.88 * maxNode(b2, depth - 1, alpha, beta) + 0.12 * maxNode(b4, depth - 1, alpha, beta);
    }
    return total / samples.length;
  }

  function maxNode(board, depth, alpha, beta) {
    if (depth <= 0 || --budget <= 0) return heuristic(board);
    var best = -Infinity;
    var order = moveOrder(board);
    for (var i = 0; i < order.length; i++) {
      var res = tryMove(board, order[i]);
      var v = chanceNode(res.board, depth - 1, alpha, beta);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;                     // α-β 剪枝
    }
    return best === -Infinity ? heuristic(board) : best;
  }

  function bestMove(board, budgetIn, maxDepthIn, allowed) {
    budget = budgetIn || 4200;
    maxDepthIn = maxDepthIn || 4;
    var bestDir = null, best = -Infinity;
    var order = allowed || moveOrder(board);   // allowed: 已过滤(可动且不越天花板)的方向
    for (var i = 0; i < order.length; i++) {
      var d = order[i];
      if (!tryMove(board, d).moved) continue;   // allowed 或缺省时都跳过无效方向
      var res = tryMove(board, d);
      var s = chanceNode(res.board, maxDepthIn, best, Infinity);
      if (s > best) { best = s; bestDir = d; }
    }
    return bestDir;
  }

  /* 难度天花板约束的 AI 走子选择（R4）。
     ceil>0 时：只允许"走完仍不越过上限"的方向 —— AI 既不瞬间判负、
     也不再往上长，被钉死在天花板下。这样简单档 AI 能继续陪跑攒分，
     但物理上限把它的总分锁死 → 分差被拉满，且玩家迟早反超。
     若被天花板卡到无路可走，返回 null（aiAct 会让它空转一轮）。 */
  function chooseBotMove(board, budget, depth, blunder, ceil) {
    function legal(dd) {
      var r = tryMove(board, dd);
      return r.moved && (!ceil || maxVal(r.board) <= ceil);
    }
    var opts = [];
    for (var dd = 0; dd < 4; dd++) if (legal(dd)) opts.push(dd);
    if (!opts.length) return null;
    if (blunder > 0 && Math.random() < blunder) return opts[Math.floor(Math.random() * opts.length)];
    return bestMove(board, budget, depth, opts);
  }

  // ---------------- Rendering ----------------
  var TILE_COLOR = {
    2: "#eee4da", 4: "#ede0c8", 8: "#f2b179", 16: "#f59563",
    32: "#f67c5f", 64: "#f65e3b", 128: "#edcf72", 256: "#edcc61",
    512: "#edc850", 1024: "#edc53f", 2048: "#edc22e",
    4096: "#3c3a32", 8192: "#5bca57"
  };

  function Duel() {
    this.p = emptyBoard(); this.ps = 0;       // player
    this.b = emptyBoard(); this.bs = 0;       // bot
    this.winner = null;
    this.round = 0;
    this.t0 = 0;
    this.aiTimer = null;
    this.thinking = false;
    this.locked = false;   // 严格轮流：bot 思考/行动期间锁住玩家输入

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
      combo: document.getElementById("ai-combo")
    };
    this.pMerge = 0; this.bMerge = 0;
    this.pCombo = 0; // 2048+ 你本步连击

    this.newRound();
  }

  Duel.prototype.newRound = function () {
    var self = this;
    this.round++;
    this.p = emptyBoard(); this.ps = 0; this.pMerge = 0; this.pCombo = 0;
    this.b = emptyBoard(); this.bs = 0; this.bMerge = 0;
    this.winner = null;
    this.locked = false;
    this.eloApplied = false;

    // ---- SKILL：用玩家隐藏分算出本局 AI 的搜索强度（R3）----
    var diff = (window.Assist && window.Assist.get("2048-botdiff")) || "normal";
    this.diff = diff;
    this.hell = (diff === "hell");
    var cfg = DIFF_CFG[diff] || DIFF_CFG.normal;
    var target = DIFF_TARGET[diff] == null ? 0.5 : DIFF_TARGET[diff];
    this.aiRating = playerRating() + eloGap(target);     // 需要的 AI 强度分
    // 分难度强度乘数 + 强度地板：预算取"经验预算"与"难度下限"较大者，
    // 保证地狱/困难即使玩家隐藏分极低也不缩水（确定性兜底）。
    this.aiBudget = Math.max(scoreToBudget(this.aiRating, cfg.pow), cfg.floor || 0);
    this.aiDepth = Math.max(depthCap(this.aiBudget), cfg.depthFl || 0);
    this.playerSpawn = cfg.spawn;                         // 玩家盘生成策略
    this.blunder = cfg.blunder;                           // AI 失误率(简单高/地狱0)
    this.ceil = cfg.ceil || 0;                            // AI 可达上限(0=不限)
    this.p4b = (cfg.p4b == null ? 0.1 : cfg.p4b);         // AI 自己的 4 落子率
    this.p4p = (cfg.p4p == null ? 0.1 : cfg.p4p);         // 玩家盘的 4 落子率

    if (this.el.container && this.el.container.classList) {
      this.el.container.classList.toggle("is-hell", this.hell);
    }
    this.setStatus(this.hell ? "地狱开局 · AI 已握高位块" : "你的回合");
    this.updateSkillBar();

    if (this.el.combo) this.el.combo.classList.remove("on");

    // 开局玩家 3 颗（给定生成策略；中立落子按难度 4 率）
    var self = this;
    function seedPlayer() {
      if (self.playerSpawn === "worst") spawnWorst(self.p);
      else if (self.playerSpawn === "help") spawnHelp(self.p);
      else spawn(self.p, self.p4p);
    }
    seedPlayer(); seedPlayer(); seedPlayer();
    // 开局 AI：若该档有高位起手块，先放一枚；其余补中立小块
    if (cfg.aiStart > 2) {
      var corner = [[0,0],[0,3],[3,0],[3,3]][Math.floor(Math.random() * 4)];
      this.b[corner[0]][corner[1]] = cfg.aiStart;
      this.bs = cfg.aiStart;            // 高位起手块的"历史合成分"一并计入，
                                        // 让地狱的分差在开局即拉开（负反馈拉满）
      spawn(this.b, this.p4b); spawn(this.b, this.p4b);
    } else {
      spawn(this.b, this.p4b); spawn(this.b, this.p4b); spawn(this.b, this.p4b);
    }

    this.t0 = Date.now();
    this.el.banner.style.display = "none";
    if (this.aiTimer) window.clearTimeout(this.aiTimer);

    this.setStatus("你的回合");
    this.render();
  };

  // 更新难度说明 + 隐藏分显示
  Duel.prototype.updateSkillBar = function () {
    var el = document.getElementById("skill-info");
    if (!el) return;
    var d = DIFF_DESC[this.diff] || "";
    el.innerHTML = '<span class="skill-elo">隐藏分 <b>' + playerRating() +
      '</b></span><span class="skill-target">目标胜率 <b>' +
      Math.round(DIFF_TARGET[this.diff] * 100) + '%</b></span><span class="skill-ai">AI强度 ' +
      Math.round(this.aiRating) + '</span>' +
      (d ? '<span class="skill-desc">' + d + '</span>' : '');
  };

  // 2048+：你本步多次合并 → 弹连击徽标
  Duel.prototype.flashCombo = function () {
    var c = this.el.combo;
    if (!c) return;
    if (this.pCombo >= 2) {
      c.textContent = "×" + this.pCombo + " 连击";
      c.classList.remove("on");
      void c.offsetWidth;
      c.classList.add("on");
    } else {
      c.classList.remove("on");
    }
  };

  // 你的落子触发机器人：先"思考"，再走一步，然后停下来等你
  Duel.prototype.think = function () {
    var self = this;
    if (this.winner) return;
    this.locked = true;              // 锁定玩家输入，等 bot 走完再解锁（严格轮流）
    this.setStatus("机器人思考中…");
    if (this.aiTimer) window.clearTimeout(this.aiTimer);
    this.aiTimer = window.setTimeout(function () { self.aiAct(); }, 420);
  };

  Duel.prototype.aiAct = function () {
    if (this.winner) return;
    // 决策：受"难度天花板"约束 + 简单/普通按失误率随机乱走，困难/地狱稳用深搜
    var d = chooseBotMove(this.b, this.aiBudget, this.aiDepth, this.blunder, this.ceil);
    if (d === null) { // 被天花板卡到无路可走 → 空转一轮，等待玩家反超
      this.checkWin(); this.locked = false; this.renderB(null);
      this.setStatus(this.winner ? "" : "机器已至上限 · 等待你反超"); return;
    }
    var old = this.b;
    var res = tryMove(this.b, d);
    var sc = slideTrack(old, d);
    this.bs += res.gained;
    this.b = res.board;
    this.bMerge += res.gained;
    spawn(this.b, this.p4b);   // AI 盘子：中立生成（强度来自失误率+搜索+起手，非生成作弊）
    this.checkWin();
    this.locked = false;             // 解锁，轮到玩家
    this.renderB(sc);
    this.setStatus(this.winner ? "" : "你的回合");
  };

  Duel.prototype.setStatus = function (txt) {
    if (this.el.aiStatus) this.el.aiStatus.textContent = txt;
  };

  Duel.prototype.playerMove = function (dir) {
    if (this.winner || this.locked) return;   // 严格轮流：bot 回合内不接受玩家输入
    var old = this.p;
    var res = tryMove(this.p, dir);
    if (!res.moved) return;
    this.p = res.board;
    var sc = slideTrack(old, dir);
    this.ps += res.gained;
    this.pMerge += res.gained;
    this.pCombo = res.merges; // 2048+ 本步连击
    if (this.playerSpawn === "worst") spawnWorst(this.p);
    else if (this.playerSpawn === "help") spawnHelp(this.p);
    else spawn(this.p, this.p4p);
    if (window.Sound) { window.Sound.drop(); if (res.merges > 0) window.Sound.merge(); }
    this.checkWin();
    if (window.nudge) window.nudge(this.el.pBoard, dir); // 滑动跟随的推力
    this.renderP(sc);
    this.flashCombo();
    if (!this.winner) this.think(); // 你动一步 → 机器人想一步
  };

  Duel.prototype.checkWin = function () {
    // 确定性兜底（R4）：AI 盘只要越过本难度"可达上限"即判负。
    // 这一条的约束力 >> 失误率：简单档 AI 被钉死在 8，物理上
    // 撑不过高位，任何正常打得比你高 → 分差天然被拉满。
    var CEILED = (this.ceil > 0 && maxVal(this.b) > this.ceil);
    var p2048 = maxVal(this.p) >= WIN_VAL;
    var b2048 = CEILED ? false : maxVal(this.b) >= WIN_VAL;
    if (CEILED) this.winner = "p";
    else if (p2048 && b2048) this.winner = "tie";
    else if (p2048) this.winner = "p";
    else if (b2048) this.winner = "b";
    else {
      var pd = deadOr(this.p), bd = deadOr(this.b);
      if (pd && bd) this.winner = this.ps >= this.bs ? "p" : "b";
      else if (pd) { this.winner = "b"; }
      else if (bd) { this.winner = "p"; }
    }
    if (this.winner) {
      this.applyElo();
      this.actuateBanner();
    }
  };

  // ELO 更新（R2）：S 实际结果，E 期望；灵敏度 K 随活动/表现/胜负方向动态变化
  Duel.prototype.applyElo = function () {
    if (this.eloApplied) return;          // 只结算一次
    this.eloApplied = true;
    var S = this.winner === "p" ? 1 : (this.winner === "tie" ? 0.5 : 0);
    var Rp = playerRating();
    var E = eloExpected(Rp, this.aiRating);   // 该强度下玩家应得胜率
    var src = (S === 1) ? "win" : (S === 0 ? "lose" : "win"); // 和局按"win"方向轻微上调
    var K = dynamicK(this.diff, src);         // 动态灵敏度（正/负反馈不对称）
    saveRating(Rp + K * (S - E));             // 闭环调节
    pushResult(S);                            // 记入近期战绩，驱动下次灵敏度
    var el = document.getElementById("skill-info");
    if (el) this.updateSkillBar();
  };

  Duel.prototype.resolve = function () { this.checkWin(); };

  Duel.prototype.actuateBanner = function () {
    this.el.banner.style.display = "flex";
    if (this.winner === "p") this.el.bannerText.textContent = "你赢了 · 抢先合成 2048";
    else if (this.winner === "b") this.el.bannerText.textContent = "机器人赢了 · 再战一局？";
    else this.el.bannerText.textContent = "平局 · 势均力敌";
  };

  Duel.prototype.render = function () {
    this.renderStats();
    renderBoard(this.el.pBoard, this.p, null);
    renderBoard(this.el.bBoard, this.b, null);
  };
  Duel.prototype.renderP = function (sc) { this.renderStats(); renderBoard(this.el.pBoard, this.p, sc || null); };
  Duel.prototype.renderB = function (sc) { this.renderStats(); renderBoard(this.el.bBoard, this.b, sc || null); };
  Duel.prototype.renderStats = function () {
    this.el.pScore.textContent = this.ps;
    this.el.bScore.textContent = this.bs;
    this.el.pMerges.textContent = "+" + this.pMerge;
    this.el.bMerges.textContent = "+" + this.bMerge;
    var secs = Math.floor((Date.now() - this.t0) / 1000);
    this.el.timer.textContent = Math.floor(secs / 60) + ":" + ("0" + (secs % 60)).slice(-2);
  };

  // 带滑动/合体/新生动画的棋盘渲染（绝对定位 + transform 过渡，参照经典模式）
  function renderBoard(container, board, slideCells) {
    container.innerHTML = "";
    var size = container.clientWidth || 260;
    var cw = (size - 2 * PAD - 3 * GAP) / 4, ch = cw;
    var start = {};
    if (slideCells) slideCells.forEach(function (s) { start[s.r + "," + s.c] = s; });
    var i, r, c;

    // 空槽底格
    for (i = 0; i < 16; i++) {
      var bg = document.createElement("div");
      bg.className = "cell";
      bg.style.left = (PAD + (i % 4) * (cw + GAP)) + "px";
      bg.style.top = (PAD + Math.floor(i / 4) * (ch + GAP)) + "px";
      bg.style.width = cw + "px";
      bg.style.height = ch + "px";
      container.appendChild(bg);
    }

    for (r = 0; r < 4; r++) for (c = 0; c < 4; c++) {
      var v = board[r][c];
      if (!v) continue;
      var st = start[r + "," + c];
      var cell = document.createElement("div");
      cell.className = "cell a-tile has-tile";
      cell.style.left = (PAD + c * (cw + GAP)) + "px";
      cell.style.top = (PAD + r * (ch + GAP)) + "px";
      cell.style.width = cw + "px";
      cell.style.height = ch + "px";
      cell.style.background = TILE_COLOR[v] || "#3c3a32";
      cell.style.color = (v === 2 || v === 4) ? "#776e65" : "#f9f6f2";
      cell.textContent = v;
      cell.style.fontSize = (v < 100 ? 26 : (v < 1000 ? 22 : (v < 10000 ? 15 : 12))) + "px";

      if (st && st.merged) {
        cell.className += " a-merged";                       // 合体原地弹跳
      } else if (!st) {
        cell.className += " a-new";                          // 新生成的方块浮现
      } else {
        var dx = (st.fromC - c) * cw, dy = (st.fromR - r) * ch;
        if (dx !== 0 || dy !== 0) {                          // 滑动
          cell.className += " a-slide";
          cell.style.transform = "translate(" + dx + "px," + dy + "px)";
        }
      }
      container.appendChild(cell);
    }

    // 强制回流，让 a-slide 起始位先落版，再触发平滑过渡
    void container.offsetHeight;

    // 下一帧让滑动位移归零 → 触发平滑过渡
    window.requestAnimationFrame(function () {
      var els = container.querySelectorAll(".a-slide");
      for (var k = 0; k < els.length; k++) els[k].style.transform = "translate(0,0)";
    });
  }

  // ---------------- input ----------------
  var KEYS = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };

  if (typeof window !== "undefined") {
    window.AiDuel = function () {
      var game = new Duel();
      window.addEventListener("keydown", function (e) {
        var d = KEYS[e.code];
        if (d === undefined) return;
        e.preventDefault();
        game.playerMove(d);
      });
      // 手机滑动：在己方棋盘上滑动控制左边的棋盘
      if (window.bindSwipe) window.bindSwipe(document.getElementById("board-p"), function (d) { game.playerMove(d); });
      document.getElementById("replay").addEventListener("click", function () { game.newRound(); });
      return game;
    };
  }

  // ---- 无头测试导出：供 Node 校验脚本复用同一套生产引擎 ----
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      WIN_VAL: WIN_VAL,
      DIFF_CFG: DIFF_CFG, DIFF_TARGET: DIFF_TARGET,
      emptyBoard: emptyBoard, clone: clone, emptyCells: emptyCells,
      tryMove: tryMove, spawn: spawn, spawnWorst: spawnWorst, spawnHelp: spawnHelp,
      maxVal: maxVal, deadOr: deadOr, bestMove: bestMove, heuristic: heuristic,
      scoreToBudget: scoreToBudget, eloGap: eloGap, depthCap: depthCap,
      chooseBotMove: chooseBotMove
    };
  }
})();