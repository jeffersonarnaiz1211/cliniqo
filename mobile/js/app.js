/* Cliniqo student app (PWA). Plain JavaScript, no framework. Talks to /api with an HttpOnly cookie session. */
(function () {
  "use strict";
  var $app = document.getElementById("app"), $toast = document.getElementById("toast");
  var S = { me: null, meta: null, depts: [], notifUnread: 0, book: null };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var LOGO = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3a17 17 0 1 0 17 17h-9a8 8 0 1 1-8-8z" fill="#2f3a8f"/><circle cx="20" cy="20" r="4.5" fill="#2f3a8f"/></svg>';
  var ICON = {
    home: '<path d="M3 11l9-8 9 8M5 10v10h14V10"/>', book: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/>',
    sched: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 14h3"/>', bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21h4"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'
  };

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function parts(d) { var p = d.split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function iso(dt) { return dt.getUTCFullYear() + "-" + String(dt.getUTCMonth() + 1).padStart(2, "0") + "-" + String(dt.getUTCDate()).padStart(2, "0"); }
  function addDays(d, n) { var x = parts(d); x.setUTCDate(x.getUTCDate() + n); return iso(x); }
  function longDate(d) { var x = parts(d); return DOW[x.getUTCDay()] + ", " + MON[x.getUTCMonth()] + " " + x.getUTCDate(); }
  function t12(t) { var h = +t.slice(0, 2), m = t.slice(3); return (h % 12 || 12) + ":" + m + " " + (h < 12 ? "AM" : "PM"); }
  function toast(msg) { $toast.textContent = msg; $toast.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { $toast.hidden = true; }, 3000); }
  function pref(k, v) { try { if (v === undefined) return localStorage.getItem("cliniqo_" + k); localStorage.setItem("cliniqo_" + k, v); } catch (e) { return null; } }
  function pill(s) { var c = { Booked: "p-wait", "Checked in": "p-wait", Completed: "p-ok", "No-show": "p-bad", Cancelled: "p-mute" }[s] || "p-mute"; return '<span class="pill ' + c + '">' + esc(s) + "</span>"; }

  async function api(method, path, body) {
    var o = { method: method, credentials: "same-origin", headers: { "X-Requested-With": "cliniqo" } };
    if (body !== undefined) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(body); }
    var res;
    try { res = await fetch("/api" + path, o); } catch (e) { throw { status: 0, message: "You look offline. Check your connection and try again." }; }
    var data = null; try { data = await res.json(); } catch (e) { /* empty */ }
    if (!res.ok) {
      if (res.status === 401 && S.me && path !== "/auth/login") { S.me = null; go("login"); }
      throw { status: res.status, message: (data && data.error) || "Something went wrong. Please try again.", field: data && data.field };
    }
    return data;
  }
  function go(r) { if (location.hash === "#/" + r) route(); else location.hash = "#/" + r; }
  function show(html) { $app.innerHTML = html; window.scrollTo(0, 0); var h = $app.querySelector("h1"); if (h) { h.setAttribute("tabindex", "-1"); } }
  function tabbar(cur) {
    var items = [["home", "Home", "home"], ["book", "Book", "book"], ["schedule", "Schedule", "sched"], ["notifications", "Alerts", "bell"], ["profile", "Profile", "user"]];
    return '<nav class="tabbar" aria-label="Main">' + items.map(function (i) {
      return '<a href="#/' + i[0] + '"' + (cur === i[0] ? ' aria-current="page"' : "") + '><svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[i[2]] + "</svg>" + i[1] +
        (i[0] === "notifications" && S.notifUnread ? '<span class="badge" aria-label="' + S.notifUnread + ' unread">' + S.notifUnread + "</span>" : "") + "</a>";
    }).join("") + "</nav>";
  }
  function skeleton() { return '<div class="skeleton"></div><div class="skeleton"></div>'; }
  function sheet(html) {
    closeSheet();
    var bg = document.createElement("div"); bg.className = "sheet-bg"; bg.id = "sheetBg";
    bg.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' + html + "</div>";
    bg.addEventListener("click", function (e) { if (e.target === bg) closeSheet(); });
    document.body.appendChild(bg);
    var f = bg.querySelector("button, input, select"); if (f) f.focus();
    return bg;
  }
  function closeSheet() { var b = document.getElementById("sheetBg"); if (b) b.remove(); }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });

  /* ---------- auth screens ---------- */
  function loginView() {
    show('<main class="screen auth"><div class="logo">' + LOGO + 'Cliniqo</div><h1 class="center">Sign In</h1>' +
      '<form id="loginForm" class="stack" novalidate><label class="fld">Student number<input class="in" id="login" autocomplete="username" inputmode="text" placeholder="2024-00123" maxlength="40" required></label>' +
      '<label class="fld">Password<input class="in" id="pw" type="password" autocomplete="current-password" maxlength="100" required></label>' +
      '<p class="err" id="err" role="alert" hidden></p><button class="btn" id="go">Sign In</button></form>' +
      '<p class="center sub">New here? <button class="link" data-act="register">Create an account</button></p></main>');
  }
  function registerView() {
    show('<main class="screen auth"><div class="logo">' + LOGO + 'Cliniqo</div><h1 class="center">Create account</h1>' +
      '<form id="regForm" class="stack" novalidate>' +
      '<label class="fld">First name<input class="in" id="fn" autocomplete="given-name" maxlength="40" required></label>' +
      '<label class="fld">Last name<input class="in" id="ln" autocomplete="family-name" maxlength="40" required></label>' +
      '<label class="fld">Student number<input class="in" id="sn" placeholder="2024-00123" maxlength="20" required></label>' +
      '<label class="fld">Password (8+ characters, letters and a number)<input class="in" id="pw" type="password" autocomplete="new-password" maxlength="72" required></label>' +
      '<label class="fld">Confirm password<input class="in" id="pw2" type="password" autocomplete="new-password" maxlength="72" required></label>' +
      '<p class="err" id="err" role="alert" hidden></p><button class="btn" id="go">Create account</button></form>' +
      '<p class="center sub">Already registered? <button class="link" data-act="tologin">Sign in</button></p></main>');
  }
  function formError(msg, field) {
    var e = document.getElementById("err"); e.textContent = msg; e.hidden = false;
    document.querySelectorAll(".in").forEach(function (i) { i.removeAttribute("aria-invalid"); });
    var map = { studentNumber: "sn", firstName: "fn", lastName: "ln", password: "pw", confirmPassword: "pw2", login: "login" };
    var el = map[field] && document.getElementById(map[field]); if (el) { el.setAttribute("aria-invalid", "true"); el.focus(); }
  }
  async function afterAuth(u) {
    S.me = u; if (u.role !== "student") { await api("POST", "/auth/logout"); S.me = null; throw { message: "Staff, providers and admins sign in on the clinic website (/admin)." }; }
    go("home");
  }
  async function submitLogin(btn) {
    var login = document.getElementById("login").value.trim(), pw = document.getElementById("pw").value;
    if (!login || !pw) return formError("Enter your student number and password.", !login ? "login" : "password");
    btn.disabled = true;
    try { var r = await api("POST", "/auth/login", { login: login, password: pw }); await afterAuth(r.user); }
    catch (e) { formError(e.message, e.field); btn.disabled = false; }
  }
  async function submitRegister(btn) {
    var v = function (id) { return document.getElementById(id).value; };
    btn.disabled = true;
    try {
      var r = await api("POST", "/auth/register", { firstName: v("fn").trim(), lastName: v("ln").trim(), studentNumber: v("sn").trim(), password: v("pw"), confirmPassword: v("pw2") });
      S.me = r.user; toast("Welcome to Cliniqo!"); go("home");
    } catch (e) { formError(e.message, e.field); btn.disabled = false; }
  }

  /* ---------- appointment card ---------- */
  function apptCard(a, withActions) {
    var grace = a.status === "Booked" && a.cutoffPassed && a.graceMinutesLeft > 0;
    var cut = a.status === "Booked" && a.cutoffPassed && !grace;
    var h = '<div class="card white"><div class="row"><h3>' + esc(a.provider.department || "Clinic") + "</h3>" + pill(a.status) + "</div>" +
      '<p class="sub">' + esc(a.provider.name) + "</p><p><b>" + longDate(a.date) + "</b> · " + t12(a.time) + "</p>";
    if (a.status === "Cancelled" && a.cancelReason) h += '<p class="sub">Reason: ' + esc(a.cancelReason) + "</p>";
    if (withActions && a.status === "Booked") {
      if (grace) h += '<p class="sub" style="margin-top:8px">New booking: you can still cancel for the next ' + a.graceMinutesLeft + ' min.</p><div class="row" style="margin-top:10px;gap:8px"><button class="btn danger sm" data-act="cancel" data-id="' + a.id + '">Cancel</button></div>';
      else h += cut ? '<p class="sub" style="margin-top:8px"><span class="pill p-mute">Cutoff passed</span> Cancel unavailable. Please contact the clinic.</p>'
        : '<div class="row" style="margin-top:10px;gap:8px"><button class="btn ghost sm" data-act="resched" data-id="' + a.id + '">Reschedule</button><button class="btn danger sm" data-act="cancel" data-id="' + a.id + '">Cancel</button></div>';
    }
    return h + "</div>";
  }

  /* ---------- home ---------- */
  async function homeView() {
    show('<main class="screen"><div class="head"><div><p class="sub">Hello,</p><h1>' + esc(S.me.firstName) + '</h1></div></div>' +
      '<div class="card"><h3>Need a check-up?</h3><p class="sub" style="margin:4px 0 12px">Pick a department, a day and a time.</p><button class="btn" data-act="gobook">Book an appointment</button></div>' +
      '<div class="row" style="margin:6px 0 10px"><h2>Next appointment</h2><a class="link" href="#/schedule">See all</a></div><div id="next">' + skeleton() + "</div></main>" + tabbar("home"));
    try {
      var r = await api("GET", "/appointments/mine"), n = r.upcoming[0];
      document.getElementById("next").innerHTML = n ? apptCard(n, true) : '<div class="empty">No upcoming appointments yet.</div>';
    } catch (e) { document.getElementById("next").innerHTML = '<p class="err">' + esc(e.message) + "</p>"; }
    refreshBadge();
  }
  async function refreshBadge() {
    try { var r = await api("GET", "/notifications"); S.notifUnread = r.unread; var b = document.querySelector(".tabbar"); if (b) { var cur = (document.querySelector(".tabbar [aria-current]") || {}).getAttribute && document.querySelector(".tabbar [aria-current]").getAttribute("href").slice(2); b.outerHTML = tabbar(cur); } } catch (e) { /* ignore */ }
  }

  /* ---------- booking ---------- */
  function dateChips(sel, from, days) {
    var h = '<div class="chips" role="group" aria-label="Choose a date">';
    for (var i = 0; i <= days; i++) { var d = addDays(from, i), x = parts(d); h += '<button class="chip" data-act="pickdate" data-d="' + d + '" aria-pressed="' + (d === sel) + '">' + DOW[x.getUTCDay()] + "<small>" + MON[x.getUTCMonth()] + " " + x.getUTCDate() + "</small></button>"; }
    return h + "</div>";
  }
  function bookView() {
    if (!S.book) S.book = { dept: S.depts.length ? S.depts[0].id : null, date: S.meta.today, time: null, provider: null };
    var b = S.book;
    show('<main class="screen"><div class="head"><h1>Book an appointment</h1></div>' +
      '<label class="fld">Department<select class="in" id="dept">' + S.depts.map(function (d) { return '<option value="' + d.id + '"' + (d.id === b.dept ? " selected" : "") + ">" + esc(d.name) + "</option>"; }).join("") + "</select></label>" +
      '<h2 style="margin:16px 0 4px">Date</h2>' + dateChips(b.date, S.meta.today, S.meta.rules.bookingDays) +
      '<h2 style="margin:10px 0 8px">Available times</h2><div id="slots">' + skeleton() + '</div></main>' + tabbar("book"));
    loadSlots();
  }
  async function loadSlots() {
    var b = S.book, box = document.getElementById("slots"); if (!box) return;
    try {
      var r = await api("GET", "/slots?departmentId=" + encodeURIComponent(b.dept) + "&date=" + b.date);
      if (!document.getElementById("slots") || b !== S.book) return;
      box.innerHTML = r.slots.length ? '<div class="slots">' + r.slots.map(function (s) {
        return '<button class="slot" data-act="pickslot" data-t="' + s.time + '" data-p="' + s.providerId + '" data-pn="' + esc(s.providerName) + '"><b>' + t12(s.time) + "</b><small>" + esc(s.providerName) + "</small></button>";
      }).join("") + "</div>" : '<div class="empty">' + esc(r.why || "No free slots on this day.") + "</div>";
    } catch (e) { box.innerHTML = '<p class="err">' + esc(e.message) + "</p>"; }
  }
  function confirmSheet(time, pid, pname) {
    var dn = (S.depts.filter(function (d) { return d.id === S.book.dept; })[0] || {}).name || "";
    sheet("<h2>Confirm booking</h2>" + '<div class="card"><h3>' + esc(dn) + "</h3><p class=\"sub\">" + esc(pname) + "</p><p><b>" + longDate(S.book.date) + "</b> · " + t12(time) + "</p></div>" +
      '<p class="sub">You can cancel or reschedule up to ' + S.meta.rules.cutoffHours + ' hours before your visit.</p><p class="err" id="sErr" role="alert" hidden></p>' +
      '<button class="btn" id="doBook" data-p="' + pid + '" data-t="' + time + '">Confirm</button><button class="btn ghost" data-act="closesheet">Back</button>');
  }
  async function doBook(btn) {
    btn.disabled = true;
    try {
      var r = await api("POST", "/appointments", { providerId: +btn.dataset.p, date: S.book.date, time: btn.dataset.t });
      closeSheet(); S.book = null; doneView(r.appointment);
    } catch (e) { var el = document.getElementById("sErr"); el.textContent = e.message; el.hidden = false; btn.disabled = false; if (e.status === 409) loadSlots(); }
  }
  function doneView(a) {
    show('<main class="screen auth"><div class="big-ok" aria-hidden="true">✓</div><h1 class="center">Booked!</h1><p class="center sub">Your appointment is confirmed.</p>' + apptCard(a, false) +
      '<button class="btn" data-act="goschedule">View my schedule</button><button class="btn ghost" data-act="gohome">Back to home</button></main>');
    document.querySelector("h1").focus();
  }

  /* ---------- schedule ---------- */
  var schedTab = "up";
  async function scheduleView() {
    show('<main class="screen"><div class="head"><h1>My schedule</h1></div><div class="tabs" role="tablist"><button role="tab" data-act="tab" data-t="up" aria-selected="' + (schedTab === "up") + '">Upcoming</button><button role="tab" data-act="tab" data-t="past" aria-selected="' + (schedTab === "past") + '">Past</button></div><div id="list">' + skeleton() + "</div></main>" + tabbar("schedule"));
    try {
      var r = await api("GET", "/appointments/mine"), list = schedTab === "up" ? r.upcoming : r.past;
      document.getElementById("list").innerHTML = list.length ? list.map(function (a) { return apptCard(a, schedTab === "up"); }).join("") : '<div class="empty">' + (schedTab === "up" ? "Nothing booked. Tap Book to schedule a visit." : "No past appointments yet.") + "</div>";
    } catch (e) { document.getElementById("list").innerHTML = '<p class="err">' + esc(e.message) + "</p>"; }
  }
  function cancelSheet(id) {
    sheet("<h2>Cancel this appointment?</h2><p class=\"sub\">The time will be released for other students.</p>" +
      '<label class="fld">Reason (optional)<input class="in" id="why" maxlength="200"></label><p class="err" id="sErr" role="alert" hidden></p>' +
      '<button class="btn danger" id="doCancel" data-id="' + id + '">Yes, cancel it</button><button class="btn ghost" data-act="closesheet">Keep it</button>');
  }
  async function doCancel(btn) {
    btn.disabled = true;
    try { await api("POST", "/appointments/" + btn.dataset.id + "/cancel", { reason: document.getElementById("why").value.trim() }); closeSheet(); toast("Appointment cancelled."); route(); }
    catch (e) { var el = document.getElementById("sErr"); el.textContent = e.message; el.hidden = false; btn.disabled = false; }
  }
  var RS = null;
  async function reschedSheet(id) {
    var r = await api("GET", "/appointments/mine"), a = r.upcoming.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!a) return toast("Appointment not found.");
    RS = { id: id, pid: a.provider.id, date: a.date < S.meta.today ? S.meta.today : a.date, time: null };
    drawResched();
  }
  function drawResched() {
    sheet("<h2>Reschedule</h2>" + dateChips(RS.date, S.meta.today, S.meta.rules.bookingDays).replace(/pickdate/g, "rsdate") + '<div id="rsSlots">' + skeleton() + '</div><p class="err" id="sErr" role="alert" hidden></p><button class="btn" id="doResched" disabled>Confirm new time</button><button class="btn ghost" data-act="closesheet">Close</button>');
    loadResched();
  }
  async function loadResched() {
    var box = document.getElementById("rsSlots"); if (!box) return;
    try {
      var r = await api("GET", "/slots?providerId=" + RS.pid + "&date=" + RS.date + "&ignoreAppointmentId=" + RS.id);
      box.innerHTML = r.slots.length ? '<div class="slots">' + r.slots.map(function (s) { return '<button class="slot" data-act="rsslot" data-t="' + s.time + '" aria-pressed="false"><b>' + t12(s.time) + "</b></button>"; }).join("") + "</div>" : '<div class="empty">' + esc(r.why || "No free slots.") + "</div>";
    } catch (e) { box.innerHTML = '<p class="err">' + esc(e.message) + "</p>"; }
  }
  async function doResched(btn) {
    btn.disabled = true;
    try { await api("POST", "/appointments/" + RS.id + "/reschedule", { date: RS.date, time: RS.time }); closeSheet(); toast("Appointment rescheduled."); route(); }
    catch (e) { var el = document.getElementById("sErr"); el.textContent = e.message; el.hidden = false; btn.disabled = false; loadResched(); }
  }

  /* ---------- notifications ---------- */
  var nTab = "all";
  async function notifView() {
    show('<main class="screen"><div class="head"><h1>Notifications</h1><button class="link" data-act="readall">Mark all read</button></div><div class="tabs" role="tablist">' +
      [["all", "All"], ["reminder", "Reminders"], ["booking", "Bookings"]].map(function (t) { return '<button role="tab" data-act="ntab" data-t="' + t[0] + '" aria-selected="' + (nTab === t[0]) + '">' + t[1] + "</button>"; }).join("") + '</div><div id="nl">' + skeleton() + "</div></main>" + tabbar("notifications"));
    try {
      var r = await api("GET", "/notifications"); S.notifUnread = r.unread;
      var list = r.notifications.filter(function (n) { return nTab === "all" || (nTab === "reminder" ? n.type === "reminder" : n.type !== "reminder"); });
      document.getElementById("nl").innerHTML = list.length ? list.map(function (n) {
        return '<div class="notif' + (n.read ? "" : " unread") + '"><span class="dot' + (n.read ? " read" : "") + '"></span><div><b>' + esc(n.title) + '</b><p class="sub">' + esc(n.body) + "</p></div></div>";
      }).join("") : '<div class="empty">Nothing here yet.</div>';
      var b = document.querySelector(".tabbar"); if (b) b.outerHTML = tabbar("notifications");
    } catch (e) { document.getElementById("nl").innerHTML = '<p class="err">' + esc(e.message) + "</p>"; }
  }

  /* ---------- profile ---------- */
  var FAQ = [["How early can I cancel?", "Up to 24 hours before your appointment. If you book inside the last 24 hours, you can still cancel for 2 hours after booking. After that, please contact the clinic."], ["How many appointments can I have?", "You can hold up to 3 upcoming appointments at a time."], ["How far ahead can I book?", "Up to 30 days ahead, during the provider's working hours."], ["I forgot my password.", "Please visit the clinic with your school ID so staff can reset it for you."]];
  function profileView() {
    show('<main class="screen"><div class="head"><h1>Profile</h1></div><div class="card"><h3>' + esc(S.me.name) + '</h3><p class="sub">Student number ' + esc(S.me.login) + "</p></div>" +
      '<h2 style="margin:16px 0 8px">Preferences</h2><label class="card white switch"><span>Larger text</span><input type="checkbox" id="large"' + (document.body.classList.contains("large") ? " checked" : "") + "></label>" +
      '<h2 style="margin:16px 0 8px">Support</h2>' + FAQ.map(function (f) { return "<details><summary>" + esc(f[0]) + "</summary><p>" + esc(f[1]) + "</p></details>"; }).join("") +
      '<button class="btn danger" style="margin-top:14px" data-act="logout">Log out</button></main>' + tabbar("profile"));
  }

  /* ---------- events ---------- */
  document.addEventListener("submit", function (e) {
    e.preventDefault();
    if (e.target.id === "loginForm") submitLogin(document.getElementById("go"));
    if (e.target.id === "regForm") submitRegister(document.getElementById("go"));
  });
  document.addEventListener("change", function (e) {
    if (e.target.id === "dept") { S.book.dept = +e.target.value; S.book.time = null; document.getElementById("slots").innerHTML = skeleton(); loadSlots(); }
    if (e.target.id === "large") { document.body.classList.toggle("large", e.target.checked); pref("large", e.target.checked ? "1" : "0"); }
  });
  document.addEventListener("click", function (e) {
    var t = e.target.closest("button"); if (!t) return;
    if (t.id === "doBook") return doBook(t);
    if (t.id === "doCancel") return doCancel(t);
    if (t.id === "doResched") return doResched(t);
    var a = t.dataset.act; if (!a) return;
    var d = t.dataset;
    if (a === "register") go("register"); else if (a === "tologin") go("login");
    else if (a === "gobook") go("book"); else if (a === "goschedule") go("schedule"); else if (a === "gohome") go("home");
    else if (a === "pickdate") { S.book.date = d.d; bookView(); }
    else if (a === "pickslot") confirmSheet(d.t, d.p, d.pn);
    else if (a === "closesheet") closeSheet();
    else if (a === "tab") { schedTab = d.t; scheduleView(); }
    else if (a === "ntab") { nTab = d.t; notifView(); }
    else if (a === "cancel") cancelSheet(d.id);
    else if (a === "resched") reschedSheet(d.id).catch(function (x) { toast(x.message); });
    else if (a === "rsdate") { RS.date = d.d; RS.time = null; drawResched(); }
    else if (a === "rsslot") { RS.time = d.t; document.querySelectorAll("[data-act=rsslot]").forEach(function (b) { b.setAttribute("aria-pressed", String(b === t)); }); document.getElementById("doResched").disabled = false; }
    else if (a === "readall") api("POST", "/notifications/read-all").then(function () { S.notifUnread = 0; notifView(); }).catch(function (x) { toast(x.message); });
    else if (a === "logout") api("POST", "/auth/logout").catch(function () {}).then(function () { S.me = null; S.book = null; go("login"); });
  });

  /* ---------- router ---------- */
  var VIEWS = { home: homeView, book: bookView, schedule: scheduleView, notifications: notifView, profile: profileView };
  function route() {
    closeSheet();
    var r = location.hash.replace("#/", "") || "home";
    if (r === "register") return S.me ? go("home") : registerView();
    if (r === "login" || !S.me) { if (r !== "login") { location.replace("#/login"); return; } return loginView(); }
    (VIEWS[r] || homeView)();
  }
  window.addEventListener("hashchange", route);
  async function boot() {
    if (pref("large") === "1") document.body.classList.add("large");
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
    try {
      var m = await api("GET", "/auth/me").catch(function () { return null; });
      if (m && m.user && m.user.role === "student") { S.me = m.user; }
      S.meta = await api("GET", "/meta").catch(function () { return null; });
    } catch (e) { /* not signed in */ }
    if (S.me) { try { S.meta = S.meta || (await api("GET", "/meta")); S.depts = (await api("GET", "/departments")).departments; } catch (e) { /* handled per view */ } }
    route();
  }
  /* After signing in, load the catalog the booking screen needs. */
  var _go = go; go = function (r) { if (S.me && !S.meta) { Promise.all([api("GET", "/meta"), api("GET", "/departments")]).then(function (x) { S.meta = x[0]; S.depts = x[1].departments; _go(r); }).catch(function () { _go(r); }); } else _go(r); };
  boot();
})();
