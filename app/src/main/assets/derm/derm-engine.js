/*
 * derm-engine.js
 * Offline stand-in for POST /api/knowledge/derm/assess (derm_engine.js on medconsults.ai's server).
 *
 * How it was built: the server's engine was never shipped to the browser, so it was rebuilt from what it
 * ANSWERS. 101 requests (all 12 presentations, every kind of input) were recorded from the live API on
 * 2026-11-04 and the rules below were fitted to them. Every constant is now a measured value, and this
 * file reproduces all 101 recorded answers exactly (probabilities to 1e-15; the same findings set aside;
 * the same next question; the same body-site weights; the same staleness).
 *
 * What that does and does not prove: it is exact on every recorded case. Inputs that were not recorded
 * could still differ, most plausibly where two same-cluster findings are exactly equally informative
 * (the tie rule below is the one choice no recorded case could test).
 *
 * Install: this file sits next to offline-shim.js in site/ and is linked right after it in <head>
 * (scrape_derm_engine.py does both). offline-shim.js calls window.DERM_ASSESS for every /assess request.
 * To hide the small notice at the top of the page, define window.DERM_ENGINE_CONFIG = {notice:false}
 * before this script loads.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------- measured constants ----
  var CFG = {
    temper: 0.7,                     // each kept finding's likelihood ratio is raised to this power
    residualFloor: 0.05,             // "Something not on this list": floor + span * exp(-kept / tau)
    residualSpan: 0.06,              //   = 0.11 with no findings, 0.05 in the limit, never zero
    residualTau: 3,
    zoneWeights: [1, 1, 0.65, 0.65, 0.4],   // by position among a diagnosis' real sites; later sites keep 0.4
    genSpread: 0.3,                  // a "gen" (generalised) marker adds this to every drawn site; it uses no position
    noPretest: 0.05,                 // pre-test probability for a test whose target was excluded by age/sex
    notice: true
  };
  if (window.DERM_ENGINE_CONFIG) { for (var key in window.DERM_ENGINE_CONFIG) CFG[key] = window.DERM_ENGINE_CONFIG[key]; }

  // The page's own tables (ZL and Z_DRAWN); it reads every key without a guard, so all 32 must be answered.
  var ZONES = ["scalp", "face", "ear", "neck", "chest", "back", "abdo", "axilla", "groin", "buttock", "shoulder",
    "elbow", "antecub", "forearm", "wrist", "hand", "palm", "thigh", "knee", "poplit", "shin", "calf", "ankle",
    "foot", "sole", "oral", "conj", "nail", "web", "umbil", "genital", "perianal"];
  var DRAWN = ZONES.slice(0, 25);

  // ---------------------------------------------------------------- helpers ----
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var odds = function (p) { return p / (1 - p); };
  var prob = function (o) { return o / (1 + o); };

  // same as the page's ageY(): unit 'y' years, 'm' months, anything else days; blank/negative = unknown
  function ageYears(st) {
    var v = parseFloat(st.age);
    if (!isFinite(v) || v < 0) return null;
    return st.unit === "y" ? v : (st.unit === "m" ? v / 12 : v / 365);
  }

  // diagnoses (dxList) and context rows (ctxRows) are both filtered by their own age and sex ranges
  function fits(row, years, sex) {
    if (row.age && years !== null && (years < row.age[0] || years > row.age[1])) return false;
    if (row.sex && sex && row.sex !== sex) return false;
    return true;
  }

  // calendar months, ignoring the day of the month (the page's monthsSince)
  function monthsBetween(fromIso, toIso) {
    var a = new Date(String(fromIso || "") + "T00:00:00"), b = new Date(String(toIso || "") + "T00:00:00");
    if (isNaN(a) || isNaN(b)) return null;
    return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  }

  // how much an answered finding says: its largest |ln LR| in the direction answered
  function informativeness(a) {
    var best = 0, col = a.v === "y" ? 0 : 1;
    Object.keys(a.f.f || {}).forEach(function (id) {
      var lr = (a.f.f[id] || [])[col];
      if (lr > 0) best = Math.max(best, Math.abs(Math.log(lr)));
    });
    return best;
  }

  function postTest(pre, se, sp) {
    var Se = clamp(se / 100, 0.01, 0.999), Sp = clamp(sp / 100, 0.01, 0.999);
    var LRp = Se / (1 - Sp), LRn = (1 - Se) / Sp, o = odds(clamp(pre, 0.001, 0.999));
    return { pos: prob(o * LRp), neg: prob(o * LRn), LRp: LRp, LRn: LRn };
  }

  // ---------------------------------------------------------------- the engine ----
  function assess(pres, req, boot) {
    var st = (req && req.state) || {};
    var years = ageYears(st), sex = st.sex || "";
    var finds = pres.find || [];
    var findKey = function (i) { return pres.id + "|" + i; };

    var answered = [];                                   // key = presId|index, value 'y' or 'n'
    finds.forEach(function (f, i) {
      var v = (st.find || {})[findKey(i)];
      if (v === "y" || v === "n") answered.push({ f: f, i: i, v: v });
    });

    var months = monthsBetween(boot && boot.reviewed, req && req.today);
    var staleness = { months: months, over: months !== null && months > (boot && boot.reviewCycle) };

    var dx = (pres.dx || []).filter(function (d) { return fits(d, years, sex); });
    var ctxRows = (pres.ctx || []).filter(function (c) { return fits(c, years, sex); });
    var ctxOn = ctxRows.filter(function (c) { return (st.ctx || {})[c.l]; });
    var flags = [];
    (pres.stop || []).forEach(function (s, i) { if ((st.flags || {})[findKey(i)]) flags.push(i); });

    var zones = {}; ZONES.forEach(function (z) { zones[z] = 0; });
    var common = {
      flags: flags, ctxRowKeys: ctxRows.map(function (c) { return c.l; }), ctxOnKeys: ctxOn.map(function (c) { return c.l; }),
      dxIds: dx.map(function (d) { return d.id; }), answered: answered
    };
    function done(rank, next, tests) {
      var R = { rank: rank, next: next, zones: zones, staleness: staleness, tests: tests, _offline: true };
      for (var k in common) R[k] = common[k];
      return R;
    }
    if (!dx.length) return done({ rows: [], residual: 1, answered: answered.length, dropped: [] }, null, []);

    // ---- prior: base rates times the ticked context rows that fit this patient, normalised to 1
    var w = {};
    dx.forEach(function (d) { w[d.id] = d.base; });
    ctxOn.forEach(function (c) {
      Object.keys(c.m || {}).forEach(function (id) { if (w[id] != null) w[id] *= c.m[id]; });
    });
    var sumW = 0; dx.forEach(function (d) { sumW += w[d.id]; });
    var pre = {}; dx.forEach(function (d) { pre[d.id] = w[d.id] / sumW; });

    // ---- correlation guard: of the answered findings sharing a cluster, keep the single most informative
    //      (a tie goes to the lower finding number) and set the rest aside
    var kept = [], dropped = [], groups = new Map();
    answered.forEach(function (a) {
      if (a.f.g) { if (!groups.has(a.f.g)) groups.set(a.f.g, []); groups.get(a.f.g).push(a); } else kept.push(a);
    });
    groups.forEach(function (arr) {
      var best = arr[0];
      arr.forEach(function (a) { if (informativeness(a) > informativeness(best)) best = a; });
      kept.push(best);
      arr.forEach(function (a) { if (a !== best) dropped.push(a); });
    });

    // ---- tempered product of the kept likelihood ratios; posterior is proportional to prior times that product
    var L = {}; dx.forEach(function (d) { L[d.id] = 1; });
    kept.forEach(function (a) {
      var col = a.v === "y" ? 0 : 1;
      Object.keys(a.f.f || {}).forEach(function (id) {
        var lr = (a.f.f[id] || [])[col];
        if (L[id] != null && lr > 0) L[id] *= Math.pow(lr, CFG.temper);
      });
    });
    var residual = CFG.residualFloor + CFG.residualSpan * Math.exp(-kept.length / CFG.residualTau);
    var q = {}, sumQ = 0;
    // the unnormalised weights (base x context multipliers) are used here, not the normalised prior: with no findings
    // that makes p = w/sum(w) x (1 - residual) bit for bit, so exact ties such as "1.25x" round as on the live site
    dx.forEach(function (d) { q[d.id] = w[d.id] * L[d.id]; sumQ += q[d.id]; });
    if (!(sumQ > 0)) { dx.forEach(function (d) { q[d.id] = w[d.id]; }); sumQ = sumW; }
    var rows = dx.map(function (d) { return { id: d.id, p: q[d.id] / sumQ * (1 - residual), lr: null, pre: pre[d.id] }; })
      .sort(function (a, b) { return b.p - a.p; });

    // ---- next question: of the unanswered findings, the one that most separates the leader from its nearest rival
    var next = null;
    if (rows.length >= 2) {
      var A = rows[0].id, B = rows[1].id, bestScore = 1e-12;
      finds.forEach(function (f, i) {
        var v = (st.find || {})[findKey(i)];
        if (v === "y" || v === "n") return;
        var fa = (f.f || {})[A] || [1, 1], fb = (f.f || {})[B] || [1, 1];
        var score = Math.max(Math.abs(Math.log(fa[0] / fb[0])), Math.abs(Math.log(fa[1] / fb[1])));
        if (score > bestScore) { bestScore = score; next = { i: i, aId: A, bId: B, yA: fa[0], yB: fb[0], nA: fa[1], nB: fb[1] }; }
      });
    }

    // ---- body sites: share of the shortlist living in each site, scaled so the largest site is 1
    var byId = {}; dx.forEach(function (d) { byId[d.id] = d; });
    var raw = {}; ZONES.forEach(function (z) { raw[z] = 0; });
    rows.forEach(function (r) {
      var zl = byId[r.id].z || [];
      if (zl.indexOf("gen") !== -1) DRAWN.forEach(function (z) { raw[z] += r.p * CFG.genSpread; });
      zl.filter(function (z) { return z !== "gen"; }).forEach(function (z, idx) {
        var wt = CFG.zoneWeights[Math.min(idx, CFG.zoneWeights.length - 1)];
        raw[z] = (raw[z] || 0) + r.p * wt;
      });
    });
    var mx = 0; for (var z in raw) mx = Math.max(mx, raw[z]);
    for (var z2 in raw) zones[z2] = mx ? raw[z2] / mx : 0;

    // ---- confirmatory tests: post-test probabilities starting from each target's current probability
    var pById = {}; rows.forEach(function (r) { pById[r.id] = r.p; });
    var tests = (pres.test || []).map(function (t) {
      return { id: t.tgt, post: postTest(pById[t.tgt] != null ? pById[t.tgt] : CFG.noPretest, t.se, t.sp) };
    });

    return done({
      rows: rows, residual: residual, answered: answered.length,
      dropped: dropped
    }, next, tests);
  }

  window.DERM_ASSESS = function (pres, ctx, bootstrap) {
    var R = assess(pres, ctx, bootstrap);
    if (CFG.notice) {
      try {
        var id = "offline-engine-notice";
        if (!document.getElementById(id)) {
          var b = document.createElement("div");
          b.id = id;
          b.textContent = "Offline copy \u2013 scoring engine rebuilt from the live engine\u2019s answers (101 of 101 recorded cases identical).";
          b.style.cssText = "background:#2f3542;color:#e8eaf0;font:500 11.5px/1.35 system-ui,sans-serif;padding:5px 12px;text-align:center";
          document.body.insertBefore(b, document.body.firstChild);
        }
      } catch (e) { /* cosmetic only */ }
    }
    return R;
  };
})();
