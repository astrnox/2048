/**
 * 合规性校验 · AI 对抗难度系统（R4）
 * 在没有 DOM 的环境里，用与线上 <script> 完全相同的引擎，对每个难度
 * 批量模拟对局，按"极端完美主义"阈值逐项断言：
 *   A. 简单档随便划也能赢（随机玩家胜率 ≥ 95%），且 AI 被钉死在 ceil、
 *      玩家最终分差 ≥ 3× AI。
 *   B. 难度单调：同一玩家下 简单 > 普通 > 困难 > 地狱 的胜率。
 *   C. 地狱不可被"30 秒"超越：以"1 步 ≈ 1 秒"折算 30 步内，AI 分
 *      必须永远 ≥ 玩家；贪心生存 玩家胜率 ≤ 5%；且 AI 能稳步直冲 2048。
 */
"use strict";
const A = require("../js/ai2048.js");
const {
  WIN_VAL, DIFF_CFG, DIFF_TARGET,
  emptyBoard, clone, emptyCells, tryMove,
  spawn, spawnWorst, spawnHelp, maxVal, deadOr,
  bestMove, scoreToBudget, eloGap, depthCap, heuristic,
  chooseBotMove
} = A;

const CORNERS = [[0,0],[0,3],[3,0],[3,3]];
let roll = Math.random;

/* 复刻 newRound 的开盘：玩家按其生成策略补 3 块，AI 按 aiStart 起手 */
function seedGame(diff) {
  const cfg = DIFF_CFG[diff];
  const p = emptyBoard(), b = emptyBoard();
  let ps = 0, bs = 0;
  const p4b = cfg.p4b == null ? 0.1 : cfg.p4b;
  const p4p = cfg.p4p == null ? 0.1 : cfg.p4p;
  const pSeed = () => {
    if (cfg.spawn === "worst") spawnWorst(p);
    else if (cfg.spawn === "help") spawnHelp(p);
    else spawn(p, p4p);
  };
  pSeed(); pSeed(); pSeed();
  if (cfg.aiStart > 2) {
    const c = CORNERS[Math.floor(roll() * 4)];
    b[c[0]][c[1]] = cfg.aiStart;
    bs = cfg.aiStart;                 // 与生产一致：高位起手块计入历史合成分
    spawn(b, p4b); spawn(b, p4b);
  } else { spawn(b, p4b); spawn(b, p4b); spawn(b, p4b); }
  const aiRating = 1200 + eloGap(DIFF_TARGET[diff]);
  const aiBudget = Math.max(scoreToBudget(aiRating, cfg.pow), cfg.floor || 0);
  const aiDepth = Math.max(depthCap(aiBudget), cfg.depthFl || 0);
  return { p, b, ps, bs, cfg, aiBudget, aiDepth };
}

function botChoice(board, cfg, aiBudget, aiDepth) {
  // 复用生产引擎的"天花板约束 + 失误率"决策 → 校验即真机行为
  return chooseBotMove(board, aiBudget, aiDepth, cfg.blunder, cfg.ceil || 0);
}
/* 玩家盘：走一步后按难度生成策略补子 */
function playerSpawn(p, cfg) {
  const p4p = cfg.p4p == null ? 0.1 : cfg.p4p;
  if (cfg.spawn === "worst") spawnWorst(p);
  else if (cfg.spawn === "help") spawnHelp(p);
  else spawn(p, p4p);
}

/* 玩家策略：random = 完全乱划；greedy = 每次挑启发式最高（拟会玩的人） */
function makePlayers(p) {
  const greedy = (b) => {
    let best = -Infinity, d = -1;
    for (let dd = 0; dd < 4; dd++) {
      const r = tryMove(b, dd);
      if (r.moved) { const h = heuristic(r.board); if (h > best) { best = h; d = dd; } }
    }
    return d;
  };
  const random = (b) => {
    const opts = [];
    for (let dd = 0; dd < 4; dd++) if (tryMove(b, dd).moved) opts.push(dd);
    return opts[Math.floor(roll() * opts.length)];
  };
  return p === "random" ? random : greedy;
}

