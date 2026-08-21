// Wait till the browser is ready to render the game (avoids glitches)
window.requestAnimationFrame(function () {
  var game = new GameManager(4, KeyboardInputManager, HTMLActuator, LocalStorageManager);

  var buttons = document.querySelectorAll(".mode-button");

  function applyMode(mode) {
    game.setMode(mode);
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("active", buttons[i].getAttribute("data-mode") === mode);
    }
  }

  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener("click", (function (button) {
      return function () {
        applyMode(button.getAttribute("data-mode"));
      };
    })(buttons[i]));
  }

  applyMode("classic");
});