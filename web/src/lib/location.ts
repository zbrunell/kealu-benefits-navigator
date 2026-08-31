//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * ZIP-code location resolution — the single source of truth for city, state,
 * and county across intake, the report, the SAWS 2 PLUS application, and the
 * demo/E2E fixture.
 *
 * Intake asks for a ZIP code and nothing else about location. Everything that
 * can be resolved from that ZIP is resolved once, here, and written into the
 * session vars, so no later step re-asks the user for city, state, or county.
 *
 * Resolution order:
 *
 * 1. `ZIP_LOCATIONS` — an exact five-digit table (city + county). Offline,
 *    instant, deterministic. Coverage is partial: the fully supported markets
 *    first (California, and Austin/Travis County in Texas), then the ZIPs used
 *    by the demo and the test suite. City and county are what promote a ZIP
 *    from "some state" to a jurisdiction that county- and city-level programs
 *    can be matched against, so a market is not deeply supported until its
 *    ZIPs are listed here.
 * 2. The CMS Marketplace `/counties/by/zip` endpoint — authoritative for county
 *    and state, already used elsewhere in the app. Results are memoized per ZIP.
 *    CMS does not return a city, so city comes only from step 1.
 * 3. `ZIP_PREFIX_STATES` — three-digit prefix ranges, used for state alone.
 *
 * Anything unresolved stays an empty string. Nothing is guessed: a ZIP that
 * spans two counties resolves its state but leaves county blank rather than
 * picking one, and an unknown ZIP yields no location at all.
 */

/** A resolved (or partially resolved) location. Empty strings mean unresolved. */
export interface ResolvedLocation {
  /** USPS city name, or "" when unknown. */
  city: string;
  /** Two-letter USPS state code, or "" when unknown. */
  state: string;
  /** County name without the " County" suffix, or "" when unknown/ambiguous. */
  county: string;
}

/** Where each field of a resolution came from. Diagnostics only. */
export type LocationSource = 'table' | 'cms' | 'prefix' | 'unresolved';

export interface ResolvedLocationWithSource extends ResolvedLocation {
  source: LocationSource;
}

export const EMPTY_LOCATION: ResolvedLocation = {
  city: '',
  state: '',
  county: '',
};

/** [inclusive 3-digit prefix start, inclusive end, USPS state code] */
const ZIP_PREFIX_STATES: ReadonlyArray<readonly [number, number, string]> = [
  [5, 5, 'NY'], [6, 9, 'PR'], [10, 27, 'MA'], [28, 29, 'RI'], [30, 38, 'NH'],
  [39, 49, 'ME'], [50, 59, 'VT'], [60, 69, 'CT'], [70, 89, 'NJ'],
  [100, 149, 'NY'], [150, 196, 'PA'], [197, 199, 'DE'], [200, 205, 'DC'],
  [206, 219, 'MD'], [220, 246, 'VA'], [247, 268, 'WV'], [270, 289, 'NC'],
  [290, 299, 'SC'], [300, 319, 'GA'], [320, 349, 'FL'], [350, 369, 'AL'],
  [370, 385, 'TN'], [386, 397, 'MS'], [398, 399, 'GA'], [400, 427, 'KY'],
  [430, 459, 'OH'], [460, 479, 'IN'], [480, 499, 'MI'], [500, 528, 'IA'],
  [530, 549, 'WI'], [550, 567, 'MN'], [570, 577, 'SD'], [580, 588, 'ND'],
  [590, 599, 'MT'], [600, 629, 'IL'], [630, 658, 'MO'], [660, 679, 'KS'],
  [680, 693, 'NE'], [700, 714, 'LA'], [716, 729, 'AR'], [730, 749, 'OK'],
  [750, 799, 'TX'], [800, 816, 'CO'], [820, 831, 'WY'], [832, 838, 'ID'],
  [840, 847, 'UT'], [850, 865, 'AZ'], [870, 884, 'NM'], [885, 885, 'TX'],
  [889, 898, 'NV'], [900, 961, 'CA'], [967, 968, 'HI'], [970, 979, 'OR'],
  [980, 994, 'WA'], [995, 999, 'AK'],
];

