#!/usr/bin/env python3
"""Build the static rootfetch.com site from data/daily_counts/*.csv.

Stdlib only. Output goes to _site/ and is deployed by GitHub Pages.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import math
import os
import re
import shutil
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
COUNTS_DIR = REPO_ROOT / "data" / "daily_counts"
SITE_URL = "https://rootfetch.com"
REPO_URL = "https://github.com/khalidsaidi/rootfetch"
DATA_LICENSE = "https://creativecommons.org/licenses/by/4.0/"
INDEXNOW_KEY = "dd02934e864e3daa533425b5d6e4ad28"
# A TLD page is offered to search engines only once it has real data behind it: enough domains,
# enough checks to show a trend, and a recent check. Thinner pages stay up for visitors (noindex,follow)
# and graduate automatically as data accrues. Keeps the site clear of Google's scaled-content rules.
INDEX_MIN_DOMAINS = 1000
INDEX_MIN_CHECKS = 4
INDEX_MAX_AGE_DAYS = 90
ORG = {"@type": "Organization", "@id": f"{SITE_URL}/#org", "name": "RootFetch", "url": f"{SITE_URL}/",
       "logo": f"{SITE_URL}/og/logo.png", "sameAs": [REPO_URL]}
WEBSITE = {"@type": "WebSite", "@id": f"{SITE_URL}/#website", "name": "RootFetch", "url": f"{SITE_URL}/",
           "description": "Daily domain registration counts and trends for every top-level domain, from ICANN zone files.",
           "publisher": {"@id": f"{SITE_URL}/#org"}, "inLanguage": "en"}
# Old URLs from the previous version of the site, sent to their closest page now.
LEGACY = {
    "stats": "index.html", "stats.json": "data/latest.json", "methodology": "data.html", "coverage": "data.html",
    "approved": "tlds.html", "compare": "tlds.html", "compare/tlds": "tlds.html", "sectors": "index.html",
    "security": "spikes.html", "runs": "data.html", "ask": "index.html", "agents": "data.html",
    "agents/playground": "data.html", "agents/recipes": "data.html", "recipes": "data.html", "for-teams": "about.html",
    "for-teams/workflows": "about.html", "docs/mcp": "data.html", "docs/integrations": "data.html",
    "docs/public-endpoints": "data.html", "mcp/live": "data.html", "mcp/usage": "data.html", "ops": "data.html",
}

# A spike is a jump of at least SPIKE_MIN_ADDED domains and SPIKE_MIN_PCT growth
# since the previous check, where that check was at most SPIKE_MAX_GAP_DAYS earlier.
SPIKE_MIN_BASE = 1000
SPIKE_MIN_ADDED = 1000
SPIKE_MIN_PCT = 0.05
SPIKE_MAX_GAP_DAYS = 21
STALE_AFTER_DAYS = 3
RECENT_DAYS = 30
RADAR_MIN_DOMAINS = 1000
RADAR_MAX_AGE_DAYS = 90

# (label, minimum growth since previous check), most severe first.
SEVERITY = [("critical", "Critical", 0.20), ("high", "High", 0.10), ("elevated", "Elevated", SPIKE_MIN_PCT)]

# TLDs named in Interisle Consulting Group's abuse reports.
INTERISLE_2025 = "https://domainnamewire.com/2025/09/11/report-names-commonly-used-tlds-for-phishing-attacks/"
INTERISLE_2026 = "https://isoclive.substack.com/p/interisle-dns-abuse"
KNOWN_ABUSE = {
    "xin": INTERISLE_2025, "help": INTERISLE_2025, "win": INTERISLE_2025, "cfd": INTERISLE_2025,
    "bond": INTERISLE_2026, "top": INTERISLE_2026, "info": INTERISLE_2026, "vip": INTERISLE_2026,
    "xyz": INTERISLE_2026,
}


@dataclass
class Change:
    tld: str
    date: str
    prev_date: str
    gap_days: int
    prev_count: int
    count: int

    @property
    def added(self) -> int:
        return self.count - self.prev_count

    @property
    def pct(self) -> float:
        return self.added / self.prev_count if self.prev_count else 0.0

    @property
    def weekly(self) -> float:
        """Growth rate scaled to one week, so checks with different gaps compare."""
        if not self.prev_count or self.count <= 0 or self.gap_days <= 0:
            return 0.0
        return (self.count / self.prev_count) ** (7 / self.gap_days) - 1

    def is_spike(self) -> bool:
        return (
            self.gap_days <= SPIKE_MAX_GAP_DAYS
            and self.prev_count >= SPIKE_MIN_BASE
            and self.added >= SPIKE_MIN_ADDED
            and self.pct >= SPIKE_MIN_PCT
        )

    @property
    def severity(self) -> tuple[str, str] | None:
        if not self.is_spike():
            return None
        for key, label, floor in SEVERITY:
            if self.pct >= floor:
                return key, label
        return None

    def as_dict(self) -> dict:
        sev = self.severity
        return {
            "tld": self.tld,
            "date": self.date,
            "prev_date": self.prev_date,
            "gap_days": self.gap_days,
            "prev_count": self.prev_count,
            "count": self.count,
            "added": self.added,
            "pct": round(self.pct, 6),
            "severity": sev[0] if sev else None,
            "known_abuse": self.tld in KNOWN_ABUSE,
        }


def load_series(counts_dir: Path) -> dict[str, dict[str, int]]:
    series: dict[str, dict[str, int]] = {}
    for path in sorted(counts_dir.glob("*.csv")):
        with path.open(newline="") as handle:
            for row in csv.DictReader(handle):
                if row.get("status") != "ok" or row.get("is_estimate", "").lower() == "true":
                    continue
                if not row.get("count"):
                    continue
                series.setdefault(row["tld"], {})[row["date_utc"]] = int(row["count"])
    return series


def changes_for(tld: str, points: dict[str, int]) -> list[Change]:
    dates = sorted(points)
    out = []
    for prev, cur in zip(dates, dates[1:]):
        gap = (date.fromisoformat(cur) - date.fromisoformat(prev)).days
        out.append(Change(tld, cur, prev, gap, points[prev], points[cur]))
    return out


# ---------- formatting ----------

def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def unicode_name(tld: str) -> str:
    if tld.startswith("xn--"):
        try:
            return tld.encode("ascii").decode("idna")
        except UnicodeError:
            return tld
    return tld


def tld_label(tld: str) -> str:
    """Display name; IDN TLDs show their script with the ASCII form beneath."""
    u = unicode_name(tld)
    if u != tld:
        return f'.{esc(u)} <span class="idn">{esc(tld)}</span>'
    return f".{esc(tld)}"


def fmt_int(n: int) -> str:
    return f"{n:,}"


def fmt_signed(n: int) -> str:
    return f"+{n:,}" if n > 0 else f"{n:,}".replace("-", "−")


def fmt_pct(p: float, digits: int = 1) -> str:
    return f"{p * 100:+.{digits}f}%".replace("-", "−")


def fmt_day(iso: str, year: bool = True) -> str:
    d = date.fromisoformat(iso)
    return f"{d.strftime('%b')} {d.day}, {d.year}" if year else f"{d.strftime('%b')} {d.day}"


def fmt_compact(n: float) -> str:
    for div, suf in ((1e6, "M"), (1e3, "k")):
        if abs(n) >= div:
            v = n / div
            return f"{v:.1f}{suf}".replace(".0", "") if v < 10 else f"{v:.0f}{suf}"
    return f"{n:.0f}"


def days(n: int) -> str:
    return f"{n} day{'s' if n != 1 else ''}"


def tick_label(v: float, span: float) -> str:
    """Axis label with just enough precision that neighbouring ticks never read the same."""
    if v < 1000:
        return fmt_int(round(v))
    for unit, suf in ((1e6, "M"), (1e3, "k")):
        if v >= unit:
            step = span / 4 / unit
            digits = 0 if step >= 1 else 1 if step >= 0.1 else 2 if step >= 0.01 else 3
            return f"{v / unit:,.{digits}f}{suf}"
    return fmt_int(round(v))


def trend_class(n: float) -> str:
    return "up" if n > 0 else "down" if n < 0 else "flat"


def sev_chip(c: Change) -> str:
    sev = c.severity
    if not sev:
        return ""
    return f'<span class="sev sev-{sev[0]}"><i aria-hidden="true"></i>{sev[1]}</span>'


def abuse_chip(tld: str, depth: int = 0) -> str:
    if tld not in KNOWN_ABUSE:
        return ""
    return (
        f'<a class="abuse" href="{"../" * depth}about.html#abuse-lists" '
        f'title="Named in Interisle Consulting Group abuse reports">On abuse lists</a>'
    )


GA_ID = "G-6W6C3JRX1Z"
# Raw string on purpose: the regexes below must reach the browser with their backslashes intact.
GA_HEAD = r"""<script async src="https://www.googletagmanager.com/gtag/js?id=G-6W6C3JRX1Z"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
// Only the real site reports; local previews and forks stay out of the data.
if (location.hostname !== 'rootfetch.com') window['ga-disable-G-6W6C3JRX1Z'] = true;
(function () {
  var p = location.pathname.replace(/\/index\.html$/, '/');
  var kind = p === '/' ? 'home'
    : /^\/tld\//.test(p) ? 'tld'
    : /^\/tlds(\.html)?$/.test(p) ? 'tld_list'
    : /^\/spikes(\.html)?$/.test(p) ? 'jumps'
    : /^\/data(\.html)?$/.test(p) ? 'data'
    : /^\/about(\.html)?$/.test(p) ? 'about'
    : 'other';
  var tld = (p.match(/^\/tld\/([^\/.]+)/) || [])[1] || '';
  window.__pageType = kind;
  window.__tld = tld;
  var cfg = { content_group: kind, page_type: kind };
  if (tld) cfg.tld = tld;
  gtag('config', 'G-6W6C3JRX1Z', cfg);
})();
</script>"""

GA_EVENTS = r"""<script>
(function () {
  var TYPE = window.__pageType || 'other';
  var TLD = window.__tld || '';

  function send(name, params) {
    try {
      if (!window.gtag) return;
      var p = params || {};
      p.page_type = TYPE;
      if (TLD && !p.tld) p.tld = TLD;
      gtag('event', name, p);
    } catch (e) {}
  }
  function label(el) { return (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100); }

  // Where on the page a link sits, so we know which chart or list sends people to a TLD.
  var SOURCES = [['.radar', 'radar'], ['.board', 'ranking'], ['.card', 'jump_card'], ['#all', 'table'],
    ['.related', 'related'], ['.sm', 'small_multiple'], ['.pulse', 'pulse'], ['.crumbs', 'breadcrumb'],
    ['nav', 'nav'], ['table', 'table'], ['footer', 'footer']];
  function source(a) {
    for (var i = 0; i < SOURCES.length; i++) if (a.closest(SOURCES[i][0])) return SOURCES[i][1];
    return 'body';
  }

  document.addEventListener('click', function (e) {
    var t = e.target; if (!t || !t.closest) return;
    var a = t.closest('a[href]'); if (!a) return;
    var src = source(a);
    if (a.closest('nav')) send('nav_click', { cta: label(a) });
    if (a.classList.contains('cta')) send('cta_click', { cta: label(a), method: src });
    var raw = a.getAttribute('href') || (a.href && a.href.baseVal) || '';
    var url; try { url = new URL(raw, location.href); } catch (err) { return; }
    var path = url.pathname;
    if (url.host !== location.host) { send('outbound_click', { link_domain: url.host }); return; }
    var m = path.match(/^\/tld\/([^\/.]+)(?:\.html)?$/);
    if (m) send('tld_open', { tld: m[1], method: src });
    var f = path.match(/([^\/]+\.(csv|json))$/);
    if (f) send('data_download', { file_name: f[1], method: src });
    if (/feed\.xml$/.test(path)) send('rss_subscribe', { method: src });
  });

  document.addEventListener('toggle', function (e) {
    var d = e.target;
    if (d && d.tagName === 'DETAILS' && d.open) {
      var s = d.querySelector('summary');
      send('disclosure_open', { faq_question: s ? label(s) : '' });
    }
  }, true);

  // Extension list: filter box, segment buttons, column sort.
  var q = document.getElementById('q'), qTimer;
  if (q) {
    var pre = new URLSearchParams(location.search).get('q');
    if (pre) { q.value = pre; q.dispatchEvent(new Event('input')); }
    q.addEventListener('input', function () {
      clearTimeout(qTimer);
      qTimer = setTimeout(function () {
        var v = q.value.trim();
        if (v.length >= 2) send('search', { search_term: v.slice(0, 100) });
      }, 1200);
    });
  }
  document.addEventListener('click', function (e) {
    var t = e.target; if (!t || !t.closest) return;
    var b = t.closest('.seg button');
    if (b) send('filter_change', { filter: b.getAttribute('data-mode') || label(b) });
    var th = t.closest('th[data-sort]');
    if (th) send('table_sort', { sort_column: label(th).replace(/[↑↓]/g, '').trim() });
  });

  // First tooltip per chart type per page.
  var hovered = {};
  document.addEventListener('mouseover', function (e) {
    var t = e.target; if (!t || !t.closest) return;
    var el = t.closest('[data-tip], .pt'); if (!el) return;
    var kind = el.closest('.radar') ? 'radar' : el.closest('.chart') ? 'history' : el.closest('.weeks') ? 'jumps_timeline' : el.closest('.pulse') ? 'pulse' : 'other';
    if (hovered[kind]) return;
    hovered[kind] = 1;
    send('chart_hover', { chart: kind });
  });

  var marks = [25, 50, 75, 100], hit = {};
  function onScroll() {
    var h = document.documentElement;
    var max = h.scrollHeight - h.clientHeight; if (max <= 0) return;
    var pct = Math.min(100, Math.round(((window.scrollY || h.scrollTop) / max) * 100));
    for (var i = 0; i < marks.length; i++) {
      if (pct >= marks[i] && !hit[marks[i]]) { hit[marks[i]] = 1; send('scroll_depth', { scroll_depth: String(marks[i]) }); }
    }
  }
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  var t0 = Date.now(), done = 0;
  addEventListener('scroll', function () {
    if (!done && hit[75] && Date.now() - t0 > 30000) { done = 1; send('read_complete', {}); }
  }, { passive: true });

  addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'hidden' || window.__left) return;
    window.__left = 1;
    send('page_exit', { seconds_on_page: String(Math.round((Date.now() - t0) / 1000)) });
  });
})();
</script>"""


# ---------- design ----------

FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    '<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:ital,wght@0,300..800;1,400&display=swap" rel="stylesheet">'
)

CSS = """
:root{
--bg:#ffffff;--ink:#14243f;--ink-2:#46536b;--muted:#6b778c;--rule:#dce2ea;--wash:#f3f6fa;
--signal:#1f5fcc;--fall:#b0307a;--dot:#a7b1bf;
--d3:#b0307a;--d2:#d77aaa;--d1:#efc6db;--n0:#e3e7ed;--g1:#c8dbf5;--g2:#7fa7e4;--g3:#256abf;
--critical:#c2362f;--high:#cf6224;--elevated:#b07e00;--good:#2e7d43;
--sans:"Atkinson Hyperlegible Next",system-ui,-apple-system,"Segoe UI",sans-serif;
--code:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
--bg:#0f1624;--ink:#e6ecf5;--ink-2:#b3bdcc;--muted:#8d98aa;--rule:#2a3446;--wash:#162033;
--signal:#6fa2ff;--fall:#d45a93;--dot:#55617a;--critical:#ff7a6e;--high:#ff9a5a;--elevated:#e6b53a;--good:#5cc07a;
--d3:#d45a93;--d2:#8e3d65;--d1:#4a2b3e;--n0:#283246;--g1:#243a5e;--g2:#3a65a6;--g3:#4f8ae0;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0f1624;--ink:#e6ecf5;--ink-2:#b3bdcc;--muted:#8d98aa;--rule:#2a3446;--wash:#162033;
--signal:#6fa2ff;--fall:#d45a93;--dot:#55617a;--critical:#ff7a6e;--high:#ff9a5a;--elevated:#e6b53a;--good:#5cc07a;
--d3:#d45a93;--d2:#8e3d65;--d1:#4a2b3e;--n0:#283246;--g1:#243a5e;--g2:#3a65a6;--g3:#4f8ae0;color-scheme:dark}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 var(--sans);font-variant-numeric:tabular-nums lining-nums}
a{color:var(--signal);text-underline-offset:3px;text-decoration-thickness:1px}
a:hover{text-decoration-thickness:2px}
a:focus-visible,button:focus-visible,input:focus-visible,[tabindex]:focus-visible,summary:focus-visible{outline:2px solid var(--signal);outline-offset:3px;border-radius:2px}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px}
.skip{position:absolute;left:-999px}.skip:focus{left:16px;top:8px;background:var(--bg);padding:8px 12px;z-index:9}
code{font:0.9em var(--code)}

