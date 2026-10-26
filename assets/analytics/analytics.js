// GoatCounter analytics: counts page/game views and shows a small stats
// widget (table, collapsible to a chip) in the bottom-left corner.
//
// Setup: create a site at goatcounter.com, put its code below, and turn on
// "Allow adding visitor counts on your website" in Settings > Site.
// While CODE is empty nothing is loaded and no widget is shown.
(function () {
  var CODE = "tung1883";
  var TABLE_MIN_WIDTH = 1480; // below this the table would cover the content column
  var HIDE_BELOW = 900;       // the side nav is hidden here, so hide the widget too
  var GAMES = [
    ["sudoku", "Sudoku"], ["minesweeper", "Minesweeper"], ["2048", "2048"],
    ["flappybird", "Flappy Bird"], ["doom", "Doom"], ["pokemon", "Pokemon FireRed"]
  ];
  var CACHE_KEY = "analytics_cache_v1";
  var MODE_KEY = "analytics_mode";
  var CACHE_MS = 15 * 60 * 1000;

  // Called by the page: window.analyticsTrack("game-doom", "Doom", true).
  // No-op until GoatCounter's script has loaded (and always on localhost).
  window.analyticsTrack = function (path, title, isEvent) {
    if (!CODE || !window.goatcounter || !window.goatcounter.count) return;
    window.goatcounter.count({ path: path, title: title, event: !!isEvent });
  };

  if (!CODE) return;

  var s = document.createElement("script");
  s.async = true;
  s.src = "//gc.zgo.at/count.js";
  s.setAttribute("data-goatcounter", "https://" + CODE + ".goatcounter.com/count");
  document.head.appendChild(s);

  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "assets/analytics/analytics.css";
  document.head.appendChild(link);

  var ICON_MIN = '<svg class="an-i" viewBox="0 0 24 24"><path d="M5 19h14"/></svg>';
  var ICON_UP = '<svg class="an-i" viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>';
  var RANGES = ["today", "7d", "30d"];

  var box = document.createElement("div");
  box.className = "an-box";
  document.body.appendChild(box);

  var state = { range: "today", manual: null, data: null, loading: false };
  try { state.manual = localStorage.getItem(MODE_KEY); } catch (e) {}

  // ---- data ----
  function ymd(d) {
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function daysAgo(n) { var d = new Date(); d.setDate(d.getDate() - n); return d; }

  function count(path, start, end) {
    var url = "https://" + CODE + ".goatcounter.com/counter/" + encodeURIComponent(path) + ".json" +
      "?start=" + ymd(start) + "&end=" + ymd(end);
    return fetch(url).then(function (r) {
      if (r.status === 404) return 0; // never counted yet
      if (!r.ok) throw new Error("counter " + r.status);
      return r.json().then(function (j) { return parseInt(String(j.count).replace(/[^0-9]/g, ""), 10) || 0; });
    });
  }

  // run tasks a few at a time; GoatCounter rate-limits the counter endpoint
  function pool(tasks, limit) {
    var results = new Array(tasks.length), next = 0;
    function worker() {
      if (next >= tasks.length) return Promise.resolve();
      var i = next++;
      return tasks[i]().then(function (v) { results[i] = v; }).then(worker);
    }
    var workers = [];
    for (var w = 0; w < Math.min(limit, tasks.length); w++) workers.push(worker());
    return Promise.all(workers).then(function () { return results; });
  }

  function load(range) {
    var days = range === "today" ? 1 : range === "7d" ? 7 : 30;
    var start = daysAgo(days - 1), end = new Date();
    var pStart = daysAgo(days * 2 - 1), pEnd = daysAgo(days);
    var tasks = [
      function () { return count("TOTAL", start, end); },
      function () { return count("TOTAL", pStart, pEnd); }
    ];
    GAMES.forEach(function (g) { tasks.push(function () { return count("game-" + g[0], start, end); }); });
    for (var i = 6; i >= 0; i--) (function (n) { tasks.push(function () { return count("TOTAL", daysAgo(n), daysAgo(n)); }); })(i);
    return pool(tasks, 3).then(function (r) {
      var games = GAMES.map(function (g, i) { return [g[1], r[2 + i]]; });
      games.sort(function (a, b) { return b[1] - a[1]; });
      return {
        views: r[0], prev: r[1], games: games,
        gamesTotal: games.reduce(function (a, g) { return a + g[1]; }, 0),
        spark: r.slice(2 + GAMES.length)
      };
    });
  }

  function ensure(range) {
    var cache = {};
    try { cache = JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch (e) {}
    var hit = cache[range];
    if (hit && Date.now() - hit.t < CACHE_MS) { state.data = hit.d; draw(); return; }
    state.loading = true;
    state.data = null;
    draw();
    load(range).then(function (d) {
      if (state.range !== range) return;
      state.data = d;
      cache[range] = { t: Date.now(), d: d };
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) {}
    }).catch(function () {
      if (state.range === range) state.data = { error: true };
    }).then(function () { state.loading = false; draw(); });
  }

  // ---- render ----
  function fmt(n) { return Number(n).toLocaleString("en-US"); }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function spark(a, w, h) {
    var mx = Math.max.apply(null, a.concat([1])), step = w / (a.length - 1);
    var pts = a.map(function (v, i) { return (i * step).toFixed(1) + "," + (h - 2 - v / mx * (h - 4)).toFixed(1); }).join(" ");
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" style="display:block"><polyline points="' + pts +
      '" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }

  function delta(cur, prev) {
    if (!prev) return "";
    var p = Math.round((cur - prev) / prev * 100);
    return '<em class="' + (p >= 0 ? "an-up" : "an-dn") + '">' + (p >= 0 ? "+" : "") + p + "%</em>";
  }

  function mode() {
    if (state.manual) return state.manual;
    return window.innerWidth >= TABLE_MIN_WIDTH ? "table" : "chip";
  }

  function rangeBar() {
    return '<div class="an-rng">' + RANGES.map(function (r) {
      return '<button type="button" data-an-range="' + r + '" class="' + (r === state.range ? "on" : "") + '">' + r + "</button>";
    }).join("") + "</div>";
  }

  function tableHtml() {
    var d = state.data, body;
    if (state.loading || !d) {
      body = '<div class="an-msg">loading ...</div>';
    } else if (d.error) {
      body = '<div class="an-msg">stats unavailable (is "Allow adding visitor counts" on?)</div>';
    } else {
      var top = d.games.filter(function (g) { return g[1] > 0; }).slice(0, 3), mx = top.length ? top[0][1] : 1;
      var kpi = function (l, v, x) { return '<div class="an-kpi"><small>' + l + "</small><b>" + v + "</b>" + (x || "") + "</div>"; };
      body = '<div class="an-kpis">' + kpi("views", fmt(d.views), delta(d.views, d.prev)) + kpi("games", fmt(d.gamesTotal)) +
        kpi("top game", top.length ? esc(top[0][0]) : "-") + "</div>" +
        '<div class="an-sp">' + spark(d.spark, 262, 28) + "</div>" +
        '<table><tr><th>games opened</th><th></th><th class="n">count</th></tr>' +
        (top.length ? top.map(function (g) {
          return "<tr><td>" + esc(g[0]) + '</td><td class="bc"><div class="an-bar"><i style="width:' + g[1] / mx * 100 + '%"></i></div></td><td class="n">' + fmt(g[1]) + "</td></tr>";
        }).join("") : '<tr><td colspan="3" class="an-dim">none yet</td></tr>') + "</table>";
    }
    return '<div class="an-tbl"><div class="an-h"><span><span class="an-live"></span>analytics</span><span class="an-r">' + rangeBar() +
      '<button type="button" class="an-tg" data-an-mode="chip" title="Collapse to chip" aria-label="Collapse to chip">' + ICON_MIN + "</button></span></div>" +
      '<div class="an-b"><div class="an-cmd"><span>$</span> stats --range ' + state.range + "</div>" + body +
      '<div class="an-foot"><span>via goatcounter</span></div></div></div>';
  }

  function chipHtml() {
    var d = state.data, label = d && !d.error ? "<b>" + fmt(d.views) + "</b> views " + spark(d.spark.slice(-6), 34, 14) : "analytics";
    return '<div class="an-chip" data-an-mode="table" title="Show analytics" role="button"><span class="an-live" style="margin:0"></span>' + label + ICON_UP + "</div>";
  }

  function draw() {
    if (window.innerWidth < HIDE_BELOW) { box.style.display = "none"; return; }
    box.style.display = "";
    box.innerHTML = mode() === "table" ? tableHtml() : chipHtml();
  }

  box.addEventListener("click", function (e) {
    var r = e.target.closest("[data-an-range]");
    if (r) { state.range = r.getAttribute("data-an-range"); ensure(state.range); return; }
    var m = e.target.closest("[data-an-mode]");
    if (m) {
      state.manual = m.getAttribute("data-an-mode");
      try { localStorage.setItem(MODE_KEY, state.manual); } catch (e2) {}
      draw();
    }
  });
  window.addEventListener("resize", draw);
  ensure(state.range);
})();
