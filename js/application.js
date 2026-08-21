// Wait till the browser is ready to render the game (avoids glitches)
window.requestAnimationFrame(function () {
  var game = new GameManager(4, KeyboardInputManager, HTMLActuator, LocalStorageManager);

  var buttons = document.querySelectorAll(".mode-button");

  // Pick the initial mode from the URL (?mode=endless), defaulting to classic.
  // This lets homepage cards like game.html?mode=time jump straight into a mode.
  var initial = "classic";
  var match = window.location.search.match(/[?&]mode=([^&]+)/);
  if (match) initial = match[1];

  function applyMode(mode) {
    game.setMode(mode);
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("active", buttons[i].getAttribute("data-mode") === mode);
    }
  }

  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener("click", function (e) {
      e.preventDefault(); // switch in place instead of reloading
      applyMode(this.getAttribute("data-mode"));
      history.replaceState(null, "", "game.html?mode=" + this.getAttribute("data-mode"));
    });
  }

  // Preselect the matching button when arriving with a mode in the URL
  for (var i = 0; i < buttons.length; i++) {
    if (buttons[i].getAttribute("data-mode") === initial) {
      buttons[i].classList.add("active");
    }
  }

  // 有经典存档且请求的是经典模式：恢复上次进度，不要 setMode 清档
  var hasSave = false;
  try {
    var s = window.localStorage.getItem("gameState");
    hasSave = !!s;
  } catch (e) {}
  if (hasSave && initial === "classic") {
    game.actuator.setMode("classic");
    game.actuator.continueGame();
  } else {
    game.setMode(initial);
  }
});