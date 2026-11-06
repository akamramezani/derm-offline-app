/* offline-shim.js - answers the page's knowledge-API calls from files saved next to the page */
(function () {
  "use strict";
  var PREFIX = "/api/knowledge/derm";
  var LOCAL = "/external/api.medconsults.ai/api/knowledge/derm";            /* where the scraper saved the API replies */
  var realFetch = window.fetch.bind(window);
  var cache = {};
  function json(obj, status) {
    return new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json" } });
  }
  function load(path) {
    if (!cache[path]) {
      cache[path] = realFetch(LOCAL + path + ".json", { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).catch(function (e) { delete cache[path]; throw e; });
    }
    return cache[path];
  }
  window.fetch = function (input, init) {
    var raw = typeof input === "string" ? input : (input && input.url) || String(input);
    var u;
    try { u = new URL(raw, location.href); } catch (e) { return realFetch(input, init); }
    if (u.pathname.indexOf(PREFIX) !== 0) return realFetch(input, init);
    var path = u.pathname.slice(PREFIX.length);                      /* /bootstrap, /presentation/<id>, /assess */
    var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    if (method === "GET") {
      return load(path).then(function (d) { return json(d); },
                             function () { return json({ error: "not available offline" }, 404); });
    }
    if (method === "POST" && path === "/assess") {
      /* WIRE-UP POINT: scoring runs on the server (derm_engine.js). Until that engine is installed here as
         window.DERM_ASSESS(presentation, ctx, bootstrap) -> response, answer 503 so the page says "Not connected". */
      if (typeof window.DERM_ASSESS !== "function") return Promise.resolve(json({ error: "offline scoring engine not installed" }, 503));
      var ctx;
      try { ctx = (JSON.parse(init.body) || {}).ctx || {}; } catch (e) { return Promise.resolve(json({ error: "bad request" }, 400)); }
      return Promise.all([load("/presentation/" + encodeURIComponent(ctx.presId)), load("/bootstrap")])
        .then(function (a) { return window.DERM_ASSESS(a[0], ctx, a[1]); })
        .then(function (R) {
          if (init.signal && init.signal.aborted) throw new DOMException("Aborted", "AbortError");
          return json(R);
        }, function (e) {
          if (e && e.name === "AbortError") throw e;
          return json({ error: String(e) }, 500);
        });
    }
    return Promise.resolve(json({ error: "not available offline" }, 404));
  };
})();
