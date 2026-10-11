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

import pygal
from pygal.style import Style

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