/* masthead */
.top .wrap{display:flex;align-items:baseline;gap:28px;padding-top:22px;padding-bottom:18px;flex-wrap:wrap;border-bottom:2px solid var(--ink)}
.brand{font-weight:800;font-size:22px;letter-spacing:-.01em;text-decoration:none;color:var(--ink)}
.brand span{font-weight:400;color:var(--muted);font-size:15px;margin-left:10px;letter-spacing:0}
nav{display:flex;gap:22px;margin-left:auto;font-size:16px}
nav a{color:var(--ink);text-decoration:none;padding:2px 0;border-bottom:2px solid transparent;white-space:nowrap}
nav a:hover{border-bottom-color:var(--rule)}
nav a.on{border-bottom-color:var(--ink);font-weight:700}
.trust{font-size:15px;color:var(--muted);margin:14px 0 0}
.trust.stale{color:var(--critical);font-weight:700}

/* type */
h1{font-weight:800;font-size:clamp(32px,4.6vw,50px);line-height:1.08;letter-spacing:-.02em;margin:44px 0 18px;max-width:22ch}
h2{font-weight:800;font-size:27px;line-height:1.2;letter-spacing:-.01em;margin:0 0 10px}
h3{font-weight:700;font-size:18px;line-height:1.3;margin:0 0 4px}
.section{margin:72px 0 0}
.section-head{margin-bottom:22px;max-width:68ch}
.section-head p{margin:0;color:var(--ink-2)}
.section-head .more{display:inline-block;margin-top:8px}
.lede{font-size:20px;line-height:1.5;color:var(--ink-2);max-width:62ch;margin:0}
.lede b{color:var(--ink)}
.muted,.count{color:var(--muted)}
.count{font-size:15px}
.eyebrow{display:none}
.up{color:var(--ink)}.down{color:var(--ink-2)}.flat{color:var(--muted)}


