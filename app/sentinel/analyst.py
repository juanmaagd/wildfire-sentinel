"""ai& analyst: turns structured findings into a situation report. Numbers and times come from code only."""

import asyncio
import base64
import json
import time

from openai import AsyncOpenAI

from .config import aiand_key

VISION_MODEL = "zai-org/glm-5.3-flash"
TEXT_MODEL = "deepseek-ai/deepseek-v4-flash"

SYSTEM = (
    "You are a wildfire situation analyst for Japanese municipal disaster-prevention offices. "
    "You receive structured findings from an automated pipeline (satellite hotspot, fast vision-model answers about "
    "aerial photos, weather, computed 1-5 scores) and the wide aerial photo of the area. "
    "Write a precise, calm situation report. Use ONLY the facts provided: never invent times, numbers, place names "
    "or casualties. Explain each score using the factors given. Japanese text must be natural, formal Japanese "
    "suitable for municipal staff."
)

SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "situation_report",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "headline_ja": {"type": "string"},
                "headline_en": {"type": "string"},
                "brief_ja": {"type": "string", "description": "3-4 lines for the duty officer"},
                "brief_en": {"type": "string", "description": "3-4 lines for the duty officer"},
                "situation_en": {"type": "string", "description": "One detailed paragraph analysing the situation"},
                "score_rationale": {
                    "type": "object",
                    "properties": {k: {"type": "string"} for k in ("danger", "spread_risk", "exposure", "urgency")},
                    "required": ["danger", "spread_risk", "exposure", "urgency"],
                    "additionalProperties": False,
                },
                "key_evidence": {"type": "array", "items": {"type": "string"}},
                "unknowns": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["headline_ja", "headline_en", "brief_ja", "brief_en", "situation_en", "score_rationale", "key_evidence", "unknowns"],
            "additionalProperties": False,
        },
    },
}

_client: AsyncOpenAI | None = None


def _ai() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(base_url="https://api.aiand.com/v1", api_key=aiand_key())
    return _client


async def report(facts: dict, wide_image_path, use_vision: bool = False) -> tuple[dict, str, int]:
    """Returns (report, model used, latency_ms). Text model by default (fast); vision model optional."""
    text = json.dumps(facts, ensure_ascii=False, default=str)
    started = time.perf_counter()
    if use_vision:
        b64 = base64.b64encode(wide_image_path.read_bytes()).decode()
        r = await asyncio.wait_for(_ai().chat.completions.create(
            model=VISION_MODEL,
            response_format=SCHEMA,
            messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": [
                {"type": "text", "text": f"Findings:\n{text}\n\nThe image is the wide aerial photo (~7 km across, fire at the center, north up)."},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
            ]}],
        ), timeout=60)
        model = VISION_MODEL
    else:
        r = await _ai().chat.completions.create(
            model=TEXT_MODEL, response_format=SCHEMA, reasoning_effort="none",
            messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": f"Findings:\n{text}"}],
        )
        model = TEXT_MODEL
    return json.loads(r.choices[0].message.content), model, int((time.perf_counter() - started) * 1000)


PLAN_SYSTEM = (
    "You are a wildfire incident commander advising Japanese fire departments (消防本部) and municipal disaster offices. "
    "You receive a computed response plan: a control line placed by a spread simulation, the burned area with and "
    "without it, crews needed to cut it in time, the weather window and what a fast vision model saw in aerial photos. "
    "Write a concrete tactical plan as an experienced commander would: anchor point, control line (fuel break cut, "
    "cleared vegetation), direct attack where safe, aerial water drops by helicopter while the fire is small, "
    "structure protection for nearby houses, and crew safety (LCES: lookouts, communications, escape routes, safety zones). "
    "Use ONLY the numbers given; never invent places, times or resources beyond them. "
    "Write every field in English except objective_ja and brief_ja, which are natural, formal Japanese. "
    "Give 3 to 5 tactics, each field one short sentence (at most 25 words). Directions as compass words (north-west), not degrees."
)

PLAN_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "response_plan",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "objective_en": {"type": "string", "description": "One sentence: what the plan achieves"},
                "objective_ja": {"type": "string"},
                "tactics": {"type": "array", "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "e.g. Control line, Aerial drops, Structure protection"},
                        "when": {"type": "string"}, "where": {"type": "string"},
                        "resources": {"type": "string"}, "why": {"type": "string"},
                    },
                    "required": ["name", "when", "where", "resources", "why"], "additionalProperties": False}},
                "weather_watch": {"type": "string"},
                "crew_safety": {"type": "string"},
                "brief_ja": {"type": "string", "description": "3 lines for the commander, Japanese"},
            },
            "required": ["objective_en", "objective_ja", "tactics", "weather_watch", "crew_safety", "brief_ja"],
            "additionalProperties": False,
        },
    },
}


async def response_plan(facts: dict) -> tuple[dict, str, int]:
    started = time.perf_counter()
    r = await _ai().chat.completions.create(
        model=TEXT_MODEL, response_format=PLAN_SCHEMA, reasoning_effort="none",
        messages=[{"role": "system", "content": PLAN_SYSTEM},
                  {"role": "user", "content": f"Plan facts:\n{json.dumps(facts, ensure_ascii=False, default=str)}"}],
    )
    return json.loads(r.choices[0].message.content), TEXT_MODEL, int((time.perf_counter() - started) * 1000)
