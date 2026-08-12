const fs = require("node:fs/promises");
const path = require("node:path");

const DATASET_ID = "d_8ef23381f9417e4d4254ee8b4dcdb176";
const DATASET_URL = `https://data.gov.sg/api/action/datastore_search?resource_id=${DATASET_ID}&limit=500`;
const REFRESH_INTERVAL_MS = 1000 * 60 * 60 * 24 * 7;
const DEFAULT_CACHE_PATH =
  process.env.PUBLIC_HOLIDAY_CACHE_PATH ||
  (process.env.VERCEL
    ? path.join("/tmp", "sg-public-holidays.json")
    : path.join(__dirname, "..", "data", "sg-public-holidays.json"));

function isoYear(date) {
  return Number(String(date).slice(0, 4));
}

function addDaysToIso(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function isWeekendIso(date) {
  const [year, month, day] = date.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

function isSundayIso(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay() === 0;
}

function yearsInRange(startDate, endDate) {
  const years = [];
  for (let year = isoYear(startDate); year <= isoYear(endDate); year += 1) {
    years.push(year);
  }
  return years;
}

function normalizeRecord(record) {
  const date = record.date || record.Date;
  const holiday = record.holiday || record.Holiday;
  const day = record.day || record.Day;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) || !holiday) {
    return null;
  }

  return {
    date,
    day: day || "",
    holiday,
    year: isoYear(date),
    observed: false
  };
}

function observedHolidayBaseName(holiday) {
  return String(holiday || "")
    .replace(/\s*\(observed\)\s*$/i, "")
    .trim()
    .toLowerCase();
}

function withObservedRestDayHolidays(holidays) {
  const officialHolidays = holidays.filter((holiday) => !holiday.observed);
  const byDate = new Map();
  for (const holiday of officialHolidays) {
    byDate.set(holiday.date, holiday);
  }

  for (const holiday of officialHolidays) {
    if (!isSundayIso(holiday.date)) continue;

    const officialObservedDate = officialHolidays.find((candidate) =>
      candidate.date > holiday.date &&
      candidate.date <= addDaysToIso(holiday.date, 7) &&
      /\(observed\)\s*$/i.test(candidate.holiday) &&
      observedHolidayBaseName(candidate.holiday) === observedHolidayBaseName(holiday.holiday)
    );
    if (officialObservedDate) continue;

    let observedDate = addDaysToIso(holiday.date, 1);
    while (isWeekendIso(observedDate) || byDate.has(observedDate)) {
      observedDate = addDaysToIso(observedDate, 1);
    }

    byDate.set(observedDate, {
      date: observedDate,
      day: "",
      holiday: `${holiday.holiday} (observed)`,
      year: isoYear(observedDate),
      observed: true,
      observedFor: holiday.date
    });
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function readCache(cachePath = DEFAULT_CACHE_PATH) {
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    const cache = JSON.parse(raw);
    return {
      datasetId: cache.datasetId || DATASET_ID,
      source: cache.source || "MOM Singapore Public Holidays via data.gov.sg",
      syncedAt: cache.syncedAt || null,
      years: Array.isArray(cache.years) ? cache.years : null,
      holidays: Array.isArray(cache.holidays)
        ? withObservedRestDayHolidays(cache.holidays)
        : []
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        datasetId: DATASET_ID,
        source: "MOM Singapore Public Holidays via data.gov.sg",
        syncedAt: null,
        holidays: []
      };
    }
    throw error;
  }
}

async function writeCache(cache, cachePath = DEFAULT_CACHE_PATH) {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

function cacheHasYears(cache, years) {
  const availableYears = new Set(
    (Array.isArray(cache.years) ? cache.years : cache.holidays.map((holiday) => holiday.year))
      .map(Number)
  );
  return years.every((year) => availableYears.has(year));
}

function cacheIsFresh(cache, now = new Date()) {
  if (!cache.syncedAt) return false;
  return now.getTime() - new Date(cache.syncedAt).getTime() < REFRESH_INTERVAL_MS;
}

async function fetchOfficialHolidays(fetchImpl = fetch) {
  const response = await fetchImpl(DATASET_URL, {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`data.gov.sg returned HTTP ${response.status}.`);
  }

  const payload = await response.json();
  const records = payload?.result?.records;
  if (!Array.isArray(records)) {
    throw new Error("The public holiday dataset response was not in the expected format.");
  }

  return records.map(normalizeRecord).filter(Boolean);
}

async function syncSingaporePublicHolidays(options = {}) {
  const cachePath = options.cachePath || DEFAULT_CACHE_PATH;
  const now = options.now || new Date();
  const baseHolidays = await fetchOfficialHolidays(options.fetchImpl);
  const cache = {
    datasetId: DATASET_ID,
    source: "MOM Singapore Public Holidays (consolidated) via data.gov.sg",
    sourceUrl: DATASET_URL,
    syncedAt: now.toISOString(),
    years: [...new Set(baseHolidays.map((holiday) => holiday.year))].sort(),
    holidays: withObservedRestDayHolidays(baseHolidays)
  };
  await writeCache(cache, cachePath);
  return cache;
}

async function getSingaporePublicHolidaysForRange(startDate, endDate, options = {}) {
  const years = yearsInRange(startDate, endDate);
  let cache = await readCache(options.cachePath);
  const shouldRefresh = options.forceRefresh || !cacheIsFresh(cache, options.now) || !cacheHasYears(cache, years);

  if (shouldRefresh) {
    try {
      cache = await syncSingaporePublicHolidays(options);
    } catch (error) {
      if (!cacheHasYears(cache, years)) {
        throw new Error(
          `Singapore public holidays for ${years.join(", ")} are not available locally and could not be synced from data.gov.sg. Please try again when the official MOM dataset is reachable.`
        );
      }
    }
  }

  if (!cacheHasYears(cache, years)) {
    throw new Error(
      `Singapore public holidays for ${years.join(", ")} have not been released in the official MOM dataset yet. Leave deduction was not calculated to avoid mistakes.`
    );
  }

  return cache.holidays.filter((holiday) => holiday.date >= startDate && holiday.date <= endDate);
}

module.exports = {
  DATASET_ID,
  DATASET_URL,
  getSingaporePublicHolidaysForRange,
  syncSingaporePublicHolidays,
  withObservedRestDayHolidays
};
