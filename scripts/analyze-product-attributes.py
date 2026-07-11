"""
Read-only analysis: find missing product attributes (brand, category, model,
unit, size, color) that can be confidently inferred from the SKU/name and
from family siblings — and flag the rest for manual review.

Inputs (from scripts/analysis/, produced by export-products-for-price-analysis.py
and export-attribute-vocab.py):
  - products_export.csv   (labels: brand/category/model/size/color/unit)
  - products_full.csv     (raw ids: brand_id/category_id/*_option_id)
  - attribute_options.csv (definition, option_id, code, label)

Logic:
  1. brand / category / model / unit: these don't vary by size/color within
     a family. If every family sibling that HAS a value agrees on ONE value,
     propose filling the blanks with it. If siblings disagree, flag.
  2. size / color: these DO vary per SKU, so they can't be "propagated" —
     instead we decompose the SKU using the family's own product code
     (already learned by build_families) and match the leftover token(s)
     against the real attribute_options vocabulary. Only proposes a fix
     when there's an unambiguous, exact code match.

Writes to scripts/analysis/:
  - attribute_fixes.csv       (every proposed fill, with the option id to write)
  - attribute_needs_review.csv (missing attributes we could NOT confidently infer)
"""
import os
import sys
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from analyze_product_prices_lib import build_families  # noqa: E402

DIR = os.path.join(os.path.dirname(__file__), "analysis")
OUT_FIXES = os.path.join(DIR, "attribute_fixes.csv")
OUT_REVIEW = os.path.join(DIR, "attribute_needs_review.csv")


def load():
    labels = pd.read_csv(os.path.join(DIR, "products_export.csv"), dtype=str)
    full = pd.read_csv(os.path.join(DIR, "products_full.csv"), dtype=str)
    opts = pd.read_csv(os.path.join(DIR, "attribute_options.csv"), dtype=str)
    df = labels.merge(full[["sku", "id", "brand_id", "category_id",
                             "size_option_id", "color_option_id",
                             "model_option_id", "unit_option_id"]], on="sku", how="left")
    df["family"], _ = build_families(df)
    return df, opts


def propagate_field(df, label_col, id_col, fixes, review):
    """brand/category/model/unit: fill blanks when the family unanimously agrees."""
    for fam, grp in df.groupby("family"):
        if len(grp) < 2:
            continue
        known = grp[grp[id_col].notna()]
        distinct_labels = known[label_col].dropna().unique()
        distinct_ids = known[id_col].dropna().unique()
        if len(distinct_ids) == 0:
            continue
        if len(distinct_ids) > 1:
            for _, row in grp.iterrows():
                review.append({
                    "sku": row["sku"], "field": label_col, "reason": "family_conflict",
                    "detail": f"family '{fam}' has multiple {label_col} values: {list(distinct_labels)}",
                })
            continue
        fill_id = distinct_ids[0]
        fill_label = distinct_labels[0] if len(distinct_labels) else ""
        for _, row in grp.iterrows():
            if pd.isna(row[id_col]):
                fixes.append({
                    "sku": row["sku"], "field": label_col,
                    "new_value": fill_label, "new_option_id": fill_id,
                })


def build_option_index(opts, definition):
    sub = opts[opts["definition"] == definition]
    by_code = {}
    for _, r in sub.iterrows():
        by_code.setdefault(r["code"].upper(), []).append(r["option_id"])
    return by_code


def resolve_size_color(df, opts, fixes, review):
    size_idx = build_option_index(opts, "Size")
    color_idx = build_option_index(opts, "Color")

    for _, row in df.iterrows():
        needs_size = pd.isna(row["size_option_id"])
        needs_color = pd.isna(row["color_option_id"])
        if not needs_size and not needs_color:
            continue

        core_tokens = row["family"].split("-")
        sku_tokens = row["sku"].split("-")
        if sku_tokens[:len(core_tokens)] != core_tokens or len(sku_tokens) == len(core_tokens):
            review.append({
                "sku": row["sku"], "field": "size/color",
                "reason": "no_variant_suffix",
                "detail": f"family='{row['family']}' but SKU has nothing left to decompose",
            })
            continue

        suffix = sku_tokens[len(core_tokens):]

        resolved_size = None
        remaining = suffix
        if needs_size:
            last = suffix[-1].upper()
            if last in size_idx and len(size_idx[last]) == 1:
                resolved_size = size_idx[last][0]
                remaining = suffix[:-1]
            elif last in size_idx and len(size_idx[last]) > 1:
                review.append({
                    "sku": row["sku"], "field": "size", "reason": "ambiguous_option",
                    "detail": f"code '{last}' matches multiple Size options",
                })

        resolved_color = None
        if needs_color and remaining:
            joined_dash = "-".join(remaining).upper()
            joined_none = "".join(remaining).upper()
            candidates = color_idx.get(joined_dash) or color_idx.get(joined_none)
            if candidates and len(candidates) == 1:
                resolved_color = candidates[0]
            elif candidates and len(candidates) > 1:
                review.append({
                    "sku": row["sku"], "field": "color", "reason": "ambiguous_option",
                    "detail": f"code '{joined_dash}' matches multiple Color options",
                })

        if needs_size:
            if resolved_size:
                fixes.append({"sku": row["sku"], "field": "size", "new_value": suffix[-1], "new_option_id": resolved_size})
            else:
                review.append({
                    "sku": row["sku"], "field": "size", "reason": "no_match",
                    "detail": f"suffix token '{suffix[-1] if suffix else ''}' has no exact Size option match",
                })

        if needs_color:
            if resolved_color:
                fixes.append({"sku": row["sku"], "field": "color", "new_value": "-".join(remaining), "new_option_id": resolved_color})
            elif remaining:
                review.append({
                    "sku": row["sku"], "field": "color", "reason": "no_match",
                    "detail": f"suffix token(s) '{'-'.join(remaining)}' have no exact Color option match",
                })


def main():
    df, opts = load()
    fixes = []
    review = []

    propagate_field(df, "brand", "brand_id", fixes, review)
    propagate_field(df, "category", "category_id", fixes, review)
    propagate_field(df, "model", "model_option_id", fixes, review)
    propagate_field(df, "unit", "unit_option_id", fixes, review)
    resolve_size_color(df, opts, fixes, review)

    fixes_df = pd.DataFrame(fixes)
    review_df = pd.DataFrame(review)
    fixes_df.to_csv(OUT_FIXES, index=False, encoding="utf-8")
    review_df.to_csv(OUT_REVIEW, index=False, encoding="utf-8")

    print("Attribute analysis complete.\n")
    if not fixes_df.empty:
        print("Proposed fixes by field:")
        print(fixes_df["field"].value_counts().to_string())
    else:
        print("No fixes proposed.")
    print()
    if not review_df.empty:
        print("Needs manual review by field/reason:")
        print(review_df.groupby(["field", "reason"]).size().to_string())
    print(f"\n  -> {OUT_FIXES} ({len(fixes_df)} rows)")
    print(f"  -> {OUT_REVIEW} ({len(review_df)} rows)")


if __name__ == "__main__":
    main()
