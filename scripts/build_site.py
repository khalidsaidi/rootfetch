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
# Pages for TLDs smaller than this are kept out of search indexes (mostly single-company TLDs).
NOINDEX_BELOW = 20
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
    var el = t.closest('[data-tip]'); if (!el) return;
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
    '<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800'
    '&family=Public+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">'
)

CSS = """
:root{
--bg:#eef2f6;--panel:#ffffff;--ink:#0f1a2a;--ink-2:#465263;--muted:#6b7686;--line:#d9e0e8;--line-2:#e8edf2;
--signal:#2a78d6;--signal-soft:#dbe8f8;--dot:#9aa6b5;
--critical:#d03b3b;--fall:#4a3aa7;--high:#ec835a;--elevated:#fab219;--good:#0ca30c;
--crit-bg:#fbe6e6;--high-bg:#fdece5;--elev-bg:#fef4dc;
--display:"Archivo",system-ui,sans-serif;--sans:"Public Sans",system-ui,sans-serif;--mono:"JetBrains Mono",ui-monospace,monospace;
color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
--bg:#0d1218;--panel:#151c25;--ink:#e7ecf2;--ink-2:#b4beca;--muted:#8792a1;--line:#273241;--line-2:#1d2631;
--signal:#3987e5;--signal-soft:#16263b;--fall:#9085e9;--dot:#5b6878;
--crit-bg:#3a1a1c;--high-bg:#3a2419;--elev-bg:#382b10;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0d1218;--panel:#151c25;--ink:#e7ecf2;--ink-2:#b4beca;--muted:#8792a1;--line:#273241;--line-2:#1d2631;
--signal:#3987e5;--signal-soft:#16263b;--fall:#9085e9;--dot:#5b6878;--crit-bg:#3a1a1c;--high-bg:#3a2419;--elev-bg:#382b10;color-scheme:dark}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 var(--sans)}
a{color:var(--signal);text-underline-offset:3px}
a:focus-visible,button:focus-visible,input:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--signal);outline-offset:2px;border-radius:4px}
.wrap{max-width:1120px;margin:0 auto;padding:0 16px}
.skip{position:absolute;left:-999px}.skip:focus{left:16px;top:8px;background:var(--panel);padding:8px 12px;z-index:9}

/* header */
.top{border-bottom:1px solid var(--line);background:var(--panel)}
.top .wrap{display:flex;align-items:center;gap:20px;min-height:60px;flex-wrap:wrap}
.brand{font:800 19px/1 var(--display);font-stretch:125%;letter-spacing:-.01em;text-decoration:none;color:var(--ink);display:flex;align-items:center;gap:10px}
.brand svg{flex:none}
nav{display:flex;gap:4px;margin-left:auto;font-size:14px;font-weight:500}
nav a{color:var(--ink-2);text-decoration:none;padding:6px 10px;border-radius:6px}
nav a:hover{background:var(--line-2);color:var(--ink)}
nav a.on{color:var(--ink);background:var(--line-2)}

/* trust bar */
.trust{display:flex;flex-wrap:wrap;gap:6px 20px;align-items:center;font:13px/1.4 var(--mono);color:var(--ink-2);padding:14px 0;border-bottom:1px solid var(--line)}
.trust .state{display:inline-flex;align-items:center;gap:8px;font-weight:600;color:var(--ink)}
.trust .state i{width:9px;height:9px;border-radius:50%;background:var(--good);box-shadow:0 0 0 3px color-mix(in srgb,var(--good) 25%,transparent)}
.trust.stale .state i{background:var(--elevated);box-shadow:0 0 0 3px color-mix(in srgb,var(--elevated) 30%,transparent)}
.trust.stale{color:var(--ink)}

/* headings */
.eyebrow{font:600 12px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}
h1{font:800 clamp(30px,5.2vw,54px)/1.02 var(--display);font-stretch:118%;letter-spacing:-.025em;margin:40px 0 16px;max-width:24ch}
h1 .hl{color:var(--signal)}h1 .hl.alarm{color:var(--critical)}
h2{font:700 22px/1.2 var(--display);font-stretch:112%;letter-spacing:-.01em;margin:0 0 6px}
.section{margin:56px 0 0}
.section-head{display:flex;align-items:end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:16px}
.section-head p{margin:0;color:var(--ink-2);max-width:62ch;font-size:15px}
.lede{font-size:18px;line-height:1.5;color:var(--ink-2);max-width:60ch;margin:0}
.lede b{color:var(--ink);font-weight:600}

/* radar */
.radar{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 18px 10px;position:relative}
.radar svg{display:block;width:100%;height:auto;overflow:visible}
.radar .axis-t{font:11px var(--mono);fill:var(--muted)}
.radar .lab{font:600 12px var(--mono);fill:var(--ink);paint-order:stroke;stroke:var(--panel);stroke-width:4px;stroke-linejoin:round}
.radar .zone-t{font:600 11px var(--mono);fill:var(--critical);letter-spacing:.06em}
.pt{cursor:pointer}
.pt circle{transition:r .12s}
.pt:hover circle.m,.pt:focus circle.m{r:7}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;color:var(--ink-2);padding:10px 2px 4px}
.legend span{display:inline-flex;align-items:center;gap:7px}
.legend i{width:10px;height:10px;border-radius:50%;display:inline-block}

/* tooltip */
#tip{position:fixed;pointer-events:none;z-index:20;background:var(--ink);color:var(--panel);font:12px/1.45 var(--mono);padding:8px 10px;border-radius:8px;max-width:300px;opacity:0;transform:translateY(4px);transition:opacity .1s,transform .1s;white-space:pre-line}
#tip.on{opacity:1;transform:none}

/* severity */
.sev{display:inline-flex;align-items:center;gap:6px;font:600 12px/1 var(--mono);padding:5px 9px 5px 8px;border-radius:99px;color:var(--ink);white-space:nowrap}
.sev i{width:8px;height:8px;display:inline-block}
.sev-critical{background:var(--crit-bg)}.sev-critical i{background:var(--critical);transform:rotate(45deg)}
.sev-high{background:var(--high-bg)}.sev-high i{width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid var(--high)}
.sev-elevated{background:var(--elev-bg)}.sev-elevated i{background:var(--elevated);border-radius:50%}
.abuse{font:600 11px/1 var(--mono);color:var(--ink-2);border:1px solid var(--line);padding:4px 8px;border-radius:99px;text-decoration:none;white-space:nowrap}
.abuse:hover{border-color:var(--ink-2)}

/* watch list */
.watch{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:10px;text-decoration:none;color:var(--ink);position:relative;transition:border-color .15s,transform .15s}
.card:hover{border-color:var(--ink-2);transform:translateY(-1px)}
.card.critical{border-top:3px solid var(--critical)}.card.high{border-top:3px solid var(--high)}.card.elevated{border-top:3px solid var(--elevated)}
.card .row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.card .name{font:800 25px/1 var(--display);font-stretch:100%;letter-spacing:-.02em;overflow-wrap:anywhere}
.card .big{font:600 22px/1 var(--mono);letter-spacing:-.02em}
.card .meta{font-size:13px;color:var(--ink-2)}
.card svg{width:100%;height:44px;display:block}
.chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.empty{background:var(--panel);border:1px dashed var(--line);border-radius:14px;padding:20px;color:var(--ink-2)}

/* tables */
.tools{display:flex;gap:12px;align-items:center;margin:0 0 12px;flex-wrap:wrap}
input[type=search]{font:inherit;font-size:15px;padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--ink);width:min(340px,100%)}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--panel)}
.seg button{font:500 13px var(--sans);border:0;background:none;color:var(--ink-2);padding:9px 12px;cursor:pointer}
.seg button[aria-pressed=true]{background:var(--ink);color:var(--panel)}
.tablebox{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:auto;max-height:720px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:10px 14px;text-align:left;border-bottom:1px solid var(--line-2);white-space:nowrap}
tbody tr:hover{background:var(--line-2)}
th{font:600 11px/1 var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.06em;background:var(--panel);position:sticky;top:0;z-index:1;border-bottom:1px solid var(--line)}
th[data-sort]{cursor:pointer;user-select:none}
th[data-sort]:hover{color:var(--ink)}
th[data-dir=desc]::after{content:" ↓"}th[data-dir=asc]::after{content:" ↑"}
td.n,th.n{text-align:right;font-family:var(--mono)}
td.spark{width:96px;padding-top:4px;padding-bottom:4px}
td.spark svg{display:block}
.up{color:var(--ink)}.down{color:var(--muted)}.flat{color:var(--muted)}
.tld{font:600 14px var(--mono);text-decoration:none;color:var(--ink)}
.tld:hover{color:var(--signal)}
.idn{font:400 11px var(--mono);color:var(--muted);margin-left:4px}
.muted{color:var(--muted)}
.count{font:13px var(--mono);color:var(--muted)}

/* detail */
.back{display:inline-block;margin-top:28px;font-size:14px}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin:20px 0}
.facts div{background:var(--panel);padding:14px 16px}
.facts b{display:block;font:600 22px/1.2 var(--mono);letter-spacing:-.02em}
.facts small{color:var(--muted);font-size:13px}
.chart{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px}
.chart svg{width:100%;height:auto;display:block;overflow:visible}
.chart .axis-t{font:11px var(--mono);fill:var(--muted)}

/* timeline */
.weeks{display:flex;gap:3px;align-items:flex-end;height:90px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 14px 30px;position:relative;overflow-x:auto}
.weeks .w{flex:1 0 10px;min-width:10px;background:var(--line-2);border-radius:3px 3px 0 0;position:relative}
.weeks .w.has{background:var(--critical)}
.weeks .w span{position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);font:10px var(--mono);color:var(--muted);white-space:nowrap}


/* trends home */
.takeaways{list-style:none;padding:0;margin:0;display:grid;gap:8px;max-width:70ch}
.takeaways li{font-size:17px;color:var(--ink-2);padding-left:22px;position:relative}
.takeaways li::before{content:"";position:absolute;left:4px;top:.6em;width:8px;height:8px;border-radius:2px;background:var(--signal)}
.takeaways b{color:var(--ink);font-weight:600}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin:28px 0 0}
.kpi{background:var(--panel);padding:16px 18px;display:flex;flex-direction:column;gap:2px}
.kpi b{font:600 30px/1.1 var(--mono);letter-spacing:-.03em}
.kpi span{font-size:14px;color:var(--ink)}
.kpi small{font-size:12px;color:var(--muted);font-family:var(--mono)}
.pulses{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.pulse,.sm{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;text-decoration:none;color:var(--ink);display:flex;flex-direction:column;gap:6px;transition:border-color .15s}
.pulse:hover,.sm:hover{border-color:var(--ink-2)}
.pulse .row,.sm .row{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.pn,.smn{font:800 22px/1 var(--display);letter-spacing:-.02em}
.pv{font:600 18px var(--mono)}
.pulse p{margin:0}
.pl svg{width:100%;height:90px;display:block}
.pb svg{width:100%;height:46px;display:block}
.boards{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:12px}
.board{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 16px 10px}
.board h3{font:700 16px/1.2 var(--display);margin:0}
.board .count{margin:2px 0 10px}
.board ol{list-style:none;margin:0;padding:0}
.board li a{display:grid;grid-template-columns:96px 1fr 76px;align-items:center;gap:10px;padding:5px 0;text-decoration:none;color:var(--ink)}
.board li a:hover .bn{color:var(--signal)}
.bn{font:600 13px var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt{height:10px;background:var(--line-2);border-radius:3px;overflow:hidden}
.bb{display:block;height:100%;border-radius:3px}
.bv{font:600 13px var(--mono);text-align:right}
.smgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:10px}
.sm svg{width:100%;height:80px;display:block}
.smn{font-size:18px}
.smv{font:600 14px var(--mono)}.smv.down{color:var(--fall)}

/* tld page seo blocks */
.crumbs{display:flex;gap:8px;flex-wrap:wrap;margin-top:28px;font-size:14px;color:var(--muted)}
.summary{margin-top:8px}.summary p{font-size:17px;line-height:1.6;color:var(--ink-2)}.summary b{color:var(--ink)}
.faq details{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-top:10px}
.faq summary{cursor:pointer;font-weight:600}
.faq p{margin:10px 0 0;color:var(--ink-2)}
.related{list-style:none;padding:0;margin:12px 0 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.related a{display:flex;justify-content:space-between;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;text-decoration:none;color:var(--ink)}
.related a:hover{border-color:var(--ink-2)}
/* prose & data */
.prose{max-width:66ch}.prose p,.prose li{color:var(--ink-2)}.prose h2{margin-top:36px}
.dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}
.dl a{display:block;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;text-decoration:none;color:var(--ink)}
.dl a:hover{border-color:var(--ink-2)}
.dl small{display:block;color:var(--ink-2);margin-top:4px;font-size:13px}
.dl code{font:600 14px var(--mono);color:var(--signal)}
footer{border-top:1px solid var(--line);margin-top:72px;padding:24px 0 48px;color:var(--muted);font-size:13px}
footer .wrap{display:flex;gap:8px 24px;flex-wrap:wrap}
@media (max-width:640px){
 nav{margin-left:0;width:100%;overflow-x:auto;padding-bottom:8px}
 .top .wrap{padding-top:12px}
 th,td{padding:9px 10px}
 .radar{padding:10px 6px 6px;overflow-x:auto}
 .radar svg{min-width:760px}
 .chart{overflow-x:auto}.chart svg{min-width:640px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
"""

