#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#

"""Build ``web/src/lib/tx-hhsc-offices.json`` from HHSC's own office answers.

Inputs, all downloaded beforehand so this step never touches the network:

``hhsc-find-an-office.json``
    Written by ``tools/fetch_tx_hhsc_offices.mjs``: HHSC's "Find an office"
    answer for each of Texas's 254 counties.
``tab20_zcta520_county20_natl.txt``
    Census 2020 ZCTA-to-county relationship file,
    https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/
``2020_Gaz_zcta_national.txt``
    Census 2020 ZCTA Gazetteer (internal point of each ZCTA),
    https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/

What it keeps
-------------
Only offices HHSC lists as ``type: HHSC`` that serve SNAP, TANF, or Medicaid
for families and children — the Texas Works programmes H1010 applies for. An
office listed only for Medicare Savings or Medicaid for the Elderly and People
with Disabilities takes a different application and is dropped.

How a ZIP gets its office
-------------------------
A ZIP is offered the office nearest to its internal point among those HHSC
lists for any county the ZIP touches. HHSC's lists are the authority on
*which* offices serve a county; the distance only chooses among them, so a
Harris County ZIP is sent to the closest Harris County office rather than to
the first one HHSC printed. Every county a ZIP touches counts, not only the
one with most of its land: most of 79601's land is rural Jones County, but
its people are in Abilene, and the Abilene office is the one nearest them.

Usage (repository root)::

    .venv/bin/python tools/build_tx_hhsc_offices.py \\
        <hhsc-find-an-office.json> <zcta-county.txt> <zcta-gazetteer.txt>
"""

from __future__ import annotations

import csv
import json
import math
import re
import sys
from pathlib import Path

OUTPUT = Path(__file__).resolve().parent.parent / "web/src/lib/tx-hhsc-offices.json"

TEXAS_FIPS = "48"

TEXAS_ZIP = re.compile(r"^(7[5-9]\d{3}|885\d{2})$")

TEXAS_WORKS_PROGRAMS = {
    "FindOffice_SNAPTitle",
    "FindOffice_TANFTitle",
    "FindOffice_MEDICAIDTitle",
}


def county_key(name: str) -> str:
    """'DeWitt County', 'De Witt', 'DEWITT' -> 'dewitt'."""
    name = re.sub(r"\s+County$", "", name.strip(), flags=re.IGNORECASE)
    return re.sub(r"[^a-z]", "", name.lower())


def title_case(text: str) -> str:
    return " ".join(word.capitalize() for word in text.split())


def parse_address(raw: str) -> tuple[str, str, str] | None:
    """'5451 North IH 35,Suite D,AUSTIN,TX,78723' -> (street, city, zip)."""
    parts = [part.strip() for part in raw.split(",") if part.strip()]

    if len(parts) < 4 or parts[-2].upper() != "TX":
        return None

    zip_code = parts[-1][:5]

    if not re.fullmatch(r"\d{5}", zip_code):
        return None

    return ", ".join(parts[:-3]), title_case(parts[-3]), zip_code


def texas_works_offices(entries: list[dict]) -> list[dict]:
    offices = []

    for entry in entries:
        if entry.get("type") != "HHSC":
            continue

        programs = {p.get("programName") for p in entry.get("programList") or []}

        if not programs & TEXAS_WORKS_PROGRAMS:
            continue

        parsed = parse_address(entry.get("physicalAddress") or "")

        if parsed is None:
            continue

        street, city, zip_code = parsed

        offices.append(
            {
                "street": street,
                "city": city,
                "zipCode": zip_code,
                "county": title_case(entry.get("county") or ""),
            }
        )

    return offices


def office_id(office: dict) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", f"{office['street']} {office['zipCode']}".lower())
    return slug.strip("-")


def distance_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 12_742 * math.asin(math.sqrt(h))


def main(hhsc_path: str, relationship_path: str, gazetteer_path: str) -> None:
    hhsc = json.loads(Path(hhsc_path).read_text())

    # County -> the Texas Works offices HHSC lists for it, in HHSC's order.
    offices: dict[str, dict] = {}
    county_offices: dict[str, list[str]] = {}

    for county, entries in hhsc["answers"].items():
        ids = []

        for office in texas_works_offices(entries):
            identifier = office_id(office)
            offices.setdefault(identifier, office)

            if identifier not in ids:
                ids.append(identifier)

        county_offices[county_key(county)] = ids

    # ZCTA -> every Texas county it touches.
    zcta_counties: dict[str, set[str]] = {}

    with open(relationship_path, encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle, delimiter="|"):
            zcta = row["GEOID_ZCTA5_20"]
            county_fips = row["GEOID_COUNTY_20"]

            # A ZCTA can cross the state line: 73949 (Texhoma, Oklahoma)
            # reaches into Sherman County. Keep Texas ZIPs only, by the same
            # prefixes as `stateFromZipPrefix` in web/src/lib/location.ts.
            if not county_fips.startswith(TEXAS_FIPS) or not TEXAS_ZIP.match(zcta):
                continue

            zcta_counties.setdefault(zcta, set()).add(row["NAMELSAD_COUNTY_20"])

    points: dict[str, tuple[float, float]] = {}

    with open(gazetteer_path, encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle, delimiter="\t")
        header = [column.strip() for column in next(reader)]
        lat, lon = header.index("INTPTLAT"), header.index("INTPTLONG")

        for row in reader:
            points[row[0].strip()] = (float(row[lat]), float(row[lon]))

    zip_to_office: dict[str, str] = {}
    unmatched_counties = {
        name
        for names in zcta_counties.values()
        for name in names
        if not county_offices.get(county_key(name))
    }

    for zcta, county_names in sorted(zcta_counties.items()):
        candidates = [
            identifier
            for name in sorted(county_names)
            for identifier in county_offices.get(county_key(name), [])
        ]

        if not candidates:
            continue

        here = points.get(zcta)

        def rank(identifier: str) -> tuple[float, int]:
            there = points.get(offices[identifier]["zipCode"])
            far = distance_km(here, there) if here and there else math.inf
            return far, candidates.index(identifier)

        zip_to_office[zcta] = min(candidates, key=rank)

    used = {identifier for identifier in zip_to_office.values()}

    OUTPUT.write_text(
        json.dumps(
            {
                "source": hhsc["source"],
                "fetchedAt": hhsc["fetchedAt"],
                "offices": {key: offices[key] for key in sorted(used)},
                "zipToOffice": zip_to_office,
            },
            indent=1,
            sort_keys=False,
        )
        + "\n"
    )

    print(
        f"{len(used)} offices, {len(zip_to_office)} ZIPs, "
        f"{len(unmatched_counties)} counties without a Texas Works office: "
        f"{sorted(unmatched_counties)}"
    )


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)

    main(*sys.argv[1:])
