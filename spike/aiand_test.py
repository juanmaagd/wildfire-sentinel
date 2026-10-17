"""Spike: ai& vision escalation (low Jev confidence) + Japanese alert text."""

import base64
import json
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

IMAGES = Path(__file__).parent / "images"


def aiand_key() -> str:
    if os.environ.get("AIAND_API_KEY"):
        return os.environ["AIAND_API_KEY"]
    names = [n for n in os.environ if "AIAND" in n.upper() or "AI_AND" in n.upper()]
    print("ai& key env names found:", names)
    return os.environ[names[0]]


client = OpenAI(base_url="https://api.aiand.com/v1", api_key=aiand_key())

VERDICT_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "land_use_verdict",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "center_land_use": {"type": "string", "enum": ["forest_or_grassland", "industrial", "residential", "farmland", "volcano_or_bare", "water"]},
                "houses_within_500m": {"type": "boolean"},
                "reason": {"type": "string"},
            },
            "required": ["center_land_use", "houses_within_500m", "reason"],
            "additionalProperties": False,
        },
    },
}


def escalate(image: Path, model: str) -> None:
    b64 = base64.b64encode(image.read_bytes()).decode()
    started = time.perf_counter()
    r = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": [
            {"type": "text", "text": "This is a ~1.8 km aerial photo of Japan. A satellite detected a heat source at the exact center. Classify what is at the center and whether houses are within 500 m."},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
        ]}],
        response_format=VERDICT_SCHEMA,
    )
    ms = (time.perf_counter() - started) * 1000
    print(f"[vision {model}] {ms:.0f} ms -> {r.choices[0].message.content}")


def alert_text(model: str) -> None:
    facts = {
        "location": "Ofunato, Iwate (39.07, 141.78)",
        "land_use": "forest (Jev confidence 1.00)",
        "houses_nearby_probability": 0.13,
        "frp_mw": 12.4,
        "detections_last_24h": 4,
    }
    started = time.perf_counter()
    r = client.chat.completions.create(
        model=model,
        reasoning_effort="none",
        messages=[
            {"role": "system", "content": "You write short wildfire alerts for Japanese municipal disaster-prevention staff. Write in Japanese, 3 lines max: what, where, recommended action. Only use the facts given."},
            {"role": "user", "content": json.dumps(facts, ensure_ascii=False)},
        ],
    )
    ms = (time.perf_counter() - started) * 1000
    print(f"[text {model}] {ms:.0f} ms ->\n{r.choices[0].message.content}")


if __name__ == "__main__":
    escalate(IMAGES / "mosaic_keiyo_refinery.jpg", "zai-org/glm-5.3-flash")
    alert_text("deepseek-ai/deepseek-v4-flash")
