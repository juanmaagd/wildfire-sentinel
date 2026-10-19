"""Fit SPEED and the per-land-cover fuel factors on the train fires only (coordinate search on mean F1 over
+12/+24/+30 h). The test fires are scored once at the end with the fitted values.

Run from app/:  uv run python -m calibration.fit
"""

import json
import time

from sentinel import spread

from .benchmark import EVAL_HOURS, HERE, run
from .fires import FIRES

TRAIN = [f[0] for f in FIRES if f[4] == "train"]
FITTED = ("tree", "shrub", "grass", "crop", "built")


def objective(params: dict) -> float:
    results = run(params, TRAIN)
    vals = [r["hours"][str(h)]["f1"] for r in results.values() for h in EVAL_HOURS if r["hours"][str(h)]["f1"] is not None]
    return sum(vals) / len(vals)


def fit() -> tuple[dict, list]:
    params = {"speed": spread.SPEED, "fuel_factors": dict(spread.FUEL_FACTORS)}
    best, log = objective(params), []
    log.append({"step": "start", "f1": round(best, 4), "speed": params["speed"]})
    print(f"start F1 {best:.4f}", flush=True)
    for speed in (0.3, 0.45, 0.7, 1.0, 1.5, 2.2, 3.2):  # the model is far too slow: coarse scan of SPEED first
        trial = {**params, "speed": speed}
        f1 = objective(trial)
        log.append({"step": f"speed={speed}", "f1": round(f1, 4)})
        print(f"speed {speed}: F1 {f1:.4f}", flush=True)
        if f1 > best:
            best, params = f1, trial
    for _ in range(2):  # then each factor, with SPEED rescaled around its best value
        for key in ("speed", *FITTED):
            for mult in (0.6, 0.8, 1.25, 1.6):
                if key == "speed":
                    trial = {**params, "speed": round(params["speed"] * mult, 3)}
                else:
                    trial = {**params, "fuel_factors": {**params["fuel_factors"], key: round(params["fuel_factors"][key] * mult, 3)}}
                f1 = objective(trial)
                log.append({"step": f"{key}x{mult}", "f1": round(f1, 4)})
                if f1 > best + 0.002:  # ignore noise-level gains
                    best, params = f1, trial
                    print(f"{key} x{mult}: F1 {f1:.4f} -> {params['speed']}, {params['fuel_factors']}", flush=True)
    return params, log


if __name__ == "__main__":
    t = time.perf_counter()
    params, log = fit()
    out = {"params": params, "train_f1": log[-1], "log": log, "minutes": round((time.perf_counter() - t) / 60, 1)}
    (HERE / "results" / "fit.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(params))
