#!/usr/bin/env python3
"""Build the static rootfetch.com site from data/daily_counts/*.csv.

Stdlib only. Output goes to _site/ and is deployed by GitHub Pages.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import shutil
from dataclasses import dataclass
from datetime import date, datetime, timezone
from email.utils import format_datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
COUNTS_DIR = REPO_ROOT / "data" / "daily_counts"
SITE_URL = "https://rootfetch.com"
REPO_URL = "https://github.com/khalidsaidi/rootfetch"

# A spike is a jump of at least SPIKE_MIN_ADDED domains and SPIKE_MIN_PCT growth
# since the previous check, where that check was at most SPIKE_MAX_GAP_DAYS earlier.
SPIKE_MIN_BASE = 1000
SPIKE_MIN_ADDED = 1000
SPIKE_MIN_PCT = 0.05
SPIKE_MAX_GAP_DAYS = 21
STALE_AFTER_DAYS = 3


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

    def is_spike(self) -> bool:
        return (
            self.gap_days <= SPIKE_MAX_GAP_DAYS
            and self.prev_count >= SPIKE_MIN_BASE
            and self.added >= SPIKE_MIN_ADDED
            and self.pct >= SPIKE_MIN_PCT
        )

    def as_dict(self) -> dict:
        return {
            "tld": self.tld,
            "date": self.date,
            "prev_date": self.prev_date,
            "gap_days": self.gap_days,
            "prev_count": self.prev_count,
            "count": self.count,
            "added": self.added,
            "pct": round(self.pct, 6),
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


def fmt_int(n: int) -> str:
    return f"{n:,}"


def fmt_signed(n: int) -> str:
    return f"+{n:,}" if n > 0 else f"{n:,}".replace("-", "−")


def fmt_pct(p: float) -> str:
    s = f"{p * 100:+.1f}%"
    return s.replace("-", "−")


def fmt_day(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d.strftime('%b')} {d.day}, {d.year}"


def trend_class(n: float) -> str:
    return "up" if n > 0 else "down" if n < 0 else "flat"


CSS = """
:root{--bg:#fbfaf7;--panel:#ffffff;--ink:#1b1d1f;--muted:#62676d;--line:#e4e1da;
--accent:#0b6e4f;--up:#0b6e4f;--down:#b42318;--warn-bg:#fff4e0;--warn-ink:#7a4b00;--spike:#b42318;--spike-bg:#fdecea;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#121416;--panel:#1a1d20;--ink:#e8e6e1;--muted:#9aa0a6;--line:#2c3035;
--accent:#4cc9a0;--up:#4cc9a0;--down:#ff7b72;--warn-bg:#3a2a0c;--warn-ink:#f5c56b;--spike:#ff7b72;--spike-bg:#3a1714}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 var(--sans)}
a{color:var(--accent)}
.wrap{max-width:1040px;margin:0 auto;padding:0 16px}
header.top{border-bottom:1px solid var(--line);background:var(--panel)}
header.top .wrap{display:flex;align-items:center;gap:20px;height:56px}
.brand{font-weight:700;font-size:17px;text-decoration:none;color:var(--ink);letter-spacing:-.01em}
.brand span{color:var(--accent)}
nav{display:flex;gap:16px;margin-left:auto;font-size:14px}
nav a{color:var(--muted);text-decoration:none}
nav a:hover,nav a.on{color:var(--ink)}
h1{font-size:28px;line-height:1.2;letter-spacing:-.02em;margin:36px 0 8px}
h2{font-size:18px;margin:36px 0 12px}
.lede{color:var(--muted);max-width:640px;margin:0 0 24px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:24px 0}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.stat b{display:block;font:600 22px/1.2 var(--mono);letter-spacing:-.02em}
.stat small{color:var(--muted);font-size:13px}
.banner{background:var(--warn-bg);color:var(--warn-ink);border-radius:10px;padding:12px 16px;margin:20px 0;font-size:14px}
.tablebox{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:9px 14px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
tr:last-child td{border-bottom:0}
th{font-weight:600;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em;background:var(--panel);position:sticky;top:0}
th[data-sort]{cursor:pointer;user-select:none}
th[data-sort]:hover{color:var(--ink)}
td.n,th.n{text-align:right;font-family:var(--mono)}
.up{color:var(--up)}.down{color:var(--down)}.flat{color:var(--muted)}
.tag{display:inline-block;font-size:11px;font-weight:600;padding:1px 7px;border-radius:99px;background:var(--spike-bg);color:var(--spike);margin-left:6px;vertical-align:1px}
.tld{font-family:var(--mono);font-weight:600}
.tools{display:flex;gap:12px;align-items:center;margin:0 0 12px;flex-wrap:wrap}
input[type=search]{font:inherit;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);width:min(320px,100%)}
.muted{color:var(--muted)}
.chart{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}
.chart svg{width:100%;height:auto;display:block}
.dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.dl a{display:block;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 16px;text-decoration:none;color:var(--ink)}
.dl a small{display:block;color:var(--muted)}
.dl code{font-family:var(--mono);font-size:13px;color:var(--accent)}
footer{border-top:1px solid var(--line);margin-top:56px;padding:20px 0 40px;color:var(--muted);font-size:13px}
@media (max-width:600px){h1{font-size:23px}nav{gap:12px}th,td{padding:8px 10px}}
"""

SORT_JS = """
document.querySelectorAll('table[data-sortable]').forEach(function(t){
  t.querySelectorAll('th[data-sort]').forEach(function(th,i){
    th.addEventListener('click',function(){
      var idx=Array.prototype.indexOf.call(th.parentNode.children,th);
      var desc=th.dataset.dir!=='desc';th.dataset.dir=desc?'desc':'asc';
      var rows=Array.from(t.tBodies[0].rows);
      rows.sort(function(a,b){
        var x=a.cells[idx].dataset.v,y=b.cells[idx].dataset.v;
        var nx=parseFloat(x),ny=parseFloat(y);
        var c=(!isNaN(nx)&&!isNaN(ny))?nx-ny:String(x).localeCompare(String(y));
        return desc?-c:c;});
      rows.forEach(function(r){t.tBodies[0].appendChild(r)});
    });
  });
});
var q=document.getElementById('q');
if(q){q.addEventListener('input',function(){
  var v=q.value.trim().toLowerCase().replace(/^\\./,'');
  document.querySelectorAll('#all tbody tr').forEach(function(r){
    r.style.display=!v||r.dataset.tld.indexOf(v)!==-1?'':'none';});
});}
"""


def page(title: str, body: str, *, active: str = "", depth: int = 0, description: str = "") -> str:
    root = "../" * depth
    desc = description or "Daily domain counts for top-level domains, from ICANN zone files."

    def link(href: str, label: str, key: str) -> str:
        cls = ' class="on"' if key == active else ""
        return f'<a href="{root}{href}"{cls}>{label}</a>'

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="alternate" type="application/rss+xml" title="RootFetch spikes" href="{SITE_URL}/feed.xml">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230b6e4f'/%3E%3Cpath d='M7 22l6-7 5 4 7-9' stroke='white' stroke-width='3' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<style>{CSS}</style>
</head>
<body>
<header class="top"><div class="wrap">
<a class="brand" href="{root}index.html">Root<span>Fetch</span></a>
<nav>{link("index.html", "Domains", "home")}{link("spikes.html", "Spikes", "spikes")}{link("data.html", "Data", "data")}{link("about.html", "About", "about")}</nav>
</div></header>
<main class="wrap">
{body}
</main>
<footer><div class="wrap">Counts come from ICANN CZDS zone files and are refreshed daily. Raw zone files are never published.
 · <a href="{REPO_URL}">Source</a> · <a href="{root}feed.xml">RSS</a></div></footer>
<script>{SORT_JS}</script>
</body>
</html>
"""


def line_chart(points: list[tuple[str, int]], spike_dates: set[str]) -> str:
    if len(points) < 2:
        return '<p class="muted">Not enough checks yet to draw a chart.</p>'
    w, h, pl, pr, pt, pb = 720, 240, 64, 16, 16, 30
    d0 = date.fromisoformat(points[0][0]).toordinal()
    d1 = date.fromisoformat(points[-1][0]).toordinal()
    vals = [v for _, v in points]
    lo, hi = min(vals), max(vals)
    if lo == hi:
        lo, hi = lo - 1, hi + 1
    pad = (hi - lo) * 0.08
    lo, hi = max(0, lo - pad), hi + pad

    def x(iso: str) -> float:
        return pl + (date.fromisoformat(iso).toordinal() - d0) / max(1, d1 - d0) * (w - pl - pr)

    def y(v: float) -> float:
        return pt + (1 - (v - lo) / (hi - lo)) * (h - pt - pb)

    grid = []
    for i in range(4):
        v = lo + (hi - lo) * i / 3
        yy = y(v)
        grid.append(
            f'<line x1="{pl}" x2="{w - pr}" y1="{yy:.1f}" y2="{yy:.1f}" stroke="var(--line)"/>'
            f'<text x="{pl - 8}" y="{yy + 4:.1f}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--mono)">{fmt_int(round(v))}</text>'
        )
    path = " ".join(f"{x(d):.1f},{y(v):.1f}" for d, v in points)
    dots = "".join(
        f'<circle cx="{x(d):.1f}" cy="{y(v):.1f}" r="{4.5 if d in spike_dates else 3}" '
        f'fill="{"var(--spike)" if d in spike_dates else "var(--accent)"}"><title>{fmt_day(d)}: {fmt_int(v)}</title></circle>'
        for d, v in points
    )
    labels = (
        f'<text x="{pl}" y="{h - 8}" font-size="11" fill="var(--muted)">{fmt_day(points[0][0])}</text>'
        f'<text x="{w - pr}" y="{h - 8}" font-size="11" fill="var(--muted)" text-anchor="end">{fmt_day(points[-1][0])}</text>'
    )
    return (
        f'<svg viewBox="0 0 {w} {h}" role="img" aria-label="Domain count over time">'
        f'{"".join(grid)}<polyline points="{path}" fill="none" stroke="var(--accent)" stroke-width="2"/>{dots}{labels}</svg>'
    )


def spike_rows(spikes: list[Change], depth: int = 0) -> str:
    root = "../" * depth
    rows = []
    for s in spikes:
        rows.append(
            f'<tr><td>{fmt_day(s.date)}</td>'
            f'<td><a class="tld" href="{root}tld/{esc(s.tld)}.html">.{esc(s.tld)}</a></td>'
            f'<td class="n up">{fmt_signed(s.added)}</td><td class="n up">{fmt_pct(s.pct)}</td>'
            f'<td class="n">{fmt_int(s.count)}</td><td class="n muted">{s.gap_days}d</td></tr>'
        )
    return "".join(rows)


SPIKE_HEAD = (
    '<thead><tr><th>Date</th><th>TLD</th><th class="n">New domains</th><th class="n">Growth</th>'
    '<th class="n">Total now</th><th class="n">Since last check</th></tr></thead>'
)


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
    age_days = (today - date.fromisoformat(last_update)).days
    total_domains = sum(pts[max(pts)] for pts in series.values())

    if out_dir.exists():
        shutil.rmtree(out_dir)
    (out_dir / "tld").mkdir(parents=True)
    (out_dir / "data").mkdir()

    stale = ""
    if age_days > STALE_AFTER_DAYS:
        stale = (
            f'<div class="banner">Heads up: the newest data is from {fmt_day(last_update)} '
            f"({age_days} days ago). Daily updates are catching up.</div>"
        )

    # ---------- index ----------
    rows = []
    latest_rows = []
    for tld in sorted(series, key=lambda t: -series[t][max(series[t])]):
        pts = series[tld]
        last = max(pts)
        cs = all_changes[tld]
        ch = cs[-1] if cs else None
        is_spike = bool(ch and ch.is_spike())
        latest_rows.append(
            {
                "tld": tld,
                "count": pts[last],
                "last_checked": last,
                "prev_count": ch.prev_count if ch else None,
                "prev_checked": ch.prev_date if ch else None,
                "added": ch.added if ch else None,
                "pct": round(ch.pct, 6) if ch else None,
                "spike": is_spike,
            }
        )
        added_cell = (
            f'<td class="n {trend_class(ch.added)}" data-v="{ch.added}">{fmt_signed(ch.added)}</td>'
            f'<td class="n {trend_class(ch.added)}" data-v="{ch.pct:.6f}">{fmt_pct(ch.pct)}</td>'
            if ch
            else '<td class="n muted" data-v="0">–</td><td class="n muted" data-v="0">–</td>'
        )
        tag = '<span class="tag">spike</span>' if is_spike else ""
        rows.append(
            f'<tr data-tld="{esc(tld)}"><td data-v="{esc(tld)}"><a class="tld" href="tld/{esc(tld)}.html">.{esc(tld)}</a>{tag}</td>'
            f'<td class="n" data-v="{pts[last]}">{fmt_int(pts[last])}</td>{added_cell}'
            f'<td data-v="{last}">{fmt_day(last)}</td></tr>'
        )

    recent_spikes = spikes[:6]
    spike_block = (
        f'<div class="tablebox"><table>{SPIKE_HEAD}<tbody>{spike_rows(recent_spikes)}</tbody></table></div>'
        f'<p><a href="spikes.html">All {len(spikes)} spikes →</a> · <a href="feed.xml">Follow by RSS</a></p>'
        if recent_spikes
        else '<p class="muted">No spikes detected yet.</p>'
    )

    index_body = f"""
<h1>How many domains each top-level domain has, day by day</h1>
<p class="lede">RootFetch counts the registered domains under {len(series):,} top-level domains (.xyz, .app, .lol and others) from ICANN's zone files, and flags sudden jumps, which are often a sign of bulk registrations for spam or phishing.</p>
{stale}
<div class="stats">
<div class="stat"><b>{len(series):,}</b><small>top-level domains tracked</small></div>
<div class="stat"><b>{fmt_int(total_domains)}</b><small>domains counted</small></div>
<div class="stat"><b>{len(spikes)}</b><small>spikes flagged</small></div>
<div class="stat"><b>{fmt_day(last_update)}</b><small>last update</small></div>
</div>
<h2>Latest spikes</h2>
{spike_block}
<h2>All top-level domains</h2>
<div class="tools"><input id="q" type="search" placeholder="Filter, e.g. xyz" aria-label="Filter top-level domains">
<span class="muted">Click a column to sort. Change is since that domain's previous check.</span></div>
<div class="tablebox"><table id="all" data-sortable>
<thead><tr><th data-sort>TLD</th><th class="n" data-sort>Domains</th><th class="n" data-sort>Change</th><th class="n" data-sort>Growth</th><th data-sort>Last checked</th></tr></thead>
<tbody>{"".join(rows)}</tbody></table></div>
"""
    (out_dir / "index.html").write_text(page("RootFetch: domain counts by TLD", index_body, active="home"))

    # ---------- spikes ----------
    spikes_body = f"""
<h1>Spikes</h1>
<p class="lede">A spike is when a top-level domain gains at least {fmt_int(SPIKE_MIN_ADDED)} domains and grows at least {SPIKE_MIN_PCT:.0%} since its previous check (within {SPIKE_MAX_GAP_DAYS} days). Sudden bulk registrations in cheap TLDs often come before spam and phishing campaigns, so these are worth a look. A spike isn't proof of abuse: promotions and price drops cause them too.</p>
<p><a href="feed.xml">Subscribe by RSS</a> · <a href="data/spikes.csv">Download CSV</a> · <a href="data/spikes.json">JSON</a></p>
{stale}
<div class="tablebox"><table>{SPIKE_HEAD}<tbody>{spike_rows(spikes) or '<tr><td colspan="6" class="muted">No spikes yet.</td></tr>'}</tbody></table></div>
"""
    (out_dir / "spikes.html").write_text(
        page("Spikes · RootFetch", spikes_body, active="spikes", description="Sudden jumps in domain registrations by TLD.")
    )

    # ---------- per-TLD ----------
    for tld, pts in series.items():
        ordered = sorted(pts.items())
        cs = all_changes[tld]
        spike_dates = {c.date for c in cs if c.is_spike()}
        change_by_date = {c.date: c for c in cs}
        hist_rows = []
        for d, v in reversed(ordered):
            c = change_by_date.get(d)
            tag = '<span class="tag">spike</span>' if d in spike_dates else ""
            if c:
                cells = f'<td class="n {trend_class(c.added)}">{fmt_signed(c.added)}</td><td class="n {trend_class(c.added)}">{fmt_pct(c.pct)}</td>'
            else:
                cells = '<td class="n muted">–</td><td class="n muted">–</td>'
            hist_rows.append(f"<tr><td>{fmt_day(d)}{tag}</td><td class=\"n\">{fmt_int(v)}</td>{cells}</tr>")
        first_d, first_v = ordered[0]
        last_d, last_v = ordered[-1]
        overall = last_v - first_v
        body = f"""
<p style="margin-top:28px"><a href="../index.html">← All top-level domains</a></p>
<h1><span class="tld">.{esc(tld)}</span></h1>
<div class="stats">
<div class="stat"><b>{fmt_int(last_v)}</b><small>domains on {fmt_day(last_d)}</small></div>
<div class="stat"><b class="{trend_class(overall)}">{fmt_signed(overall)}</b><small>since {fmt_day(first_d)}</small></div>
<div class="stat"><b>{len(ordered)}</b><small>checks recorded</small></div>
<div class="stat"><b>{len(spike_dates)}</b><small>spikes</small></div>
</div>
<div class="chart">{line_chart(ordered, spike_dates)}</div>
<h2>History</h2>
<div class="tablebox"><table><thead><tr><th>Date</th><th class="n">Domains</th><th class="n">Change</th><th class="n">Growth</th></tr></thead>
<tbody>{"".join(hist_rows)}</tbody></table></div>
"""
        (out_dir / "tld" / f"{tld}.html").write_text(
            page(f".{tld} domain count · RootFetch", body, depth=1, description=f"Daily domain count history for .{tld}.")
        )

    # ---------- data files ----------
    with (out_dir / "data" / "history.csv").open("w", newline="") as handle:
        w = csv.writer(handle)
        w.writerow(["date", "tld", "count"])
        for tld in sorted(series):
            for d, v in sorted(series[tld].items()):
                w.writerow([d, tld, v])
    with (out_dir / "data" / "spikes.csv").open("w", newline="") as handle:
        fields = ["date", "tld", "prev_date", "gap_days", "prev_count", "count", "added", "pct"]
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
                },
                "spikes": [s.as_dict() for s in spikes],
            },
            indent=1,
        )
    )
    (out_dir / "status.json").write_text(
        json.dumps({"last_update": last_update, "age_days": age_days, "stale": age_days > STALE_AFTER_DAYS})
    )

    data_body = f"""
<h1>Data</h1>
<p class="lede">Everything on this site is free to download and reuse. Files are regenerated every day.</p>
<div class="dl">
<a href="data/history.csv"><code>history.csv</code><small>Every check for every TLD: date, tld, count.</small></a>
<a href="data/latest.json"><code>latest.json</code><small>Latest count per TLD with change since the previous check.</small></a>
<a href="data/spikes.csv"><code>spikes.csv</code><small>Every flagged spike.</small></a>
<a href="data/spikes.json"><code>spikes.json</code><small>Spikes plus the rule used to flag them.</small></a>
<a href="feed.xml"><code>feed.xml</code><small>RSS feed of new spikes.</small></a>
<a href="status.json"><code>status.json</code><small>Date of the newest data, for monitoring.</small></a>
</div>
<h2>Notes</h2>
<p>Counts are the number of distinct second-level names with NS records in each zone file. Most TLDs are re-checked about every two weeks on a rolling schedule; a few (.xyz, .app, .dev) are checked daily. Only TLDs RootFetch has been granted CZDS access to are included.</p>
"""
    (out_dir / "data.html").write_text(page("Data · RootFetch", data_body, active="data"))

    about_body = f"""
<h1>About</h1>
<p class="lede">RootFetch is a small, free, open project that tracks how many domains are registered under each top-level domain.</p>
<h2>Where the numbers come from</h2>
<p>ICANN's <a href="https://czds.icann.org/">Centralized Zone Data Service</a> gives approved users daily copies of TLD zone files. Every day an automated job downloads a rolling set of them, counts the domains, and throws the raw files away. Only the counts are published.</p>
<h2>Why spikes matter</h2>
<p>Most TLDs grow slowly. When one suddenly gains thousands of domains, it's often a registrar promotion, and sometimes a batch bought for spam, phishing or malware. The <a href="spikes.html">spikes page</a> lists these jumps so they're easy to spot.</p>
<h2>Source</h2>
<p>The code and the full data history are on <a href="{REPO_URL}">GitHub</a>.</p>
"""
    (out_dir / "about.html").write_text(page("About · RootFetch", about_body, active="about"))

    (out_dir / "404.html").write_text(
        page("Not found · RootFetch", '<h1>Page not found</h1><p><a href="/">Go to the home page</a></p>')
    )

    # ---------- RSS ----------
    items = []
    for s in spikes[:50]:
        pub = datetime.combine(date.fromisoformat(s.date), datetime.min.time(), tzinfo=timezone.utc)
        link = f"{SITE_URL}/tld/{s.tld}.html"
        items.append(
            f"<item><title>.{esc(s.tld)} gained {fmt_int(s.added)} domains ({fmt_pct(s.pct)})</title>"
            f"<link>{link}</link><guid isPermaLink=\"false\">rootfetch-spike-{esc(s.tld)}-{s.date}</guid>"
            f"<pubDate>{format_datetime(pub)}</pubDate>"
            f"<description>.{esc(s.tld)} went from {fmt_int(s.prev_count)} to {fmt_int(s.count)} domains between "
            f"{fmt_day(s.prev_date)} and {fmt_day(s.date)}.</description></item>"
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
    (out_dir / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {SITE_URL}/sitemap.xml\n")
    urls = ["", "spikes.html", "data.html", "about.html"] + [f"tld/{t}.html" for t in sorted(series)]
    (out_dir / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        + "".join(f"<url><loc>{SITE_URL}/{u}</loc></url>" for u in urls)
        + "</urlset>\n"
    )

    return {"tlds": len(series), "spikes": len(spikes), "last_update": last_update, "age_days": age_days}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "_site")
    parser.add_argument("--counts-dir", type=Path, default=COUNTS_DIR)
    args = parser.parse_args()
    summary = build(args.out, args.counts_dir, datetime.now(timezone.utc).date())
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
