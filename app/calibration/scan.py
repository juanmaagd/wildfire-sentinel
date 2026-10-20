"""Scan SPEED alone (train mean F1 over +12/+24/+30 h picks it; test is only reported).

Run from app/:  uv run python -m calibration.scan [--landcover] 0.45 0.6 0.8
"""

import argparse

from sentinel import spread

from .benchmark import EVAL_HOURS, run, summary


def mean_f1(results: dict, split: str) -> float:
    vals = [r["hours"][str(h)]["f1"] for r in results.values() if r["split"] == split for h in EVAL_HOURS
            if r["hours"][str(h)]["f1"] is not None]
    return sum(vals) / len(vals)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("speeds", nargs="+", type=float)
    ap.add_argument("--landcover", action="store_true")
    a = ap.parse_args()
    for speed in a.speeds:
        res = run({"speed": speed, "fuel_factors": spread.FUEL_FACTORS if a.landcover else None})
        s = summary(res)
        print(f"speed {speed}: train F1 {mean_f1(res, 'train'):.3f} | +30 h train {s['train']['30']['f1']} (ratio {s['train']['30']['ratio_median']}) "
              f"test {s['test']['30']['f1']} (recall {s['test']['30']['recall']}, ratio {s['test']['30']['ratio_median']})"
              f" | pedrogao {res['pedrogao']['hours']['30']['f1']} albergaria {res['albergaria']['hours']['30']['f1']}",
              flush=True)
