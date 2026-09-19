// Central registry of available game modes.
// Each entry drives the on-screen selector and the behaviour toggles
// looked up by key ("classic" | "time" | "endless").
var GameModes = {
  classic: { name: "经典模式", desc: "经典玩法，合成到 2048 获胜" },
  time:    { name: "限时挑战", desc: "60 秒倒计时，尽可能多得分" },
  endless: { name: "无尽模式", desc: "列车不停，冲击更高数字" },
  daily:   { name: "每日难题", desc: "每天同一盘、运数相同，冲今日最佳" },
  n128:    { name: "别造 128", desc: "一旦合成 128 就出局，禁止造 128" },
  anti:    { name: "反转 2048", desc: "反着玩：谁先把棋盘填到无路可走，谁赢" },
  steps:   { name: "限步挑战", desc: "60 步之内，尽可能多得高分" },
  block:   { name: "障碍格", desc: "棋盘上有不可通行的障碍格，绕开它们合体" },
  spin:    { name: "旋转棋盘", desc: "每走一步棋盘顺时针旋转 90°" },
  lava:    { name: "熔岩上涌", desc: "岩浆每 4 步上升一行，吞噬瓦片" },
  blind:   { name: "盲盒记忆", desc: "瓦片数值藏在背面，每步只闪现一瞬" },
  fission: { name: "裂变", desc: "大数不稳定，随时可能分裂成两个半值" },
  fuse:    { name: "引信", desc: "瓦片带倒计时，归零爆炸消失并扣分" },
  dive:    { name: "整除模式", desc: "瓦片与其约数合并相加，合成解锁新质数" }
};