/* market map */
.mapfig{margin:34px 0 0}
.mmap{width:100%;height:auto;display:block}
.mmap .t{fill:var(--n0)}
.mmap .t.d3{fill:var(--d3)}.mmap .t.d2{fill:var(--d2)}.mmap .t.d1{fill:var(--d1)}
.mmap .t.g1{fill:var(--g1)}.mmap .t.g2{fill:var(--g2)}.mmap .t.g3{fill:var(--g3)}
.mmap .pt:hover .t,.mmap .pt:focus .t{stroke:var(--ink);stroke-width:2}
.mmap .gl{font:700 12px var(--sans);fill:var(--ink-2)}
.mmap .tl{font-family:var(--sans);font-weight:800;fill:var(--ink);letter-spacing:-.01em}
.mmap .tv{font:600 11px var(--sans);fill:var(--ink-2)}
.mmap .tl.g3,.mmap .tl.d3,.mmap .tv.g3,.mmap .tv.d3{fill:#fff}
.mmap.tall{display:none}
.mkey{margin:14px 0 0;font-size:14px;color:var(--ink-2);width:min(100%,280px)}
.mk-scale{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.mk-scale i{height:12px;display:block;border-radius:2px}
.mk-note{margin:4px 0 0;font-size:13px;color:var(--muted)}
.mk-scale .d3{background:var(--d3)}.mk-scale .d2{background:var(--d2)}.mk-scale .d1{background:var(--d1)}.mk-scale .n0{background:var(--n0)}
.mk-scale .g1{background:var(--g1)}.mk-scale .g2{background:var(--g2)}.mk-scale .g3{background:var(--g3)}
.mk-labels{display:flex;justify-content:space-between;margin-top:4px}
.mapfig figcaption{margin:10px 0 0;font-size:15px;color:var(--ink-2);max-width:72ch}

/* findings under the hero */
.takeaways{list-style:none;padding:0;margin:30px 0 0;max-width:68ch;border-top:1px solid var(--rule)}
.takeaways li{padding:12px 0;border-bottom:1px solid var(--rule);color:var(--ink-2)}
.takeaways b{color:var(--ink)}
.kpis{display:none}

/* charts on the page, not in boxes */
.pulses{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:36px}
.pulse,.sm{text-decoration:none;color:var(--ink);display:block}
.pulse .row,.sm .row{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.pn{font-weight:800;font-size:26px;letter-spacing:-.02em}
.pv{font-weight:700;font-size:18px}
.pulse p{margin:2px 0 10px;font-size:15px;color:var(--muted)}
.pulse:hover .pn,.sm:hover .smn{color:var(--signal)}
.pl svg{width:100%;height:96px;display:block;border-bottom:1px solid var(--rule)}
.pb svg{width:100%;height:40px;display:block}
.pulse .row.count{font-size:13px}
.smgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:28px 24px}
.sm svg{width:100%;height:64px;display:block;margin:6px 0 2px}
.smn{font-weight:800;font-size:19px}
.smv{font-weight:700;font-size:15px}.smv.down{color:var(--ink-2)}
.sm .count{font-size:13px}

/* ranked lists */
.boards{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:40px 44px}
.board h3{margin-bottom:2px}
.board .count{margin:0 0 10px;font-size:14px}
.board ol{list-style:none;margin:0;padding:0;border-top:1px solid var(--rule)}
.board li a{display:grid;grid-template-columns:104px 1fr minmax(70px,auto);align-items:center;gap:12px;padding:7px 0;border-bottom:1px solid var(--rule);text-decoration:none;color:var(--ink)}
.board li a:hover .bn{color:var(--signal);text-decoration:underline}
.bn{font-weight:700;font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt{height:8px;background:transparent}
.bb{display:block;height:100%}
.bv{font-size:15px;text-align:right;color:var(--ink-2)}

/* severity: a shape and a word, no badges */
.sev{display:inline-flex;align-items:center;gap:6px;font-weight:700;font-size:15px;white-space:nowrap}
.sev i{width:9px;height:9px;display:inline-block}
.sev{color:var(--ink)}.sev-critical{}.sev-critical i{background:var(--critical);transform:rotate(45deg)}
.sev-high{}.sev-high i{width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid var(--high)}
.sev-elevated{}.sev-elevated i{background:var(--elevated);border-radius:50%}
.abuse{font-size:15px;color:var(--critical)}
.chips{display:flex;gap:16px;flex-wrap:wrap;align-items:center}

/* jumps as a list */
.jumps{list-style:none;margin:0;padding:0;border-top:1px solid var(--rule)}
.jumps li a{display:grid;grid-template-columns:minmax(120px,1.2fr) 110px minmax(90px,.8fr) 2fr;gap:16px;align-items:baseline;padding:12px 0;border-bottom:1px solid var(--rule);text-decoration:none;color:var(--ink)}
.jumps .name{font-weight:800;font-size:21px}
.jumps .big{font-weight:800;font-size:19px}
.jumps .meta{color:var(--ink-2);font-size:15px}
.jumps li a:hover .name{color:var(--signal);text-decoration:underline}
.empty{color:var(--ink-2)}

/* tables */
.tools{display:flex;gap:14px;align-items:center;margin:0 0 14px;flex-wrap:wrap}
input[type=search]{font:inherit;font-size:17px;padding:9px 12px;border:1px solid var(--ink-2);border-radius:2px;background:var(--bg);color:var(--ink);width:min(340px,100%)}
.seg{display:inline-flex;gap:18px}
.seg button{font:inherit;font-size:16px;border:0;border-bottom:2px solid transparent;background:none;color:var(--ink-2);padding:4px 0;cursor:pointer}
.seg button[aria-pressed=true]{color:var(--ink);border-bottom-color:var(--ink);font-weight:700}
.tablebox{overflow:auto;max-height:760px;border-top:2px solid var(--ink)}
table{width:100%;border-collapse:collapse;font-size:16px}
th,td{padding:9px 12px 9px 0;text-align:left;border-bottom:1px solid var(--rule);white-space:nowrap}
th{font-weight:700;font-size:14px;color:var(--ink-2);background:var(--bg);position:sticky;top:0;z-index:1;border-bottom:1px solid var(--ink-2)}
th[data-sort]{cursor:pointer;user-select:none}
th[data-sort]:hover{color:var(--ink)}
th[data-dir=desc]::after{content:" ↓"}th[data-dir=asc]::after{content:" ↑"}
tbody tr:hover{background:var(--wash)}
td.n,th.n{text-align:right}
td.spark{width:96px;padding-top:4px;padding-bottom:4px}
td.spark svg{display:block}
.tld{font-weight:700;text-decoration:none;color:var(--ink)}
.tld:hover{color:var(--signal);text-decoration:underline}
.idn{font-weight:400;font-size:13px;color:var(--muted);margin-left:6px}

/* extension pages */
.crumbs{display:flex;gap:8px;flex-wrap:wrap;margin-top:26px;font-size:15px;color:var(--muted)}
.crumbs a{color:var(--ink-2)}
h1.tldname small{font-size:.2em;letter-spacing:0;font-weight:600;color:var(--muted);margin-left:.4em}
h1.tldname{font-size:clamp(64px,13vw,168px);line-height:.92;letter-spacing:-.045em;margin:18px 0 22px;max-width:none;overflow-wrap:anywhere}
.tldlede{max-width:62ch}
.facts{display:flex;flex-wrap:wrap;gap:12px 44px;margin:22px 0 24px;padding:18px 0;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
.facts b{display:block;font-weight:800;font-size:26px;letter-spacing:-.01em}
.facts small{color:var(--muted);font-size:14px}
.chart svg{width:100%;height:auto;display:block;overflow:visible}
.chart .axis-t{font:12px var(--sans);fill:var(--muted)}
.summary p{font-size:18px;line-height:1.6;color:var(--ink-2);max-width:68ch}.summary b{color:var(--ink)}
.answers h2{margin-top:40px}
.verdict{font-weight:800;font-size:21px;line-height:1.35;padding:2px 0 2px 16px;border-left:5px solid var(--rule);max-width:60ch;margin:12px 0}
.answers .verdict{color:var(--ink)}
.answers .verdict.verdict-warn{border-left-color:var(--critical)}.answers .verdict.verdict-mixed{border-left-color:var(--elevated)}.answers .verdict.verdict-ok{border-left-color:var(--good)}
.answers p{color:var(--ink-2);max-width:68ch}
.faq details{border-bottom:1px solid var(--rule);padding:14px 0}
.faq details:first-of-type{border-top:1px solid var(--rule)}
.faq summary{cursor:pointer;font-weight:700;font-size:18px}
.faq p{margin:8px 0 0;color:var(--ink-2);max-width:68ch}
.related{list-style:none;padding:0;margin:12px 0 0;display:flex;flex-wrap:wrap;gap:10px 28px}
.related a{text-decoration:none;color:var(--ink);font-weight:700}
.related a:hover{color:var(--signal);text-decoration:underline}
.related .count{font-weight:400;margin-left:6px;font-size:14px}
.prose-p{color:var(--ink-2);max-width:68ch}

/* tooltip */
#tip{position:fixed;pointer-events:none;z-index:20;background:var(--ink);color:var(--bg);font:14px/1.45 var(--sans);padding:8px 11px;border-radius:3px;max-width:300px;opacity:0;white-space:pre-line}
#tip.on{opacity:1}
.pt{cursor:pointer}
.legend{display:flex;flex-wrap:wrap;gap:6px 22px;font-size:14px;color:var(--ink-2);padding:10px 0 0}
.legend span{display:inline-flex;align-items:center;gap:7px}
.legend i{width:10px;height:10px;border-radius:50%;display:inline-block}

/* jumps-per-week strip */
.weeks{display:flex;gap:3px;align-items:flex-end;height:84px;padding:0 0 26px;position:relative;overflow-x:auto;border-bottom:1px solid var(--rule)}
.weeks .w{flex:1 0 10px;min-width:10px;background:var(--rule);position:relative}
.weeks .w.has{background:var(--critical)}
.weeks .w span{position:absolute;bottom:-22px;left:50%;transform:translateX(-50%);font-size:12px;color:var(--muted);white-space:nowrap}

/* prose and data pages */
.prose{max-width:68ch}.prose p,.prose li{color:var(--ink-2)}.prose h2{margin-top:44px}
.prose pre{background:var(--wash);padding:14px 16px;overflow:auto;font-size:14px;border-left:3px solid var(--rule)}
.dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:0 40px;border-top:1px solid var(--rule)}
.dl a{display:block;padding:14px 0;border-bottom:1px solid var(--rule);text-decoration:none;color:var(--ink)}
.dl code{font-weight:700;font-size:16px;color:var(--signal)}
.dl a:hover code{text-decoration:underline}
.dl small{display:block;color:var(--ink-2);margin-top:2px;font-size:15px}
footer{margin-top:96px;border-top:2px solid var(--ink)}
footer .wrap{padding-top:20px;padding-bottom:56px;display:flex;gap:10px 28px;flex-wrap:wrap;color:var(--ink-2);font-size:15px}
footer a{color:var(--ink)}
@media (max-width:640px){
 body{font-size:16px}
 nav{margin-left:0;width:100%;gap:6px 20px;flex-wrap:wrap}
 .mmap.wide{display:none}.mmap.tall{display:block}
 .jumps li a{grid-template-columns:1fr auto;}
 .jumps li a .meta{grid-column:1/-1}
 th,td{padding:8px 10px 8px 0}
 .chart{overflow-x:auto}.chart svg{min-width:620px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
"""

JS = """
(function(){
var tip=document.getElementById('tip');
function show(e,el){tip.textContent=el.getAttribute('data-tip')||el.getAttribute('aria-label');tip.classList.add('on');move(e,el)}
function move(e,el){var x,y;if(e&&e.clientX!=null&&e.type!=='focus'){x=e.clientX;y=e.clientY}else{var r=el.getBoundingClientRect();x=r.left+r.width/2;y=r.top}
 var w=tip.offsetWidth,h=tip.offsetHeight;x=Math.min(Math.max(8,x+14),innerWidth-w-8);y=y-h-12<8?y+18:y-h-12;tip.style.left=x+'px';tip.style.top=y+'px'}
function hide(){tip.classList.remove('on')}
document.querySelectorAll('[data-tip],.pt[aria-label]').forEach(function(el){
 el.addEventListener('mouseenter',function(e){show(e,el)});el.addEventListener('mousemove',function(e){move(e,el)});
 el.addEventListener('mouseleave',hide);el.addEventListener('focus',function(e){show(e,el)});el.addEventListener('blur',hide);});
document.querySelectorAll('table[data-sortable]').forEach(function(t){
 t.querySelectorAll('th[data-sort]').forEach(function(th){
  th.setAttribute('tabindex','0');
  function go(){var idx=Array.prototype.indexOf.call(th.parentNode.children,th);
   var desc=th.dataset.dir!=='desc';t.querySelectorAll('th').forEach(function(o){delete o.dataset.dir});th.dataset.dir=desc?'desc':'asc';
   var rows=Array.from(t.tBodies[0].rows);
   rows.sort(function(a,b){var x=a.cells[idx].dataset.v,y=b.cells[idx].dataset.v,nx=parseFloat(x),ny=parseFloat(y);
    var c=(!isNaN(nx)&&!isNaN(ny))?nx-ny:String(x).localeCompare(String(y));return desc?-c:c});
   rows.forEach(function(r){t.tBodies[0].appendChild(r)});}
  th.addEventListener('click',go);th.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}});
 });
});
var q=document.getElementById('q'),mode='all',segs=document.querySelectorAll('.seg button'),cnt=document.getElementById('shown');
function apply(){var v=q?q.value.trim().toLowerCase().replace(/^\\./,''):'',n=0;
 document.querySelectorAll('#all tbody tr').forEach(function(r){
  var ok=(!v||r.dataset.tld.indexOf(v)!==-1||(r.dataset.u||'').indexOf(v)!==-1)&&(mode==='all'||(mode==='spike'&&r.dataset.spike)||(mode==='abuse'&&r.dataset.abuse)||(mode==='grow'&&r.dataset.grow));
  r.style.display=ok?'':'none';if(ok)n++});if(cnt)cnt.textContent=n.toLocaleString()}
if(q)q.addEventListener('input',apply);
segs.forEach(function(b){b.addEventListener('click',function(){segs.forEach(function(o){o.setAttribute('aria-pressed','false')});b.setAttribute('aria-pressed','true');mode=b.dataset.mode;apply()})});
})();
"""

LOGO = (
    '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">'
    '<rect width="26" height="26" rx="7" fill="var(--ink)"/>'
    '<path d="M5 18.5 10 14l4 2.5 7-9" stroke="var(--panel)" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
    '<circle cx="21" cy="7.5" r="2.6" fill="var(--critical)"/></svg>'
)
FAVICON = (
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 26 26'%3E%3Crect width='26' height='26' rx='7' fill='%230f1a2a'/%3E"
    "%3Cpath d='M5 18.5 10 14l4 2.5 7-9' stroke='white' stroke-width='2.4' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E"
    "%3Ccircle cx='21' cy='7.5' r='2.6' fill='%23d03b3b'/%3E%3C/svg%3E"
)


def page(title: str, body: str, *, active: str = "", depth: int = 0, description: str = "", trust: str = "",
         path: str = "", image: str = "og/site.png", jsonld: list[dict] | None = None, noindex: bool = False) -> str:
    root = "../" * depth
    desc = description or "Daily domain registration counts and trends for every top-level domain, from ICANN zone files."
    url = f"{SITE_URL}/{path}"
    graph = {"@context": "https://schema.org", "@graph": [ORG, WEBSITE] + (jsonld or [])}
    ld = json.dumps(graph, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    robots = "noindex,follow" if noindex else "index,follow,max-image-preview:large,max-snippet:-1"

    def link(href: str, label: str, key: str) -> str:
        cur = ' class="on" aria-current="page"' if key == active else ""
        return f'<a href="{root}{href}"{cur}>{label}</a>'

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<meta name="robots" content="{robots}">
<link rel="canonical" href="{esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="RootFetch">
<meta property="og:url" content="{esc(url)}">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:image" content="{SITE_URL}/{image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{esc(title)}">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(desc)}">
<meta name="twitter:image" content="{SITE_URL}/{image}">
<meta name="theme-color" content="#14243f">
<script type="application/ld+json">{ld}</script>
{GA_HEAD}
<link rel="alternate" type="application/rss+xml" title="RootFetch spikes" href="{SITE_URL}/feed.xml">
<link rel="icon" href="{FAVICON}">
<link rel="apple-touch-icon" href="{SITE_URL}/og/logo.png">
<link rel="sitemap" type="application/xml" href="{SITE_URL}/sitemap.xml">
{FONTS}
<style>{CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="wrap">
<a class="brand" href="{root}index.html">RootFetch<span>domain extensions, counted daily</span></a>
<nav aria-label="Main">{link("index.html", "Trends", "home")}{link("tlds.html", "All extensions", "tlds")}{link("spikes.html", "Unusual jumps", "spikes")}{link("data.html", "Data", "data")}{link("about.html", "About", "about")}</nav>
</div></header>
<div class="wrap">{trust}</div>
<main id="main" class="wrap">
{body}
</main>
<footer><div class="wrap"><span>RootFetch counts the domains in ICANN zone files every day. Raw zone files are never published.</span>
<a href="{root}data.html">Download the data</a><a href="{root}feed.xml">RSS feed</a><a href="{REPO_URL}">Source code</a></div></footer>
<div id="tip" role="tooltip"></div>
<script>{JS}</script>
{GA_EVENTS}
</body>
</html>
"""


# ---------- charts ----------

def sparkline(points: list[tuple[str, int]], w: int = 88, h: int = 26, color: str = "var(--ink-2)", mark: str | None = None) -> str:
    pts = points[-12:]
    if len(pts) < 2:
        return ""
    vals = [v for _, v in pts]
    lo, hi = min(vals), max(vals)
    span = hi - lo or 1
    d0 = date.fromisoformat(pts[0][0]).toordinal()
    d1 = date.fromisoformat(pts[-1][0]).toordinal()
    xs = [2 + (date.fromisoformat(d).toordinal() - d0) / max(1, d1 - d0) * (w - 6) for d, _ in pts]
    ys = [h - 3 - (v - lo) / span * (h - 6) for v in vals]
    line = " ".join(f"{x:.1f},{y:.1f}" for x, y in zip(xs, ys))
    end = mark or color
    return (
        f'<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}" aria-hidden="true" preserveAspectRatio="none">'
        f'<polyline points="{line}" fill="none" stroke="{color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>'
        f'<circle cx="{xs[-1]:.1f}" cy="{ys[-1]:.1f}" r="2.6" fill="{end}"/></svg>'
    )


def radar_chart(entries: list[tuple[Change, str]], recent_cut: str, depth: int = 0) -> str:
    """Scatter of every sizable TLD: x = size (log), y = growth per week at its latest check."""
    w, h, pl, pr, pt, pb = 1060, 440, 56, 24, 34, 40
    sizes = [c.count for c, _ in entries]
    xlo = math.floor(math.log10(max(RADAR_MIN_DOMAINS, min(sizes))))
    xhi = math.log10(max(sizes)) + 0.15
    ws = sorted(c.weekly for c, _ in entries)
    ylo = max(-0.12, min(-0.04, ws[max(0, int(len(ws) * 0.01))]))
    # Scale to the bulk of TLDs. A handful of brand-new extensions can grow thousands of percent
    # from a tiny base; those are pinned to the top edge with an arrow instead of squashing everyone else.
    yhi = min(0.5, max(0.12, ws[min(len(ws) - 1, int(len(ws) * 0.98))] * 1.3))
    yhi = max(yhi, min(0.5, max((v for v in ws if v <= 0.5), default=0.12) * 1.08))

    def x(n: float) -> float:
        return pl + (math.log10(n) - xlo) / (xhi - xlo) * (w - pl - pr)

    def y(v: float) -> float:
        v = min(max(v, ylo), yhi)
        return pt + (1 - (v - ylo) / (yhi - ylo)) * (h - pt - pb)

    parts = []
    # unusual-growth zone: where a two-week check would clear the spike threshold
    zone = (1 + SPIKE_MIN_PCT) ** (7 / 14) - 1
    parts.append(
        f'<rect x="{pl}" y="{pt}" width="{w - pl - pr}" height="{y(zone) - pt:.1f}" fill="var(--critical)" opacity=".06"/>'
        f'<line x1="{pl}" x2="{w - pr}" y1="{y(zone):.1f}" y2="{y(zone):.1f}" stroke="var(--critical)" stroke-dasharray="3 4" opacity=".55"/>'
        f'<text class="zone-t" x="{w - pr}" y="{pt - 10}" text-anchor="end">UNUSUAL GROWTH ↑</text>'
    )
    # y grid
    step = next(s_ for s_ in (0.01, 0.02, 0.05, 0.1, 0.2, 0.5) if (yhi - ylo) / s_ <= 6)
    v = math.ceil(ylo / step) * step
    while v <= yhi + 1e-9:
        yy = y(v)
        stroke = "var(--ink-2)" if abs(v) < 1e-9 else "var(--line-2)"
        parts.append(
            f'<line x1="{pl}" x2="{w - pr}" y1="{yy:.1f}" y2="{yy:.1f}" stroke="{stroke}" stroke-width="{1 if abs(v) < 1e-9 else 1}"/>'
            f'<text class="axis-t" x="{pl - 8}" y="{yy + 4:.1f}" text-anchor="end">{v * 100:+.0f}%</text>'
        )
        v += step
    for p in range(xlo, math.floor(xhi) + 1):
        xx = x(10 ** p)
        parts.append(
            f'<line x1="{xx:.1f}" x2="{xx:.1f}" y1="{pt}" y2="{h - pb}" stroke="var(--line-2)"/>'
            f'<text class="axis-t" x="{xx:.1f}" y="{h - pb + 18}" text-anchor="middle">{fmt_compact(10 ** p)}</text>'
        )
    parts.append(
        f'<text class="axis-t" x="{(pl + w - pr) / 2:.0f}" y="{h - 4}" text-anchor="middle">domains registered (log scale) →</text>'
        f'<text class="axis-t" x="{pl - 44}" y="{pt - 10}">growth / week</text>'
    )

    def live(c: Change):
        return c.severity if c.severity and c.date > recent_cut else None

    # plain dots first, flagged ones on top
    ordered = sorted(entries, key=lambda e: (e[0].severity is not None, live(e[0]) is not None, e[0].weekly))
    root = "../" * depth
    dots, labels = [], []
    for c, _ in ordered:
        sev, now = c.severity, live(c)
        cx, cy = x(c.count), y(c.weekly)
        if now:
            fill, stroke, r = f"var(--{now[0]})", "var(--panel)", 6
        elif sev:
            fill, stroke, r = "var(--panel)", f"var(--{sev[0]})", 4.5
        else:
            fill, stroke, r = "var(--dot)", "var(--panel)", 3.6
        tip = (
            f".{unicode_name(c.tld)}  {fmt_int(c.count)} domains\n"
            f"{fmt_signed(c.added)} ({fmt_pct(c.pct)}) in {days(c.gap_days)}\n"
            f"≈ {fmt_pct(c.weekly)} per week · checked {fmt_day(c.date, False)}"
            + (f"\n{sev[1]} spike" if sev else "")
        )
        halo = f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r + 5}" fill="{fill}" opacity=".18"/>' if now else ""
        if c.weekly > yhi:
            ay = pt + 4
            dots.append(
                f'<a class="pt" href="{root}tld/{esc(c.tld)}.html" aria-label="{esc(tip + chr(10) + "off the chart")}">'
                f'<circle cx="{cx:.1f}" cy="{ay + 4:.1f}" r="14" fill="transparent"/>'
                f'<path class="m" d="M{cx:.1f},{ay:.1f} l6,10 h-12 z" fill="var(--ink-2)"/></a>'
            )
            labels.append((3, c.weekly, c, cx, ay + 6))
            continue
        dots.append(
            f'<a class="pt" href="{root}tld/{esc(c.tld)}.html" aria-label="{esc(tip)}">'
            f'{halo}<circle cx="{cx:.1f}" cy="{cy:.1f}" r="14" fill="transparent"/>'
            f'<circle class="m" cx="{cx:.1f}" cy="{cy:.1f}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{2 if sev and not now else 1.5}"/></a>'
        )
        labels.append((2 if now else 1 if sev else 0, c.weekly, c, cx, cy))

    # greedy label placement: most important first, skip any that would collide
    placed: list[tuple[float, float, float, float]] = []
    blocked = [(cx - 5, cy - 5, cx + 5, cy + 5) for _, _, c, cx, cy in labels if c.severity]
    shown = 0
    for prio, _, c, cx, cy in sorted(labels, key=lambda t: (-t[0], -t[1])):
        if prio == 0 and shown >= 9:
            break
        text = "." + unicode_name(c.tld) + (f" {fmt_pct(c.pct, 0)}" if c.weekly > yhi else "")
        tw = 7.4 * len(text) + 4
        for dx, dy, anchor in ((10, 4, "start"), (-10, 4, "end"), (0, -12, "middle"), (0, 18, "middle")):
            x0 = cx + dx if anchor == "start" else cx + dx - tw if anchor == "end" else cx - tw / 2
            box = (x0, cy + dy - 11, x0 + tw, cy + dy + 3)
            if box[0] < pl or box[2] > w - pr + 10 or box[1] < pt:
                continue
            hit = any(not (box[2] < b[0] or box[0] > b[2] or box[3] < b[1] or box[1] > b[3]) for b in placed)
            hit = hit or any(not (box[2] < b[0] or box[0] > b[2] or box[3] < b[1] or box[1] > b[3]) for b in blocked if not (b[0] < cx < b[2] and b[1] < cy < b[3]))
            if not hit:
                placed.append(box)
                parts_lab = f'<text class="lab" x="{cx + dx:.1f}" y="{cy + dy:.1f}" text-anchor="{anchor}">{esc(text)}</text>'
                dots.append(parts_lab)
                shown += 1
                break
    parts.extend(dots)
    return (
        f'<svg viewBox="0 0 {w} {h}" role="img" aria-label="Growth per week against size for {len(entries)} top-level domains">'
        f'{"".join(parts)}</svg>'
    )


def history_chart(points: list[tuple[str, int]], changes: dict[str, Change]) -> str:
    if len(points) < 2:
        return '<p class="muted">One check so far. A chart appears after the next one.</p>'
    w, h, pl, pr, pt, pb = 1060, 300, 70, 20, 18, 34
    d0 = date.fromisoformat(points[0][0]).toordinal()
    d1 = date.fromisoformat(points[-1][0]).toordinal()
    vals = [v for _, v in points]
    lo, hi = min(vals), max(vals)
    if lo == hi:
        lo, hi = lo - 1, hi + 1
    pad = (hi - lo) * 0.1
    lo, hi = max(0, lo - pad), hi + pad

    def x(iso: str) -> float:
        return pl + (date.fromisoformat(iso).toordinal() - d0) / max(1, d1 - d0) * (w - pl - pr)

    def y(v: float) -> float:
        return pt + (1 - (v - lo) / (hi - lo)) * (h - pt - pb)

    parts = []
    for i in range(5):
        v = lo + (hi - lo) * i / 4
        yy = y(v)
        parts.append(
            f'<line x1="{pl}" x2="{w - pr}" y1="{yy:.1f}" y2="{yy:.1f}" stroke="var(--line-2)"/>'
            f'<text class="axis-t" x="{pl - 10}" y="{yy + 4:.1f}" text-anchor="end">{tick_label(v, hi - lo)}</text>'
        )
    # month ticks
    cur = date.fromordinal(d0).replace(day=1)
    while cur.toordinal() <= d1:
        if cur.toordinal() >= d0:
            xx = pl + (cur.toordinal() - d0) / max(1, d1 - d0) * (w - pl - pr)
            parts.append(f'<text class="axis-t" x="{xx:.1f}" y="{h - 10}" text-anchor="middle">{cur.strftime("%b")}</text>')
        cur = (cur + timedelta(days=32)).replace(day=1)
    # gaps longer than 21 days are drawn dashed: we didn't see what happened in between
    for (da, va), (db, vb) in zip(points, points[1:]):
        gap = (date.fromisoformat(db) - date.fromisoformat(da)).days
        dash = ' stroke-dasharray="4 5" opacity=".6"' if gap > SPIKE_MAX_GAP_DAYS else ""
        parts.append(
            f'<line x1="{x(da):.1f}" y1="{y(va):.1f}" x2="{x(db):.1f}" y2="{y(vb):.1f}" stroke="var(--signal)" stroke-width="2" stroke-linecap="round"{dash}/>'
        )
    for d, v in points:
        c = changes.get(d)
        sev = c.severity if c else None
        fill = f"var(--{sev[0]})" if sev else "var(--signal)"
        r = 6 if sev else 4
        tip = f"{fmt_day(d)}\n{fmt_int(v)} domains"
        if c:
            tip += f"\n{fmt_signed(c.added)} ({fmt_pct(c.pct)}) since {fmt_day(c.prev_date, False)}"
        if sev:
            tip += f"\n{sev[1]} spike"
        parts.append(
            f'<g class="pt" tabindex="0" aria-label="{esc(tip)}">'
            f'<circle cx="{x(d):.1f}" cy="{y(v):.1f}" r="13" fill="transparent"/>'
            f'<circle class="m" cx="{x(d):.1f}" cy="{y(v):.1f}" r="{r}" fill="{fill}" stroke="var(--panel)" stroke-width="2"/></g>'
        )
    return f'<svg viewBox="0 0 {w} {h}" role="img" aria-label="Domain count over time">{"".join(parts)}</svg>'



def bar_board(title: str, note: str, rows: list[tuple[str, float, str]], color: str, depth: int = 0) -> str:
    """Ranked horizontal bars: (tld, value, value label). Length encodes magnitude."""
    if not rows:
        return f'<div class="board"><h3>{esc(title)}</h3><p class="count">Not enough recent checks yet.</p></div>'
    mx = max(abs(v) for _, v, _ in rows) or 1
    root = "../" * depth
    items = "".join(
        f'<li><a href="{root}tld/{esc(t)}.html"><span class="bn">.{esc(unicode_name(t))}</span>'
        f'<span class="bt"><span class="bb" style="width:{max(2, abs(v) / mx * 100):.1f}%;background:{color}"></span></span>'
        f'<span class="bv">{esc(lab)}</span></a></li>'
        for t, v, lab in rows
    )
    return f'<div class="board"><h3>{esc(title)}</h3><p class="count">{esc(note)}</p><ol>{items}</ol></div>'


def mini_line(points: list[tuple[str, float]], w: int, h: int, lo: float, hi: float, d0: int, d1: int,
              color: str = "var(--signal)", base: float | None = None) -> str:
    """Small line chart on a shared scale; gaps over SPIKE_MAX_GAP_DAYS are dashed."""
    def x(iso: str) -> float:
        return 2 + (date.fromisoformat(iso).toordinal() - d0) / max(1, d1 - d0) * (w - 4)

    def y(v: float) -> float:
        v = min(max(v, lo), hi)
        return h - 2 - (v - lo) / ((hi - lo) or 1) * (h - 4)

    parts = []
    if base is not None:
        parts.append(f'<line x1="0" x2="{w}" y1="{y(base):.1f}" y2="{y(base):.1f}" stroke="var(--line)" stroke-dasharray="2 3"/>')
    for (da, va), (db, vb) in zip(points, points[1:]):
        gap = (date.fromisoformat(db) - date.fromisoformat(da)).days
        dash = ' stroke-dasharray="3 4" opacity=".55"' if gap > SPIKE_MAX_GAP_DAYS else ""
        parts.append(f'<line x1="{x(da):.1f}" y1="{y(va):.1f}" x2="{x(db):.1f}" y2="{y(vb):.1f}" stroke="{color}" stroke-width="2" stroke-linecap="round"{dash}/>')
    if points:
        d, v = points[-1]
        parts.append(f'<circle cx="{x(d):.1f}" cy="{y(v):.1f}" r="3" fill="{color}"/>')
    return f'<svg viewBox="0 0 {w} {h}" preserveAspectRatio="none" aria-hidden="true">{"".join(parts)}</svg>'


def pulse_panel(tld: str, pts: list[tuple[str, int]]) -> str:
    """Daily-checked TLD: count line plus the daily net change as bars underneath."""
    w, h, bh = 340, 90, 46
    d0 = date.fromisoformat(pts[0][0]).toordinal()
    d1 = date.fromisoformat(pts[-1][0]).toordinal()
    vals = [v for _, v in pts]
    lo, hi = min(vals), max(vals)
    line = mini_line(pts, w, h, lo - (hi - lo) * 0.05, hi + (hi - lo) * 0.05, d0, d1)
    diffs = []
    for (da, va), (db, vb) in zip(pts, pts[1:]):
        if (date.fromisoformat(db) - date.fromisoformat(da)).days == 1:
            diffs.append((db, vb - va))
    bars = ""
    if diffs:
        mx = max(abs(v) for _, v in diffs) or 1
        bw = max(2.0, (w - 4) / max(1, d1 - d0) * 0.8)
        mid = bh / 2
        rects = []
        for d, v in diffs:
            bx = 2 + (date.fromisoformat(d).toordinal() - d0) / max(1, d1 - d0) * (w - 4) - bw / 2
            hh = abs(v) / mx * (mid - 2)
            by = mid - hh if v >= 0 else mid
            fill = "var(--signal)" if v >= 0 else "var(--fall)"
            tip = f"{fmt_day(d)}: {fmt_signed(v)} domains"
            rects.append(f'<rect x="{bx:.1f}" y="{by:.1f}" width="{bw:.1f}" height="{max(1, hh):.1f}" rx="1" fill="{fill}" data-tip="{esc(tip)}"/>')
        bars = (
            f'<svg viewBox="0 0 {w} {bh}" preserveAspectRatio="none" aria-label="Daily net change">'
            f'<line x1="0" x2="{w}" y1="{mid}" y2="{mid}" stroke="var(--line)"/>{"".join(rects)}</svg>'
        )
    first_v, last_v = pts[0][1], pts[-1][1]
    recent = [v for _, v in diffs[-7:]]
    avg = sum(recent) / len(recent) if recent else 0
    return (
        f'<a class="pulse" href="tld/{esc(tld)}.html"><div class="row"><span class="pn">.{esc(tld)}</span>'
        f'<span class="pv">{fmt_int(last_v)}</span></div>'
        f'<p class="count">{fmt_pct((last_v - first_v) / first_v if first_v else 0)} since {fmt_day(pts[0][0], False)}, '
        f'averaging {fmt_signed(round(avg))} domains a day over the last week of checks.</p>'
        f'<div class="pl">{line}</div><div class="pb">{bars}</div>'
        f'<div class="row count"><span>{fmt_day(pts[0][0], False)}</span><span>net change per day</span><span>{fmt_day(pts[-1][0], False)}</span></div></a>'
    )


# ---------- per-TLD written content ----------

def _pick(tld: str, options: list[str]) -> str:
    """Stable choice between phrasings, so pages don't all read the same."""
    return options[sum(map(ord, tld)) % len(options)]


def _script_name(text: str) -> str:
    import unicodedata
    for ch in text:
        if ch.isalpha():
            name = unicodedata.name(ch, "")
            for script in ("CYRILLIC", "ARABIC", "HEBREW", "GREEK", "DEVANAGARI", "THAI", "HANGUL", "HIRAGANA", "KATAKANA", "GEORGIAN", "ARMENIAN", "BENGALI", "TAMIL", "TELUGU", "GUJARATI", "GURMUKHI", "KANNADA", "MALAYALAM", "SINHALA", "LAO", "KHMER", "ETHIOPIC"):
                if name.startswith(script):
                    return script.title()
            if name.startswith("CJK"):
                return "Chinese"
    return ""


def _years(since: str, until: date) -> float:
    return (until - date.fromisoformat(since)).days / 365.25


def _month_rows(ordered: list[tuple[str, int]]) -> list[tuple[str, int, int | None]]:
    """Last count seen in each calendar month, with change from the previous month that has data."""
    last: dict[str, int] = {}
    for d, v in ordered:
        last[d[:7]] = v
    out, prev = [], None
    for m in sorted(last):
        out.append((m, last[m], None if prev is None else last[m] - prev))
        prev = last[m]
    return out


def tld_story(tld: str, u: str, ordered: list[tuple[str, int]], cs: list["Change"], meta: dict | None,
              series: dict[str, dict[str, int]], by_size: list[str], size_rank: dict[str, int],
              big_weekly: list[float], long_term: dict[str, float], today: date) -> tuple[str, list[tuple[str, str]]]:
    """Unique, data-backed sections and extra FAQ entries for one TLD page."""
    last_d, last_v = ordered[-1]
    first_d, first_v = ordered[0]
    sections: list[str] = []
    faq: list[tuple[str, str]] = []
    name = f".{u}"
    latest = cs[-1] if cs else None

    # --- about: registry facts from ICANN ---
    if meta:
        op = meta.get("operator") or "an unnamed registry"
        delegated = meta.get("delegated")
        signed = meta.get("signed")
        script = _script_name(u) if u != tld else ""
        lines = []
        if delegated and delegated <= "1990-12-31":
            lines.append(f"{name} is one of the original top-level domains, in the internet's root zone since {date.fromisoformat(delegated).year}. "
                         f"Today it is operated by <b>{esc(op)}</b>.")
        elif delegated:
            age = _years(delegated, today)
            lines.append(_pick(tld, [
                f"{name} has been in the internet's root zone since <b>{fmt_day(delegated)}</b>, about {age:.1f} years, and is operated by <b>{esc(op)}</b>.",
                f"<b>{esc(op)}</b> runs {name}, which went live in the root zone on <b>{fmt_day(delegated)}</b> ({age:.1f} years ago).",
                f"The registry behind {name} is <b>{esc(op)}</b>. The extension was delegated to the root zone on <b>{fmt_day(delegated)}</b>, {age:.1f} years ago.",
            ]))
            if signed and signed < delegated:
                gap = (date.fromisoformat(delegated) - date.fromisoformat(signed)).days
                lines.append(f"Its ICANN registry agreement was signed on {fmt_day(signed)}, {gap} days before launch.")
        if script:
            lines.append(f"It is an internationalized domain name (IDN), written in {script} script as <b>.{esc(u)}</b>; "
                         f"in the DNS it appears as <code>{esc(tld)}</code>.")
        if meta.get("brand"):
            lines.append(f"{name} is a <b>brand TLD</b>: under Specification 13 of its ICANN agreement, only {esc(op)} and its affiliates "
                         "can register names in it. That is why its domain count stays small and mostly reflects the company's own sites.")
            faq.append((f"Can anyone register a .{u} domain?",
                        f"No. .{u} is a brand TLD under Specification 13 of its ICANN registry agreement, so only {op} and its affiliates can register .{u} names."))
        else:
            faq.append((f"Can anyone register a .{u} domain?", _pick(tld + "x", [
                f"Generally yes: .{u} has no brand-only clause in its ICANN agreement, so registrars sell it to the public. {op} can still apply eligibility rules.",
                f".{u} is open to the public through registrars; it is not a Specification 13 brand TLD. Check {op}'s policies for any restrictions.",
                f"Yes, unless {op} sets its own limits. .{u} is a generic extension, not a company-only brand TLD.",
            ])))
        faq.append((f"Who runs the .{u} domain extension?", _pick(tld + "w", [f"{op}.", f"The registry operator is {op}.", f".{u} is run by {op}."])))
        if delegated and delegated > "1990-12-31":
            faq.append((f"When was .{u} created?", _pick(tld + "d", [
                f"It was delegated on {fmt_day(delegated)}.", f"{fmt_day(delegated)}, when it entered the root zone.",
                f".{u} went live in the DNS root on {fmt_day(delegated)}."])))
        sections.append(f'<section class="section prose"><h2>About the .{esc(u)} extension</h2><p>{" ".join(lines)}</p>'
                        f'<p class="count">Source: <a href="https://www.icann.org/resources/registries/gtlds/v2/gtlds.json">ICANN</a></p></section>')

        # --- family: other TLDs from the same operator ---
        fam = [t for t in by_size if t != tld and (series_meta := _META.get(t)) and series_meta.get("operator") == op]
        if fam:
            fam_total = sum(series[t][max(series[t])] for t in fam) + last_v
            pos = 1 + sum(1 for t in fam if series[t][max(series[t])] > last_v)
            share = last_v / fam_total if fam_total else 0
            items = "".join(
                f'<li><a href="{esc(t)}.html"><span class="tld">.{esc(unicode_name(t))}</span>'
                f'<span class="count">{fmt_compact(series[t][max(series[t])])}</span></a></li>' for t in fam[:12]
            )
            more = f" The largest are listed below." if len(fam) > 12 else ""
            sections.append(
                f'<section class="section"><h2>Other extensions run by {esc(op)}</h2>'
                f'<p class="prose-p">{esc(op)} operates <b>{len(fam) + 1}</b> of the TLDs RootFetch tracks, holding {fmt_int(fam_total)} domains in total. '
                f'{name} is <b>#{pos}</b> of them by size, with {share:.1%} of the group\'s domains.{more}</p>'
                f'<ul class="related">{items}</ul></section>'
            )

    # --- comparison with every other TLD ---
    comp = []
    pct_size = 1 - (size_rank[tld] - 1) / max(1, len(by_size) - 1)
    comp.append(_pick(tld + "c", [
        f"By size, {name} sits ahead of {pct_size:.0%} of tracked TLDs.",
        f"{name} is bigger than {pct_size:.0%} of the TLDs in this dataset.",
        f"In domain count, {name} outranks {pct_size:.0%} of the extensions RootFetch follows.",
    ]))
    if tld in long_term and long_term:
        vals = sorted(long_term.values())
        med = vals[len(vals) // 2]
        g = long_term[tld]
        better = sum(1 for v in vals if v < g) / len(vals)
        comp.append(f"Since {fmt_day(first_d, False)} it has changed {fmt_pct(g)}, against a median of {fmt_pct(med)} for large TLDs tracked as long, "
                    f"which puts it ahead of {better:.0%} of them.")
    if latest and latest.gap_days <= 60 and big_weekly and latest.prev_count >= 10000:
        faster = sum(1 for v in big_weekly if v < latest.weekly) / len(big_weekly)
        comp.append(f"Its latest weekly rate, {fmt_pct(latest.weekly)}, is faster than {faster:.0%} of large TLDs right now.")
    i = size_rank[tld] - 1
    peers = [t for t in by_size[max(0, i - 5): i + 6] if t != tld]
    peer_growth = []
    for t in peers:
        p = sorted(series[t].items())
        if len(p) > 1 and p[0][1]:
            peer_growth.append((p[-1][1] / p[0][1] - 1, t))
    if peer_growth and len(ordered) > 1 and first_v:
        mine = last_v / first_v - 1
        beats = sum(1 for g, _ in peer_growth if g < mine)
        best = max(peer_growth)
        comp.append(_pick(tld + "p", [f"Among the {len(peer_growth)} TLDs closest to it in size, {name} grew faster than {beats}; ",
                                f"Next to its {len(peer_growth)} nearest-sized neighbours, {name} out-grew {beats}; ",
                                f"{name} beat {beats} of the {len(peer_growth)} similar-sized TLDs on growth; "]) + f"the fastest of that group was <a href=\"{esc(best[1])}.html\">.{esc(unicode_name(best[1]))}</a> at {fmt_pct(best[0])}.")
    sections.append(f'<section class="section prose"><h2>How .{esc(u)} compares</h2><p>{" ".join(comp)}</p></section>')

    # --- biggest moves between checks ---
    if len(cs) >= 2:
        up = max(cs, key=lambda c: c.added)
        down = min(cs, key=lambda c: c.added)
        grew = sum(1 for c in cs if c.added > 0)
        fell = sum(1 for c in cs if c.added < 0)
        flat = len(cs) - grew - fell
        def n_of(n: int, one: str, many: str) -> str:
            return f"{n} {one if n == 1 else many}"
        moves = [f"Of {len(cs)} changes between checks, {n_of(grew, 'was a gain', 'were gains')}, "
                 f"{n_of(fell, 'was a loss', 'were losses')} and {n_of(flat, 'showed no change', 'showed no change')}."]
        if up.added > 0:
            moves.append(f"The biggest gain was <b>{fmt_signed(up.added)}</b> domains ({fmt_pct(up.pct)}) between {fmt_day(up.prev_date)} and {fmt_day(up.date)}.")
        if down.added < 0:
            moves.append(f"The biggest drop was <b>{fmt_signed(down.added)}</b> ({fmt_pct(down.pct)}) between {fmt_day(down.prev_date)} and {fmt_day(down.date)}.")
        sections.append(f'<section class="section prose"><h2>Biggest moves</h2><p>{" ".join(moves)}</p></section>')

    # --- long-run trend, from this TLD's own numbers ---
    months = _month_rows(ordered)
    total_all = sum(series[t][max(series[t])] for t in series)
    span = (date.fromisoformat(last_d) - date.fromisoformat(first_d)).days
    trend = []
    if total_all:
        share = last_v / total_all
        trend.append(_pick(tld + "s", [
            f"{name} accounts for {share:.2%} of all {fmt_compact(total_all)} domains RootFetch counts.",
            f"Its {fmt_int(last_v)} names are {share:.2%} of the {fmt_compact(total_all)} domains across every tracked extension.",
            f"That is a {share:.2%} slice of the {fmt_compact(total_all)} domains in the whole dataset.",
        ]))
    if span >= 14 and first_v > 0 and last_v > 0:
        avg_week = (last_v / first_v) ** (7 / span) - 1
        per_day = (last_v - first_v) / span
        trend.append(f"Over the {span} days from {fmt_day(first_d, False)} to {fmt_day(last_d, False)} it averaged "
                     f"<b>{fmt_pct(avg_week, 2)}</b> a week, or {fmt_signed(round(per_day))} domains a day.")
        changes = [(m, ch) for m, _, ch in months if ch is not None]
        if len(changes) >= 2:
            hi = max(changes, key=lambda x: x[1])
            lo = min(changes, key=lambda x: x[1])
            month_name = lambda m: date.fromisoformat(m + "-01").strftime("%B %Y")
            if hi[1] != lo[1]:
                trend.append(_pick(tld + "hm", [
                    f"Its strongest month on record was {month_name(hi[0])} ({fmt_signed(hi[1])}); its weakest was {month_name(lo[0])} ({fmt_signed(lo[1])}).",
                    f"{month_name(hi[0])} was its best month ({fmt_signed(hi[1])}), {month_name(lo[0])} its worst ({fmt_signed(lo[1])}).",
                    f"The biggest monthly gain came in {month_name(hi[0])} ({fmt_signed(hi[1])}) and the weakest month was {month_name(lo[0])} ({fmt_signed(lo[1])}).",
                ]))
        if latest and latest.gap_days <= 60 and latest.prev_count:
            proj = last_v * (1 + latest.weekly) ** (30 / 7)
            trend.append(_pick(tld + "pj", [
                f"If the latest rate held for 30 days, {name} would reach about {fmt_int(round(proj))} domains (a straight-line projection, not a forecast).",
                f"At this pace it would be near {fmt_int(round(proj))} domains in a month, assuming nothing changes.",
            ]))
    if trend:
        sections.append(f'<section class="section prose"><h2>.{esc(u)} growth trend</h2><p>{" ".join(trend)}</p></section>')

    # --- month by month ---
    if len(months) >= 2:
        rows = "".join(
            f'<tr><td>{date.fromisoformat(m + "-01").strftime("%B %Y")}</td><td class="n">{fmt_int(v)}</td>'
            f'<td class="n {trend_class(ch or 0)}">{fmt_signed(ch) if ch is not None else "–"}</td></tr>'
            for m, v, ch in reversed(months)
        )
        sections.append(
            f'<section class="section"><h2>.{esc(u)} domains by month</h2>'
            f'<div class="tablebox" style="margin-top:12px"><table><thead><tr><th>Month</th><th class="n">Domains</th><th class="n">Change</th></tr></thead>'
            f'<tbody>{rows}</tbody></table></div></section>'
        )
    return "".join(sections), faq


_META: dict[str, dict] = {}


def load_meta() -> dict[str, dict]:
    path = REPO_ROOT / "data" / "tld_meta.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text()).get("tlds", {})


_WIKI: dict[str, dict] = {}


def load_wiki() -> dict[str, dict]:
    path = REPO_ROOT / "data" / "tld_wiki.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text()).get("tlds", {})


def tld_answers(tld: str, u: str, last_v: int, rank: int, total: int, meta: dict | None, wiki: dict | None,
                tspikes: list["Change"], latest: "Change | None", median_weekly: float) -> tuple[str, str, list[tuple[str, str]], str]:
    """Direct answers to what people search about a TLD: what it is, is it safe, is it a country domain.

    Returns (lede html, answers html, faq entries, short kind label). Only states what ICANN, Wikipedia
    or RootFetch's own counts support.
    """
    name = f".{u}"
    op = (meta or {}).get("operator") or ""
    brand = bool((meta or {}).get("brand"))
    delegated = (meta or {}).get("delegated")
    wiki = wiki or {}
    geo = wiki.get("geo")
    if brand:
        kind = "brand extension"
    elif geo:
        kind = "geographic extension"
    elif delegated and delegated <= "1990-12-31":
        kind = "original generic extension"
    else:
        kind = "generic extension"

    # --- meaning, only when a source states it ---
    meaning = ""
    if wiki.get("translation"):
        meaning = f"The name means &ldquo;{esc(wiki['translation'])}&rdquo;."
    elif geo:
        meaning = f"It is meant for {esc(geo)}."
    elif wiki.get("use"):
        meaning = f"Its intended use is {esc(wiki['use'].lower())}."
    elif brand and wiki.get("entity"):
        meaning = f"It belongs to {esc(wiki['entity'])}."

    # --- reputation, from RootFetch's own data plus published abuse reports ---
    listed = tld in KNOWN_ABUSE
    jumps = len(tspikes)
    fast = bool(latest and latest.gap_days <= 60 and latest.prev_count >= 1000
                and latest.weekly > max(0.01, 3 * median_weekly))
    signals = []
    if listed:
        signals.append(f'it is named in <a href="{KNOWN_ABUSE[tld]}">Interisle Consulting Group\'s abuse reports</a>')
    if jumps:
        signals.append(f'RootFetch recorded {jumps} unusual registration jump{"s" if jumps != 1 else ""} '
                       f'(bursts of {fmt_int(SPIKE_MIN_ADDED)}+ new domains), a pattern that often comes with cheap promotions and bulk sign-ups')
    if fast:
        signals.append(f"it is growing about {fmt_pct(latest.weekly)} a week, far faster than a typical large extension")
    if brand:
        verdict, vclass = f"Low risk as an extension: only {esc(op) or 'its owner'} can register {name} names.", "ok"
    elif listed or jumps >= 2:
        verdict, vclass = _pick(tld + "w", [f"Use caution: {name} shows abuse signals.",
                                            f"Be careful with {name}: it shows signs of abuse.",
                                            f"{name} carries real abuse signals, so treat unknown links with care."]), "warn"
    elif signals:
        verdict, vclass = _pick(tld + "m", [f"Mixed: {name} shows some unusual activity.",
                                            f"Mostly fine, but {name} has had some unusual activity."]), "mixed"
    else:
        verdict, vclass = _pick(tld + "o", [f"No warning signs in RootFetch's data for {name}.",
                                            f"{name} looks clean in RootFetch's data: no bursts, no abuse-report mentions.",
                                            f"Nothing suspicious stands out for {name} in our counts."]), "ok"
    plain_signals = re.sub(r"<[^>]+>", "", "; ".join(signals))
    safety_body = (
        (f"<p>Signals: {'; '.join(signals)}.</p>" if signals else "")
        + "<p>" + _pick(tld + "v", [
            f"This describes {name} as a whole. Most domains in any extension are legitimate, so judge a specific "
            "website on its own: how old it is, who is behind it, and where the link came from.",
            f"That is a judgement about the extension, not any one site. A {name} address can be perfectly genuine; "
            "check the site's age, owner and how you found it.",
            f"None of this says a particular {name} website is good or bad. Look at the site itself: "
            "when it was registered, who runs it, and whether you trust where the link came from.",
        ]) + "</p>"
    )

    country = _pick(tld + "c2", [
        f"No. {name} is a {kind}, not a country-code domain; those are two letters, like .uk or .de.",
        f"No country is behind {name}. It is a {kind}" + (f" operated by {op}." if op else "."),
        f"{name} isn't tied to any country. Country-code extensions have two letters (.fr, .jp); {name} is a {kind}.",
    ])
    if geo:
        country = f"Not a country code, but it is a geographic extension for {geo}" + (f", run by {op}." if op else ".")

    lede = (f"<b>{name} is a {kind}</b>" + (f" run by <b>{esc(op)}</b>" if op else "")
            + (f", in the internet's root zone since {date.fromisoformat(delegated).year}" if delegated else "")
            + "." + (f" {meaning}" if meaning else "") + f" It has <b>{fmt_int(last_v)}</b> registered domains, <b>#{rank:,}</b> of {total:,} extensions RootFetch tracks.")
    answers = (
        f'<section class="section answers"><h2>Is {name} safe?</h2>'
        f'<p class="verdict verdict-{vclass}">{verdict}</p>{safety_body}'
        f'<h2>Is {name} a country domain?</h2><p>{esc(country)}</p></section>'
    )
    faq = [(f"Is .{u} safe or spam?", re.sub(r"<[^>]+>", "", verdict) + (f" Signals: {plain_signals}." if plain_signals else "")
            ),
           (f"Is .{u} a country domain?", country)]
    if meaning:
        faq.append((f"What does .{u} mean?", re.sub(r"<[^>]+>", "", html.unescape(meaning))))
    return lede, answers, faq, kind


# ---------- market map (squarified treemap) ----------

def _squarify(values: list[float], x: float, y: float, w: float, h: float) -> list[tuple[float, float, float, float]]:
    """Squarified treemap layout (Bruls et al.): values sorted descending, returns rects in input order."""
    rects: list[tuple[float, float, float, float]] = []
    vals = list(values)
    total = sum(vals) or 1.0
    scale = w * h / total
    areas = [v * scale for v in vals]

    def worst(row: list[float], side: float) -> float:
        s = sum(row)
        return max(max(side * side * r / (s * s), (s * s) / (side * side * r)) for r in row)

    i = 0
    while i < len(areas):
        side = min(w, h)
        row = [areas[i]]
        j = i + 1
        while j < len(areas) and worst(row + [areas[j]], side) <= worst(row, side):
            row.append(areas[j])
            j += 1
        s = sum(row)
        if w >= h:  # lay the row down the left edge
            cw = s / h if h else 0
            cy = y
            for a in row:
                ch = a / cw if cw else 0
                rects.append((x, cy, cw, ch))
                cy += ch
            x += cw
            w -= cw
        else:  # lay the row along the top edge
            ch = s / w if w else 0
            cx = x
            for a in row:
                cw2 = a / ch if ch else 0
                rects.append((cx, y, cw2, ch))
                cx += cw2
            y += ch
            h -= ch
        i = j
    return rects


def _growth_bin(weekly: float | None) -> str:
    if weekly is None:
        return "n0"
    for limit, name in ((-0.02, "d3"), (-0.005, "d2"), (-0.001, "d1")):
        if weekly <= limit:
            return name
    for limit, name in ((0.02, "g3"), (0.005, "g2"), (0.001, "g1")):
        if weekly >= limit:
            return name
    return "n0"


def market_map(entries: list["Change"], meta: dict[str, dict], depth: int = 0, groups_shown: int = 12,
               size: tuple[int, int] = (1040, 600), min_font: float = 10.0, cls: str = "") -> str:
    """Every sizable TLD as a tile: area = domains, colour = growth per week, grouped by registry operator."""
    (W, H), BAND, GAP = size, 18 * min_font / 10, 2
    root = "../" * depth
    by_op: dict[str, list["Change"]] = {}
    for c in entries:
        op = ((meta.get(c.tld) or {}).get("operator") or "Unknown registry").strip()
        by_op.setdefault(op, []).append(c)
    ops = sorted(by_op, key=lambda o: -sum(c.count for c in by_op[o]))
    groups = [(o, by_op[o]) for o in ops[:groups_shown]]
    rest = [c for o in ops[groups_shown:] for c in by_op[o]]
    if rest:
        groups.append((f"{len(ops) - groups_shown} other registries", rest))
    grects = _squarify([sum(c.count for c in g) for _, g in groups], 0, 0, W, H)
    out = []
    for (name, members), (gx, gy, gw, gh) in zip(groups, grects):
        members = sorted(members, key=lambda c: -c.count)
        band = BAND if gw >= 90 and gh >= 60 else 0
        out.append(f'<g class="grp">')
        if band:
            cw = 6.4 * min_font / 10
            label = name if len(name) * cw < gw - 8 else name[: max(3, int((gw - 14) / cw))] + "…"
            out.append(f'<text class="gl" x="{gx + 4:.1f}" y="{gy + band * 0.72:.1f}" font-size="{12 * min_font / 10:.0f}">{esc(label)}</text>')
        tiles = _squarify([c.count for c in members], gx, gy + band, gw, gh - band)
        for c, (x, y, w, h) in zip(members, tiles):
            weekly = c.weekly if c.gap_days <= 60 else None
            b = _growth_bin(weekly)
            x1, y1, w1, h1 = x + GAP / 2, y + GAP / 2, max(0.0, w - GAP), max(0.0, h - GAP)
            tip = (f".{unicode_name(c.tld)}: {fmt_int(c.count)} domains\n"
                   + (f"{fmt_pct(weekly)} a week at its latest check" if weekly is not None else "no recent growth figure")
                   + f"\nRun by {name if not name.endswith('registries') else ((meta.get(c.tld) or {}).get('operator') or 'unknown')}")
            lab = ""
            fs = max(min_font, min(30.0 * min_font / 10, (w1 * h1) ** 0.5 / 4.2, w1 / (len(unicode_name(c.tld)) + 1) * 1.6))
            if w1 >= fs * (len(unicode_name(c.tld)) + 1) * 0.62 and h1 >= fs * 1.5:
                lab = f'<text class="tl {b}" x="{x1 + 5:.1f}" y="{y1 + fs + 2:.1f}" font-size="{fs:.0f}">.{esc(unicode_name(c.tld))}</text>'
                if h1 >= fs + 18 * min_font / 10 and w1 >= 58 * min_font / 10 and weekly is not None:
                    lab += (f'<text class="tv {b}" x="{x1 + 5:.1f}" y="{y1 + fs + 17 * min_font / 10:.1f}" '
                            f'font-size="{11 * min_font / 10:.0f}">{fmt_pct(weekly)}/wk</text>')
            out.append(f'<a class="pt" href="{root}tld/{esc(c.tld)}.html" aria-label="{esc(tip)}">'
                       f'<rect class="t {b}" x="{x1:.1f}" y="{y1:.1f}" width="{w1:.1f}" height="{h1:.1f}" rx="2"/>{lab}</a>')
        out.append("</g>")
    return (f'<svg class="mmap {cls}" viewBox="0 0 {W} {H}" role="img" aria-label="Market map of {len(entries)} domain extensions: '
            f'size is registered domains, colour is growth per week, grouped by registry">{"".join(out)}</svg>')


MAP_LEGEND = (
    '<div class="mkey"><div class="mk-scale">'
    '<i class="d3"></i><i class="d2"></i><i class="d1"></i><i class="n0"></i><i class="g1"></i><i class="g2"></i><i class="g3"></i></div>'
    '<div class="mk-labels"><span>Shrinking</span><span>Steady</span><span>Growing</span></div>'
    '<p class="mk-note">The darkest shades mean 2% a week or more.</p></div>'
)


def _og_available() -> bool:
    try:
        import PIL  # noqa: F401
    except ImportError:
        print("Pillow not installed: skipping share images", file=sys.stderr)
        return False
    return True


def _og():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import og_images
    return og_images


# ---------- build ----------

def build(out_dir: Path, counts_dir: Path, today: date) -> dict:
    series = load_series(counts_dir)
    if not series:
        raise SystemExit(f"no counts found in {counts_dir}")

    all_changes = {tld: changes_for(tld, pts) for tld, pts in series.items()}
    _META.clear()
    _META.update(load_meta())
    _WIKI.clear()
    _WIKI.update(load_wiki())
    spikes = sorted(
        (c for cs in all_changes.values() for c in cs if c.is_spike()),
        key=lambda c: (c.date, c.added),
        reverse=True,
    )
    last_update = max(d for pts in series.values() for d in pts)
    last_day = date.fromisoformat(last_update)
    age_days = (today - last_day).days
    stale = age_days > STALE_AFTER_DAYS
    checked_latest = sum(1 for pts in series.values() if last_update in pts)
    total_domains = sum(pts[max(pts)] for pts in series.values())
    recent_cut = (last_day - timedelta(days=RECENT_DAYS)).isoformat()
    first_seen = min(d for pts in series.values() for d in pts)
    recent = [s for s in spikes if s.date > recent_cut]

    if out_dir.exists():
        shutil.rmtree(out_dir)
    (out_dir / "tld").mkdir(parents=True)
    (out_dir / "data").mkdir()

    if stale:
        trust = (f'<p class="trust stale" role="status">The newest data is {age_days} days old (last update {fmt_day(last_update)}). '
                 "Daily updates are behind.</p>")
    else:
        trust = (f'<p class="trust" role="status">Updated {fmt_day(last_update)}, when {checked_latest} of the '
                 f"{len(series):,} tracked zone files were counted.</p>")

    # ---------- radar ----------
    radar_entries = []
    for tld, cs in all_changes.items():
        if not cs:
            continue
        c = cs[-1]
        if c.count < RADAR_MIN_DOMAINS or (last_day - date.fromisoformat(c.date)).days > RADAR_MAX_AGE_DAYS:
            continue
        radar_entries.append((c, tld))
    flagged_now = [c for c, _ in radar_entries if c.severity and c.date > recent_cut]

    # ---------- trend metrics ----------
    # "Active" = latest check within RADAR_MAX_AGE_DAYS, previous check within 60 days of it.
    active = []
    for tld, cs in all_changes.items():
        if not cs:
            continue
        c = cs[-1]
        if (last_day - date.fromisoformat(c.date)).days > RADAR_MAX_AGE_DAYS or c.gap_days > 60:
            continue
        active.append(c)
    big = [c for c in active if c.prev_count >= 10000]
    per_week = {c.tld: c.added * 7 / c.gap_days for c in active}
    growing = [c for c in big if c.weekly > 0]
    shrinking = [c for c in big if c.weekly < 0]
    fastest = sorted(big, key=lambda c: -c.weekly)[:8]
    slowest = sorted(shrinking, key=lambda c: c.weekly)[:8]
    gains = sorted(big, key=lambda c: -per_week[c.tld])[:8]
    largest = sorted(
        (t for t, pts in series.items() if (last_day - date.fromisoformat(max(pts))).days <= RADAR_MAX_AGE_DAYS),
        key=lambda t: -series[t][max(series[t])],
    )

    # long-term: first check by mid-March, latest check within the active window
    long_term = []
    for tld, pts in series.items():
        ds = sorted(pts)
        if ds[0] <= "2026-03-15" and (last_day - date.fromisoformat(ds[-1])).days <= RADAR_MAX_AGE_DAYS and pts[ds[0]] >= 10000:
            long_term.append((pts[ds[-1]] / pts[ds[0]] - 1, tld, ds[0], ds[-1]))
    risers = sorted(long_term, reverse=True)[:8]
    fallers = sorted(long_term)[:8]

    # ---------- headline ----------
    lead_gain = gains[0] if gains else None
    if big and lead_gain:
        share = len(growing) / len(big)
        headline = (
            f"{len(growing)} of {len(big)} large domain extensions are growing. "
            f".{esc(unicode_name(lead_gain.tld))} leads, adding {fmt_compact(per_week[lead_gain.tld])} domains a week."
        )
    else:
        headline = "Domain counts for every top-level domain, day by day"
        share = 0
    takeaways = []
    if fastest:
        f0 = fastest[0]
        takeaways.append(f"<b>.{esc(unicode_name(f0.tld))}</b> is growing fastest at <b>{fmt_pct(f0.weekly)}</b> a week.")
    if risers:
        r0 = risers[0]
        takeaways.append(
            f"Since {fmt_day(r0[2], False)}, <b>.{esc(unicode_name(r0[1]))}</b> grew <b>{fmt_pct(r0[0], 0)}</b>, "
            f"from {fmt_compact(series[r0[1]][r0[2]])} to {fmt_compact(series[r0[1]][r0[3]])} domains."
        )
    if slowest:
        s0 = slowest[0]
        takeaways.append(f"<b>.{esc(unicode_name(s0.tld))}</b> is shrinking fastest at <b>{fmt_pct(s0.weekly)}</b> a week.")
    if recent:
        top = max(recent, key=lambda s: s.pct)
        takeaways.append(
            f"<b>{len({s.tld for s in recent})}</b> TLDs had unusual jumps in the last {RECENT_DAYS} days, "
            f"led by <b>.{esc(unicode_name(top.tld))}</b> ({fmt_pct(top.pct)})."
        )
    else:
        takeaways.append(f"No unusual registration jumps in the last {RECENT_DAYS} days.")

    # ---------- KPI tiles ----------
    kpis = [
        (fmt_compact(total_domains), "domains counted", f"across {len(series):,} TLDs"),
        (f"{share:.0%}" if big else "–", "of large TLDs growing", f"{len(growing)} up · {len(shrinking)} down"),
        (f"{fmt_compact(per_week[lead_gain.tld])}/wk" if lead_gain else "–", "biggest weekly gain",
         f".{unicode_name(lead_gain.tld)}" if lead_gain else ""),
        (str(len({s.tld for s in recent})), f"unusual jumps, last {RECENT_DAYS} days", f"{len(spikes)} since tracking began"),
    ]
    kpi_html = "".join(
        f'<div class="kpi"><b>{esc(v)}</b><span>{esc(lab)}</span><small>{esc(sub)}</small></div>' for v, lab, sub in kpis
    )

    # ---------- daily pulse ----------
    daily = [t for t in ("xyz", "app", "dev") if t in series and len(series[t]) > 5]
    pulse_html = "".join(pulse_panel(t, sorted(series[t].items())) for t in daily)

    # ---------- leaderboards ----------
    # brand-new extensions taking off: too small for the rankings above, but the most dramatic growth there is
    launches = []
    for t, cs_ in all_changes.items():
        if not cs_:
            continue
        c = cs_[-1]
        if ((last_day - date.fromisoformat(c.date)).days <= RECENT_DAYS and c.gap_days <= SPIKE_MAX_GAP_DAYS
                and c.prev_count >= 10 and c.count >= 500 and c.count >= 2 * c.prev_count):
            launches.append(c)
    launches.sort(key=lambda c: -c.count / c.prev_count)
    launch_html = ""
    if launches:
        launch_html = (
            '<section class="section" aria-labelledby="launch-h"><div class="section-head">'
            '<h2 id="launch-h">Just launched and taking off</h2>'
            f'<p>Extensions that at least doubled in size at their latest check, usually because they just opened to the public. '
            f'Too small for the rankings above, but the fastest growth in the dataset.</p></div>'
            '<div class="boards">'
            + bar_board("Times larger than at the previous check", f"{len(launches)} extension{'s' if len(launches) != 1 else ''}, last {RECENT_DAYS} days",
                        [(c.tld, c.count / c.prev_count, f"{fmt_int(c.prev_count)} to {fmt_int(c.count)}") for c in launches[:8]], "var(--signal)")
            + "</div></section>"
        )
    boards = "".join([
        bar_board("Fastest growing", "growth per week, TLDs with 10k+ domains",
                  [(c.tld, c.weekly, fmt_pct(c.weekly)) for c in fastest], "var(--signal)"),
        bar_board("Biggest gains", "new domains per week",
                  [(c.tld, per_week[c.tld], fmt_signed(round(per_week[c.tld]))) for c in gains], "var(--signal)"),
        bar_board("Shrinking fastest", "decline per week, TLDs with 10k+ domains",
                  [(c.tld, c.weekly, fmt_pct(c.weekly)) for c in slowest], "var(--fall)"),
        bar_board(f"Biggest risers since {fmt_day(risers[0][2], False) if risers else 'February'}", "total growth since first check",
                  [(t, g, fmt_pct(g, 0)) for g, t, _, _ in risers], "var(--signal)"),
        bar_board("Biggest fallers", "total decline since first check",
                  [(t, g, fmt_pct(g, 0)) for g, t, _, _ in fallers if g < 0], "var(--fall)"),
        bar_board("Largest TLDs", f"domains, checked in the last {RADAR_MAX_AGE_DAYS} days",
                  [(t, series[t][max(series[t])], fmt_compact(series[t][max(series[t])])) for t in largest[:8]], "var(--ink-2)"),
    ])

    # ---------- small multiples: the 12 largest, indexed ----------
    sm_tlds = [t for t in largest if sorted(series[t])[0] <= "2026-03-15" and len(series[t]) >= 3][:12]
    sm_html = ""
    if sm_tlds:
        d0 = min(date.fromisoformat(sorted(series[t])[0]).toordinal() for t in sm_tlds)
        d1 = last_day.toordinal()
        idx = {t: [(d, v / series[t][sorted(series[t])[0]] * 100) for d, v in sorted(series[t].items())] for t in sm_tlds}
        allv = [v for pts in idx.values() for _, v in pts]
        lo, hi = min(min(allv), 95), max(max(allv), 105)
        cells = []
        for t in sm_tlds:
            pts = idx[t]
            chg = pts[-1][1] - 100
            cls = "up" if chg > 0 else "down"
            cells.append(
                f'<a class="sm" href="tld/{esc(t)}.html"><div class="row"><span class="smn">.{esc(unicode_name(t))}</span>'
                f'<span class="smv {cls}">{fmt_pct(chg / 100, 1)}</span></div>'
                f'{mini_line(pts, 220, 70, lo, hi, d0, d1, "var(--signal)" if chg >= 0 else "var(--fall)", 100)}'
                f'<span class="count">{fmt_compact(series[t][max(series[t])])} domains</span></a>'
            )
        sm_html = "".join(cells)

    # ---------- unusual jumps ----------
    watch_src = recent if recent else spikes[:6]
    rows_j = []
    for s_ in sorted(watch_src, key=lambda x: -x.pct)[:6]:
        rows_j.append(
            f'<li><a href="tld/{esc(s_.tld)}.html"><span class="name">.{esc(unicode_name(s_.tld))}</span>'
            f'{sev_chip(s_)}<span class="big">{fmt_pct(s_.pct)} <span class="meta">in {days(s_.gap_days)}</span></span>'
            f'<span class="meta">{fmt_signed(s_.added)} domains, to {fmt_int(s_.count)}, on {fmt_day(s_.date)}'
            + (" (named in abuse reports)" if s_.tld in KNOWN_ABUSE else "") + "</span></a></li>"
        )
    watch_block = f'<ul class="jumps">{"".join(rows_j)}</ul>' if rows_j else '<p class="empty">No unusual jumps yet.</p>'

    # ---------- market map: every sizable extension, grouped by the registry that runs it ----------
    map_entries = [c for c, _ in radar_entries]
    n_ops = len({((_META.get(c.tld) or {}).get("operator") or "") for c in map_entries})
    wall_html = (
        f'<figure class="mapfig">{market_map(map_entries, _META, cls="wide")}'
        f'{market_map(map_entries, _META, groups_shown=7, size=(600, 900), min_font=17, cls="tall")}{MAP_LEGEND}'
        f'<figcaption>The domain market: {len(map_entries)} extensions with at least {fmt_int(RADAR_MIN_DOMAINS)} domains, '
        f'each sized by its registered domains and grouped by the {n_ops} registries that run them. '
        f'Colour shows growth per week at the latest check. Hover a tile for the numbers; click it to open the extension.</figcaption></figure>'
    )

    index_body = f"""
<h1>{headline}</h1>
<p class="lede">RootFetch counts the registered domains under {len(series):,} domain extensions every day, straight from their zone files.</p>
{wall_html}
<ul class="takeaways">{"".join(f"<li>{t}</li>" for t in takeaways)}</ul>

<section class="section" aria-labelledby="pulse-h">
<div class="section-head"><h2 id="pulse-h">The three extensions counted every day</h2>
<p>The line is each extension's total. The bars underneath are each day's net change.</p></div>
<div class="pulses">{pulse_html}</div>
</section>

<section class="section" aria-labelledby="boards-h">
<div class="section-head"><h2 id="boards-h">Growing and shrinking</h2>
<p>Rankings from each extension's latest check. Growth per week is scaled so extensions checked days or weeks apart compare fairly.
<a class="cta more" href="tlds.html">See all {len(series):,} extensions</a></p></div>
<div class="boards">{boards}</div>
</section>

<section class="section" aria-labelledby="sm-h">
<div class="section-head"><h2 id="sm-h">The biggest extensions since February</h2>
<p>Every chart starts at 100 on the extension's first check and shares one scale, so the lines compare directly. Dashed stretches are gaps between checks.</p></div>
<div class="smgrid">{sm_html}</div>
</section>

{launch_html}
<section class="section" aria-labelledby="watch-h">
<div class="section-head"><h2 id="watch-h">Unusual jumps</h2>
<p>An extension gaining at least {fmt_int(SPIKE_MIN_ADDED)} domains and {SPIKE_MIN_PCT:.0%} within {SPIKE_MAX_GAP_DAYS} days. Sometimes a price promotion, sometimes bulk registrations for spam or phishing.
<a class="cta more" href="spikes.html">See all {len(spikes)} jumps</a> or <a class="cta" href="feed.xml">follow them by RSS</a>.</p></div>
{watch_block}
</section>
"""
    if _og_available():
        (out_dir / "og").mkdir(exist_ok=True)
        og = _og()
        og.site_image(out_dir / "og" / "home.png", re.sub("<[^>]+>", "", headline).replace("&amp;", "&"),
                      f"Daily domain trends for {len(series):,} top-level domains · {fmt_day(last_update)}",
                      sorted(series["xyz"].items()) if "xyz" in series else None)
        og.site_image(out_dir / "og" / "site.png", "Domain statistics & trends for every domain extension",
                      f"{len(series):,} top-level domains · updated daily from ICANN zone files")
        og.logo_image(out_dir / "og" / "logo.png")
    (out_dir / "index.html").write_text(
        page("Domain statistics & trends by extension (TLD) | RootFetch", index_body, active="home", trust=trust,
             path="", image="og/home.png",
             description=(f"Domain statistics for {len(series):,} domain extensions (TLDs): daily counts, fastest growing "
                          "and shrinking extensions, rankings and unusual registration jumps."),
             jsonld=[{"@type": "Dataset", "@id": f"{SITE_URL}/#dataset", "name": "RootFetch TLD domain counts",
                      "description": f"Registered domain counts for {len(series):,} top-level domains, checked on a rolling daily schedule from ICANN CZDS zone files.",
                      "url": f"{SITE_URL}/", "creator": {"@id": f"{SITE_URL}/#org"}, "license": DATA_LICENSE,
                      "isAccessibleForFree": True, "temporalCoverage": f"{first_seen}/{last_update}", "dateModified": last_update,
                      "keywords": ["domain registrations", "TLD statistics", "gTLD", "zone files", "domain trends"],
                      "distribution": [
                          {"@type": "DataDownload", "encodingFormat": "text/csv", "contentUrl": f"{SITE_URL}/data/history.csv"},
                          {"@type": "DataDownload", "encodingFormat": "application/json", "contentUrl": f"{SITE_URL}/data/latest.json"}]}])
    )

    # ---------- all TLDs ----------
    rows = []
    latest_rows = []
    for tld in sorted(series, key=lambda t: -series[t][max(series[t])]):
        pts = series[tld]
        last = max(pts)
        cs = all_changes[tld]
        ch = cs[-1] if cs else None
        sev = ch.severity if ch else None
        ever = any(c.is_spike() for c in cs)
        latest_rows.append(
            {
                "tld": tld,
                "name": unicode_name(tld),
                "count": pts[last],
                "last_checked": last,
                "prev_count": ch.prev_count if ch else None,
                "prev_checked": ch.prev_date if ch else None,
                "added": ch.added if ch else None,
                "pct": round(ch.pct, 6) if ch else None,
                "severity": sev[0] if sev else None,
                "known_abuse": tld in KNOWN_ABUSE,
            }
        )
        if ch:
            cells = (
                f'<td class="n {trend_class(ch.added)}" data-v="{ch.added}">{fmt_signed(ch.added)}</td>'
                f'<td class="n {trend_class(ch.added)}" data-v="{ch.weekly:.6f}">{fmt_pct(ch.weekly)}</td>'
            )
        else:
            cells = '<td class="n muted" data-v="0">–</td><td class="n muted" data-v="0">–</td>'
        ordered = sorted(pts.items())
        attrs = f' data-u="{esc(unicode_name(tld).lower())}"'
        attrs += ' data-spike="1"' if ever else ""
        attrs += ' data-abuse="1"' if tld in KNOWN_ABUSE else ""
        attrs += ' data-grow="1"' if ch and ch.weekly > 0.005 else ""
        flags = (sev_chip(ch) if ch else "") + abuse_chip(tld)
        rows.append(
            f'<tr data-tld="{esc(tld)}"{attrs}><td data-v="{esc(tld)}"><a class="tld" href="tld/{esc(tld)}.html">{tld_label(tld)}</a></td>'
            f'<td class="n" data-v="{pts[last]}">{fmt_int(pts[last])}</td>{cells}'
            f'<td class="spark" data-v="{ch.weekly if ch else 0:.6f}">{sparkline(ordered)}</td>'
            f'<td data-v="{last}">{fmt_day(last, False)}</td><td data-v="{(2 if sev else 0) + (1 if tld in KNOWN_ABUSE else 0)}"><span class="chips">{flags}</span></td></tr>'
        )
    top3 = largest[:3]  # only extensions checked recently
    ext_faq = [
        ("What is a domain extension (TLD)?",
         "A domain extension, or top-level domain (TLD), is the last part of a domain name, like .com, .xyz or .app. "
         "Each one is run by a registry that publishes a zone file listing every registered domain under it."),
        ("How many domain extensions are there?",
         f"About 1,500 TLDs exist in the DNS root. RootFetch tracks {len(series):,} of them, the ones whose zone files it can access through ICANN's Centralized Zone Data Service."),
        ("What is the most popular domain extension?",
         ".com is the largest overall. Among the extensions RootFetch tracks, the largest are "
         + ", ".join(f".{unicode_name(t)} ({fmt_compact(series[t][max(series[t])])} domains)" for t in top3) + "."),
    ]
    if fastest:
        ext_faq.append(("Which domain extensions are growing fastest?",
                        "At their latest checks, the fastest growing large extensions are "
                        + ", ".join(f".{unicode_name(c.tld)} ({fmt_pct(c.weekly)} a week)" for c in fastest[:3]) + "."))
    tlds_body = f"""
<h1>Most popular domain extensions in {last_update[:4]}</h1>
<p class="lede">All {len(series):,} domain extensions (TLDs) RootFetch tracks, ranked by how many domains are registered under each, counted from their zone files. The top three right now: {", ".join(f".{unicode_name(t)} ({fmt_compact(series[t][max(series[t])])})" for t in top3)}. Growth is scaled to one week so extensions checked at different intervals compare fairly.</p>
<section class="section">
<div class="tools"><input id="q" type="search" placeholder="Find a TLD, e.g. xyz" aria-label="Find a TLD">
<div class="seg" role="group" aria-label="Show">
<button type="button" data-mode="all" aria-pressed="true">All</button>
<button type="button" data-mode="grow" aria-pressed="false">Growing</button>
<button type="button" data-mode="spike" aria-pressed="false">Has spiked</button>
<button type="button" data-mode="abuse" aria-pressed="false">On abuse lists</button></div>
<span class="count"><span id="shown">{len(series):,}</span> shown</span></div>
<div class="tablebox"><table id="all" data-sortable>
<thead><tr><th data-sort>TLD</th><th class="n" data-sort data-dir="desc">Domains</th><th class="n" data-sort>Change</th><th class="n" data-sort>Per week</th><th data-sort>Trend</th><th data-sort>Checked</th><th data-sort>Flags</th></tr></thead>
<tbody>{"".join(rows)}</tbody></table></div>
</section>
<section class="section faq"><h2>About domain extensions</h2>{"".join(f"<details{' open' if i == 0 else ''}><summary>{esc(q)}</summary><p>{esc(a)}</p></details>" for i, (q, a) in enumerate(ext_faq))}</section>
"""
    (out_dir / "tlds.html").write_text(page(f"Most popular domain extensions {last_update[:4]}: {len(series):,} ranked", tlds_body, active="tlds", trust=trust,
                                               path="tlds.html",
                                               description=f"The most popular domain extensions in {last_update[:4]}, ranked by registered domains: {len(series):,} TLDs with weekly growth and trends. Updated {fmt_day(last_update)}.",
                                               jsonld=[{"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in ext_faq]},
                                                       {"@type": "ItemList", "name": "Largest domain extensions by registered domains", "numberOfItems": 25,
                                                        "itemListElement": [{"@type": "ListItem", "position": i + 1, "url": f"{SITE_URL}/tld/{t}.html", "name": f".{unicode_name(t)}"}
                                                                            for i, t in enumerate(sorted(series, key=lambda t: -series[t][max(series[t])])[:25])]}]))

    # ---------- spikes ----------
    first_day = min(d for pts in series.values() for d in pts)
    wk0 = date.fromisoformat(first_day) - timedelta(days=date.fromisoformat(first_day).weekday())
    weeks = []
    cur = wk0
    while cur <= last_day:
        end = cur + timedelta(days=6)
        n = [s for s in spikes if cur.isoformat() <= s.date <= end.isoformat()]
        weeks.append((cur, n))
        cur += timedelta(days=7)
    mx = max((len(n) for _, n in weeks), default=1) or 1
    bars = []
    for i, (wk, n) in enumerate(weeks):
        hpct = 6 + 94 * len(n) / mx if n else 6
        label = f"<span>{wk.strftime('%b')}</span>" if wk.day <= 7 else ""
        tip = f"Week of {fmt_day(wk.isoformat(), False)}: {len(n)} spike{'s' if len(n) != 1 else ''}"
        if n:
            tip += "\n" + ", ".join(f".{unicode_name(s.tld)}" for s in n[:6])
        bars.append(f'<div class="w{" has" if n else ""}" style="height:{hpct:.0f}%" tabindex="0" data-tip="{esc(tip)}">{label}</div>')
    spike_rows = []
    for s in spikes:
        spike_rows.append(
            f'<tr><td data-v="{s.date}">{fmt_day(s.date)}</td>'
            f'<td data-v="{esc(s.tld)}"><a class="tld" href="tld/{esc(s.tld)}.html">{tld_label(s.tld)}</a></td>'
            f'<td data-v="{s.pct:.6f}">{sev_chip(s)}</td>'
            f'<td class="n up" data-v="{s.added}">{fmt_signed(s.added)}</td><td class="n" data-v="{s.pct:.6f}">{fmt_pct(s.pct)}</td>'
            f'<td class="n" data-v="{s.count}">{fmt_int(s.count)}</td><td class="n muted" data-v="{s.gap_days}">{s.gap_days} day{"s" if s.gap_days != 1 else ""}</td>'
            f'<td data-v="{1 if s.tld in KNOWN_ABUSE else 0}">{abuse_chip(s.tld)}</td></tr>'
        )
    from collections import Counter
    by_tld = Counter(s_.tld for s_ in spikes)
    by_op = Counter((_META.get(s_.tld) or {}).get("operator") or "Unknown" for s_ in spikes)
    biggest = sorted(spikes, key=lambda s_: -s_.pct)[:3]
    repeat = [(t, n) for t, n in by_tld.most_common() if n > 1][:5]
    jump_story = []
    if spikes:
        jump_story.append(
            f"RootFetch has flagged <b>{len(spikes)}</b> unusual jumps across <b>{len(by_tld)}</b> extensions since "
            f"{fmt_day(min(s_.date for s_ in spikes))}. The largest, by growth, were "
            + ", ".join(f'<a href="tld/{esc(s_.tld)}.html">.{esc(unicode_name(s_.tld))}</a> ({fmt_pct(s_.pct)} in {days(s_.gap_days)}, {fmt_day(s_.date, False)})' for s_ in biggest)
            + "."
        )
        if repeat:
            jump_story.append("Some extensions jump again and again: "
                              + ", ".join(f'<a href="tld/{esc(t)}.html">.{esc(unicode_name(t))}</a> ({n} times)' for t, n in repeat) + ".")
        ops = [(o, n) for o, n in by_op.most_common(4) if o != "Unknown"]
        if ops:
            jump_story.append("By registry operator, the most jumps came from "
                              + ", ".join(f"{esc(o)} ({n})" for o, n in ops)
                              + ". Operators that run many low-cost extensions tend to show up here, because one promotion can move several of them at once.")
    spikes_body = f"""
<h1>Unusual domain registration jumps: {len(spikes)} so far</h1>
<p class="lede">A spike is when a TLD gains at least {fmt_int(SPIKE_MIN_ADDED)} domains and grows {SPIKE_MIN_PCT:.0%} or more since its previous check, and that check was no more than {SPIKE_MAX_GAP_DAYS} days earlier. Severity follows the size of the jump: <b>Elevated</b> 5–10%, <b>High</b> 10–20%, <b>Critical</b> 20% and up.</p>
<p><a class="cta" href="feed.xml">Follow new spikes by RSS</a> · <a class="cta" href="data/spikes.csv">CSV</a> · <a class="cta" href="data/spikes.json">JSON</a></p>
<section class="section" aria-labelledby="t-h"><div class="section-head"><h2 id="t-h">Spikes per week</h2>
<p>Weeks without data look the same as quiet weeks. Check the trust bar above for gaps.</p></div>
<div class="weeks">{"".join(bars)}</div></section>
<section class="section prose"><h2>What the record shows</h2><p>{" ".join(jump_story) or "No jumps have been flagged yet."}</p></section>
<section class="section prose"><h2>What a jump means</h2>
<p>Most extensions grow by a fraction of a percent a week. When one gains thousands of domains in days, something changed: a registrar ran a sale, the registry cut its wholesale price, a large reseller bought names in bulk, or a campaign registered domains for spam, phishing or malware. The zone file alone can't tell these apart, so a jump is a reason to look closer, not a verdict.</p>
<p>Security teams use jumps to decide which newly registered domains to scrutinize first. Domain investors and registries use them to see which promotions actually moved volume. Journalists use them to spot unusual activity around events.</p>
<h2>How to follow new jumps</h2>
<p>Subscribe to the <a class="cta" href="feed.xml">RSS feed</a> in any feed reader to get each new jump as it is detected, or poll <a class="cta" href="data/spikes.json">spikes.json</a>, which also includes the exact detection rule. Each jump links to its extension's page with the full history.</p></section>
<section class="section"><h2>Every jump</h2><div class="tablebox" style="margin-top:12px"><table data-sortable>
<thead><tr><th data-sort data-dir="desc">Date</th><th data-sort>TLD</th><th data-sort>Severity</th><th class="n" data-sort>New domains</th><th class="n" data-sort>Growth</th><th class="n" data-sort>Total now</th><th class="n" data-sort>Window</th><th data-sort>Context</th></tr></thead>
<tbody>{"".join(spike_rows) or '<tr><td colspan="8" class="muted">No spikes yet.</td></tr>'}</tbody></table></div></section>
"""
    (out_dir / "spikes.html").write_text(
        page("Unusual domain registration jumps by TLD · RootFetch", spikes_body, active="spikes", trust=trust, path="spikes.html",
             description=f"{len(spikes)} sudden jumps in domain registrations by TLD, ranked by severity, with an RSS feed. Often promotions, sometimes bulk spam or phishing.")
    )

    # ---------- per-TLD ----------
    by_size = sorted(series, key=lambda t: -series[t][max(series[t])])
    size_rank = {t: i + 1 for i, t in enumerate(by_size)}
    growth_rank = {c.tld: i + 1 for i, c in enumerate(sorted(big, key=lambda c: -c.weekly))}
    (out_dir / "data" / "tld").mkdir()
    og_ok = _og_available()
    (out_dir / "og").mkdir(exist_ok=True)
    sitemap: list[tuple[str, str]] = []
    big_weekly = [c.weekly for c in big]
    long_term_map = {t: g for g, t, _, _ in long_term}
    for tld, pts in series.items():
        ordered = sorted(pts.items())
        cs = all_changes[tld]
        by_date = {c.date: c for c in cs}
        tspikes = [c for c in cs if c.is_spike()]
        hist_rows = []
        for d, v in reversed(ordered):
            c = by_date.get(d)
            if c:
                cells = (
                    f'<td class="n {trend_class(c.added)}">{fmt_signed(c.added)}</td>'
                    f'<td class="n {trend_class(c.added)}">{fmt_pct(c.pct)}</td><td class="n muted">{c.gap_days} day{"s" if c.gap_days != 1 else ""}</td>'
                )
            else:
                cells = '<td class="n muted">–</td><td class="n muted">–</td><td class="n muted">first check</td>'
            hist_rows.append(
                f'<tr><td>{fmt_day(d)}</td><td class="n">{fmt_int(v)}</td>{cells}<td>{sev_chip(c) if c else ""}</td></tr>'
            )
        first_d, first_v = ordered[0]
        last_d, last_v = ordered[-1]
        overall = last_v - first_v
        overall_pct = overall / first_v if first_v else 0
        u = unicode_name(tld)
        latest = cs[-1] if cs else None
        noindex = (last_v < INDEX_MIN_DOMAINS or len(ordered) < INDEX_MIN_CHECKS
                   or (last_day - date.fromisoformat(last_d)).days > INDEX_MAX_AGE_DAYS)
        rank = size_rank[tld]
        sub = f'<p class="count">{esc(tld)}</p>' if u != tld else ""

        # plain-language summary, written from this TLD's own numbers
        facts = [_pick(tld, [
            f".{esc(u)} has <b>{fmt_int(last_v)}</b> registered domains as of {fmt_day(last_d)}, ranking <b>#{rank:,}</b> by size.",
            f"On {fmt_day(last_d)} the .{esc(u)} zone held <b>{fmt_int(last_v)}</b> domains, which makes it <b>#{rank:,}</b> in RootFetch's ranking.",
            f"<b>{fmt_int(last_v)}</b> domains were registered under .{esc(u)} at its latest check ({fmt_day(last_d)}), placing it <b>#{rank:,}</b> of {len(series):,}.",
        ])]
        if len(ordered) > 1:
            direction = "grown" if overall > 0 else "shrunk" if overall < 0 else "held steady"
            facts.append(
                _pick(tld + "fc", [f"Since its first check on {fmt_day(first_d)} it has {direction}",
                                    f"It has {direction} since RootFetch first counted it on {fmt_day(first_d)},"])
                + (f" by <b>{fmt_pct(abs(overall_pct) if overall < 0 else overall_pct, 1).lstrip('+').replace(chr(8722), '')}</b> "
                   f"({fmt_signed(overall)} domains)." if overall else ".")
            )
        if latest and latest.gap_days <= 60:
            facts.append(
                _pick(tld + "lc", [f"At its latest check it changed by {fmt_signed(latest.added)} domains over {latest.gap_days} days, ",
                                    f"The most recent check showed {fmt_signed(latest.added)} domains across {latest.gap_days} days, "])
                + f"about <b>{fmt_pct(latest.weekly)}</b> a week"
                + (f", the #{growth_rank[tld]} fastest growth among {len(big)} large TLDs." if tld in growth_rank and latest.weekly > 0 else ".")
            )
        if tspikes:
            t0 = max(tspikes, key=lambda c: c.pct)
            facts.append(
                f"It has had {len(tspikes)} unusual jump{'s' if len(tspikes) != 1 else ''}; the largest was "
                f"{fmt_pct(t0.pct)} in {days(t0.gap_days)} on {fmt_day(t0.date)}."
            )
        summary = " ".join(facts)
        context = ""
        if tld in KNOWN_ABUSE:
            context = (
                f'<p>.{esc(u)} is also named in <a href="{KNOWN_ABUSE[tld]}">Interisle Consulting Group\'s abuse reports</a>, '
                "so its jumps deserve a closer look.</p>"
            )

        # neighbours by size, for internal links
        i = rank - 1
        near = [t for t in by_size[max(0, i - 4): i + 5] if t != tld][:8]
        related = "".join(
            f'<li><a href="{esc(t)}.html"><span class="tld">.{esc(unicode_name(t))}</span>'
            f'<span class="count">{fmt_compact(series[t][max(series[t])])}</span></a></li>'
            for t in near
        )

        lede, answers_html, answer_faq, kind = tld_answers(
            tld, u, last_v, rank, len(series), _META.get(tld), _WIKI.get(tld), tspikes, latest,
            sorted(big_weekly)[len(big_weekly) // 2] if big_weekly else 0.0)
        faq = [(f"How many .{u} domains are there?", _pick(tld + "q", [
            f"As of {fmt_day(last_d)}, there are {fmt_int(last_v)} registered .{u} domains.",
            f"{fmt_int(last_v)}, according to the .{u} zone file on {fmt_day(last_d)}.",
            f"The .{u} zone listed {fmt_int(last_v)} domains when it was last checked on {fmt_day(last_d)}.",
        ]))]
        if len(ordered) > 1:
            faq.append((f"Is .{u} growing?",
                        f".{u} went from {fmt_int(first_v)} domains on {fmt_day(first_d)} to {fmt_int(last_v)} on {fmt_day(last_d)}, "
                        f"a change of {fmt_pct(overall_pct)}."
                        + (f" Its latest rate is about {fmt_pct(latest.weekly)} a week." if latest and latest.gap_days <= 60 else "")))
        faq.append((f"How big is the .{u} domain extension compared to others?",
                    _pick(tld + "b", [f"It ranks #{rank:,} by domain count.", f".{u} is number {rank:,} in size among tracked extensions.",
                                       f"By registered domains, .{u} comes in at #{rank:,}."])
                    + (f" Its nearest neighbours are {', '.join('.' + unicode_name(t) for t in near[:3])}." if near else "")))
        if tspikes:
            faq.append((f"Has .{u} had sudden registration spikes?",
                        f"Yes. RootFetch recorded {len(tspikes)} unusual jump{'s' if len(tspikes) != 1 else ''} in .{u}, "
                        f"where it gained at least {fmt_int(SPIKE_MIN_ADDED)} domains and {SPIKE_MIN_PCT:.0%} or more within {SPIKE_MAX_GAP_DAYS} days."))
        story_html, story_faq = tld_story(tld, u, ordered, cs, _META.get(tld), series, by_size, size_rank,
                                          big_weekly, long_term_map, last_day)
        faq[1:1] = story_faq
        faq = answer_faq + faq
        faq_html = "".join(f"<details{' open' if i == 0 else ''}><summary>{esc(q)}</summary><p>{esc(a)}</p></details>" for i, (q, a) in enumerate(faq))

        # per-TLD CSV
        with (out_dir / "data" / "tld" / f"{tld}.csv").open("w", newline="") as handle:
            w = csv.writer(handle)
            w.writerow(["date", "tld", "count"])
            for d, v in ordered:
                w.writerow([d, tld, v])

        image = "og/site.png"
        if og_ok and not noindex:
            up = overall >= 0
            change_line = f"{fmt_pct(overall_pct, 0 if abs(overall_pct) >= .1 else 1)} since {fmt_day(first_d)}" if len(ordered) > 1 else "First check"
            _og().tld_image(out_dir / "og" / f"{tld}.png", u, last_v, change_line.replace(chr(8722), "-"), ordered, up,
                            f"Domain count from ICANN zone files · {fmt_day(last_d)}")
            image = f"og/{tld}.png"

        path = f"tld/{tld}.html"
        page_url = f"{SITE_URL}/{path}"
        ld = [
            {"@type": "BreadcrumbList", "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Trends", "item": f"{SITE_URL}/"},
                {"@type": "ListItem", "position": 2, "name": "Domain extensions", "item": f"{SITE_URL}/tlds.html"},
                {"@type": "ListItem", "position": 3, "name": f".{u}", "item": page_url}]},
            {"@type": "Dataset", "@id": f"{page_url}#dataset", "name": f".{u} domain count history",
             "description": f"Number of registered .{u} domains at each check from {first_d} to {last_d}, counted from the .{u} zone file via ICANN CZDS.",
             "url": page_url, "creator": {"@id": f"{SITE_URL}/#org"}, "license": DATA_LICENSE, "isAccessibleForFree": True,
             "temporalCoverage": f"{first_d}/{last_d}", "dateModified": last_d,
             "keywords": [f".{u}", f"{u} domain", f".{u} domain statistics", "domain extension", "domain statistics", "TLD"],
             "variableMeasured": "Registered second-level domains with NS records",
             "distribution": [{"@type": "DataDownload", "encodingFormat": "text/csv", "contentUrl": f"{SITE_URL}/data/tld/{tld}.csv"}]},
            {"@type": "FAQPage", "mainEntity": [
                {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq]},
        ]

        body = f"""
<nav class="crumbs" aria-label="Breadcrumb"><a href="../index.html">Trends</a><span>/</span><a href="../tlds.html">Domain extensions</a><span>/</span><span aria-current="page">.{esc(u)}</span></nav>
<h1 class="tldname">.{esc(u)}<small> domain</small></h1>{sub}
<p class="lede tldlede">{lede}</p>
<div class="chips">{(sev_chip(tspikes[-1]) + f'<span class="count">last jump {fmt_day(tspikes[-1].date)}</span>') if tspikes else ""}{abuse_chip(tld, 1)}</div>
{answers_html}
<section class="section"><h2>How popular is .{esc(u)}?</h2>
<div class="facts">
<div><b>{fmt_int(last_v)}</b><small>domains on {fmt_day(last_d)}</small></div>
<div><b>{fmt_signed(overall)}</b><small>since {fmt_day(first_d)} ({fmt_pct(overall_pct)})</small></div>
<div><b>#{rank:,}</b><small>largest of {len(series):,} TLDs</small></div>
<div><b>{len(tspikes)}</b><small>unusual jump{"s" if len(tspikes) != 1 else ""}</small></div>
</div>
<div class="prose summary"><p>{summary}</p>{context}</div></section>
<div class="chart" style="margin-top:20px">{history_chart(ordered, by_date)}</div>
<p class="count" style="margin-top:8px"><a class="cta" href="../data/tld/{esc(tld)}.csv">Download .{esc(u)} history (CSV)</a></p>
{story_html}
<section class="section"><h2>Every check</h2>
<div class="tablebox" style="margin-top:12px"><table><thead><tr><th>Date</th><th class="n">Domains</th><th class="n">Change</th><th class="n">Growth</th><th class="n">Window</th><th>Severity</th></tr></thead>
<tbody>{"".join(hist_rows)}</tbody></table></div></section>
<section class="section faq"><h2>Questions about .{esc(u)}</h2>{faq_html}</section>
<section class="section"><h2>Domain extensions of similar size</h2><ul class="related">{related}</ul></section>
"""
        title = f".{u} domain: is it safe? Who runs it, how popular | RootFetch"
        for alt in (f".{u} domain: safe? Who runs it? Popularity | RootFetch", f".{u} domain: safety, owner & popularity",
                    f".{u} domain: is it safe? | RootFetch", f".{u} domain | RootFetch"):
            if len(title) <= 60:
                break
            title = alt
        op_name = (_META.get(tld) or {}).get("operator") or ""
        desc = (f"Is .{u} safe or spam? .{u} is a {kind}" + (f" run by {op_name}" if op_name else "")
                + f" with {fmt_compact(last_v)} domains (#{rank:,}). Abuse signals, growth and history from zone files.")
        if len(desc) > 158:
            desc = (f"Is .{u} safe or spam? A {kind} with {fmt_compact(last_v)} domains (#{rank:,}). "
                    "Abuse signals, who runs it and growth, from zone files.")
        (out_dir / "tld" / f"{tld}.html").write_text(
            page(title, body, depth=1, trust=trust, description=desc, path=path, image=image, jsonld=ld, noindex=noindex)
        )
        if not noindex:
            sitemap.append((path, last_d))

    # ---------- data files ----------
    with (out_dir / "data" / "history.csv").open("w", newline="") as handle:
        w = csv.writer(handle)
        w.writerow(["date", "tld", "count"])
        for tld in sorted(series):
            for d, v in sorted(series[tld].items()):
                w.writerow([d, tld, v])
    fields = ["date", "tld", "prev_date", "gap_days", "prev_count", "count", "added", "pct", "severity", "known_abuse"]
    with (out_dir / "data" / "spikes.csv").open("w", newline="") as handle:
        w = csv.DictWriter(handle, fieldnames=fields)
        w.writeheader()
        for s in spikes:
            w.writerow(s.as_dict())
    generated = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    (out_dir / "data" / "latest.json").write_text(
        json.dumps({"generated_at": generated, "last_update": last_update, "tlds": latest_rows}, indent=1)
    )
    (out_dir / "data" / "spikes.json").write_text(
        json.dumps(
            {
                "generated_at": generated,
                "rule": {
                    "min_base": SPIKE_MIN_BASE,
                    "min_added": SPIKE_MIN_ADDED,
                    "min_pct": SPIKE_MIN_PCT,
                    "max_gap_days": SPIKE_MAX_GAP_DAYS,
                    "severity": {key: floor for key, _, floor in SEVERITY},
                },
                "spikes": [s.as_dict() for s in spikes],
            },
            indent=1,
        )
    )
    (out_dir / "status.json").write_text(
        json.dumps({"last_update": last_update, "age_days": age_days, "stale": stale, "checked_latest": checked_latest})
    )

    data_body = f"""
<h1>Download everything</h1>
<p class="lede">All data on this site is free to download and reuse. Files are rebuilt every day.</p>
<section class="section"><div class="dl">
<a class="cta" href="data/history.csv"><code>history.csv</code><small>Every check for every TLD: date, tld, count.</small></a>
<a class="cta" href="data/latest.json"><code>latest.json</code><small>Latest count per TLD, change since the previous check, severity and abuse-list flag.</small></a>
<a class="cta" href="data/spikes.csv"><code>spikes.csv</code><small>Every flagged spike with severity.</small></a>
<a class="cta" href="data/spikes.json"><code>spikes.json</code><small>Spikes plus the exact rule used to flag them.</small></a>
<a class="cta" href="feed.xml"><code>feed.xml</code><small>RSS feed of new spikes.</small></a>
<a class="cta" href="status.json"><code>status.json</code><small>Date of the newest data, for monitoring.</small></a>
</div></section>
<section class="section prose"><h2>How the numbers are made</h2>
<p>ICANN's Centralized Zone Data Service (CZDS) gives approved users a daily copy of each generic TLD's zone file, the list every DNS resolver uses to find a domain's name servers. RootFetch downloads a rolling set of these files every day at 03:30 UTC, counts the distinct second-level names that have NS records, and deletes the raw file. Only the counts are kept and published.</p>
<p>About {checked_latest} extensions are checked per run, so each is re-checked roughly every two weeks; .xyz, .app and .dev are checked daily. Growth between two checks is also expressed per week, compounding over the gap, so an extension checked after 3 days and one checked after 14 days can be compared directly.</p>
<h2>What the files contain</h2>
<ul>
<li><b>history.csv</b>: one row per check with <code>date</code> (UTC, YYYY-MM-DD), <code>tld</code> (ASCII form, e.g. <code>xn--p1acf</code> for IDNs) and <code>count</code>.</li>
<li><b>latest.json</b>: one object per extension with the latest <code>count</code>, <code>last_checked</code>, the previous check, <code>added</code>, <code>pct</code>, <code>severity</code> and <code>known_abuse</code>.</li>
<li><b>spikes.json</b>: every unusual jump plus the <code>rule</code> object with the exact thresholds: {fmt_int(SPIKE_MIN_ADDED)}+ new domains and {SPIKE_MIN_PCT:.0%}+ growth within {SPIKE_MAX_GAP_DAYS} days; severity Elevated 5–10%, High 10–20%, Critical 20%+.</li>
<li><b>data/tld/&lt;tld&gt;.csv</b>: the history of a single extension, for example <a href="data/tld/xyz.csv">xyz.csv</a>.</li>
</ul>
<h2>Use it in code</h2>
<pre><code>curl -s https://rootfetch.com/data/latest.json | jq '.tlds[] | select(.tld=="xyz")'

import pandas as pd
df = pd.read_csv("https://rootfetch.com/data/history.csv", parse_dates=["date"])
df[df.tld == "lol"].plot(x="date", y="count")</code></pre>
<h2>Limits to know about</h2>
<p>Counts measure delegated names in the zone file, which is close to, but not the same as, registrations: names on hold or without name servers aren't in the zone. Country-code extensions such as .uk or .de don't publish zone files through CZDS, so they aren't covered, and .com is not yet included. Because most extensions are checked every two weeks, a short burst may show up spread across one longer window.</p>
<h2>License and citation</h2>
<p>The data is free to reuse under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Please credit it as: <i>RootFetch, TLD domain counts, https://rootfetch.com/data.html</i>, with the date you downloaded it.</p></section>
"""
    (out_dir / "data.html").write_text(page("Download TLD domain count data (CSV, JSON) · RootFetch", data_body, active="data", trust=trust, path="data.html",
                                               description="Free downloads of daily domain counts for every tracked top-level domain: full history CSV, latest JSON, unusual jumps and an RSS feed. CC BY 4.0."))

    abuse_items = "".join(
        f'<li><b>.{esc(t)}</b>: <a href="{src}">{"Interisle Phishing Landscape 2025" if src == INTERISLE_2025 else "Interisle report, June 2026"}</a></li>'
        for t, src in sorted(KNOWN_ABUSE.items())
    )
    about_body = f"""
<h1>Free daily trends for every top-level domain</h1>
<div class="prose">
<p class="lede">RootFetch counts how many domains are registered under each top-level domain, tracks which are growing or shrinking, and flags sudden jumps.</p>
<h2>What you can use it for</h2>
<p>Spot which TLDs are gaining or losing ground, compare growth across TLDs of any size, watch the daily pulse of the biggest ones, and download the full history.</p>
<h2>Unusual jumps</h2>
<p>Scammers register domains by the thousand in cheap TLDs, use them for a few days of phishing or spam, and move on. Those bursts show up as sudden jumps in a TLD's zone file, often before the domains land on blocklists. A spike can also be a harmless price promotion, so treat it as a lead, not a verdict.</p>
<h2>Where the numbers come from</h2>
<p>ICANN's <a href="https://czds.icann.org/">Centralized Zone Data Service</a> gives approved users daily copies of TLD zone files. Every day an automated job downloads a rolling set of them, counts the domains and throws the raw files away. Only the counts are published.</p>
<h2 id="what-is-a-tld">What is a TLD?</h2>
<p>A top-level domain (TLD), also called a domain extension, is the last part of a domain name: the <b>.com</b> in example.com or the <b>.xyz</b> in example.xyz. Each TLD's registry publishes a zone file listing every registered domain, which is what RootFetch counts.</p>
<h2 id="abuse-lists">"On abuse lists"</h2>
<p>These TLDs are named among the most abused in recent reports by Interisle Consulting Group:</p>
<ul>{abuse_items}</ul>
<p>Being on the list says nothing about any single domain. Most domains in these TLDs are legitimate.</p>
<h2>Source</h2>
<p>The code and the full data history are on <a href="{REPO_URL}">GitHub</a>.</p>
</div>
"""
    (out_dir / "about.html").write_text(page("About RootFetch: how domain counts are made", about_body, active="about", trust=trust, path="about.html",
                                                description="How RootFetch counts registered domains from ICANN CZDS zone files, how growth and unusual jumps are calculated, and where the data comes from."))

    (out_dir / "404.html").write_text(
        page("Not found · RootFetch", '<h1>No page here</h1><p class="lede"><a href="/">Go to trends</a> or <a href="/tlds.html">find a TLD</a>.</p>', path="404.html", noindex=True)
    )

    # ---------- RSS ----------
    items = []
    for s in spikes[:50]:
        pub = datetime.combine(date.fromisoformat(s.date), datetime.min.time(), tzinfo=timezone.utc)
        link = f"{SITE_URL}/tld/{s.tld}.html"
        sev = s.severity
        items.append(
            f"<item><title>[{sev[1]}] .{esc(unicode_name(s.tld))} gained {fmt_int(s.added)} domains ({fmt_pct(s.pct)})</title>"
            f"<link>{link}</link><guid isPermaLink=\"false\">rootfetch-spike-{esc(s.tld)}-{s.date}</guid>"
            f"<pubDate>{format_datetime(pub)}</pubDate>"
            f"<description>.{esc(unicode_name(s.tld))} went from {fmt_int(s.prev_count)} to {fmt_int(s.count)} domains between "
            f"{fmt_day(s.prev_date)} and {fmt_day(s.date)}.{' It is named in Interisle abuse reports.' if s.tld in KNOWN_ABUSE else ''}</description></item>"
        )
    (out_dir / "feed.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>'
        f"<title>RootFetch spikes</title><link>{SITE_URL}/spikes.html</link>"
        "<description>Sudden jumps in domain registrations by top-level domain.</description>"
        f"<lastBuildDate>{format_datetime(datetime.now(timezone.utc))}</lastBuildDate>"
        f"{''.join(items)}</channel></rss>\n"
    )

    (out_dir / "CNAME").write_text("rootfetch.com\n")
    (out_dir / ".nojekyll").write_text("")
    (out_dir / f"{INDEXNOW_KEY}.txt").write_text(INDEXNOW_KEY)
    (out_dir / "robots.txt").write_text(
        "User-agent: *\nAllow: /\n\n"
        "# AI search and assistants are welcome to read and cite this data.\n"
        + "".join(f"User-agent: {bot}\nAllow: /\n\n" for bot in
                  ("GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended", "Applebot-Extended", "CCBot"))
        + f"Sitemap: {SITE_URL}/sitemap.xml\n"
    )
    pages = [("", last_update), ("tlds.html", last_update), ("spikes.html", last_update), ("data.html", last_update), ("about.html", last_update)]
    (out_dir / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        + "".join(f"<url><loc>{SITE_URL}/{u}</loc><lastmod>{d}</lastmod></url>" for u, d in pages + sorted(sitemap))
        + "</urlset>\n"
    )
    (out_dir / "indexnow-urls.txt").write_text("\n".join(f"{SITE_URL}/{u}" for u, _ in pages + sorted(sitemap)) + "\n")

    top_lines = "\n".join(
        f"- [.{unicode_name(t)}]({SITE_URL}/tld/{t}.html): {fmt_int(series[t][max(series[t])])} domains"
        for t in by_size[:25]
    )
    (out_dir / "llms.txt").write_text(f"""# RootFetch

> Free daily counts of registered domains for {len(series):,} top-level domains (TLDs), computed from ICANN CZDS zone files, with growth trends and unusual registration jumps. Last update: {last_update}.

Counts are distinct second-level names with NS records in each TLD's zone file. Most TLDs are re-checked about every two weeks on a rolling schedule; .xyz, .app and .dev are checked daily. Data license: CC BY 4.0 ({DATA_LICENSE}).

## Pages
- [Trends]({SITE_URL}/): headline trends, fastest growing and shrinking TLDs, daily pulse
- [All TLDs]({SITE_URL}/tlds.html): every tracked TLD with latest count and weekly growth
- [Unusual jumps]({SITE_URL}/spikes.html): sudden registration spikes with severity
- [Data]({SITE_URL}/data.html): downloads and method
- [About]({SITE_URL}/about.html)

## Data
- [latest.json]({SITE_URL}/data/latest.json): latest count, change and flags per TLD
- [history.csv]({SITE_URL}/data/history.csv): every check for every TLD
- [spikes.json]({SITE_URL}/data/spikes.json): unusual jumps and the rule used
- Per-TLD history: {SITE_URL}/data/tld/<tld>.csv

## Largest TLDs tracked
{top_lines}
""")

    for old, new in LEGACY.items():
        target = f"{SITE_URL}/{new}" if new != "index.html" else f"{SITE_URL}/"
        stub = out_dir / f"{old}.html"
        stub.parent.mkdir(parents=True, exist_ok=True)
        stub.write_text(
            f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Moved · RootFetch</title>'
            f'<meta name="robots" content="noindex"><link rel="canonical" href="{target}">'
            f'<meta http-equiv="refresh" content="0;url={target}"></head>'
            f'<body><p>This page moved to <a href="{target}">{target}</a>.</p></body></html>'
        )

    return {"tlds": len(series), "spikes": len(spikes), "last_update": last_update, "age_days": age_days,
            "radar": len(radar_entries), "total_domains": total_domains}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "_site")
    parser.add_argument("--counts-dir", type=Path, default=COUNTS_DIR)
    args = parser.parse_args()
    summary = build(args.out, args.counts_dir, datetime.now(timezone.utc).date())
    check_inline_scripts(args.out)
    print(json.dumps(summary))


def check_inline_scripts(out: Path) -> None:
    """Fail the build if any inline script (analytics included) would not parse in a browser."""
    import subprocess

    guard = Path(__file__).resolve().parent / "check_inline_js.mjs"
    if not shutil.which("node"):
        if os.environ.get("CI"):
            raise SystemExit("node is required for the inline script check")
        print("node not found: skipping inline script check", file=sys.stderr)
        return
    result = subprocess.run(["node", str(guard), str(out)], capture_output=True, text=True)
    sys.stderr.write(result.stdout + result.stderr)
    if result.returncode:
        raise SystemExit("build stopped: inline script check failed")


if __name__ == "__main__":
    main()
