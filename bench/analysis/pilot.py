# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas>=2.2", "matplotlib>=3.9"]
# ///
"""Summarise a pilot campaign: within-seed and between-seed spread of the final
score, and score-over-time curves with the repeated seed's runs overlaid.

Reads bench/results/<campaign>/*/{meta.json,observer.ndjson}.
"""

import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

campaign = Path(sys.argv[1] if len(sys.argv) > 1 else "bench/results/pilot")
figures = Path(sys.argv[2] if len(sys.argv) > 2 else "bench/figures")
figures.mkdir(parents=True, exist_ok=True)


def load_run(run: Path) -> tuple[dict, pd.DataFrame]:
    """The first listed agent of a run, which is the only one in a pilot."""
    meta = json.loads((run / "meta.json").read_text())
    me_meta = meta["agents"][0]
    rows = []
    with open(run / "observer.ndjson") as lines:
        for line in lines:
            snap = json.loads(line)
            me = next((a for a in snap["agents"] if a["id"] == me_meta["id"]), None)
            loose = [p for p in snap["parcels"] if p["carriedBy"] is None]
            rows.append(
                {
                    "t": snap["t"],
                    "score": me["score"] if me else None,
                    "penalty": me["penalty"] if me else None,
                    "x": me["x"] if me else None,
                    "y": me["y"] if me else None,
                    "parcels_on_grid": len(loose),
                }
            )
    return meta, pd.DataFrame(rows)


runs = []
series = []
for run in sorted(p for p in campaign.iterdir() if (p / "meta.json").exists()):
    meta, df = load_run(run)
    me_meta = meta["agents"][0]
    label = dict(map=meta["map"], agent=me_meta["agent"], seed=meta["seed"], rep=run.name.rsplit("__r", 1)[-1])
    runs.append({**label, "score": me_meta["finalScore"], "penalty": me_meta["finalPenalty"], "duration": meta["duration"]})
    series.append(df.assign(**label))

runs = pd.DataFrame(runs)
series = pd.concat(series, ignore_index=True)

# Within-seed: the repeated seed. Between-seed: one run per seed (rep 0 of each).
summary = []
for (m, agent), g in runs.groupby(["map", "agent"]):
    repeated = g[g.seed == g.seed.value_counts().idxmax()]
    across = g[g.rep == "0"]
    summary.append(
        {
            "map": m,
            "agent": agent,
            "within n": len(repeated),
            "within mean": repeated.score.mean(),
            "within sd": repeated.score.std(ddof=1),
            "between n": len(across),
            "between mean": across.score.mean(),
            "between sd": across.score.std(ddof=1),
            "penalty mean": g.penalty.mean(),
        }
    )
summary = pd.DataFrame(summary)
print(runs.sort_values(["map", "seed", "rep"]).to_string(index=False))
print()
print(summary.round(1).to_string(index=False))
summary.to_csv(figures / "pilot_summary.csv", index=False)
runs.to_csv(figures / "pilot_runs.csv", index=False)

# One panel per map. The repeated seed's runs are shades of blue; other seeds get their own colour.
maps = sorted(series["map"].unique())
blues = plt.cm.Blues
others = ["#d62728", "#2ca02c", "#ff7f0e", "#9467bd", "#8c564b", "#e377c2", "#17becf"]
fig, axes = plt.subplots(1, len(maps), figsize=(5 * len(maps), 3.6), squeeze=False)
for ax, m in zip(axes[0], maps):
    g = series[series["map"] == m]
    counts = runs[runs["map"] == m].seed.value_counts()
    repeated_seed = counts.idxmax()
    other_seeds = sorted(s for s in counts.index if s != repeated_seed)
    reps = sorted(g[g.seed == repeated_seed].rep.unique())
    for (seed, rep), run in g.groupby(["seed", "rep"]):
        if seed == repeated_seed:
            shade = 0.45 + 0.5 * reps.index(rep) / max(len(reps) - 1, 1)
            ax.plot(run.t, run.score, color=blues(shade), lw=1.6, label=f"seed {seed} (x{len(reps)})" if rep == reps[0] else None)
        else:
            ax.plot(run.t, run.score, color=others[other_seeds.index(seed) % len(others)], lw=1.2, ls="--", label=f"seed {seed}")
    ax.set_title(m)
    ax.set_xlabel("seconds since spawn")
    ax.set_ylabel("score")
    ax.legend(frameon=False, fontsize=8)
    ax.spines[["top", "right"]].set_visible(False)
fig.suptitle(f"{runs.agent.iloc[0]} agent, {int(runs.duration.iloc[0])} s runs: repeated seed in blues, other seeds dashed", fontsize=10)
fig.tight_layout()
fig.savefig(figures / "pilot_score_over_time.pdf")
fig.savefig(figures / "pilot_score_over_time.png", dpi=160)
print(f"\nwrote {figures}/pilot_score_over_time.{{pdf,png}}")