JS = """
(function(){
var tip=document.getElementById('tip');
function show(e,el){tip.textContent=el.getAttribute('data-tip');tip.classList.add('on');move(e,el)}
function move(e,el){var x,y;if(e&&e.clientX!=null&&e.type!=='focus'){x=e.clientX;y=e.clientY}else{var r=el.getBoundingClientRect();x=r.left+r.width/2;y=r.top}
 var w=tip.offsetWidth,h=tip.offsetHeight;x=Math.min(Math.max(8,x+14),innerWidth-w-8);y=y-h-12<8?y+18:y-h-12;tip.style.left=x+'px';tip.style.top=y+'px'}
function hide(){tip.classList.remove('on')}
document.querySelectorAll('[data-tip]').forEach(function(el){
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
<meta name="theme-color" content="#0f1a2a">
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
<a class="brand" href="{root}index.html">{LOGO}RootFetch</a>
<nav aria-label="Main">{link("index.html", "Trends", "home")}{link("tlds.html", "Extensions list", "tlds")}{link("spikes.html", "Unusual jumps", "spikes")}{link("data.html", "Data", "data")}{link("about.html", "About", "about")}</nav>
</div></header>
<div class="wrap">{trust}</div>
<main id="main" class="wrap">
{body}
</main>
<footer><div class="wrap"><span>Counts from ICANN CZDS zone files, refreshed daily. Raw zone files are never published.</span>
<a href="{root}feed.xml">RSS feed</a><a href="{REPO_URL}">Source on GitHub</a></div></footer>
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
    ylo = min(-0.04, ws[max(0, int(len(ws) * 0.01))])
    yhi = max(0.12, ws[-1] * 1.08)
    ylo = max(ylo, -0.12)

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
    step = 0.05 if yhi - ylo > 0.2 else 0.02
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
        dots.append(
            f'<a class="pt" href="{root}tld/{esc(c.tld)}.html" data-tip="{esc(tip)}" aria-label="{esc(tip)}">'
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
        text = "." + unicode_name(c.tld)
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
            f'<text class="axis-t" x="{pl - 10}" y="{yy + 4:.1f}" text-anchor="end">{fmt_compact(v) if v >= 1000 else fmt_int(round(v))}</text>'
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
            f'<g class="pt" tabindex="0" data-tip="{esc(tip)}" aria-label="{esc(tip)}">'
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
        f'<p class="count">{fmt_pct((last_v - first_v) / first_v if first_v else 0)} since {fmt_day(pts[0][0], False)} · '
        f'avg {fmt_signed(round(avg))}/day over its last {len(recent)} daily checks</p>'
        f'<div class="pl">{line}</div><div class="pb">{bars}</div>'
        f'<div class="row count"><span>{fmt_day(pts[0][0], False)}</span><span>daily net change</span><span>{fmt_day(pts[-1][0], False)}</span></div></a>'
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

    state = (
        f'<span class="state"><i></i>Data is {age_days} days old</span>'
        if stale
        else '<span class="state"><i></i>Up to date</span>'
    )
    trust = (
        f'<div class="trust{" stale" if stale else ""}" role="status">{state}'
        f"<span>Last update {fmt_day(last_update)}</span>"
        f"<span>{checked_latest} TLDs checked in that run</span>"
        f"<span>{len(series):,} TLDs tracked</span></div>"
    )

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
            f'<span class="hl">{len(growing)} of {len(big)}</span> large domain extensions are growing. '
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
    watch_src = recent if recent else spikes[:4]
    cards = []
    for s in sorted(watch_src, key=lambda s: (-s.pct))[:4]:
        sev = s.severity
        pts = sorted(series[s.tld].items())
        cards.append(
            f'<a class="card {sev[0]}" href="tld/{esc(s.tld)}.html">'
            f'<div class="row"><span class="name">.{esc(unicode_name(s.tld))}</span>{sev_chip(s)}</div>'
            f'<div><span class="big">{fmt_pct(s.pct)}</span> <span class="meta">in {days(s.gap_days)}</span></div>'
            f"{sparkline(pts, 240, 44, 'var(--ink-2)', f'var(--{sev[0]})')}"
            f'<div class="meta">{fmt_signed(s.added)} domains → {fmt_int(s.count)} · {fmt_day(s.date)}</div>'
            f'<div class="chips">{abuse_chip(s.tld)}</div></a>'
        )
    watch_block = f'<div class="watch">{"".join(cards)}</div>' if cards else '<div class="empty">No unusual jumps yet.</div>'

    legend = (
        '<div class="legend">'
        '<span><i style="background:var(--critical)"></i>Critical jump: 20%+</span>'
        '<span><i style="background:var(--high)"></i>High: 10–20%</span>'
        '<span><i style="background:var(--elevated)"></i>Elevated: 5–10%</span>'
        f'<span><i style="background:var(--panel);box-shadow:inset 0 0 0 2px var(--high)"></i>Jumped more than {RECENT_DAYS} days ago</span>'
        '<span><i style="background:var(--dot)"></i>Normal</span></div>'
    )
    index_body = f"""