/**
 * Exact five-digit ZIP → [city, county, state].
 *
 * Deliberately exact: city and county are only ever reported for a ZIP listed
 * here, because neither can be inferred from a ZIP prefix without guessing
 * (91744 and 91764 share the 917 prefix but sit in different counties).
 *
 * Coverage is partial — the most populous California cities, Austin/Travis
 * County, and the ZIPs used by the demo and the test suite. An unlisted ZIP
 * falls through to CMS for county/state and simply has no city. Extend this
 * table freely; it is data, not logic.
 *
 * ZIPs that straddle a county line are deliberately absent rather than
 * assigned to the larger share. Austin spills north into Williamson County
 * (78717, 78726–78730, 78750), so those are left to CMS, which returns state
 * alone for an ambiguous ZIP. A household given the wrong county silently
 * loses every county program it qualifies for and gains ones it does not.
 */
const ZIP_LOCATIONS: Readonly<
  Record<string, readonly [city: string, county: string, state: string]>
> = {
  // Los Angeles County
  '90001': ['Los Angeles', 'Los Angeles', 'CA'],
  '90002': ['Los Angeles', 'Los Angeles', 'CA'],
  '90003': ['Los Angeles', 'Los Angeles', 'CA'],
  '90011': ['Los Angeles', 'Los Angeles', 'CA'],
  '90012': ['Los Angeles', 'Los Angeles', 'CA'],
  '90015': ['Los Angeles', 'Los Angeles', 'CA'],
  '90017': ['Los Angeles', 'Los Angeles', 'CA'],
  '90019': ['Los Angeles', 'Los Angeles', 'CA'],
  '90026': ['Los Angeles', 'Los Angeles', 'CA'],
  '90028': ['Los Angeles', 'Los Angeles', 'CA'],
  '90037': ['Los Angeles', 'Los Angeles', 'CA'],
  '90044': ['Los Angeles', 'Los Angeles', 'CA'],
  '90045': ['Los Angeles', 'Los Angeles', 'CA'],
  '90057': ['Los Angeles', 'Los Angeles', 'CA'],
  '90066': ['Los Angeles', 'Los Angeles', 'CA'],
  '90210': ['Beverly Hills', 'Los Angeles', 'CA'],
  '90211': ['Beverly Hills', 'Los Angeles', 'CA'],
  '90212': ['Beverly Hills', 'Los Angeles', 'CA'],
  '90230': ['Culver City', 'Los Angeles', 'CA'],
  '90241': ['Downey', 'Los Angeles', 'CA'],
  '90242': ['Downey', 'Los Angeles', 'CA'],
  '90247': ['Gardena', 'Los Angeles', 'CA'],
  '90250': ['Hawthorne', 'Los Angeles', 'CA'],
  '90255': ['Huntington Park', 'Los Angeles', 'CA'],
  '90262': ['Lynwood', 'Los Angeles', 'CA'],
  '90280': ['South Gate', 'Los Angeles', 'CA'],
  '90301': ['Inglewood', 'Los Angeles', 'CA'],
  '90302': ['Inglewood', 'Los Angeles', 'CA'],
  '90303': ['Inglewood', 'Los Angeles', 'CA'],
  '90401': ['Santa Monica', 'Los Angeles', 'CA'],
  '90402': ['Santa Monica', 'Los Angeles', 'CA'],
  '90403': ['Santa Monica', 'Los Angeles', 'CA'],
  '90404': ['Santa Monica', 'Los Angeles', 'CA'],
  '90405': ['Santa Monica', 'Los Angeles', 'CA'],
  '90501': ['Torrance', 'Los Angeles', 'CA'],
  '90503': ['Torrance', 'Los Angeles', 'CA'],
  '90505': ['Torrance', 'Los Angeles', 'CA'],
  '90601': ['Whittier', 'Los Angeles', 'CA'],
  '90602': ['Whittier', 'Los Angeles', 'CA'],
  '90604': ['Whittier', 'Los Angeles', 'CA'],
  '90605': ['Whittier', 'Los Angeles', 'CA'],
  '90640': ['Montebello', 'Los Angeles', 'CA'],
  '90650': ['Norwalk', 'Los Angeles', 'CA'],
  '90660': ['Pico Rivera', 'Los Angeles', 'CA'],
  '90703': ['Cerritos', 'Los Angeles', 'CA'],
  '90706': ['Bellflower', 'Los Angeles', 'CA'],
  '90745': ['Carson', 'Los Angeles', 'CA'],
  '90802': ['Long Beach', 'Los Angeles', 'CA'],
  '90803': ['Long Beach', 'Los Angeles', 'CA'],
  '90805': ['Long Beach', 'Los Angeles', 'CA'],
  '90806': ['Long Beach', 'Los Angeles', 'CA'],
  '90810': ['Long Beach', 'Los Angeles', 'CA'],
  '90813': ['Long Beach', 'Los Angeles', 'CA'],
  '90815': ['Long Beach', 'Los Angeles', 'CA'],
  '91101': ['Pasadena', 'Los Angeles', 'CA'],
  '91103': ['Pasadena', 'Los Angeles', 'CA'],
  '91104': ['Pasadena', 'Los Angeles', 'CA'],
  '91106': ['Pasadena', 'Los Angeles', 'CA'],
  '91107': ['Pasadena', 'Los Angeles', 'CA'],
  '91201': ['Glendale', 'Los Angeles', 'CA'],
  '91205': ['Glendale', 'Los Angeles', 'CA'],
  '91206': ['Glendale', 'Los Angeles', 'CA'],
  '91331': ['Pacoima', 'Los Angeles', 'CA'],
  '91335': ['Reseda', 'Los Angeles', 'CA'],
  '91342': ['Sylmar', 'Los Angeles', 'CA'],
  '91352': ['Sun Valley', 'Los Angeles', 'CA'],
  '91401': ['Van Nuys', 'Los Angeles', 'CA'],
  '91405': ['Van Nuys', 'Los Angeles', 'CA'],
  '91406': ['Van Nuys', 'Los Angeles', 'CA'],
  '91501': ['Burbank', 'Los Angeles', 'CA'],
  '91505': ['Burbank', 'Los Angeles', 'CA'],
  '91506': ['Burbank', 'Los Angeles', 'CA'],
  '91601': ['North Hollywood', 'Los Angeles', 'CA'],
  '91604': ['Studio City', 'Los Angeles', 'CA'],
  '91744': ['La Puente', 'Los Angeles', 'CA'],
  '91754': ['Monterey Park', 'Los Angeles', 'CA'],
  '91766': ['Pomona', 'Los Angeles', 'CA'],
  '91767': ['Pomona', 'Los Angeles', 'CA'],
  '91790': ['West Covina', 'Los Angeles', 'CA'],
  '91801': ['Alhambra', 'Los Angeles', 'CA'],
  '93534': ['Lancaster', 'Los Angeles', 'CA'],
  '93535': ['Lancaster', 'Los Angeles', 'CA'],
  '93550': ['Palmdale', 'Los Angeles', 'CA'],
  '93551': ['Palmdale', 'Los Angeles', 'CA'],

  // Orange County
  '92626': ['Costa Mesa', 'Orange', 'CA'],
  '92627': ['Costa Mesa', 'Orange', 'CA'],
  '92646': ['Huntington Beach', 'Orange', 'CA'],
  '92647': ['Huntington Beach', 'Orange', 'CA'],
  '92683': ['Westminster', 'Orange', 'CA'],
  '92701': ['Santa Ana', 'Orange', 'CA'],
  '92703': ['Santa Ana', 'Orange', 'CA'],
  '92704': ['Santa Ana', 'Orange', 'CA'],
  '92705': ['Santa Ana', 'Orange', 'CA'],
  '92801': ['Anaheim', 'Orange', 'CA'],
  '92802': ['Anaheim', 'Orange', 'CA'],
  '92804': ['Anaheim', 'Orange', 'CA'],
  '92805': ['Anaheim', 'Orange', 'CA'],
  '92831': ['Fullerton', 'Orange', 'CA'],
  '92832': ['Fullerton', 'Orange', 'CA'],
  '92840': ['Garden Grove', 'Orange', 'CA'],
  '92843': ['Garden Grove', 'Orange', 'CA'],
  '92867': ['Orange', 'Orange', 'CA'],

  // San Diego County
  '92101': ['San Diego', 'San Diego', 'CA'],
  '92102': ['San Diego', 'San Diego', 'CA'],
  '92103': ['San Diego', 'San Diego', 'CA'],
  '92104': ['San Diego', 'San Diego', 'CA'],
  '92105': ['San Diego', 'San Diego', 'CA'],
  '92113': ['San Diego', 'San Diego', 'CA'],
  '92114': ['San Diego', 'San Diego', 'CA'],
  '92115': ['San Diego', 'San Diego', 'CA'],
  '92126': ['San Diego', 'San Diego', 'CA'],

  // Riverside / San Bernardino counties
  '92201': ['Indio', 'Riverside', 'CA'],
  '92262': ['Palm Springs', 'Riverside', 'CA'],
  '92335': ['Fontana', 'San Bernardino', 'CA'],
  '92336': ['Fontana', 'San Bernardino', 'CA'],
  '92345': ['Hesperia', 'San Bernardino', 'CA'],
  '92376': ['Rialto', 'San Bernardino', 'CA'],
  '92392': ['Victorville', 'San Bernardino', 'CA'],
  '92401': ['San Bernardino', 'San Bernardino', 'CA'],
  '92404': ['San Bernardino', 'San Bernardino', 'CA'],
  '92411': ['San Bernardino', 'San Bernardino', 'CA'],
  '92501': ['Riverside', 'Riverside', 'CA'],
  '92503': ['Riverside', 'Riverside', 'CA'],
  '92504': ['Riverside', 'Riverside', 'CA'],
  '92507': ['Riverside', 'Riverside', 'CA'],
  '92553': ['Moreno Valley', 'Riverside', 'CA'],
  '92557': ['Moreno Valley', 'Riverside', 'CA'],
  '92570': ['Perris', 'Riverside', 'CA'],
  '92591': ['Temecula', 'Riverside', 'CA'],
  '92592': ['Temecula', 'Riverside', 'CA'],
  '91710': ['Chino', 'San Bernardino', 'CA'],
  '91730': ['Rancho Cucamonga', 'San Bernardino', 'CA'],
  '91764': ['Ontario', 'San Bernardino', 'CA'],

  // Ventura / Santa Barbara / Kern counties
  '93003': ['Ventura', 'Ventura', 'CA'],
  '93010': ['Camarillo', 'Ventura', 'CA'],
  '93030': ['Oxnard', 'Ventura', 'CA'],
  '93033': ['Oxnard', 'Ventura', 'CA'],
  '93065': ['Simi Valley', 'Ventura', 'CA'],
  '93101': ['Santa Barbara', 'Santa Barbara', 'CA'],
  '93105': ['Santa Barbara', 'Santa Barbara', 'CA'],
  '93454': ['Santa Maria', 'Santa Barbara', 'CA'],
  '93301': ['Bakersfield', 'Kern', 'CA'],
  '93304': ['Bakersfield', 'Kern', 'CA'],
  '93307': ['Bakersfield', 'Kern', 'CA'],
  '93309': ['Bakersfield', 'Kern', 'CA'],

  // Central Valley / Central Coast
  '93611': ['Clovis', 'Fresno', 'CA'],
  '93701': ['Fresno', 'Fresno', 'CA'],
  '93702': ['Fresno', 'Fresno', 'CA'],
  '93703': ['Fresno', 'Fresno', 'CA'],
  '93705': ['Fresno', 'Fresno', 'CA'],
  '93706': ['Fresno', 'Fresno', 'CA'],
  '93710': ['Fresno', 'Fresno', 'CA'],
  '93726': ['Fresno', 'Fresno', 'CA'],
  '93727': ['Fresno', 'Fresno', 'CA'],
  '93901': ['Salinas', 'Monterey', 'CA'],
  '93905': ['Salinas', 'Monterey', 'CA'],
  '93906': ['Salinas', 'Monterey', 'CA'],
  '93940': ['Monterey', 'Monterey', 'CA'],
  '95340': ['Merced', 'Merced', 'CA'],
  '95350': ['Modesto', 'Stanislaus', 'CA'],
  '95351': ['Modesto', 'Stanislaus', 'CA'],
  '95354': ['Modesto', 'Stanislaus', 'CA'],
  '95376': ['Tracy', 'San Joaquin', 'CA'],
  '95380': ['Turlock', 'Stanislaus', 'CA'],
  '95201': ['Stockton', 'San Joaquin', 'CA'],
  '95202': ['Stockton', 'San Joaquin', 'CA'],
  '95205': ['Stockton', 'San Joaquin', 'CA'],
  '95206': ['Stockton', 'San Joaquin', 'CA'],
  '95207': ['Stockton', 'San Joaquin', 'CA'],
  '95336': ['Manteca', 'San Joaquin', 'CA'],

  // Bay Area
  '94102': ['San Francisco', 'San Francisco', 'CA'],
  '94103': ['San Francisco', 'San Francisco', 'CA'],
  '94107': ['San Francisco', 'San Francisco', 'CA'],
  '94109': ['San Francisco', 'San Francisco', 'CA'],
  '94110': ['San Francisco', 'San Francisco', 'CA'],
  '94112': ['San Francisco', 'San Francisco', 'CA'],
  '94114': ['San Francisco', 'San Francisco', 'CA'],
  '94116': ['San Francisco', 'San Francisco', 'CA'],
  '94117': ['San Francisco', 'San Francisco', 'CA'],
  '94118': ['San Francisco', 'San Francisco', 'CA'],
  '94121': ['San Francisco', 'San Francisco', 'CA'],
  '94122': ['San Francisco', 'San Francisco', 'CA'],
  '94124': ['San Francisco', 'San Francisco', 'CA'],
  '94134': ['San Francisco', 'San Francisco', 'CA'],
  '94014': ['Daly City', 'San Mateo', 'CA'],
  '94015': ['Daly City', 'San Mateo', 'CA'],
  '94010': ['Burlingame', 'San Mateo', 'CA'],
  '94025': ['Menlo Park', 'San Mateo', 'CA'],
  '94061': ['Redwood City', 'San Mateo', 'CA'],
  '94063': ['Redwood City', 'San Mateo', 'CA'],
  '94080': ['South San Francisco', 'San Mateo', 'CA'],
  '94401': ['San Mateo', 'San Mateo', 'CA'],
  '94403': ['San Mateo', 'San Mateo', 'CA'],
  '94301': ['Palo Alto', 'Santa Clara', 'CA'],
  '94303': ['Palo Alto', 'Santa Clara', 'CA'],
  '95035': ['Milpitas', 'Santa Clara', 'CA'],
  '95050': ['Santa Clara', 'Santa Clara', 'CA'],
  '95051': ['Santa Clara', 'Santa Clara', 'CA'],
  '95110': ['San Jose', 'Santa Clara', 'CA'],
  '95111': ['San Jose', 'Santa Clara', 'CA'],
  '95112': ['San Jose', 'Santa Clara', 'CA'],
  '95116': ['San Jose', 'Santa Clara', 'CA'],
  '95122': ['San Jose', 'Santa Clara', 'CA'],
  '95123': ['San Jose', 'Santa Clara', 'CA'],
  '95127': ['San Jose', 'Santa Clara', 'CA'],
  '95128': ['San Jose', 'Santa Clara', 'CA'],
  '95148': ['San Jose', 'Santa Clara', 'CA'],
  '94501': ['Alameda', 'Alameda', 'CA'],
  '94536': ['Fremont', 'Alameda', 'CA'],
  '94538': ['Fremont', 'Alameda', 'CA'],
  '94541': ['Hayward', 'Alameda', 'CA'],
  '94544': ['Hayward', 'Alameda', 'CA'],
  '94550': ['Livermore', 'Alameda', 'CA'],
  '94566': ['Pleasanton', 'Alameda', 'CA'],
  '94577': ['San Leandro', 'Alameda', 'CA'],
  '94587': ['Union City', 'Alameda', 'CA'],
  '94601': ['Oakland', 'Alameda', 'CA'],
  '94602': ['Oakland', 'Alameda', 'CA'],
  '94603': ['Oakland', 'Alameda', 'CA'],
  '94605': ['Oakland', 'Alameda', 'CA'],
  '94606': ['Oakland', 'Alameda', 'CA'],
  '94607': ['Oakland', 'Alameda', 'CA'],
  '94609': ['Oakland', 'Alameda', 'CA'],
  '94610': ['Oakland', 'Alameda', 'CA'],
  '94612': ['Oakland', 'Alameda', 'CA'],
  '94621': ['Oakland', 'Alameda', 'CA'],
  '94702': ['Berkeley', 'Alameda', 'CA'],
  '94703': ['Berkeley', 'Alameda', 'CA'],
  '94704': ['Berkeley', 'Alameda', 'CA'],
  '94705': ['Berkeley', 'Alameda', 'CA'],
  '94509': ['Antioch', 'Contra Costa', 'CA'],
  '94520': ['Concord', 'Contra Costa', 'CA'],
  '94521': ['Concord', 'Contra Costa', 'CA'],
  '94553': ['Martinez', 'Contra Costa', 'CA'],
  '94801': ['Richmond', 'Contra Costa', 'CA'],
  '94804': ['Richmond', 'Contra Costa', 'CA'],
  '94806': ['San Pablo', 'Contra Costa', 'CA'],
  '94533': ['Fairfield', 'Solano', 'CA'],
  '94589': ['Vallejo', 'Solano', 'CA'],
  '94590': ['Vallejo', 'Solano', 'CA'],
  '94558': ['Napa', 'Napa', 'CA'],
  '94901': ['San Rafael', 'Marin', 'CA'],
  '94945': ['Novato', 'Marin', 'CA'],
  '95060': ['Santa Cruz', 'Santa Cruz', 'CA'],
  '95076': ['Watsonville', 'Santa Cruz', 'CA'],
  '95401': ['Santa Rosa', 'Sonoma', 'CA'],
  '95403': ['Santa Rosa', 'Sonoma', 'CA'],
  '95404': ['Santa Rosa', 'Sonoma', 'CA'],
  '95407': ['Santa Rosa', 'Sonoma', 'CA'],

  // Sacramento region and north
  '95811': ['Sacramento', 'Sacramento', 'CA'],
  '95814': ['Sacramento', 'Sacramento', 'CA'],
  '95815': ['Sacramento', 'Sacramento', 'CA'],
  '95816': ['Sacramento', 'Sacramento', 'CA'],
  '95817': ['Sacramento', 'Sacramento', 'CA'],
  '95818': ['Sacramento', 'Sacramento', 'CA'],
  '95820': ['Sacramento', 'Sacramento', 'CA'],
  '95822': ['Sacramento', 'Sacramento', 'CA'],
  '95823': ['Sacramento', 'Sacramento', 'CA'],
  '95824': ['Sacramento', 'Sacramento', 'CA'],
  '95825': ['Sacramento', 'Sacramento', 'CA'],
  '95826': ['Sacramento', 'Sacramento', 'CA'],
  '95828': ['Sacramento', 'Sacramento', 'CA'],
  '95833': ['Sacramento', 'Sacramento', 'CA'],
  '95838': ['Sacramento', 'Sacramento', 'CA'],
  '95610': ['Citrus Heights', 'Sacramento', 'CA'],
  '95621': ['Citrus Heights', 'Sacramento', 'CA'],
  '95624': ['Elk Grove', 'Sacramento', 'CA'],
  '95757': ['Elk Grove', 'Sacramento', 'CA'],
  '95758': ['Elk Grove', 'Sacramento', 'CA'],
  '95630': ['Folsom', 'Sacramento', 'CA'],
  '95670': ['Rancho Cordova', 'Sacramento', 'CA'],
  '95661': ['Roseville', 'Placer', 'CA'],
  '95678': ['Roseville', 'Placer', 'CA'],
  '95677': ['Rocklin', 'Placer', 'CA'],
  '95691': ['West Sacramento', 'Yolo', 'CA'],
  '95695': ['Woodland', 'Yolo', 'CA'],
  '95926': ['Chico', 'Butte', 'CA'],
  '95928': ['Chico', 'Butte', 'CA'],
  '95991': ['Yuba City', 'Sutter', 'CA'],
  '96001': ['Redding', 'Shasta', 'CA'],
  '96002': ['Redding', 'Shasta', 'CA'],
  '95501': ['Eureka', 'Humboldt', 'CA'],

  // ── Texas ────────────────────────────────────────────────────────────────
  //
  // Austin / Travis County is the first deeply supported local market outside
  // California, so its ZIPs are enumerated rather than left to CMS: Central
  // Health MAP and the Austin Energy Customer Assistance Program are matched
  // on county and city, and neither can be matched from a state code alone.
  //
  // Travis County only. The Williamson County side of Austin is omitted on
  // purpose — see the note above.
  '78701': ['Austin', 'Travis', 'TX'],
  '78702': ['Austin', 'Travis', 'TX'],
  '78703': ['Austin', 'Travis', 'TX'],
  '78704': ['Austin', 'Travis', 'TX'],
  '78705': ['Austin', 'Travis', 'TX'],
  '78712': ['Austin', 'Travis', 'TX'],
  '78719': ['Austin', 'Travis', 'TX'],
  '78721': ['Austin', 'Travis', 'TX'],
  '78722': ['Austin', 'Travis', 'TX'],
  '78723': ['Austin', 'Travis', 'TX'],
  '78724': ['Austin', 'Travis', 'TX'],
  '78725': ['Austin', 'Travis', 'TX'],
  '78731': ['Austin', 'Travis', 'TX'],
  '78732': ['Austin', 'Travis', 'TX'],
  '78733': ['Austin', 'Travis', 'TX'],
  '78735': ['Austin', 'Travis', 'TX'],
  '78736': ['Austin', 'Travis', 'TX'],
  '78737': ['Austin', 'Travis', 'TX'],
  '78739': ['Austin', 'Travis', 'TX'],
  '78741': ['Austin', 'Travis', 'TX'],
  '78742': ['Austin', 'Travis', 'TX'],
  '78744': ['Austin', 'Travis', 'TX'],
  '78745': ['Austin', 'Travis', 'TX'],
  '78746': ['Austin', 'Travis', 'TX'],
  '78747': ['Austin', 'Travis', 'TX'],
  '78748': ['Austin', 'Travis', 'TX'],
  '78749': ['Austin', 'Travis', 'TX'],
  '78751': ['Austin', 'Travis', 'TX'],
  '78752': ['Austin', 'Travis', 'TX'],
  '78753': ['Austin', 'Travis', 'TX'],
  '78754': ['Austin', 'Travis', 'TX'],
  '78756': ['Austin', 'Travis', 'TX'],
  '78757': ['Austin', 'Travis', 'TX'],
  '78758': ['Austin', 'Travis', 'TX'],
  '78759': ['Austin', 'Travis', 'TX'],

  // Other Travis County cities, which are in Texas and Travis County but not
  // in the City of Austin — the case that proves a city program stays inside
  // its city.
  '78610': ['Buda', 'Hays', 'TX'],
  '78641': ['Leander', 'Williamson', 'TX'],
  '78652': ['Manchaca', 'Travis', 'TX'],
  '78653': ['Manor', 'Travis', 'TX'],
  '78669': ['Spicewood', 'Travis', 'TX'],

  // Texas outside Travis County — the case that proves an Austin program does
  // not leak to the rest of the state.
  '77002': ['Houston', 'Harris', 'TX'],
  '77004': ['Houston', 'Harris', 'TX'],
  '75201': ['Dallas', 'Dallas', 'TX'],
  '75204': ['Dallas', 'Dallas', 'TX'],
  '78205': ['San Antonio', 'Bexar', 'TX'],
  '79901': ['El Paso', 'El Paso', 'TX'],
};

