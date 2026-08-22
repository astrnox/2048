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

  /* =========================================================
     SKILL 系统 ·「目标胜率 × 玩家隐藏分(ELO)」动态难度
     ---------------------------------------------------------
     设计说明（科学建模）：
       1) 每个玩家有一个隐藏 ELO 分 Rp，持久化在 localStorage。
       2) 每档难度固定一个"目标胜率 target"：
             简单 0.90 / 普通 0.60 / 困难 0.30 / 地狱 ~0.01
       3) 由标准 Elo 期望公式 P=E(Rp,Ra)=1/(1+10^((Ra-Rp)/400))，
          反解达到该胜率所需的 AI 强度分：
              Ra = Rp + 400·log10((1-target)/target)
          难度越高 gap 越大 → 要求的 AI 越强。
       4) Ra 单调映射为搜索节点预算（指数增长）与深度上限：
              预算越大 → 推演越深 → AI 越强。
          这样"难度"是连续的单个参数，可随玩家水平自动伸缩。
       5) 每局结束按 Elo 更新 Rp：  Rp += K·(S - E)
          S 本局实际结果(胜1/和.5/负0)，E 期望(用本局 Ra 算出)。
          于是玩家越强 → Rp 越高 → AI 强度分随之上浮 → 难度自动
          跟上玩家，把目标胜率钉住（困难实在太强则玩家分回落，AI
          相应变弱，形成稳定负反馈）。
     ---------------------------------------------------------
     生成策略：
       - 地狱不靠"生成偏向 AI"，而靠最强搜索碾压，双方生成都保持中立。
       - 仅困难档在玩家盘上加对抗性 spawnWorst 作为补充难度来源，
         主要压力仍来自搜索深度。
     ========================================================= */
  var RP_KEY = "2048-ai-elo";
  var RP_DEF = 1200;        // 新玩家基准分
  var ELO_K = 48;           // 更新步长（越大适应越快）
  var DIFF_TARGET = { easy: 0.90, normal: 0.60, hard: 0.30, hell: 0.01 };
  // 各档体验描述（UI 用）
  var DIFF_DESC = {
    easy:   "AI 浅算、爱失误，让你从容熟悉规则",
    normal: "AI 稳定合牌，和你势均力敌",
    hard:   "AI 深算 + 针对你的落点，压你一头",
    hell:   "AI 全力推演、近乎完美，几乎不可战胜"
  };

  function playerRating() {
    try { var v = parseInt(localStorage.getItem(RP_KEY), 10); return isNaN(v) ? RP_DEF : v; }
    catch (e) { return RP_DEF; }
  }
  function saveRating(r) { try { localStorage.setItem(RP_KEY, String(Math.round(r))); } catch (e) {} }

  // Elo 期望（玩家胜率）
  function eloExpected(playerR, aiR) { return 1 / (1 + Math.pow(10, (aiR - playerR) / 400)); }
  // 目标胜率 → 需要的 AI 相对分差
  function eloGap(target) { return 400 * Math.log10((1 - target) / target); }

  // 强度分 + 档位 → 节点预算（指数）：Ra 越高预算指数级放大
  function scoreToBudget(Ra) {
    var s = Math.max(0, Math.min(1, (Ra - 1000) / 1600));   // 归一 0..1
    return Math.round(700 * Math.pow(10, 2.4 * s));          // 700 → ~200000
  }
  // 预算 → 深度上限（限制递归层数，控时）
  function depthCap(b) {
    if (b < 1500) return 3;
    if (b < 6000) return 5;
    if (b < 20000) return 7;
    if (b < 60000) return 8;
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

  /* ---- 对抗性放置（Adversarial 补充难度来源）----
     只在"困难"档对玩家盘生效：spawnWorst 挑(落点, 取值)，使玩家
     【最优应对之后】的局面最差（min-max 两层的 Placer 视角），
     作为搜索深度之外的额外压力。地狱/简单/普通走中立生成。 */
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
    b[bestCell[0]][bestCell[1]] = bestVal;
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
      total += 0.9 * maxNode(b2, depth - 1, alpha, beta) + 0.1 * maxNode(b4, depth - 1, alpha, beta);
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

  function bestMove(board, budgetIn, maxDepthIn) {
    budget = budgetIn || 4200;
    maxDepthIn = maxDepthIn || 4;
    var bestDir = null, best = -Infinity;
    var order = moveOrder(board);
    for (var i = 0; i < order.length; i++) {
      var d = order[i];
      var res = tryMove(board, d);
      var s = chanceNode(res.board, maxDepthIn, best, Infinity);
      if (s > best) { best = s; bestDir = d; }
    }
    return bestDir;
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

    // ---- SKILL：用玩家隐藏分算出本局 AI 的搜索强度 ----
    var diff = (window.Assist && window.Assist.get("2048-botdiff")) || "normal";
    this.diff = diff;
    this.hell = (diff === "hell");
    var target = DIFF_TARGET[diff] == null ? 0.5 : DIFF_TARGET[diff];
    this.aiRating = playerRating() + eloGap(target);     // 需要的 AI 强度分
    this.aiBudget = scoreToBudget(this.aiRating);         // → 节点预算
    this.aiDepth = depthCap(this.aiBudget);               // → 深度上限

    if (this.el.container && this.el.container.classList) {
      this.el.container.classList.toggle("is-hell", this.hell);
    }
    this.setStatus(this.hell ? "地狱开局 · 全力推演" : "你的回合");
    this.updateSkillBar();

    if (this.el.combo) this.el.combo.classList.remove("on");

    // 生成策略（地狱不靠生成偏向 AI，纯靠最强算法碾压）：
    //   简单/普通/地狱 → 双方中立随机；仅困难 → 玩家盘对抗性 spawn 补压
    if (diff === "hard") {
      spawnWorst(this.p); spawnWorst(this.p); spawnWorst(this.p);
      this.playerSpawn = "worst";
    } else {
      spawn(this.p); spawn(this.p); spawn(this.p);
      this.playerSpawn = "neutral";
    }
    this.botSpawn = "neutral";
    spawn(this.b); spawn(this.b); spawn(this.b);

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
    var d = bestMove(this.b, this.aiBudget, this.aiDepth);   // SKILL 驱动的搜索强度
    if (d === null) { this.checkWin(); this.locked = false; this.renderB(null); this.setStatus(this.winner ? "" : "机器入局停止"); return; }
    var old = this.b;
    var res = tryMove(this.b, d);
    var sc = slideTrack(old, d);
    this.bs += res.gained;
    this.b = res.board;
    this.bMerge += res.gained;
    spawn(this.b);   // AI 盘子：中立生成（强搜算法碾压，不靠生成作弊）
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
    if (this.playerSpawn === "worst") spawnWorst(this.p); else spawn(this.p);
    if (window.Sound) { window.Sound.drop(); if (res.merges > 0) window.Sound.merge(); }
    this.checkWin();
    if (window.nudge) window.nudge(this.el.pBoard, dir); // 滑动跟随的推力
    this.renderP(sc);
    this.flashCombo();
    if (!this.winner) this.think(); // 你动一步 → 机器人想一步
  };

  Duel.prototype.checkWin = function () {
    var p2048 = maxVal(this.p) >= WIN_VAL;
    var b2048 = maxVal(this.b) >= WIN_VAL;
    if (p2048 && b2048) this.winner = "tie";
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

  // ELO 更新：S 实际结果，E 期望（用本局 AI 强度分反推的玩家胜率）
  Duel.prototype.applyElo = function () {
    if (this.eloApplied) return;          // 只结算一次
    this.eloApplied = true;
    var S = this.winner === "p" ? 1 : (this.winner === "tie" ? 0.5 : 0);
    var Rp = playerRating();
    var E = eloExpected(Rp, this.aiRating);   // 该强度下玩家应得胜率
    saveRating(Rp + ELO_K * (S - E));         // 闭环负反馈
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
})();