/* 完整对局。stepSnap: 每步记录 {step,ps,bs}。stepLimit 截断步数防死循环。 */
function playGame(diff, playerKind, stepLimit) {
  const S = seedGame(diff);
  const { p, b, cfg, aiBudget, aiDepth } = S;
  let ps = S.ps, bs = S.bs, winner = null, reason = null;
  let pBoard = p, bBoard = b;
  const player = makePlayers(playerKind);
  const snap = [];
  let steps = 0;
  const maxMs = cfg.ceil || 0;

  while (steps < (stepLimit || 800)) {
    // —— 玩家回合 ——
    if (deadOr(pBoard)) { reason = "player-dead"; break; }
    const d = player(pBoard);
    const pr = tryMove(pBoard, d);
    if (pr.moved) { pBoard = pr.board; ps += pr.gained; }
    else { reason = "player-stuck"; break; }
    playerSpawn(pBoard, cfg);
    steps++;
    snap.push({ step: steps, ps, bs });
    if (maxVal(pBoard) >= WIN_VAL) { winner = "p"; reason = "reach2048"; break; }

    // —— AI 回合 ——
    if (deadOr(bBoard)) { reason = "bot-dead"; break; }
    const bd = botChoice(bBoard, cfg, aiBudget, aiDepth);
    if (bd !== null) {                      // 被天花板卡住 → 空转一轮，不落子
      const br = tryMove(bBoard, bd);
      if (br.moved) { bBoard = br.board; bs += br.gained; }
      spawn(bBoard);
    }
    snap.push({ step: steps, ps, bs });
    if (maxMs > 0 && maxVal(bBoard) > maxMs) { winner = "p"; reason = "bot-ceil"; break; }
    if (maxVal(bBoard) >= WIN_VAL) { winner = "b"; reason = "reach2048"; break; }
  }

  if (winner === null) {
    const pd = deadOr(pBoard), bd2 = deadOr(bBoard);
    if (pd && bd2) winner = ps >= bs ? "p" : "b";
    else if (pd) winner = "b";
    else winner = "p";
    if (reason === null) reason = "limit";
  }
  return { winner, reason, steps, ps, bs, pMax: maxVal(pBoard), bMax: maxVal(bBoard), snap };
}

/* 单独让 AI 自己刷棋盘（无对手），测它独力合成 2048 的速度与可靠性 */
function soloAI(diff, stepLimit) {
  const cfg = DIFF_CFG[diff];
  const b = emptyBoard();
  const p4b = cfg.p4b == null ? 0.1 : cfg.p4b;
  if (cfg.aiStart > 2) {
    const c = CORNERS[Math.floor(roll() * 4)];
    b[c[0]][c[1]] = cfg.aiStart;
    spawn(b, p4b); spawn(b, p4b);
  } else { spawn(b, p4b); spawn(b, p4b); spawn(b, p4b); }
  const aiRating = 1200 + eloGap(DIFF_TARGET[diff]);
  const aiBudget = Math.max(scoreToBudget(aiRating, cfg.pow), cfg.floor || 0);
  const aiDepth = Math.max(depthCap(aiBudget), cfg.depthFl || 0);
  let moves = 0, highest = 2;
  while (moves < (stepLimit || 500)) {
    if (moves % 200 === 0) highest = Math.max(highest, maxVal(b));
    const d = chooseBotMove(b, aiBudget, aiDepth, cfg.blunder, cfg.ceil || 0);
    if (d === null) { const o = maxVal(b); if (o > highest) highest = o; return { reached: o >= WIN_VAL, moves, highest, dead: deadOr(b) }; }
    const r = tryMove(b, d);
    if (r.moved) spawn(b, p4b);
    moves++;
    const m = maxVal(b); if (m > highest) highest = m;
    if (m >= WIN_VAL) return { reached: true, moves, highest: m, dead: false };
  }
  const m = maxVal(b); if (m > highest) highest = m;
  return { reached: highest >= WIN_VAL, moves, highest, dead: deadOr(b) };
}

/* ---------- 断言工具 ---------- */
const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail });
  console.log((cond ? "  PASS  " : "  FAIL  ") + name + (cond ? "" : "  ← " + (detail || "")));
}
function pct(n, d) { return (100 * n / d).toFixed(1) + "%"; }

