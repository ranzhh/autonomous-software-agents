# /// script
# requires-python = ">=3.11"
# dependencies = ["matplotlib>=3.9"]
# ///
"""Score over time for the solo campaigns: one figure per map, one colour per
agent, one shade per seed.

Reads bench/results/solo/<agent>/*/{meta.json,observer.ndjson}. A curve stops
where the agent stops appearing in the snapshots, which is where the server
kicked it for passing -1000 penalty; the last point is marked with a cross.
"""

import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

campaign = Path(sys.argv[1] if len(sys.argv) > 1 else "bench/results/solo")
figures = Path(sys.argv[2] if len(sys.argv) > 2 else "bench/figures/solo")
figures.mkdir(parents=True, exist_ok=True)

# suite.ts order, then the agents from least to most machinery.
MAPS = ["empty_10", "26c1_3", "crates_one_way", "crates_maze", "26c1_4"]
COLOURS = {
    "dumb": "#7f7f7f",
    "greedy": "#ff7f0e",
    "naive": "#2ca02c",
    "deliberate": "#1f77b4",
    "pddl": "#9467bd",
}


def curve(run: Path, agent_id: str) -> tuple[list[float], list[int], bool]:
    """Score against seconds, up to the last snapshot holding the agent."""
    ts, scores = [], []
    gone = False
    for line in (run / "observer.ndjson").open():
        snap = json.loads(line)
        me = next((a for a in snap["agents"] if a["id"] == agent_id), None)
        if me is None:
            gone = True
            break
        ts.append(snap["t"])
        scores.append(me["score"])
    return ts, scores, gone


runs = []
for meta_path in sorted(campaign.glob("*/*/meta.json")):
    meta = json.loads(meta_path.read_text())
    for a in meta["agents"]:
        ts, scores, kicked = curve(meta_path.parent, a["id"])
        runs.append(
            {
                "agent": a["agent"],
                "map": meta["map"],
                "seed": int(meta["seed"]),
                "duration": meta["duration"],
                "t": ts,
                "score": scores,
                "kicked": kicked,
            }
        )
if not runs:
    sys.exit(f"no runs under {campaign}")


def shade(colour: str, k: int, of: int) -> tuple[float, float, float]:
    """The agent's colour, mixed towards white: earliest seed lightest."""
    r, g, b = matplotlib.colors.to_rgb(colour)
    f = 0.45 + 0.55 * (k / max(of - 1, 1))
    return (r * f + (1 - f), g * f + (1 - f), b * f + (1 - f))


maps = [m for m in MAPS if any(r["map"] == m for r in runs)]
maps += sorted({r["map"] for r in runs} - set(maps))
agents = [a for a in COLOURS if any(r["agent"] == a for r in runs)]

for m in maps:
    here = [r for r in runs if r["map"] == m]
    seeds = sorted({r["seed"] for r in here})
    duration = max(r["duration"] for r in here)
    fig, ax = plt.subplots(figsize=(7.2, 4.4))
    for agent in agents:
        mine = sorted(
            (r for r in here if r["agent"] == agent), key=lambda r: r["seed"]
        )
        # Solid is that agent's best run on this map; the other seeds are dashed.
        best = max(mine, key=lambda r: r["score"][-1] if r["score"] else 0)
        for r in mine:
            colour = shade(COLOURS[agent], seeds.index(r["seed"]), len(seeds))
            solid = r is best
            ax.plot(
                r["t"],
                r["score"],
                color=colour,
                lw=1.8 if solid else 1.2,
                ls="-" if solid else (0, (4, 2)),
                label=agent if solid else None,
            )
            if r["kicked"]:
                ax.plot(
                    r["t"][-1], r["score"][-1], marker="x", ms=6, mew=1.6, color=colour
                )
    ax.set_xlim(0, duration)
    ax.set_ylim(bottom=0)
    ax.set_title(f"{m}: score over time, seeds {seeds[0]}-{seeds[-1]}")
    ax.set_xlabel("seconds since spawn")
    ax.set_ylabel("score")
    ax.spines[["top", "right"]].set_visible(False)
    ax.legend(frameon=False, fontsize=9, loc="upper left")
    fig.tight_layout()
    fig.text(
        0.99,
        0.005,
        f"light to dark: seed {seeds[0]} to {seeds[-1]}   |   "
        "solid: that agent's best run   |   x: kicked at -1000 penalty",
        ha="right",
        va="bottom",
        fontsize=8,
        color="#555555",
    )
    fig.subplots_adjust(bottom=0.18)
    fig.savefig(figures / f"solo_{m}.pdf")
    fig.savefig(figures / f"solo_{m}.png", dpi=160)
    plt.close(fig)
    print(f"wrote {figures}/solo_{m}.{{pdf,png}}")
