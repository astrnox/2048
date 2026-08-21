// Central registry of available game modes.
// Each entry drives the on-screen selector and the behaviour toggles
// looked up by key ("classic" | "time" | "endless").
var GameModes = {
  classic: { name: "经典模式", desc: "经典玩法，合成到 2048 获胜" },
  time:    { name: "限时挑战", desc: "60 秒倒计时，尽可能多得分" },
  endless: { name: "无尽模式", desc: "列车不停，冲击更高数字" },
  daily:   { name: "每日难题", desc: "每天同一盘、运数相同，冲今日最佳" }
};