/** Normalize a five-digit ZIP from user input; "" when not five digits. */
export function normalizeZip(zipCode: string | undefined | null): string {
  const digits = (zipCode ?? '').trim().slice(0, 5);
  return /^\d{5}$/.test(digits) ? digits : '';
}

/** State from the three-digit prefix ranges, or "" when unrecognized. */
export function stateFromZipPrefix(zipCode: string | undefined): string {
  const zip = normalizeZip(zipCode);
  if (!zip) return '';

  const prefix = Number(zip.slice(0, 3));
  const match = ZIP_PREFIX_STATES.find(
    ([start, end]) => prefix >= start && prefix <= end,
  );

  return match?.[2] ?? '';
}

/** Strip the trailing " County" that CMS includes in county names. */
export function normalizeCountyName(name: string): string {
  return name.trim().replace(/\s+County$/i, '').trim();
}

/**
 * Resolve a ZIP without any network access.
 *
 * Uses the exact-ZIP table first, then the prefix table for state alone. This
 * is the synchronous path used anywhere an await is not possible (and the
 * fallback when CMS is unavailable).
 */
export function resolveZipLocationOffline(
  zipCode: string | undefined,
): ResolvedLocationWithSource {
  const zip = normalizeZip(zipCode);
  if (!zip) return { ...EMPTY_LOCATION, source: 'unresolved' };

  const exact = ZIP_LOCATIONS[zip];
  if (exact) {
    const [city, county, state] = exact;
    return { city, state, county, source: 'table' };
  }

  const state = stateFromZipPrefix(zip);

  return {
    city: '',
    state,
    county: '',
    source: state ? 'prefix' : 'unresolved',
  };
}

