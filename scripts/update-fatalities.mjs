#!/usr/bin/env node

/**
 * Fetches NYC traffic fatality and injury data from the NYC Open Data SODA API
 * and updates src/data/fatalities.json with current numbers.
 *
 * The script:
 * - Queries the NYPD Motor Vehicle Collisions dataset for fatal crashes
 * - Queries aggregate injury counts by year
 * - For completed years, keeps the existing manually-vetted values
 * - For the current year, uses API YTD counts and projects full-year estimates
 * - Updates the permit timeline months-waiting count
 * - Updates the last timeline entry's cumulative death count and date
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_PATH = join(__dirname, "..", "src", "data", "fatalities.json");

const API_BASE = "https://data.cityofnewyork.us/resource/h9gi-nx95.json";

async function queryFatalCrashes(year) {
  const startDate = `${year}-01-01T00:00:00`;
  const endDate = `${year + 1}-01-01T00:00:00`;

  const params = new URLSearchParams({
    $where: `number_of_persons_killed > 0 AND crash_date >= '${startDate}' AND crash_date < '${endDate}'`,
    $select: "collision_id, crash_date, number_of_persons_killed, number_of_pedestrians_killed, number_of_cyclist_killed, number_of_motorist_killed",
    $limit: "50000",
  });

  const resp = await fetch(`${API_BASE}?${params}`);
  if (!resp.ok) {
    console.error(`API error for year ${year}: ${resp.status} ${resp.statusText}`);
    return [];
  }

  return resp.json();
}

async function queryInjuryAggregates(year) {
  const startDate = `${year}-01-01T00:00:00`;
  const endDate = `${year + 1}-01-01T00:00:00`;

  const params = new URLSearchParams({
    $where: `crash_date >= '${startDate}' AND crash_date < '${endDate}'`,
    $select: "sum(number_of_pedestrians_injured) as ped, sum(number_of_cyclist_injured) as cyc, sum(number_of_motorist_injured) as mot",
  });

  const resp = await fetch(`${API_BASE}?${params}`);
  if (!resp.ok) {
    console.error(`API error for injury aggregates ${year}: ${resp.status} ${resp.statusText}`);
    return null;
  }

  const rows = await resp.json();
  if (!rows.length) return null;
  return {
    pedestrian: parseInt(rows[0].ped, 10) || 0,
    cyclist: parseInt(rows[0].cyc, 10) || 0,
    motorist: parseInt(rows[0].mot, 10) || 0,
  };
}

function dedup(records) {
  const seen = new Map();
  for (const r of records) {
    const key = r.collision_id;
    if (key && !seen.has(key)) {
      seen.set(key, r);
    }
  }
  return [...seen.values()];
}

function countFatalities(records) {
  let total = 0;
  for (const r of records) {
    total += parseInt(r.number_of_persons_killed, 10) || 0;
  }
  return total;
}

function monthsSince(dateStr) {
  const start = new Date(dateStr + "-01");
  const now = new Date();
  return (
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth())
  );
}

function currentMonthLabel() {
  const now = new Date();
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[now.getMonth()]} ${now.getFullYear()}`;
}

async function main() {
  console.log("Fetching crash data from NYC Open Data API...");

  const data = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth(); // 0-indexed
  const monthFraction = (currentMonth + 1) / 12;
  let changed = false;

  // --- Fatalities ---
  const records = await queryFatalCrashes(currentYear);
  const unique = dedup(records);
  const apiDeaths = countFatalities(unique);
  console.log(`${currentYear} API fatalities: ${apiDeaths} (from ${unique.length} fatal crashes)`);

  for (const entry of data.nycFatalities.byYear) {
    if (entry.year === currentYear) {
      const projected = Math.round(apiDeaths / monthFraction);
      if (projected !== entry.deaths) {
        console.log(`Updating deaths ${entry.year}: ${entry.deaths} -> ${projected} (from ${apiDeaths} YTD)`);
        entry.deaths = projected;
        entry.note = `Projected from ${apiDeaths} YTD`;
        changed = true;
      }
      break;
    }
  }

  if (!data.nycFatalities.byYear.find((e) => e.year === currentYear)) {
    const projected = Math.round(apiDeaths / monthFraction);
    data.nycFatalities.byYear.push({
      year: currentYear,
      deaths: projected,
      note: `Projected from ${apiDeaths} YTD`,
    });
    changed = true;
    console.log(`Added deaths ${currentYear}: ${projected}`);
  }

  // --- Injuries ---
  const injAgg = await queryInjuryAggregates(currentYear);
  if (injAgg) {
    console.log(`${currentYear} API injuries: ped=${injAgg.pedestrian}, cyc=${injAgg.cyclist}, mot=${injAgg.motorist}`);

    const projPed = Math.round(injAgg.pedestrian / monthFraction);
    const projCyc = Math.round(injAgg.cyclist / monthFraction);
    const projMot = Math.round(injAgg.motorist / monthFraction);

    let injEntry = data.nycInjuries.byYear.find((e) => e.year === currentYear);
    if (!injEntry) {
      injEntry = { year: currentYear };
      data.nycInjuries.byYear.push(injEntry);
    }

    if (injEntry.pedestrian !== projPed || injEntry.cyclist !== projCyc || injEntry.motorist !== projMot) {
      console.log(`Updating injuries ${currentYear}: ped ${injEntry.pedestrian}->${projPed}, cyc ${injEntry.cyclist}->${projCyc}, mot ${injEntry.motorist}->${projMot}`);
      injEntry.pedestrian = projPed;
      injEntry.cyclist = projCyc;
      injEntry.motorist = projMot;
      injEntry.note = `Projected from YTD`;
      changed = true;
    }
  }

  // --- Permit timeline months ---
  const nycPermit = data.permitTimeline.find((p) => p.city === "New York, NY");
  if (nycPermit && nycPermit.testStart) {
    const newMonths = monthsSince(nycPermit.testStart);
    if (newMonths !== nycPermit.months) {
      console.log(`Updating NYC permit months: ${nycPermit.months} -> ${newMonths}`);
      nycPermit.months = newMonths;
      changed = true;
    }
  }

  // --- Timeline cumulative deaths ---
  const lastEvent = data.timeline[data.timeline.length - 1];
  const delayStart = new Date(data.nycFatalities.delayStart);
  const delayStartYear = delayStart.getFullYear();
  const delayStartMonth = delayStart.getMonth();

  let cumulative = 0;
  for (const entry of data.nycFatalities.byYear) {
    if (entry.year < delayStartYear) continue;
    if (entry.year === delayStartYear) {
      const fractionRemaining = (12 - delayStartMonth) / 12;
      if (entry.year < currentYear) {
        cumulative += Math.round(entry.deaths * fractionRemaining);
      } else {
        cumulative += Math.round(entry.deaths * fractionRemaining * ((currentMonth + 1) / 12));
      }
    } else if (entry.year < currentYear) {
      cumulative += entry.deaths;
    } else if (entry.year === currentYear) {
      cumulative += Math.round(entry.deaths * ((currentMonth + 1) / 12));
    }
  }

  const newDateLabel = currentMonthLabel();
  if (lastEvent.date !== newDateLabel || lastEvent.cumulativeDeaths !== cumulative) {
    console.log(`Updating last timeline: "${lastEvent.date}" (${lastEvent.cumulativeDeaths}) -> "${newDateLabel}" (${cumulative})`);
    lastEvent.date = newDateLabel;
    lastEvent.cumulativeDeaths = cumulative;
    changed = true;
  }

  if (changed) {
    writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n");
    console.log("fatalities.json updated.");
  } else {
    console.log("No changes needed.");
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
