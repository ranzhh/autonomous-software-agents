# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas>=2.2", "matplotlib>=3.9"]
# ///
"""Within-seed pilot: how much of the run-to-run spread is the real-time layer?

Reads bench/results/<campaign>/*/{meta.json,observer.ndjson}, prints the
within-seed and between-seed spread of the final score, and draws score-over-time
curves with repeated-seed runs overlaid.
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
    meta = json.loads((run / "meta.json").read_text())
    rows = []
    with open(run / "observer.ndjson") as lines:
        for line in lines:
            snap = json.loads(line)
            me = next((a for a in snap["agents"] if a["id"] == meta["agentId"]), None)
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
    label = dict(map=meta["map"], agent=meta["agent"], seed=meta["seed"], rep=run.name.rsplit("__r", 1)[-1])
    runs.append({**label, "score": meta["finalScore"], "penalty": meta["finalPenalty"], "duration": meta["duration"]})
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

# Figure: score over time, one panel per map. Repeated seed in colour, others grey.
maps = sorted(series["map"].unique())
fig, axes = plt.subplots(1, len(maps), figsize=(5 * len(maps), 3.6), sharey=False, squeeze=False)
for ax, m in zip(axes[0], maps):
    g = series[series["map"] == m]
    repeated_seed = runs[runs["map"] == m].seed.value_counts().idxmax()
    for (seed, rep), run in g.groupby(["seed", "rep"]):
        same = seed == repeated_seed
        ax.plot(
            run.t,
            run.score,
            color="#1f77b4" if same else "#9e9e9e",
            alpha=0.9 if same else 0.6,
            lw=1.4 if same else 1.0,
            label=(f"seed {seed}, {int(runs[(runs['map']==m)&(runs.seed==seed)].shape[0])} runs" if same else "other seeds")
            if rep == "0"
            else None,
        )
    ax.set_title(m)
    ax.set_xlabel("seconds since spawn")
    ax.set_ylabel("score")
    handles, labels = ax.get_legend_handles_labels()
    seen = {}
    for h, l in zip(handles, labels):
        seen.setdefault(l, h)
    ax.legend(seen.values(), seen.keys(), frameon=False, fontsize=8)
    ax.spines[["top", "right"]].set_visible(False)
fig.suptitle(f"{runs.agent.iloc[0]} agent, {int(runs.duration.iloc[0])} s runs: same seed in blue, other seeds in grey", fontsize=10)
fig.tight_layout()
fig.savefig(figures / "pilot_score_over_time.pdf")
fig.savefig(figures / "pilot_score_over_time.png", dpi=160)
print(f"\nwrote {figures}/pilot_score_over_time.{{pdf,png}}")
