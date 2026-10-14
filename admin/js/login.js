(function () {
  "use strict";
  var api = window.Cliniqo.api;

  // Already signed in? Go straight to the console.
  api.get("/auth/me").then(function (r) { if (r.user.role !== "student") location.replace("admin.html"); }).catch(function () {});

  var form = document.getElementById("loginForm");
  var email = document.getElementById("email");
  var pw = document.getElementById("password");
  var emailErr = document.getElementById("emailErr");
  var pwErr = document.getElementById("pwErr");
  var formMsg = document.getElementById("formMsg");
  var submit = document.getElementById("submit");

  function showMsg(text, isErr) { formMsg.textContent = text; formMsg.className = "msg" + (isErr ? " err" : ""); formMsg.hidden = false; }
  function fieldErr(input, el, text) { el.textContent = text || ""; el.hidden = !text; input.setAttribute("aria-invalid", text ? "true" : "false"); }

  document.getElementById("eye").addEventListener("click", function () {
    var show = pw.type === "password";
    pw.type = show ? "text" : "password";
    this.setAttribute("aria-pressed", String(show));
    this.setAttribute("aria-label", show ? "Hide password" : "Show password");
    document.getElementById("slash").style.display = show ? "none" : "";
  });
  document.getElementById("forgot").addEventListener("click", function () {
    showMsg("Password resets are done by the clinic administrator. Contact them to get a new password.", false);
  });

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    formMsg.hidden = true;
    var em = email.value.trim(), pass = pw.value, bad = false;
    if (!em) { fieldErr(email, emailErr, "Enter your work email."); bad = true; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { fieldErr(email, emailErr, "Enter a valid email, like name@ntc.edu.ph."); bad = true; }
    else fieldErr(email, emailErr, "");
    if (!pass) { fieldErr(pw, pwErr, "Enter your password."); bad = true; } else fieldErr(pw, pwErr, "");
    if (bad) return;

    submit.disabled = true; submit.textContent = "Signing in…";
    try {
      var r = await api.post("/auth/login", { login: em, password: pass });
      if (r.user.role === "student") {
        await api.post("/auth/logout");
        showMsg("This website is for clinic staff, providers and administrators. Students use the Cliniqo student app.", true);
      } else {
        location.href = "admin.html";
        return;
      }
    } catch (err) { showMsg(err.message, true); }
    submit.disabled = false; submit.textContent = "Continue";
  });
})();
