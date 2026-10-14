/* Adds a "show password" eye button to every password field, including fields the app builds later
   (sign up, add user, reset password dialogs). Nothing else needs to change when a new password field is added. */
(function () {
  "use strict";
  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path class="slash" d="M3 3l18 18"/></svg>';

  function enhance(input) {
    if (input.dataset.pwToggle || input.closest(".pill-input")) return; // the sign-in page has its own button
    input.dataset.pwToggle = "1";
    var wrap = document.createElement("span");
    wrap.className = "pw-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pw-eye";
    btn.setAttribute("aria-label", "Show password");
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = ICON;
    btn.addEventListener("mousedown", function (e) { e.preventDefault(); }); // keep the cursor in the field
    btn.addEventListener("click", function () {
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.setAttribute("aria-pressed", String(show));
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
      input.focus();
      try { var n = input.value.length; input.setSelectionRange(n, n); } catch (e) { /* not supported */ }
    });
    wrap.appendChild(btn);
  }

  function scan() {
    var list = document.querySelectorAll("input[type=password]");
    for (var i = 0; i < list.length; i++) enhance(list[i]);
  }
  scan();
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
})();