<p class="eyebrow" style="margin-top:36px">Domain statistics · {fmt_day(last_update)}</p>
<h1>{headline}</h1>
<ul class="takeaways">{"".join(f"<li>{t}</li>" for t in takeaways)}</ul>
<div class="kpis">{kpi_html}</div>

<section class="section" aria-labelledby="pulse-h">
<div class="section-head"><div><h2 id="pulse-h">Daily pulse</h2>
<p>The TLDs checked every day. The line is the total; the bars underneath are each day's net change in domains.</p></div></div>
<div class="pulses">{pulse_html}</div>
</section>

<section class="section" aria-labelledby="boards-h">
<div class="section-head"><div><h2 id="boards-h">Who's growing, who's shrinking</h2>
<p>Rankings from each TLD's latest check. Growth per week is scaled so TLDs checked days or weeks apart compare fairly.</p></div>
<span class="count"><a class="cta" href="tlds.html">All extensions →</a></span></div>
<div class="boards">{boards}</div>
</section>

<section class="section" aria-labelledby="sm-h">
<div class="section-head"><div><h2 id="sm-h">The biggest TLDs since they were first checked</h2>
<p>Each panel starts at 100 on its first check, and all share one scale, so the lines can be compared. Dashed stretches are gaps with no checks.</p></div></div>
<div class="smgrid">{sm_html}</div>
</section>

