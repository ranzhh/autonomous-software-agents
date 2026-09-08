# /// script
# requires-python = ">=3.11"
# dependencies = ["matplotlib>=3.9"]
# ///
"""Draw one moment of a run: the board, the crates and where everyone stands.

    uv run bench/analysis/board.py <run dir> [seconds] [out.png] [--agent name]
                                  [--reachable]

Tiles come from the run's meta.json, agent positions from observer.ndjson, and
crates from one agent's own beliefs (--agent, default the last one listed), so
the crates drawn are what that agent had seen by then, not ground truth.
--reachable hatches the tiles that agent can walk to without pushing a crate.
"""

import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.patches as mpatches
import matplotlib.pyplot as plt

args = [a for a in sys.argv[1:] if not a.startswith("--")]
flags = {a.split("=")[0]: a.split("=")[-1] for a in sys.argv[1:] if a.startswith("--")}
run = Path(args[0])
when = float(args[1]) if len(args) > 1 else 110.0
out = Path(args[2]) if len(args) > 2 else Path("board.png")

meta = json.loads((run / "meta.json").read_text())
game = meta["config"]["GAME"]
tiles = game["map"]["tiles"]
width, height = game["map"]["width"], game["map"]["height"]

# Tile types as the server writes them: 0 wall, 1 spawner, 2 delivery, 5 floor,
# and 5! the floor tiles a crate starts on. grid.ts takes both 5s as slidable.
COLOURS = {
    "0": "#3f3f46",
    "1": "#bfdbfe",
    "2": "#bbf7d0",
    "5": "#f4f4f5",
    "5!": "#fef3c7",
}
NAMES = {
    "0": "wall",
    "1": "spawner",
    "2": "delivery",
    "5": "slidable floor",
    "5!": "crate origin",
}
AGENT_COLOURS = {
    "dumb": "#7f7f7f",
    "greedy": "#ff7f0e",
    "naive": "#2ca02c",
    "deliberate": "#1f77b4",
    "pddl": "#9467bd",
    "bdi": "#d62728",
}

snaps = [json.loads(line) for line in (run / "observer.ndjson").open()]
snap = min(snaps, key=lambda s: abs(s["t"] - when))
ids = {a["id"]: a["name"] for a in meta["agents"]}

watcher = flags.get("--agent", meta["agents"][-1]["name"])
crates, seen_at = [], None
for line in (run / f"{watcher}.log").open():
    try:
        row = json.loads(line)
    except json.JSONDecodeError:
        continue
    if row.get("msg") == "deliberating" and "cratesSeen" in row:
        if seen_at is None:
            seen_at = row["time"]
        crates = row["cratesSeen"]
        if (row["time"] - seen_at) / 1000 >= snap["t"]:
            break

present = {ids[a["id"]] for a in snap["agents"] if a["id"] in ids}
gone = [n for n in ids.values() if n not in present]

reach: set[tuple[int, int]] = set()
if "--reachable" in flags:
    from collections import deque

    blocked = {(c["x"], c["y"]) for c in crates}
    me = next(a for a in snap["agents"] if ids.get(a["id"]) == watcher)
    start = (round(me["x"]), round(me["y"]))
    reach, queue = {start}, deque([start])
    while queue:
        x, y = queue.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (x + dx, y + dy)
            if n in reach or n in blocked:
                continue
            if not (0 <= n[0] < width and 0 <= n[1] < height):
                continue
            if str(tiles[n[0]][n[1]]) == "0":
                continue
            reach.add(n)
            queue.append(n)

fig, ax = plt.subplots(figsize=(7.5, 7.0))
for x in range(width):
    for y in range(height):
        kind = str(tiles[x][y])
        ax.add_patch(
            mpatches.Rectangle(
                (x - 0.5, y - 0.5), 1, 1,
                facecolor=COLOURS.get(kind, "#f4f4f5"),
                edgecolor="#d4d4d8", linewidth=0.6,
            )
        )

for x, y in reach:
    ax.add_patch(
        mpatches.Rectangle(
            (x - 0.5, y - 0.5), 1, 1, facecolor="none",
            edgecolor="#ef4444", hatch="///", linewidth=0.0, alpha=0.35,
        )
    )

for c in crates:
    ax.add_patch(
        mpatches.Rectangle(
            (c["x"] - 0.34, c["y"] - 0.34), 0.68, 0.68,
            facecolor="#a16207", edgecolor="#422006", linewidth=1.4,
        )
    )

for a in snap["agents"]:
    name = ids.get(a["id"])
    if name is None:
        continue
    ax.add_patch(
        plt.Circle(
            (a["x"], a["y"]), 0.30,
            facecolor=AGENT_COLOURS.get(name, "#ef4444"),
            edgecolor="white", linewidth=1.6, zorder=3,
        )
    )
    ax.annotate(
        name, (a["x"], a["y"] - 0.42), ha="center", va="bottom",
        fontsize=8, zorder=4,
        bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.75),
    )

ax.set_xlim(-0.5, width - 0.5)
ax.set_ylim(height - 0.5, -0.5)
ax.set_aspect("equal")
ax.set_xticks(range(width))
ax.set_yticks(range(height))
ax.tick_params(length=0, labelsize=8)
for side in ("top", "right", "bottom", "left"):
    ax.spines[side].set_visible(False)
ax.set_title(
    f"{meta['map']}, seed {meta['seed']}, t = {snap['t']:.0f}s"
    f"  (crates as {watcher} had seen them)"
    + (f"\n{', '.join(gone)} already kicked" if gone else ""),
    fontsize=11,
)

handles = [
    mpatches.Patch(facecolor=COLOURS[k], edgecolor="#d4d4d8", label=NAMES[k])
    for k in ("5", "5!", "1", "2", "0")
]
handles.append(
    mpatches.Patch(facecolor="#a16207", edgecolor="#422006", label="crate")
)
if reach:
    handles.append(
        mpatches.Patch(facecolor="none", edgecolor="#ef4444", hatch="///",
                       label=f"reachable by {watcher}")
    )
handles += [
    plt.Line2D([], [], marker="o", ls="", markersize=9, markerfacecolor=c,
               markeredgecolor="white", label=n)
    for n, c in AGENT_COLOURS.items()
    if n in present
]
ax.legend(
    handles=handles, loc="upper left", bbox_to_anchor=(1.01, 1.0),
    frameon=False, fontsize=9,
)
fig.tight_layout()
fig.savefig(out, dpi=170, bbox_inches="tight")
print(f"wrote {out} at t={snap['t']:.1f}s, {len(crates)} crates from {watcher}")