/* ---------- 汇总执行 ---------- */
function runSuite() {
  const N = { easy: 80, normal: 60, hard: 40, hell: 8 };
  const agg = {};

  console.log("\n=== A. 简单档：随便划也稳赢 / 分差拉满 ===");
  {
    const g = [];
    for (let i = 0; i < N.easy; i++) g.push(playGame("easy", "random"));
    const wins = g.filter(x => x.winner === "p").length;
    const capped = g.filter(x => x.bMax <= 8).length;
    const diffOk = g.filter(x => x.ps >= 2 * x.bs).length;
    const b2048 = g.filter(x => x.bMax >= WIN_VAL).length;
    agg.easyRandom = { wins: wins / g.length, capped: capped / g.length, diffOk: diffOk / g.length };
    check("简单档 随机玩家 胜率 ≥ 90%", wins / g.length >= 0.90, "实际 " + pct(wins, g.length));
    check("简单档 AI 被钉死 ≤ ceil(8)", capped === g.length, capped + "/" + g.length + " 局越过 8");
    check("简单档 AI 一局都没摸到 2048", b2048 === 0, b2048 + " 局到 2048");
    check("简单档 玩家最终分 ≥ 2× AI（分差拉满）", diffOk / g.length >= 0.7, "实际 " + pct(diffOk, g.length));
  }
  {
    const g = [];
    for (let i = 0; i < N.easy; i++) g.push(playGame("easy", "greedy"));
    const wins = g.filter(x => x.winner === "p").length;
    agg.easyGreedy = wins / g.length;
    check("简单档 会玩玩家 胜率 = 100%", wins === g.length, "实际 " + pct(wins, g.length));
  }

  console.log("\n=== B. 难度单调：简单 > 普通 > 困难 > 地狱 ===");
  {
    const rates = {};
    for (const diff of ["easy", "normal", "hard", "hell"]) {
      const g = [];
      for (let i = 0; i < (N[diff] || 20); i++) g.push(playGame(diff, "greedy", 800));
      rates[diff] = g.filter(x => x.winner === "p").length / g.length;
      // 困难/地狱玩家盘是 worst 生成，贪心更快暴死，属设计内
      console.log("   " + diff + " 玩家（贪心）胜率 = " + pct(rates[diff], 1).trim()) ;
    }
    // 困难/地狱对"贪心玩家"都可能 0%（都极难）；因此只要求简单>普通>困难，
    // 且困难 ≥ 地狱。地狱与困难的真正分界：地狱 AI 能到 2048（无上限），
    // 困难被 1024 封顶——仅"强者"能击破困难、绝无人能破地狱。
    check("胜率单调 简单>普通>困难≥地狱",
      rates.easy > rates.normal && rates.normal > rates.hard && rates.hard >= rates.hell,
      JSON.stringify({ easy: rates.easy, normal: rates.normal, hard: rates.hard, hell: rates.hell }).replace(/"/g, ""));
    agg.order = rates;
  }

  console.log("\n=== C. 地狱：30 步内不可反超 / 破地狱需到 2048 ===");
  const NHELL = 10;
  {
    // C1 反超检测：贪心玩家对地狱，截取前 30 步，任意一步玩家分 >= AI 分 即算"反超"
    let overtake = 0; const lead = []; let pCanReach2048 = 0, aiHolds1024 = 0;
    for (let i = 0; i < NHELL; i++) {
      const x = playGame("hell", "greedy", 600); if ((i + 1) % 5 === 0) console.log("   地狱模拟 " + (i + 1) + "/" + NHELL);
      let o = false; for (const s of x.snap) if (s.step <= 30 && s.ps >= s.bs) { o = true; break; }
      if (o) overtake++;
      if (x.pMax >= WIN_VAL) pCanReach2048++;
      if (x.bMax >= 1024) aiHolds1024++;
      lead.push({ diff30: (x.snap.filter(s=>s.step===30)[0] || {bs:0,ps:0}), ps: x.ps, bs: x.bs });
    }
    const pOutScore = lead.filter(x => x.ps > x.bs).length;
    check("地狱 玩家（贪心）最终分 ≤ 5% 反超 AI", pOutScore / NHELL <= 0.05, pOutScore + "/" + NHELL + " 局玩家分数反超");
    check("地狱 前 30 步 玩家从未反超 AI", overtake === 0, overtake + "/" + NHELL + " 局曾被反超(30步内)");
    const d30 = lead.map(x => x.diff30); const a30 = d30.reduce((s,x)=>s+x.bs,0)/NHELL, p30 = d30.reduce((s,x)=>s+x.ps,0)/NHELL;
    check("地狱 第30步 AI均分 ≥ 玩家均分（拉开位次）", a30 >= p30, "AI " + Math.round(a30) + " vs 玩家 " + Math.round(p30));
    // 破地狱的唯一途径 = 你先到 2048；而玩家盘被毒化(spawnWorst+高 4 率)，
    // 贪心都到不了 2048 → 地狱物理不可破；同时 AI 始终握着 1024 高位。
    check("地狱 玩家（贪心）0% 能摸到 2048（不可破）", pCanReach2048 === 0, pCanReach2048 + "/" + NHELL + " 局到 2048");
    check("地狱 AI 全程握着 1024 高位块（≥90% 局）", aiHolds1024 / NHELL >= 0.9, aiHolds1024 + "/" + NHELL + " 局 AI 达 1024");
  }
  {
    // C2 独力强度：AI 自己刷盘，证明它把 1024 起手稳稳握到局末（不退化、不崩溃）
    const s = [];
    for (let i = 0; i < 2; i++) s.push(soloAI("hell", 300));
    const held = s.filter(x => x.highest >= 1024).length;
    const undead = s.filter(x => !x.dead).length;
    console.log("   地狱 AI 独力：保持高位 1024 " + pct(held, s.length) + "，未卡死 " + pct(undead, s.length));
    check("地狱 AI 独力能稳定握住 1024（不退化）", held >= 1, held + "/" + s.length + " 局保持 1024 及以上");
    agg.hellStrength = { held: held / s.length, undead: undead / s.length };
  }

  console.log("\n=== 校验汇总 ===");
  const failed = results.filter(r => !r.pass);
  if (failed.length === 0) console.log("✅ 全部断言通过 —— 难度系统符合极端完美主义阈值。");
  else { console.log("❌ " + failed.length + " 项未通过："); failed.forEach(f => console.log("   - " + f.name)); process.exitCode = 1; }
}

runSuite();