/** Memoized CMS county lookups, keyed by ZIP. null = looked up, unresolved. */
const cmsCountyCache = new Map<string, ResolvedLocation | null>();

/**
 * Ask CMS for the county and state of a ZIP.
 *
 * Returns null when CMS is unavailable (no API key, offline, rate limited) or
 * when the ZIP spans more than one county in the same state — an ambiguous
 * answer is left unresolved rather than guessed.
 */
async function resolveFromCms(zip: string): Promise<ResolvedLocation | null> {
  if (cmsCountyCache.has(zip)) return cmsCountyCache.get(zip) ?? null;

  let resolved: ResolvedLocation | null = null;

  try {
    const { getCountiesByZip } = await import('@/lib/cms-marketplace');
    const counties = await getCountiesByZip(zip);

    // Boundary ZIPs can span states; prefer the prefix-derived state.
    const preferredState = stateFromZipPrefix(zip);
    const candidates = preferredState
      ? counties.filter((county) => county.state === preferredState)
      : counties;

    const pool = candidates.length > 0 ? candidates : counties;
    const distinct = new Set(pool.map((county) => normalizeCountyName(county.name)));

    if (pool.length > 0) {
      resolved = {
        city: '',
        state: pool[0].state,
        // Ambiguous across counties → state only, county left blank.
        county: distinct.size === 1 ? normalizeCountyName(pool[0].name) : '',
      };
    }
  } catch {
    // CMS unavailable — the caller falls back to the offline tables.
    resolved = null;
  }

  cmsCountyCache.set(zip, resolved);

  return resolved;
}

/**
 * Resolve city, state, and county for a ZIP code.
 *
 * Never throws and never guesses: unresolved fields come back as empty strings.
 */
export async function resolveZipLocation(
  zipCode: string | undefined,
): Promise<ResolvedLocationWithSource> {
  const zip = normalizeZip(zipCode);
  if (!zip) return { ...EMPTY_LOCATION, source: 'unresolved' };

  const offline = resolveZipLocationOffline(zip);

  // The exact table already has city + county + state; no lookup needed.
  if (offline.source === 'table') return offline;

  const cms = await resolveFromCms(zip);
  if (!cms) return offline;

  return {
    city: offline.city,
    state: cms.state || offline.state,
    county: cms.county || offline.county,
    source: 'cms',
  };
}

/** Test seam: clear the memoized CMS lookups. */
export function __clearLocationCache(): void {
  cmsCountyCache.clear();
}
