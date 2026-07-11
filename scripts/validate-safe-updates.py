"""
Sanity-check the 'safe' family groupings before trusting them.

Flags:
  1. Families where product names vary a lot (possible bad grouping —
     unrelated products sharing a SKU prefix by coincidence).
  2. Families where the only known reference price comes from a single
     lone SKU (thin evidence — one data point being propagated everywhere).
  3. Families where the known price's date_added is old (2001-01-01 era)
     while most/all of the blanks being filled are much newer products
     (stale anchor price risk).
"""
import os
import sys
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from analyze_product_prices_lib import build_families  # noqa: E402

DIR = os.path.join(os.path.dirname(__file__), "analysis")
df = pd.read_csv(os.path.join(DIR, "products_export.csv"), dtype={"sku": str, "name": str})
df["cost_price"] = pd.to_numeric(df["cost_price"], errors="coerce")
df["retail_price"] = pd.to_numeric(df["retail_price"], errors="coerce")
df["family"], _ = build_families(df)
df["date_added"] = pd.to_datetime(df["date_added"], errors="coerce")

safe = pd.read_csv(os.path.join(DIR, "safe_updates.csv"), dtype=str)
safe_families = sorted(safe["family"].unique())

print(f"Auditing {len(safe_families)} 'safe' families ({len(safe)} proposed fills)\n")

print("=" * 70)
print("1) Name-consistency check (possible bad grouping)")
print("=" * 70)
flagged_names = []
for fam in safe_families:
    grp = df[df["family"] == fam]
    names = sorted(grp["name"].dropna().unique())
    if len(names) > 3:
        flagged_names.append(fam)
        print(f"  {fam}: {len(names)} distinct names -> {names}")
print(f"-> {len(flagged_names)} families flagged\n")

print("=" * 70)
print("2) Thin-evidence check (only ONE SKU in the family has a known price)")
print("=" * 70)
flagged_thin = []
for fam in safe_families:
    grp = df[df["family"] == fam]
    known_cost_rows = grp[grp["cost_price"].notna()]
    known_retail_rows = grp[grp["retail_price"].notna()]
    n_known = len(set(known_cost_rows["sku"]) | set(known_retail_rows["sku"]))
    if n_known == 1:
        flagged_thin.append(fam)
        row = known_cost_rows.iloc[0] if len(known_cost_rows) else known_retail_rows.iloc[0]
        n_blanks = len(safe[safe["family"] == fam])
        print(f"  {fam}: only '{row['sku']}' has a price, propagating to {n_blanks} other SKUs")
print(f"-> {len(flagged_thin)} families flagged\n")

print("=" * 70)
print("3) Stale-anchor check (known price is from an old/legacy dated row)")
print("=" * 70)
flagged_stale = []
for fam in safe_families:
    grp = df[df["family"] == fam]
    known = grp[(grp["cost_price"].notna()) | (grp["retail_price"].notna())]
    if known["date_added"].notna().any():
        newest_known = known["date_added"].max()
        newest_overall = grp["date_added"].max()
        # flag if the reference price is >2 years older than the newest sibling in the family
        if pd.notna(newest_overall) and pd.notna(newest_known):
            gap_days = (newest_overall - newest_known).days
            if gap_days > 730:
                flagged_stale.append(fam)
                print(f"  {fam}: newest known-price row dated {newest_known.date()}, "
                      f"but family has rows as new as {newest_overall.date()} ({gap_days} days newer)")
print(f"-> {len(flagged_stale)} families flagged\n")

print("=" * 70)
print("SUMMARY")
print("=" * 70)
all_flagged = set(flagged_names) | set(flagged_thin) | set(flagged_stale)
print(f"Total safe families: {len(safe_families)}")
print(f"Flagged for any reason: {len(all_flagged)} -> {sorted(all_flagged)}")
print(f"Clean (no flags): {len(safe_families) - len(all_flagged)}")
