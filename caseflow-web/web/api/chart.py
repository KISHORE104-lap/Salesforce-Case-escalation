# api/chart.py  ->  URL: /api/chart   (a Python serverless function on Vercel)
#
# Draws the CaseFlow "Live insights" charts with the Python library pygal.
# The browser sends the counts; this function returns the charts as SVG text.
#
#   POST /api/chart
#   body:  {"levels": [agent, lead, manager, admin], "sla": {"ok": 3, "risk": 1, "breach": 2, "none": 1}, "theme": "light"}
#   reply: {"levelChart": "<svg ...>", "slaChart": "<svg ...>"}

import json
from http.server import BaseHTTPRequestHandler

try:
    import pygal  # the chart library (installed by Vercel from api/requirements.txt)
    from pygal.style import Style
    HAVE_PYGAL = True
except ImportError:  # if it is missing, the plain-Python fallback below draws the charts
    HAVE_PYGAL = False

LEVELS = ["Support Agent", "Team Lead", "Support Manager", "Case Admin"]
PALETTE = {
    "light": {"ink": "#1E2A3A", "soft": "#4F5D6E", "grid": "#DDE4E0", "pen": "#2F5DA8",
              "ok": "#2F8F5B", "risk": "#B87503", "breach": "#C62E2E", "none": "#8A96A3"},
    "dark": {"ink": "#E6ECEF", "soft": "#A3B0BC", "grid": "#33414F", "pen": "#7FA6E6",
             "ok": "#5CC08A", "risk": "#E5A93A", "breach": "#F07070", "none": "#7D8A97"},
}


def make_style(p, colors):
    return Style(
        background="transparent",
        plot_background="transparent",
        foreground=p["soft"],
        foreground_strong=p["ink"],
        foreground_subtle=p["grid"],
        colors=colors,
        value_colors=(p["ink"],),
        font_family="Atkinson Hyperlegible, Segoe UI, sans-serif",
        label_font_size=20,
        major_label_font_size=20,
        value_font_size=22,
        legend_font_size=22,
        tooltip_font_size=18,
        opacity=0.95,
        opacity_hover=1,
    )


def count(value):
    try:
        return max(0, min(10000, int(value)))
    except (TypeError, ValueError):
        return 0


def render(data):
    p = PALETTE["dark" if data.get("theme") == "dark" else "light"]
    levels = (list(data.get("levels") or []) + [0, 0, 0, 0])[:4]
    sla = data.get("sla") or {}
    if not HAVE_PYGAL:
        return {
            "levelChart": svg_bars(LEVELS, [count(v) for v in levels], p["pen"], p["ink"], p["soft"], p["grid"]),
            "slaChart": svg_donut(["On track", "At risk", "Breached", "No SLA"],
                                  [count(sla.get(k)) for k in ("ok", "risk", "breach", "none")],
                                  (p["ok"], p["risk"], p["breach"], p["none"]), p["ink"], p["soft"]),
        }
    common = dict(disable_xml_declaration=True, js=[], explicit_size=False, margin=12, width=640, height=380)

    # Chart 1: open cases on each rung of the ladder (top rung first)
    values = [count(v) for v in levels]
    bars = pygal.HorizontalBar(
        style=make_style(p, (p["pen"],)),
        show_legend=False,
        print_values=True,
        truncate_label=-1,
        **common,
    )
    bars.x_labels = list(reversed(LEVELS))
    top = max(values + [1])
    step = max(1, -(-top // 5))
    bars.y_labels = list(range(0, top + step + 1, step))
    bars.add("Open cases", list(reversed(values)))

    # Chart 2: donut of SLA status
    donut = pygal.Pie(
        inner_radius=0.62,
        style=make_style(p, (p["ok"], p["risk"], p["breach"], p["none"])),
        legend_box_size=18,
        truncate_legend=-1,
        **common,
    )
    donut.add("On track", count(sla.get("ok")))
    donut.add("At risk", count(sla.get("risk")))
    donut.add("Breached", count(sla.get("breach")))
    donut.add("No SLA", count(sla.get("none")))

    return {"levelChart": bars.render(is_unicode=True), "slaChart": donut.render(is_unicode=True)}


# ---------- Fallback: plain-Python SVG charts (used if pygal is not installed) ----------
def _esc(text):
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def svg_donut(labels, values, colors, ink, soft):
    import math
    total = sum(values) or 1
    cx, cy, r, w = 440, 190, 140, 52
    parts, angle = [], -math.pi / 2
    for value, color in zip(values, colors):
        if value <= 0:
            continue
        sweep = 2 * math.pi * value / total
        if sweep >= 2 * math.pi - 1e-6:
            parts.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{color}" stroke-width="{w}"/>')
        else:
            x1, y1 = cx + r * math.cos(angle), cy + r * math.sin(angle)
            x2, y2 = cx + r * math.cos(angle + sweep), cy + r * math.sin(angle + sweep)
            large = 1 if sweep > math.pi else 0
            parts.append(f'<path d="M{x1:.1f} {y1:.1f} A{r} {r} 0 {large} 1 {x2:.1f} {y2:.1f}" fill="none" stroke="{color}" stroke-width="{w}"/>')
        angle += sweep
    legend = "".join(
        f'<rect x="20" y="{30 + i * 34}" width="18" height="18" fill="{c}"/>'
        f'<text x="48" y="{45 + i * 34}" font-size="22" fill="{soft}">{_esc(l)} ({v})</text>'
        for i, (l, v, c) in enumerate(zip(labels, values, colors))
    )
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 380" font-family="sans-serif">'
            f'{legend}{"".join(parts)}<text x="{cx}" y="{cy + 12}" text-anchor="middle" font-size="36" font-weight="700" fill="{ink}">{sum(values)}</text></svg>')


def svg_bars(labels, values, color, ink, soft, grid):
    top = max(values + [1])
    n = max(len(values), 1)
    left, right, y0, y1 = 60, 620, 40, 320
    slot = (right - left) / n
    out = [f'<line x1="{left}" y1="{y1}" x2="{right}" y2="{y1}" stroke="{grid}" stroke-width="2"/>']
    for i, (label, value) in enumerate(zip(labels, values)):
        h = (y1 - y0) * value / top
        x = left + i * slot + slot * 0.18
        bw = slot * 0.64
        out.append(f'<rect x="{x:.1f}" y="{y1 - h:.1f}" width="{bw:.1f}" height="{h:.1f}" rx="4" fill="{color}"/>')
        out.append(f'<text x="{x + bw / 2:.1f}" y="{y1 - h - 10:.1f}" text-anchor="middle" font-size="22" fill="{ink}">{value}</text>')
        out.append(f'<text x="{x + bw / 2:.1f}" y="{y1 + 32}" text-anchor="middle" font-size="18" fill="{soft}">{_esc(label)}</text>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 380" font-family="sans-serif">{"".join(out)}</svg>'


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = min(int(self.headers.get("Content-Length") or 0), 20000)
            data = json.loads(self.rfile.read(length) or b"{}")
            status, body = 200, render(data if isinstance(data, dict) else {})
        except Exception as error:
            status, body = 400, {"errors": ["Could not draw the charts: " + str(error)[:120]]}
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


# Local testing: echo '{"levels":[4,3,2,1]}' | python3 api/chart.py
if __name__ == "__main__":
    import sys
    print(json.dumps(render(json.load(sys.stdin))))