<section class="section" aria-labelledby="radar-h">
<div class="section-head"><div><h2 id="radar-h">Size vs. growth</h2>
<p>Every TLD with at least {fmt_int(RADAR_MIN_DOMAINS)} domains, placed by size and by growth per week at its latest check. Hover for numbers, click to open.</p></div>
<span class="count">{len(radar_entries)} TLDs checked in the last {RADAR_MAX_AGE_DAYS} days</span></div>
<div class="radar">{radar_chart(radar_entries, recent_cut)}{legend}</div>
</section>

<section class="section" aria-labelledby="watch-h">
<div class="section-head"><div><h2 id="watch-h">Unusual jumps</h2>
<p>At least {fmt_int(SPIKE_MIN_ADDED)} new domains and {SPIKE_MIN_PCT:.0%}+ growth within {SPIKE_MAX_GAP_DAYS} days. Sometimes a price promotion, sometimes bulk registrations for spam or phishing.</p></div>
<span class="count"><a class="cta" href="spikes.html">All {len(spikes)} jumps →</a> · <a class="cta" href="feed.xml">RSS</a></span></div>
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
    top3 = sorted(series, key=lambda t: -series[t][max(series[t])])[:3]
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
<p class="eyebrow" style="margin-top:40px">TLD list · {fmt_day(last_update)}</p>
<h1>Domain extensions list: all {len(series):,} TLDs ranked by size</h1>
<p class="lede">Every domain extension (TLD) RootFetch tracks, with its number of registered domains and how it changed since its previous check. Growth is scaled to one week so extensions checked at different intervals compare fairly.</p>
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
    (out_dir / "tlds.html").write_text(page(f"Domain extensions list: {len(series):,} TLDs ranked | RootFetch", tlds_body, active="tlds", trust=trust,
                                               path="tlds.html",
                                               description=f"Full TLD list: {len(series):,} domain extensions ranked by number of registered domains, with weekly growth, trend lines and unusual-jump flags. Updated {fmt_day(last_update)}.",
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
    spikes_body = f"""
<p class="eyebrow" style="margin-top:40px">Alerts</p>
<h1>{len(spikes)} spikes so far</h1>
<p class="lede">A spike is when a TLD gains at least {fmt_int(SPIKE_MIN_ADDED)} domains and grows {SPIKE_MIN_PCT:.0%} or more since its previous check, and that check was no more than {SPIKE_MAX_GAP_DAYS} days earlier. Severity follows the size of the jump: <b>Elevated</b> 5–10%, <b>High</b> 10–20%, <b>Critical</b> 20% and up.</p>
<p><a class="cta" href="feed.xml">Follow new spikes by RSS</a> · <a class="cta" href="data/spikes.csv">CSV</a> · <a class="cta" href="data/spikes.json">JSON</a></p>
<section class="section" aria-labelledby="t-h"><div class="section-head"><h2 id="t-h">Spikes per week</h2>
<p>Weeks without data look the same as quiet weeks. Check the trust bar above for gaps.</p></div>
<div class="weeks">{"".join(bars)}</div></section>
<section class="section"><div class="tablebox"><table data-sortable>
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
        noindex = last_v < NOINDEX_BELOW
        rank = size_rank[tld]
        sub = f'<p class="count">{esc(tld)}</p>' if u != tld else ""

        # plain-language summary, written from this TLD's own numbers
        facts = [f".{esc(u)} has <b>{fmt_int(last_v)}</b> registered domains as of {fmt_day(last_d)}, "
                 f"making it the <b>#{rank:,}</b> largest of the {len(series):,} domain extensions RootFetch tracks."]
        if len(ordered) > 1:
            direction = "grown" if overall > 0 else "shrunk" if overall < 0 else "held steady"
            facts.append(
                f"Since its first check on {fmt_day(first_d)} it has {direction}"
                + (f" by <b>{fmt_pct(abs(overall_pct) if overall < 0 else overall_pct, 1).lstrip('+').replace(chr(8722), '')}</b> "
                   f"({fmt_signed(overall)} domains)." if overall else ".")
            )
        if latest and latest.gap_days <= 60:
            facts.append(
                f"At its latest check it changed by {fmt_signed(latest.added)} domains over {latest.gap_days} days, "
                f"about <b>{fmt_pct(latest.weekly)}</b> a week"
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

        faq = [(f"How many .{u} domains are there?",
                f"As of {fmt_day(last_d)}, there are {fmt_int(last_v)} registered .{u} domains, counted from the .{u} zone file published through ICANN's Centralized Zone Data Service.")]
        if len(ordered) > 1:
            faq.append((f"Is .{u} growing?",
                        f".{u} went from {fmt_int(first_v)} domains on {fmt_day(first_d)} to {fmt_int(last_v)} on {fmt_day(last_d)}, "
                        f"a change of {fmt_pct(overall_pct)}."
                        + (f" Its latest rate is about {fmt_pct(latest.weekly)} a week." if latest and latest.gap_days <= 60 else "")))
        faq.append((f"How big is the .{u} domain extension compared to others?",
                    f".{u} is the #{rank:,} largest of {len(series):,} tracked domain extensions (TLDs)."
                    + (f" Similar-sized TLDs include {', '.join('.' + unicode_name(t) for t in near[:3])}." if near else "")))
        if tspikes:
            faq.append((f"Has .{u} had sudden registration spikes?",
                        f"Yes. RootFetch recorded {len(tspikes)} unusual jump{'s' if len(tspikes) != 1 else ''} in .{u}, "
                        f"where it gained at least {fmt_int(SPIKE_MIN_ADDED)} domains and {SPIKE_MIN_PCT:.0%} or more within {SPIKE_MAX_GAP_DAYS} days."))
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
<h1 style="margin-top:12px">.{esc(u)} domain statistics</h1>{sub}
<div class="chips">{(sev_chip(tspikes[-1]) + f'<span class="count">last jump {fmt_day(tspikes[-1].date)}</span>') if tspikes else ""}{abuse_chip(tld, 1)}</div>
<div class="facts">
<div><b>{fmt_int(last_v)}</b><small>domains on {fmt_day(last_d)}</small></div>
<div><b>{fmt_signed(overall)}</b><small>since {fmt_day(first_d)} ({fmt_pct(overall_pct)})</small></div>
<div><b>#{rank:,}</b><small>largest of {len(series):,} TLDs</small></div>
<div><b>{len(tspikes)}</b><small>unusual jump{"s" if len(tspikes) != 1 else ""}</small></div>
</div>
<div class="prose summary"><p>{summary}</p>{context}</div>
<div class="chart" style="margin-top:20px">{history_chart(ordered, by_date)}</div>
<p class="count" style="margin-top:8px">Dashed lines mark gaps longer than {SPIKE_MAX_GAP_DAYS} days with no checks. <a class="cta" href="../data/tld/{esc(tld)}.csv">Download .{esc(u)} history (CSV)</a></p>
<section class="section"><h2>Every check</h2>
<div class="tablebox" style="margin-top:12px"><table><thead><tr><th>Date</th><th class="n">Domains</th><th class="n">Change</th><th class="n">Growth</th><th class="n">Window</th><th>Severity</th></tr></thead>
<tbody>{"".join(hist_rows)}</tbody></table></div></section>
<section class="section faq"><h2>Questions about .{esc(u)}</h2>{faq_html}</section>
<section class="section"><h2>Domain extensions of similar size</h2><ul class="related">{related}</ul></section>
"""
        title = f".{u} domain statistics: {fmt_int(last_v)} domains | RootFetch"
        if len(title) > 60:
            title = f".{u} domains: {fmt_int(last_v)} | RootFetch"
        if len(title) > 60:
            title = f".{u} domain statistics | RootFetch"
        desc = (
            f"How many .{u} domains are there? {fmt_int(last_v)} as of {fmt_day(last_d)}"
            + (f", {fmt_pct(overall_pct, 0 if abs(overall_pct) >= .1 else 1)} since {fmt_day(first_d, False)}" if len(ordered) > 1 else "")
            + f". .{u} domain statistics, growth and trends from ICANN zone files."
        )
        if len(desc) > 158:
            desc = f"How many .{u} domains are there? {fmt_int(last_v)} as of {fmt_day(last_d)}. Domain statistics and trends from ICANN zone files."
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
<p class="eyebrow" style="margin-top:40px">Open data</p>
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
<p>A count is the number of distinct second-level names with NS records in a TLD's zone file. About {checked_latest} TLDs are checked per run on a rolling schedule, so each is re-checked roughly every two weeks; .xyz, .app and .dev are checked daily. Only TLDs RootFetch has CZDS access to are included, which is why .com isn't here yet.</p>
<p>Spikes: {fmt_int(SPIKE_MIN_ADDED)}+ new domains and {SPIKE_MIN_PCT:.0%}+ growth over a window of {SPIKE_MAX_GAP_DAYS} days or less. Severity: Elevated 5–10%, High 10–20%, Critical 20%+.</p></section>
"""
    (out_dir / "data.html").write_text(page("Download TLD domain count data (CSV, JSON) · RootFetch", data_body, active="data", trust=trust, path="data.html",
                                               description="Free downloads of daily domain counts for every tracked top-level domain: full history CSV, latest JSON, unusual jumps and an RSS feed. CC BY 4.0."))

    abuse_items = "".join(
        f'<li><b>.{esc(t)}</b>: <a href="{src}">{"Interisle Phishing Landscape 2025" if src == INTERISLE_2025 else "Interisle report, June 2026"}</a></li>'
        for t, src in sorted(KNOWN_ABUSE.items())
    )
    about_body = f"""
<p class="eyebrow" style="margin-top:40px">About</p>
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
