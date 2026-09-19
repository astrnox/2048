function Tile(position, value, fuse) {
  this.x                = position.x;
  this.y                = position.y;
  this.value            = value || 2;
  this.fuse             = (fuse === undefined) ? 8 : fuse; // 引信模式剩余寿命（步）

  this.previousPosition = null;
  this.mergedFrom       = null; // Tracks tiles that merged together
}

Tile.prototype.savePosition = function () {
  this.previousPosition = { x: this.x, y: this.y };
};

Tile.prototype.updatePosition = function (position) {
  this.x = position.x;
  this.y = position.y;
};

Tile.prototype.serialize = function () {
  return {
    position: {
      x: this.x,
      y: this.y
    },
    value: this.value,
    fuse: this.fuse
  };
};
