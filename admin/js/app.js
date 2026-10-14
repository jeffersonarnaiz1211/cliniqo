(function () {
  "use strict";
  var api = window.Cliniqo.api;

  /* ---------- Helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmtTime(t) { var p = t.split(":"), h = +p[0]; return ((h + 11) % 12 + 1) + ":" + p[1] + " " + (h < 12 ? "AM" : "PM"); }
  function parseIso(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function addDays(s, n) { var d = parseIso(s); d.setDate(d.getDate() + n); return iso(d); }
  function fmtDate(d) { return parseIso(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }); }
  function fmtShort(d) { return parseIso(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
  function fmtStamp(s) { return new Date(s).toLocaleString(); }
  function pill(status) {
    var cls = { "Checked in": "ok", Completed: "ok", Cancelled: "bad", "No-show": "mute" }[status] || "";
    return '<span class="pill ' + cls + '">' + esc(status) + "</span>";
  }
  function toast(msg) {
    var t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600);
  }

  /* ---------- Session and role rules (the server enforces the same rules on every request) ---------- */
  var me, role, meta, lists = { departments: [], providers: [] };
  var ROUTES = { admin: ["dashboard", "schedule", "walkin", "users", "hours", "reports", "audit"], staff: ["schedule", "walkin"], provider: ["myday", "hours"] };
  var HOME = { admin: "dashboard", staff: "schedule", provider: "myday" };
  var CONSOLE = { admin: "Admin console", staff: "Staff console", provider: "Provider console" };
  var ROLE_LABEL = { admin: "Administrator", staff: "Clinic staff", provider: "Provider" };
  var ACTION_ROLES = {
    checkin: ["admin", "staff"], resched: ["admin", "staff"], cancel: ["admin", "staff"], wkconfirm: ["admin", "staff"],
    complete: ["admin", "staff", "provider"], noshow: ["admin", "staff", "provider"],
    adduser: ["admin"], toggleuser: ["admin"], resetpw: ["admin"], csv: ["admin"],
    savehours: ["admin", "provider"], block: ["admin", "provider"], unblock: ["admin", "provider"]
  };
  function can(act) { var r = ACTION_ROLES[act]; return !r || r.indexOf(role) >= 0; }

  var ui = { date: "", prov: "all", status: "all", q: "", userRole: "all", userQ: "", hoursProv: null, range: 7 };
  var VIEWS = {};
  var routeToken = 0;

  function handleError(e) {
    if (e && e.status === 401) { location.replace("index.html"); return; }
    toast(e && e.message ? e.message : "Something went wrong. Please try again.");
  }
  /* Run an API action, then refresh the page. */
  async function act(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); await rerender(); } catch (e) { handleError(e); await rerender().catch(function () {}); }
  }

  /* ---------- Dialog ---------- */
  var dlg = $("dlg");
  function openDialog(html, onSubmit, okLabel) {
    dlg.innerHTML = '<form method="dialog" novalidate>' + html + '<p class="msg err" id="dlgErr" role="alert" hidden></p><div class="btns"><button type="button" class="btn" id="dlgCancel">Cancel</button><button type="submit" class="btn primary" id="dlgOk">' + (okLabel || "Save") + "</button></div></form>";
    var f = dlg.querySelector("form");
    $("dlgCancel").onclick = function () { dlg.close(); };
    f.onsubmit = async function (e) {
      e.preventDefault();
      var ok = $("dlgOk"); ok.disabled = true;
      try { await onSubmit(f); dlg.close(); await rerender(); }
      catch (err) { if (err && err.status === 401) return handleError(err); var m = $("dlgErr"); m.textContent = err && err.message ? err.message : "Something went wrong."; m.hidden = false; ok.disabled = false; }
    };
    dlg.showModal();
    var first = f.querySelector("input,select,textarea"); if (first) first.focus();
    return f;
  }
  function failIf(cond, msg) { if (cond) { var e = new Error(msg); throw e; } }

  /* ---------- Shared table ---------- */
  function apptTable(rows, withActions) {
    var h = '<div class="tablewrap"><table><thead><tr><th>Time</th><th>Student</th><th>Student ID</th><th>Provider</th><th>Dept</th><th>Status</th>' + (withActions ? "<th>Actions</th>" : "") + "</tr></thead><tbody>";
    rows.forEach(function (a) {
      var btns = "";
      if (withActions) {
        var bt = function (cls, action, label) { return '<button class="btn sm ' + cls + '" data-act="' + action + '" data-id="' + a.id + '">' + label + "</button>"; };
        if (a.status === "Booked") {
          if (role === "provider") btns = bt("primary", "complete", "Complete") + bt("", "noshow", "No-show");
          else if (role === "staff" && a.cutoffPassed && a.graceMinutesLeft > 0) btns = bt("primary", "checkin", "Check in") + bt("danger", "cancel", "Cancel");
          else if (role === "staff" && a.cutoffPassed) btns = bt("primary", "checkin", "Check in") + '<span class="pill wait" title="Only an admin can change it">Cutoff passed</span>';
          else btns = bt("primary", "checkin", "Check in") + bt("", "resched", "Reschedule") + bt("danger", "cancel", "Cancel");
        } else if (a.status === "Checked in") btns = bt("primary", "complete", "Complete") + bt("", "noshow", "No-show");
        else if (a.status === "Cancelled" && a.cancelReason) btns = '<span class="hint">' + esc(a.cancelReason) + "</span>";
      }
      h += "<tr><td><b>" + fmtTime(a.time) + "</b></td><td>" + esc(a.student.name) + '</td><td class="mono">' + esc(a.student.studentNumber) + "</td><td>" + esc(a.provider.name) + "</td><td>" + esc(a.provider.department) + "</td><td>" + pill(a.status) + "</td>" + (withActions ? '<td><div class="act">' + btns + "</div></td>" : "") + "</tr>";
    });
    return h + "</tbody></table></div>";
  }
  function dateTools() {
    return '<button class="btn sm" data-act="prevday" aria-label="Previous day">&lsaquo;</button><input class="in" type="date" id="fDate" value="' + ui.date + '" aria-label="Date"><button class="btn sm" data-act="nextday" aria-label="Next day">&rsaquo;</button><button class="btn sm" data-act="today">Today</button>';
  }

  /* ---------- Views ---------- */
  VIEWS.dashboard = async function () {
    var d = await api.get("/dashboard"), at = d.attention, attn = "";
    if (at.overdue) attn += '<div class="row"><span><b>' + at.overdue + " booked appointment" + (at.overdue > 1 ? "s" : "") + ' past start time</b><br><span class="hint">Mark them completed or no-show</span></span><a class="btn sm" href="#/schedule">Open</a></div>';
    at.providersWithoutHours.forEach(function (n) { attn += '<div class="row"><span><b>' + esc(n) + ' has no working days</b><br><span class="hint">Students cannot book this provider</span></span><a class="btn sm" href="#/hours">Set hours</a></div>'; });
    if (at.disabledAccounts) attn += '<div class="row"><span><b>' + at.disabledAccounts + " disabled account" + (at.disabledAccounts > 1 ? "s" : "") + '</b><br><span class="hint">Review in Users</span></span><a class="btn sm" href="#/users">Open</a></div>';
    if (!attn) attn = '<p class="hint">Nothing needs attention.</p>';
    return '<div class="tiles"><div class="tile dark"><b>' + d.total + '</b><span>Appointments today</span></div><div class="tile"><b>' + d.checkedIn + '</b><span>Checked in</span></div><div class="tile"><b>' + d.cancelled + '</b><span>Cancelled</span></div><div class="tile"><b>' + d.openSlots + '</b><span>Open slots today</span></div></div>' +
      '<div class="cols"><div class="panel"><h3>Next up</h3>' + (d.next.length ? apptTable(d.next, false) : '<div class="empty">No upcoming appointments today.</div>') + '</div><div class="panel"><h3>Needs attention</h3>' + attn + "</div></div>";
  };

  VIEWS.schedule = async function () {
    var qs = "?date=" + ui.date + (ui.prov !== "all" ? "&providerId=" + ui.prov : "") + (ui.status !== "all" ? "&status=" + encodeURIComponent(ui.status) : "") + (ui.q ? "&q=" + encodeURIComponent(ui.q) : "");
    var r = await api.get("/appointments" + qs), rows = r.appointments;
    var provOpts = '<option value="all">All providers</option>' + lists.providers.map(function (p) { return '<option value="' + p.id + '"' + (String(ui.prov) === String(p.id) ? " selected" : "") + ">" + esc(p.name) + "</option>"; }).join("");
    var stOpts = ["all", "Booked", "Checked in", "Completed", "No-show", "Cancelled"].map(function (s) { return '<option value="' + s + '"' + (ui.status === s ? " selected" : "") + ">" + (s === "all" ? "All statuses" : s) + "</option>"; }).join("");
    return '<div class="tools">' + dateTools() + '<select class="in" id="fProv" aria-label="Provider">' + provOpts + '</select><select class="in" id="fStatus" aria-label="Status">' + stOpts + '</select><input class="in" id="fQ" placeholder="Search name or student ID" value="' + esc(ui.q) + '" aria-label="Search"><a class="btn sm primary grow" href="#/walkin">New booking</a></div>' +
      '<div class="panel">' + (rows.length ? apptTable(rows, true) : '<div class="empty">No appointments for ' + esc(fmtDate(ui.date)) + " with these filters.</div>") + "</div>" +
      '<p class="hint">' + (role === "admin" ? "As admin you can cancel at any time. A cancellation inside 24 hours of the appointment is recorded as an override in the audit log." : "Cancelling or changing inside 24 hours of the appointment is blocked for staff, except that a new booking can be cancelled within 2 hours of being made. Ask an admin for anything else.") + "</p>";
  };

  VIEWS.myday = async function () {
    var rows = (await api.get("/appointments?date=" + ui.date)).appointments;
    var c = function (s) { return rows.filter(function (a) { return a.status === s; }).length; };
    return '<div class="tools">' + dateTools() + "</div>" +
      '<div class="tiles"><div class="tile dark"><b>' + (rows.length - c("Cancelled")) + '</b><span>Booked this day</span></div><div class="tile"><b>' + c("Completed") + '</b><span>Completed</span></div><div class="tile"><b>' + c("Checked in") + '</b><span>Checked in, waiting</span></div><div class="tile"><b>' + c("Booked") + '</b><span>Still to come</span></div></div>' +
      '<div class="panel">' + (rows.length ? apptTable(rows, true) : '<div class="empty">You have no appointments on ' + esc(fmtDate(ui.date)) + ".</div>") + "</div>" +
      '<p class="hint">The front desk checks students in. You mark a visit completed or no-show. You only see your own appointments.</p>';
  };

  VIEWS.users = async function () {
    var r = await api.get("/users?" + (ui.userRole !== "all" ? "role=" + ui.userRole + "&" : "") + (ui.userQ ? "q=" + encodeURIComponent(ui.userQ) : ""));
    var chips = ["all", "student", "provider", "staff", "admin"].map(function (x) { return '<button class="chip" data-role="' + x + '" aria-pressed="' + (ui.userRole === x) + '">' + (x === "all" ? "All" : x[0].toUpperCase() + x.slice(1)) + "</button>"; }).join("");
    var h = '<div class="tools"><input class="in" id="uQ" placeholder="Search name, ID or email" value="' + esc(ui.userQ) + '" aria-label="Search users">' + chips + '<button class="btn sm primary grow" data-act="adduser">Add user</button></div>';
    h += '<div class="panel"><div class="tablewrap"><table><thead><tr><th>Name</th><th>Student ID or email</th><th>Role</th><th>Department</th><th>Active</th><th></th></tr></thead><tbody>';
    r.users.forEach(function (u) {
      var self = u.id === me.id;
      h += "<tr><td><b>" + esc(u.name) + '</b></td><td class="mono">' + esc(u.login) + "</td><td>" + pill(u.role[0].toUpperCase() + u.role.slice(1)) + "</td><td>" + esc(u.department || "—") + '</td><td><label class="switch"><input type="checkbox" data-act="toggleuser" data-id="' + u.id + '"' + (u.active ? " checked" : "") + (self ? " disabled" : "") + ' aria-label="Active: ' + esc(u.name) + '"><span></span></label></td><td><button class="btn sm" data-act="resetpw" data-id="' + u.id + '" data-name="' + esc(u.name) + '">Reset password</button></td></tr>';
    });
    if (!r.users.length) h += '<tr><td colspan="6" class="empty">No users match.</td></tr>';
    return h + '</tbody></table></div></div><p class="hint">Disabling an account blocks sign-in and keeps its appointment history. You cannot disable your own account.</p>';
  };

  VIEWS.hours = async function () {
    if (role === "provider") ui.hoursProv = me.id;
    if (!ui.hoursProv && lists.providers.length) ui.hoursProv = lists.providers[0].id;
    if (!ui.hoursProv) return '<div class="panel"><div class="empty">There are no providers yet. Add one in Users.</div></div>';
    var d = await api.get("/providers/" + ui.hoursProv + "/availability"), own = role === "provider";
    var chips = own ? "" : lists.providers.map(function (p) { return '<button class="chip" data-prov="' + p.id + '" aria-pressed="' + (ui.hoursProv === p.id) + '">' + esc(p.name) + "</button>"; }).join("");
    var h = '<div class="tools">' + chips + "</div>";
    h += '<div class="cols"><div class="panel"><div class="row"><h3>Weekly hours · 30-minute slots</h3><button class="btn sm primary" data-act="savehours">Save hours</button></div><div class="tablewrap"><table><thead><tr><th>Day</th><th>Start</th><th>End</th><th>Working</th></tr></thead><tbody>';
    d.hours.forEach(function (r) {
      h += '<tr class="dayrow"><td>' + r.day + '</td><td><input class="in" type="time" step="1800" data-h="start" data-i="' + r.weekday + '" value="' + r.start + '" aria-label="Start ' + r.day + '"></td><td><input class="in" type="time" step="1800" data-h="end" data-i="' + r.weekday + '" value="' + r.end + '" aria-label="End ' + r.day + '"></td><td><label class="switch"><input type="checkbox" data-h="working" data-i="' + r.weekday + '"' + (r.working ? " checked" : "") + ' aria-label="Working ' + r.day + '"><span></span></label></td></tr>';
    });
    h += '</tbody></table></div><p class="msg err" id="hoursErr" role="alert" hidden></p></div>';
    h += '<div class="panel"><h3>' + (own ? "Days off" : "Blocked dates") + "</h3>" + (d.blocked.length ? d.blocked.map(function (b) { return '<div class="row"><span><b>' + fmtDate(b.date) + '</b><br><span class="hint">' + esc(b.reason) + '</span></span><button class="btn sm danger" data-act="unblock" data-id="' + b.id + '">Remove</button></div>'; }).join("") : '<p class="hint">No blocked dates.</p>') +
      '<button class="btn" data-act="block">' + (own ? "Block a day off" : "Block a date") + '</button><p class="hint">Appointments already booked on a blocked date stay in the schedule. Reschedule or cancel them by hand.</p></div></div>';
    return h;
  };

  VIEWS.reports = async function () {
    var r = await api.get("/reports?days=" + ui.range);
    var max = Math.max.apply(null, r.perDay.map(function (x) { return x.count; }).concat([1])), dense = ui.range > 10;
    var bars = '<div class="bars' + (dense ? " dense" : "") + '">' + r.perDay.map(function (x) { return '<div data-v="' + x.count + '" style="height:' + Math.max(2, x.count / max * 100) + '%" title="' + fmtShort(x.date) + ": " + x.count + '"></div>'; }).join("") + '</div><div class="bar-labels">' + r.perDay.map(function (x, i) { return "<span>" + (dense && i % 5 ? "" : fmtShort(x.date)) + "</span>"; }).join("") + "</div>";
    var active = r.total - r.cancelled || 1;
    var split = function (a) { return a.map(function (k) { return '<div class="row"><span>' + esc(k.name) + "</span><b>" + k.count + '</b></div><div class="meter"><i style="width:' + Math.round(k.count * 100 / active) + '%"></i></div>'; }).join("") || '<p class="hint">No data.</p>'; };
    return '<div class="tools"><button class="chip" data-range="7" aria-pressed="' + (ui.range === 7) + '">7 days</button><button class="chip" data-range="30" aria-pressed="' + (ui.range === 30) + '">30 days</button><button class="btn sm primary grow" data-act="csv">Export CSV</button></div>' +
      '<div class="tiles"><div class="tile dark"><b>' + r.total + '</b><span>Appointments</span></div><div class="tile"><b>' + r.noShowRate + '%</b><span>No-show rate (of visits that happened or were missed)</span></div><div class="tile"><b>' + r.cancelledRate + '%</b><span>Cancelled</span></div><div class="tile"><b>' + r.completed + '</b><span>Completed</span></div></div>' +
      '<div class="cols"><div class="panel"><h3>Appointments per day (excluding cancelled)</h3>' + bars + '</div><div class="panel"><h3>By department</h3>' + split(r.byDepartment) + "<h3>By provider</h3>" + split(r.byProvider) + "</div></div>";
  };

  VIEWS.audit = async function () {
    var r = await api.get("/audit");
    return '<div class="panel"><div class="tablewrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th></tr></thead><tbody>' +
      r.entries.map(function (l) { return '<tr><td class="mono">' + esc(fmtStamp(l.at)) + "</td><td>" + esc(l.by) + "</td><td>" + esc(l.action) + "</td><td>" + esc(l.target) + "</td></tr>"; }).join("") + "</tbody></table></div></div>";
  };

  /* ---------- Book for a student (staff and admin) ---------- */
  var wk = {};
  VIEWS.walkin = async function () {
    var deptOpts = lists.departments.map(function (d) { return '<option value="' + d.id + '">' + esc(d.name) + "</option>"; }).join("");
    wk = { sid: "", student: null, dept: lists.departments.length ? lists.departments[0].id : null, prov: null, date: ui.date < meta.today ? meta.today : ui.date, time: "" };
    return '<div class="cols"><div class="panel"><h3>New booking</h3><div class="form">' +
      '<label class="fld">Student ID<input class="in" id="wkSid" placeholder="2024-00152" autocomplete="off" maxlength="20"></label>' +
      '<label class="fld">Student<input class="in" id="wkName" readonly placeholder="Shown after you enter the ID"></label>' +
      '<label class="fld">Department<select class="in" id="wkDept">' + deptOpts + "</select></label>" +
      '<label class="fld">Provider<select class="in" id="wkProv"></select></label>' +
      '<label class="fld">Date<input class="in" type="date" id="wkDate" min="' + meta.today + '" value="' + wk.date + '"></label>' +
      '<div class="fld">Available slots<div class="slots" id="wkSlots"></div></div></div>' +
      '<p class="msg err" id="wkErr" role="alert" hidden></p>' +
      '<div class="row"><span class="hint">A slot already taken is greyed out and cannot be picked.</span><button class="btn primary" data-act="wkconfirm">Confirm booking</button></div></div>' +
      '<div class="panel"><h3>Summary</h3><div class="row"><span class="hint">Student</span><b id="sumStu">—</b></div><div class="row"><span class="hint">Provider</span><b id="sumProv">—</b></div>' +
      '<div class="row"><span class="hint">When</span><b id="sumWhen">—</b></div><div class="row"><span class="hint">Booked by</span><b>' + esc(me.name) + "</b></div>" +
      '<p class="hint">The student sees the booking in the Cliniqo student app, with a confirmation notification.</p><div id="wkDone"></div></div></div>';
  };

  var wkSlotSeq = 0;
  async function wkUpdate() {
    $("wkErr").hidden = true;
    var provs = lists.providers.filter(function (p) { return p.departmentId === wk.dept; });
    if (!provs.some(function (p) { return p.id === wk.prov; })) wk.prov = provs.length ? provs[0].id : null;
    $("wkProv").innerHTML = provs.map(function (p) { return '<option value="' + p.id + '"' + (p.id === wk.prov ? " selected" : "") + ">" + esc(p.name) + "</option>"; }).join("") || '<option value="">No provider</option>';
    var pu = provs.filter(function (p) { return p.id === wk.prov; })[0];
    $("sumStu").textContent = wk.student ? wk.student.name : "—";
    $("sumProv").textContent = pu ? pu.name : "—";
    $("sumWhen").textContent = wk.date && wk.time ? fmtShort(wk.date) + " · " + fmtTime(wk.time) : "—";
    var seq = ++wkSlotSeq, slots = [], why = "No provider in this department.";
    if (wk.prov && wk.date) {
      try { var r = await api.get("/slots?providerId=" + wk.prov + "&date=" + wk.date + "&all=1"); slots = r.slots; why = r.why; }
      catch (e) { if (seq === wkSlotSeq) { slots = []; why = e.message; } }
    }
    if (seq !== wkSlotSeq || !$("wkSlots")) return;
    if (!slots.some(function (s) { return s.time === wk.time && !s.taken; })) wk.time = "";
    $("wkSlots").innerHTML = slots.length ? slots.map(function (s) { return '<button type="button" class="slot" data-slot="' + s.time + '"' + (s.taken ? " disabled" : "") + ' aria-pressed="' + (s.time === wk.time) + '" aria-label="' + fmtTime(s.time) + (s.taken ? ", taken" : "") + '">' + fmtTime(s.time).replace(" AM", "").replace(" PM", "") + "</button>"; }).join("") : '<span class="hint">' + esc(why) + "</span>";
    $("sumWhen").textContent = wk.date && wk.time ? fmtShort(wk.date) + " · " + fmtTime(wk.time) : "—";
  }

  var lookupTimer;
  function initWalkin() {
    $("wkSid").addEventListener("input", function () {
      wk.sid = this.value.trim(); wk.student = null; $("wkName").value = ""; $("wkName").setAttribute("aria-invalid", "false");
      clearTimeout(lookupTimer);
      if (!/^(\d{4}-\d{5}|\d{9})$/.test(wk.sid)) { wkUpdate(); return; }
      var sid = wk.sid;
      lookupTimer = setTimeout(async function () {
        try { var r = await api.get("/students/lookup?studentNumber=" + encodeURIComponent(sid)); if (wk.sid !== sid) return; wk.student = r.student; $("wkName").value = r.student.active ? r.student.name : "This student account is disabled."; $("wkName").setAttribute("aria-invalid", r.student.active ? "false" : "true"); if (!r.student.active) wk.student = null; }
        catch (e) { if (wk.sid !== sid) return; $("wkName").value = e.message; $("wkName").setAttribute("aria-invalid", "true"); }
        wkUpdate();
      }, 200);
    });
    $("wkDept").addEventListener("change", function () { wk.dept = +this.value; wk.prov = null; wkUpdate(); });
    $("wkProv").addEventListener("change", function () { wk.prov = +this.value; wkUpdate(); });
    $("wkDate").addEventListener("change", function () { wk.date = this.value; wkUpdate(); });
    $("wkSlots").addEventListener("click", function (e) { var b = e.target.closest("[data-slot]"); if (!b || b.disabled) return; wk.time = b.getAttribute("data-slot"); wkUpdate(); });
    wkUpdate();
  }

  async function wkConfirm() {
    var err = $("wkErr"); err.hidden = true;
    function fail(m) { err.textContent = m; err.hidden = false; }
    if (!/^(\d{4}-\d{5}|\d{9})$/.test(wk.sid)) return fail("Enter the student ID, like 2024-00123.");
    if (!wk.student) return fail($("wkName").value || "Check the student ID.");
    if (!wk.prov) return fail("Choose a provider.");
    if (!wk.date || wk.date < meta.today) return fail("Choose today or a later date.");
    if (!wk.time) return fail("Pick an available time slot.");
    try {
      var r = await api.post("/appointments", { studentNumber: wk.sid, providerId: wk.prov, date: wk.date, time: wk.time });
      var a = r.appointment; ui.date = a.date;
      $("wkDone").innerHTML = '<p class="msg ok">Booked ' + esc(a.student.name) + " with " + esc(a.provider.name) + " on " + esc(fmtShort(a.date)) + " at " + fmtTime(a.time) + '. <a class="link" href="#/schedule">View in daily schedule</a></p>';
      wk.sid = ""; wk.student = null; wk.time = ""; $("wkSid").value = ""; $("wkName").value = "";
      toast("Booking created"); wkUpdate();
    } catch (e) { if (e.status === 401) return handleError(e); fail(e.message); wkUpdate().then(function () { err.textContent = e.message; err.hidden = false; }); }
  }

  /* ---------- Dialogs ---------- */
  async function cancelDialog(id) {
    var row = (await api.get("/appointments?date=" + ui.date)).appointments.filter(function (a) { return a.id === id; })[0];
    if (!row) { toast("That appointment is no longer in the list."); return rerender(); }
    var warn = row.cutoffPassed && !row.graceMinutesLeft ? '<p class="msg">This is inside the 24-hour cutoff. It will be recorded as an admin override.</p>' : "";
    openDialog('<h3>Cancel appointment</h3><p class="hint">' + esc(row.student.name) + " · " + esc(fmtDate(row.date)) + " · " + fmtTime(row.time) + "</p>" + warn + '<label class="fld">Reason (required)<input class="in" id="reason" maxlength="120"></label>', async function (f) {
      var reason = f.querySelector("#reason").value.trim();
      failIf(!reason, "Enter a reason for the cancellation.");
      await api.post("/appointments/" + id + "/cancel", { reason: reason });
      toast("Appointment cancelled");
    }, "Cancel appointment");
  }

  async function rescheduleDialog(id) {
    var row = (await api.get("/appointments?date=" + ui.date)).appointments.filter(function (a) { return a.id === id; })[0];
    if (!row) { toast("That appointment is no longer in the list."); return rerender(); }
    var f = openDialog('<h3>Reschedule appointment</h3><p class="hint">' + esc(row.student.name) + " with " + esc(row.provider.name) + '</p><div class="form"><label class="fld">Date<input class="in" type="date" id="rDate" min="' + meta.today + '" value="' + row.date + '"></label><label class="fld">Available time<select class="in" id="rTime"></select></label></div>', async function (f) {
      var date = f.querySelector("#rDate").value, time = f.querySelector("#rTime").value;
      failIf(!date, "Choose a date."); failIf(!time, "No free time on this date. Pick another date.");
      await api.post("/appointments/" + id + "/reschedule", { date: date, time: time });
      toast("Appointment rescheduled");
    }, "Reschedule");
    async function refresh() {
      var sel = f.querySelector("#rTime"), d = f.querySelector("#rDate").value;
      if (!d) return;
      try { var r = await api.get("/slots?providerId=" + row.provider.id + "&date=" + d + "&ignoreAppointmentId=" + id); sel.innerHTML = r.slots.length ? r.slots.map(function (s) { return '<option value="' + s.time + '"' + (d === row.date && s.time === row.time ? " selected" : "") + ">" + fmtTime(s.time) + "</option>"; }).join("") : '<option value="">' + esc(r.why || "No free slots") + "</option>"; }
      catch (e) { sel.innerHTML = '<option value="">' + esc(e.message) + "</option>"; }
    }
    f.querySelector("#rDate").onchange = refresh; refresh();
  }

  function addUserDialog() {
    var deptOpts = lists.departments.map(function (d) { return '<option value="' + d.id + '">' + esc(d.name) + "</option>"; }).join("");
    openDialog('<h3>Add user</h3><div class="form">' +
      '<label class="fld">First name<input class="in" id="nFirst" maxlength="40"></label><label class="fld">Last name<input class="in" id="nLast" maxlength="40"></label>' +
      '<label class="fld">Role<select class="in" id="nRole"><option value="student">Student</option><option value="provider">Provider</option><option value="staff">Staff</option><option value="admin">Admin</option></select></label>' +
      '<label class="fld">Student number or work email<input class="in" id="nLogin" maxlength="80"></label>' +
      '<label class="fld">Department (providers)<select class="in" id="nDept">' + deptOpts + '</select></label>' +
      '<label class="fld">Temporary password<input class="in" id="nPw" type="password" autocomplete="new-password"></label></div><p class="hint">At least 8 characters with a letter and a number.</p>', async function (f) {
      var body = { firstName: f.querySelector("#nFirst").value.trim(), lastName: f.querySelector("#nLast").value.trim(), role: f.querySelector("#nRole").value, login: f.querySelector("#nLogin").value.trim(), password: f.querySelector("#nPw").value };
      if (body.role === "provider") body.departmentId = +f.querySelector("#nDept").value;
      failIf(!body.firstName || !body.lastName, "Enter first and last name.");
      await api.post("/users", body);
      if (body.role === "provider") lists.providers = (await api.get("/providers")).providers;
      toast("User created");
    }, "Create user");
  }

  function resetPwDialog(id, name) {
    openDialog('<h3>Reset password</h3><p class="hint">' + esc(name) + '</p><label class="fld">New temporary password<input class="in" id="npw" type="password" autocomplete="new-password"></label><p class="hint">At least 8 characters with a letter and a number. Tell the user in person.</p>', async function (f) {
      await api.post("/users/" + id + "/password", { password: f.querySelector("#npw").value });
      toast("Password reset");
    }, "Reset password");
  }

  function blockDialog() {
    openDialog('<h3>Block a date</h3><div class="form"><label class="fld">Date<input class="in" type="date" id="blDate" min="' + meta.today + '"></label><label class="fld">Reason<input class="in" id="blWhy" maxlength="80"></label></div>', async function (f) {
      var d = f.querySelector("#blDate").value, why = f.querySelector("#blWhy").value.trim();
      failIf(!d || d < meta.today, "Choose today or a later date."); failIf(!why, "Enter a reason.");
      await api.post("/providers/" + ui.hoursProv + "/blocked", { date: d, reason: why });
      toast("Date blocked");
    }, "Block date");
  }

  async function saveHours() {
    var err = $("hoursErr"), hours = [];
    for (var i = 0; i < 7; i++) {
      hours.push({ weekday: i, working: document.querySelector('[data-h="working"][data-i="' + i + '"]').checked, start: document.querySelector('[data-h="start"][data-i="' + i + '"]').value, end: document.querySelector('[data-h="end"][data-i="' + i + '"]').value });
    }
    try { await api.put("/providers/" + ui.hoursProv + "/availability", { hours: hours }); err.hidden = true; toast("Hours saved"); }
    catch (e) { if (e.status === 401) return handleError(e); err.textContent = e.message; err.hidden = false; }
  }

  /* ---------- Router ---------- */
  var TITLES = {
    dashboard: ["Dashboard", function () { return fmtDate(meta.today); }],
    schedule: ["Daily schedule", function () { return "All providers"; }],
    walkin: ["Book for a student", function () { return "Walk-in or phone request"; }],
    myday: ["My day", function () { return fmtDate(ui.date); }],
    users: ["Users", function () { return "Accounts and roles"; }],
    hours: [null, function () { return role === "provider" ? "Your weekly hours and days off" : "These hours create the slots students can book"; }],
    reports: ["Reports", function () { return "Last " + ui.range + " days"; }],
    audit: ["Audit log", function () { return "Latest actions"; }]
  };

  async function route() {
    var r = location.hash.replace("#/", "") || HOME[role];
    if (!VIEWS[r] || ROUTES[role].indexOf(r) < 0) {
      if (VIEWS[r]) toast("Your role cannot open that page.");
      location.hash = "#/" + HOME[role];
      return;
    }
    var title = r === "hours" ? (role === "provider" ? "My hours" : "Provider hours") : TITLES[r][0];
    $("title").textContent = title; $("subtitle").textContent = TITLES[r][1]();
    document.title = "Cliniqo · " + title;
    document.querySelectorAll("#nav a").forEach(function (a) {
      var rt = a.getAttribute("data-route");
      a.hidden = ROUTES[role].indexOf(rt) < 0;
      if (role === "provider" && rt === "hours") a.lastChild.textContent = "My hours";
      if (rt === r) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    var token = ++routeToken, view = $("view");
    if (view.getAttribute("data-route") !== r) view.innerHTML = '<p class="hint">Loading…</p>';
    var html;
    try { html = await VIEWS[r](); }
    catch (e) {
      if (token !== routeToken) return;
      if (e.status === 401) return handleError(e);
      view.innerHTML = '<div class="panel"><p class="msg err">' + esc(e.message || "Could not load this page.") + '</p><div><button class="btn" data-act="retry">Try again</button></div></div>';
      return;
    }
    if (token !== routeToken) return;
    view.innerHTML = html; view.setAttribute("data-route", r);
    if (r === "walkin") initWalkin();
  }
  async function rerender() {
    var y = window.scrollY, el = document.activeElement, ae = el && el.id, pos = el && el.selectionStart;
    await route();
    window.scrollTo(0, y);
    if (ae) { var n = $(ae); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } }
  }

  /* ---------- Events ---------- */
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-act],[data-role],[data-prov],[data-range]"); if (!t) return;
    var action = t.getAttribute("data-act"), id = +t.getAttribute("data-id");
    if (t.hasAttribute("data-role")) { ui.userRole = t.getAttribute("data-role"); return rerender(); }
    if (t.hasAttribute("data-prov")) { if (role === "provider") return; ui.hoursProv = +t.getAttribute("data-prov"); return rerender(); }
    if (t.hasAttribute("data-range")) { ui.range = +t.getAttribute("data-range"); return rerender(); }
    if (action === "toggleuser") return; // handled by the change event
    if (action && !can(action)) { toast("Your role cannot do that."); return; }
    switch (action) {
      case "prevday": ui.date = addDays(ui.date, -1); return rerender();
      case "nextday": ui.date = addDays(ui.date, 1); return rerender();
      case "today": ui.date = meta.today; return rerender();
      case "retry": return rerender();
      case "checkin": return act(function () { return api.post("/appointments/" + id + "/status", { status: "Checked in" }); }, "Checked in");
      case "complete": return act(function () { return api.post("/appointments/" + id + "/status", { status: "Completed" }); }, "Marked completed");
      case "noshow": return act(function () { return api.post("/appointments/" + id + "/status", { status: "No-show" }); }, "Marked no-show");
      case "cancel": return cancelDialog(id).catch(handleError);
      case "resched": return rescheduleDialog(id).catch(handleError);
      case "wkconfirm": return wkConfirm();
      case "adduser": return addUserDialog();
      case "resetpw": return resetPwDialog(id, t.getAttribute("data-name"));
      case "block": return blockDialog();
      case "unblock": return act(function () { return api.del("/providers/" + ui.hoursProv + "/blocked/" + id); }, "Date removed");
      case "savehours": return saveHours();
      case "csv": return api.download("/reports.csv?days=" + ui.range, "cliniqo-appointments.csv").catch(handleError);
    }
  });
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.id === "fDate") { if (t.value) { ui.date = t.value; rerender(); } }
    else if (t.id === "fProv") { ui.prov = t.value; rerender(); }
    else if (t.id === "fStatus") { ui.status = t.value; rerender(); }
    else if (t.getAttribute("data-act") === "toggleuser") {
      if (!can("toggleuser")) { rerender(); return; }
      var on = t.checked;
      act(function () { return api.patch("/users/" + t.getAttribute("data-id"), { active: on }); }, on ? "Account enabled" : "Account disabled");
    }
  });
  var typing;
  document.addEventListener("input", function (e) {
    if (e.target.id !== "fQ" && e.target.id !== "uQ") return;
    var id = e.target.id, v = e.target.value;
    if (id === "fQ") ui.q = v; else ui.userQ = v;
    clearTimeout(typing); typing = setTimeout(rerender, 250);
  });
  $("signout").onclick = async function () { try { await api.post("/auth/logout"); } catch (e) {} location.href = "index.html"; };
  window.addEventListener("hashchange", route);

  /* ---------- Start ---------- */
  (async function boot() {
    try {
      me = (await api.get("/auth/me")).user;
      if (me.role === "student") { await api.post("/auth/logout"); location.replace("index.html"); return; }
      role = me.role;
      var res = await Promise.all([api.get("/meta"), api.get("/departments"), api.get("/providers")]);
      meta = res[0]; lists.departments = res[1].departments; lists.providers = res[2].providers;
    } catch (e) { location.replace("index.html"); return; }
    ui.date = meta.today;
    if (parseIso(ui.date).getDay() === 0) ui.date = addDays(ui.date, 1); // the sample clinic is closed on Sundays
    $("meName").textContent = me.name;
    $("meRole").textContent = ROLE_LABEL[role];
    document.querySelector(".side .tag").textContent = CONSOLE[role];
    var rb = $("reset"); if (rb) rb.remove();
    route();
  })();
})();
