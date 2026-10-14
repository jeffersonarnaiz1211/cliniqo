/* Talks to the Cliniqo API. Sign-in uses an HttpOnly cookie, so no token is ever stored in JavaScript. */
(function () {
  "use strict";
  function ApiError(status, message, field) { this.status = status; this.message = message; this.field = field; }
  ApiError.prototype = Object.create(Error.prototype);

  async function request(method, path, body) {
    var opts = { method: method, credentials: "same-origin", headers: { "X-Requested-With": "cliniqo" } };
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    var res;
    try { res = await fetch("/api" + path, opts); }
    catch (e) { throw new ApiError(0, "Cannot reach the server. Check your connection and try again."); }
    var data = null;
    try { data = await res.json(); } catch (e) { /* no JSON body */ }
    if (!res.ok) throw new ApiError(res.status, (data && data.error) || "Something went wrong. Please try again.", data && data.field);
    return data;
  }

  async function download(path, fallbackName) {
    var res = await fetch("/api" + path, { credentials: "same-origin", headers: { "X-Requested-With": "cliniqo" } });
    if (!res.ok) { var d = null; try { d = await res.json(); } catch (e) {} throw new ApiError(res.status, (d && d.error) || "Download failed."); }
    var m = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
    var url = URL.createObjectURL(await res.blob()), a = document.createElement("a");
    a.href = url; a.download = m ? m[1] : fallbackName; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  window.Cliniqo = {
    ApiError: ApiError,
    api: {
      get: function (p) { return request("GET", p); }, post: function (p, b) { return request("POST", p, b || {}); },
      put: function (p, b) { return request("PUT", p, b); }, patch: function (p, b) { return request("PATCH", p, b); },
      del: function (p) { return request("DELETE", p); }, download: download
    }
  };
})();
