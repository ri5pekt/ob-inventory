"""Shared helpers for analyze-product-prices.py and validate-safe-updates.py."""
import pandas as pd


def _strip_exact(sku: str, size, color):
    """Strip trailing SIZE and COLOR tokens using THIS row's own tagged values.
    Only reliable when both size and color are actually tagged on the row."""
    tokens = sku.split("-")

    if pd.notna(size) and tokens and tokens[-1].upper() == str(size).upper():
        tokens = tokens[:-1]

    if pd.notna(color):
        color_tokens = str(color).split("-")
        n = len(color_tokens)
        if n > 0 and len(tokens) >= n and [t.upper() for t in tokens[-n:]] == [c.upper() for c in color_tokens]:
            tokens = tokens[:-n]
        elif tokens and tokens[-1].upper() == str(color).replace("-", "").upper():
            tokens = tokens[:-1]

    return "-".join(tokens) if tokens else sku.split("-")[0]


def build_families(df: pd.DataFrame):
    """
    Two-pass, hybrid family grouping.

    Pass 1 ("confident cores"): for every row where BOTH size and color are
    tagged, strip them off using the row's own known values. This gives a
    trustworthy product code (e.g. "BG-C-TH", "BG-SA-SEMI") without ever
    conflating two different product lines that merely share a generic
    prefix (the "BG" bug: Culture Series / Kanok / Super Air all starting
    with "BG").

    Pass 2 (resolve untagged rows): a row with missing size/color (common
    for older/incomplete catalog entries) is matched against the longest
    confident core whose tokens are a strict prefix of its own SKU tokens.
    This lets rows like "BBTD-BKBK-L" (untagged) still join the "BBTD"
    family learned from its tagged sibling "BBTD-BKYW-L", instead of being
    stranded as an unrelated singleton.

    Only as an absolute last resort (no confident core matches at all —
    i.e. no sibling anywhere in the catalog has usable tags) does a row
    fall back to its bare first SKU token. Returns (family_series, n_fallback).
    """
    skus = df["sku"].tolist()
    sizes = df["size"].tolist()
    colors = df["color"].tolist()
    tokens_list = [s.split("-") for s in skus]

    exact_family = [None] * len(df)
    confident_cores = set()
    for i, (sku, size, color) in enumerate(zip(skus, sizes, colors)):
        if pd.notna(size) and pd.notna(color):
            core = _strip_exact(sku, size, color)
            exact_family[i] = core
            confident_cores.add(core)

    core_tokens_sorted = sorted(
        ({"tokens": c.split("-"), "upper": [t.upper() for t in c.split("-")], "key": c} for c in confident_cores),
        key=lambda c: len(c["tokens"]),
        reverse=True,
    )

    families = []
    n_fallback = 0
    for i, tokens in enumerate(tokens_list):
        if exact_family[i] is not None:
            families.append(exact_family[i])
            continue
        upper_tokens = [t.upper() for t in tokens]
        matched = None
        for core in core_tokens_sorted:
            n = len(core["tokens"])
            if n <= len(upper_tokens) and upper_tokens[:n] == core["upper"]:
                matched = core["key"]
                break
        if matched:
            families.append(matched)
        else:
            families.append(tokens[0])
            n_fallback += 1

    return pd.Series(families, index=df.index), n_fallback
