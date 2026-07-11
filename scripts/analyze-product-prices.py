"""
Read-only analysis of scripts/analysis/products_export.csv.

Groups products into "families" (by SKU prefix, i.e. same base product across
sizes/colors), then for each family:
  - if every non-blank cost_price agrees AND every non-blank retail_price agrees
    -> SAFE: blanks can be confidently filled with that price.
  - if cost_price or retail_price disagrees anywhere in the family
    -> CONFLICT: left untouched, flagged for manual review / question to store owner.

Writes three files to scripts/analysis/:
  - safe_updates.csv   (every blank cell that would be filled, with proposed value)
  - conflicts.csv      (every family with a price disagreement, all its rows)
  - questions.md       (human-readable summary + list of questions for store owner)

Does NOT modify the database. Pure analysis.
"""
import os
import sys
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from analyze_product_prices_lib import build_families  # noqa: E402

DIR = os.path.join(os.path.dirname(__file__), "analysis")
IN_CSV = os.path.join(DIR, "products_export.csv")
OUT_SAFE = os.path.join(DIR, "safe_updates.csv")
OUT_CONFLICTS = os.path.join(DIR, "conflicts.csv")
OUT_QUESTIONS = os.path.join(DIR, "questions.md")


def fmt(v):
    if pd.isna(v):
        return "-"
    return f"{float(v):.2f}"


def fmt_text(v):
    if pd.isna(v) or v is None:
        return "-"
    return str(v)


def main():
    df = pd.read_csv(IN_CSV, dtype={"sku": str, "name": str})
    df["cost_price"] = pd.to_numeric(df["cost_price"], errors="coerce")
    df["retail_price"] = pd.to_numeric(df["retail_price"], errors="coerce")
    df["family"], n_fallback = build_families(df)
    print(f"  ({n_fallback} SKUs had no tagged siblings at all -> grouped by bare SKU prefix as last resort)\n")

    safe_rows = []
    conflict_rows = []
    no_data_families = 0
    safe_families = 0
    conflict_families = 0
    singleton_families = 0

    for fam, group in df.groupby("family", sort=True):
        if len(group) < 2:
            singleton_families += 1
            continue

        known_costs = sorted(set(round(v, 2) for v in group["cost_price"].dropna()))
        known_retails = sorted(set(round(v, 2) for v in group["retail_price"].dropna()))

        cost_conflict = len(known_costs) > 1
        retail_conflict = len(known_retails) > 1

        if cost_conflict or retail_conflict:
            conflict_families += 1
            for _, row in group.iterrows():
                conflict_rows.append({
                    "family": fam,
                    "sku": row["sku"],
                    "name": row["name"],
                    "size": fmt_text(row.get("size")),
                    "color": fmt_text(row.get("color")),
                    "cost_price": fmt(row["cost_price"]),
                    "retail_price": fmt(row["retail_price"]),
                    "cost_conflict": cost_conflict,
                    "retail_conflict": retail_conflict,
                    "distinct_costs_in_family": ", ".join(fmt(c) for c in known_costs),
                    "distinct_retails_in_family": ", ".join(fmt(r) for r in known_retails),
                })
            continue

        safe_cost = known_costs[0] if len(known_costs) == 1 else None
        safe_retail = known_retails[0] if len(known_retails) == 1 else None

        if safe_cost is None and safe_retail is None:
            no_data_families += 1
            continue

        family_had_update = False
        for _, row in group.iterrows():
            new_cost = row["cost_price"]
            new_retail = row["retail_price"]
            will_fill_cost = pd.isna(row["cost_price"]) and safe_cost is not None
            will_fill_retail = pd.isna(row["retail_price"]) and safe_retail is not None
            if will_fill_cost:
                new_cost = safe_cost
            if will_fill_retail:
                new_retail = safe_retail
            if will_fill_cost or will_fill_retail:
                family_had_update = True
                safe_rows.append({
                    "family": fam,
                    "sku": row["sku"],
                    "name": row["name"],
                    "size": fmt_text(row.get("size")),
                    "color": fmt_text(row.get("color")),
                    "old_cost": fmt(row["cost_price"]),
                    "new_cost": fmt(new_cost),
                    "old_retail": fmt(row["retail_price"]),
                    "new_retail": fmt(new_retail),
                })
        if family_had_update:
            safe_families += 1

    safe_df = pd.DataFrame(safe_rows)
    conflicts_df = pd.DataFrame(conflict_rows)

    safe_df.to_csv(OUT_SAFE, index=False, encoding="utf-8")
    conflicts_df.to_csv(OUT_CONFLICTS, index=False, encoding="utf-8")

    # ── Build questions.md ──────────────────────────────────────────────
    lines = []
    lines.append("# Price update analysis — questions for store owner\n")
    lines.append(f"Source: production export ({len(df)} SKUs, {df['family'].nunique()} families)\n")
    lines.append("## Summary\n")
    lines.append(f"- Safe families (blanks can be auto-filled): **{safe_families}**")
    lines.append(f"- Blank cells that would be filled: **{len(safe_df)}**")
    lines.append(f"- Conflicting families (need your input): **{conflict_families}**")
    lines.append(f"- Families with zero price data anywhere (can't auto-fill, no reference): **{no_data_families}**")
    lines.append(f"- Single-SKU products (no siblings to compare against): **{singleton_families}**\n")

    lines.append("## Questions — conflicting families\n")
    lines.append("For each of these, two or more variants of what looks like the *same* product ")
    lines.append("already have *different* prices set. Please tell us which price is correct ")
    lines.append("(or if they're actually different products and that's expected).\n")

    if not conflicts_df.empty:
        for fam, group in conflicts_df.groupby("family"):
            first = group.iloc[0]
            lines.append(f"### `{fam}` — {first['name']}")
            if first["cost_conflict"]:
                lines.append(f"- **Cost conflict**: {first['distinct_costs_in_family']}")
            if first["retail_conflict"]:
                lines.append(f"- **Retail conflict**: {first['distinct_retails_in_family']}")
            lines.append("")
            lines.append("| SKU | Size | Color | Cost | Retail |")
            lines.append("|---|---|---|---|---|")
            for _, row in group.iterrows():
                lines.append(f"| {row['sku']} | {row['size']} | {row['color']} | {row['cost_price']} | {row['retail_price']} |")
            lines.append("")
    else:
        lines.append("_None found._\n")

    with open(OUT_QUESTIONS, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print("Analysis complete.\n")
    print(f"  Total SKUs:                 {len(df)}")
    print(f"  Families:                   {df['family'].nunique()}")
    print(f"  Safe families:              {safe_families}")
    print(f"  Blanks that would be filled:{len(safe_df):>6}")
    print(f"  Conflicting families:       {conflict_families}")
    print(f"  No-data families:           {no_data_families}")
    print(f"  Singleton (no siblings):    {singleton_families}")
    print()
    print(f"  -> {OUT_SAFE}")
    print(f"  -> {OUT_CONFLICTS}")
    print(f"  -> {OUT_QUESTIONS}")


if __name__ == "__main__":
    main()
