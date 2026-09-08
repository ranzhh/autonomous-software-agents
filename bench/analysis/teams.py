# /// script
# requires-python = ">=3.11"
# dependencies = ["matplotlib>=3.9"]
# ///
"""Compare team campaigns: score over time per map, and the missions won.

    uv run bench/analysis/teams.py bench/results/67 [figures dir]

Every immediate subdirectory of the root is one condition, named by its
directory (llm+bdi, bdi+bdi). Writes one figure with a panel per map, a text
table, and teams.tex.
"""

import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

root = Path(sys.argv[1] if len(sys.argv) > 1 else "bench/results/67")
figures = Path(sys.argv[2] if len(sys.argv) > 2 else "bench/figures/teams")
figures.mkdir(parents=True, exist_ok=True)

CONDITION_COLOURS = ["#1f77b4", "#d62728", "#2ca02c", "#ff7f0e"]


def team_series(run: Path, meta: dict) -> tuple[list[float], list[int]]:
    """The team's total score at each snapshot."""
    ids = [a["id"] for a in meta["agents"]]
    ts, totals = [], []
    for line in (run / "observer.ndjson").open():
        snap = json.loads(line)
        seen = {a["id"]: a["score"] for a in snap["agents"]}
        ts.append(snap["t"])
        totals.append(sum(seen.get(i, 0) for i in ids))
    return ts, totals


def missions(run: Path) -> tuple[int, int, int]:
    """Mission points won, missions won, missions posted."""
    points = won = posted = 0
    path = run / "missions.ndjson"
    if not path.exists():
        return 0, 0, 0
    for line in path.open():
        row = json.loads(line)
        if "shouted" in row:
            posted += 1
        if "rewarded" in row and isinstance(row.get("points"), int):
            points += row["points"]
            won += 1
    return points, won, posted


runs = []
for meta_path in sorted(root.rglob("meta.json")):
    meta = json.loads(meta_path.read_text())
    condition = meta_path.relative_to(root).parts[0]
    ts, totals = team_series(meta_path.parent, meta)
    points, won, posted = missions(meta_path.parent)
    runs.append(
        {
            "condition": condition,
            "map": meta["map"],
            "seed": meta["seed"],
            "duration": meta["duration"],
            "t": ts,
            "total": totals,
            "members": [(a["name"], a["finalScore"]) for a in meta["agents"]],
            "team": sum(a["finalScore"] for a in meta["agents"]),
            "mission_points": points,
            "missions_won": won,
            "missions_posted": posted,
        }
    )
if not runs:
    sys.exit(f"no runs under {root}")

conditions = sorted({r["condition"] for r in runs})
maps = sorted({r["map"] for r in runs})
colour = {c: CONDITION_COLOURS[i % len(CONDITION_COLOURS)] for i, c in enumerate(conditions)}

width = max(len("condition"), *(len(c) for c in conditions)) + 2
print(f"{'condition':{width}}{'map':17}{'team':>7}{'mission':>9}{'won':>5}  members")
for c in conditions:
    for m in maps:
        for r in [x for x in runs if x["condition"] == c and x["map"] == m]:
            members = "  ".join(f"{n}={s}" for n, s in r["members"])
            print(
                f"{c:{width}}{m:17}{r['team']:7}{r['mission_points']:9}"
                f"{r['missions_won']:3}/{r['missions_posted']:<2} {members}"
            )

fig, axes = plt.subplots(1, len(maps), figsize=(6.2 * len(maps), 4.2), squeeze=False)
for ax, m in zip(axes[0], maps):
    for c in conditions:
        for r in [x for x in runs if x["condition"] == c and x["map"] == m]:
            ax.plot(r["t"], r["total"], color=colour[c], lw=1.9, label=c)
            for mission_t in (30, 60, 90, 120):
                ax.axvline(mission_t, color="#d4d4d8", lw=0.8, ls=(0, (2, 3)), zorder=0)
    ax.set_title(m)
    ax.set_xlim(0, max(r["duration"] for r in runs))
    ax.set_ylim(bottom=0)
    ax.set_xlabel("seconds since spawn")
    ax.set_ylabel("team score")
    ax.spines[["top", "right"]].set_visible(False)
    ax.legend(frameon=False, fontsize=9, loc="upper left")
fig.suptitle("Team score over time; dotted lines are the four missions", fontsize=11)
fig.tight_layout()
fig.savefig(figures / "teams.pdf")
fig.savefig(figures / "teams.png", dpi=160)
plt.close(fig)

esc = lambda s: s.replace("_", r"\_").replace("+", r"$+$")  # noqa: E731
lines = [
    "% Team campaigns: two agents on one team, seed 42, one spawn order, 150 s.",
    r"% Requires: \usepackage{booktabs}",
    "",
    r"\begin{table}[htbp]",
    r"  \centering",
    r"  \small",
    r"  \caption{Two agents on one team, with the standard mission set. Team score",
    r"           after 150\,s, the mission bonus inside it, and the missions won of",
    r"           those posted.}",
    r"  \label{tab:teams}",
    r"  \begin{tabular}{llrrr}",
    r"    \toprule",
    r"    \textbf{team} & \textbf{map} & \textbf{score} & \textbf{of which missions}"
    r" & \textbf{missions won} \\",
    r"    \midrule",
]
for c in conditions:
    for m in maps:
        for r in [x for x in runs if x["condition"] == c and x["map"] == m]:
            lines.append(
                rf"    \texttt{{{esc(c)}}} & \texttt{{{esc(m)}}} & {r['team']} & "
                rf"{r['mission_points']} & {r['missions_won']}/{r['missions_posted']} \\"
            )
lines += [r"    \bottomrule", r"  \end{tabular}", r"\end{table}", ""]
(figures / "teams.tex").write_text("\n".join(lines))
print(f"\nwrote {figures}/teams.{{png,pdf,tex}}")
