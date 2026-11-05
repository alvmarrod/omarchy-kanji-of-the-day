// Per-year cache for the Kanji of the Day app. One file holds every kanji
// fetched during the year, plus the latest date for the bar's fallback.

var VERSION = 1

function trimString(value) {
  return value === undefined || value === null ? "" : String(value).trim()
}

function stringArray(value) {
  if (!Array.isArray(value)) return []
  var out = []
  for (var i = 0; i < value.length; i++) {
    var text = trimString(value[i])
    if (text) out.push(text)
  }
  return out
}

function normalizeKanji(input) {
  if (!input || typeof input !== "object") return null
  var character = trimString(input.character)
  if (!character) return null
  return {
    character: character,
    meanings: stringArray(input.meanings),
    kun: stringArray(input.kun),
    on: stringArray(input.on),
    strokes: Math.max(0, Math.round(Number(input.strokes) || 0)),
    jlpt: /^N[1-5]$/.test(trimString(input.jlpt)) ? trimString(input.jlpt) : "",
    url: trimString(input.url)
  }
}

function normalizeWord(input) {
  if (!input || typeof input !== "object") return null
  var word = trimString(input.word)
  if (!word) return null
  return {
    word: word,
    reading: trimString(input.reading),
    meaning: trimString(input.meaning)
  }
}

function normalizeSentence(input) {
  if (!input || typeof input !== "object" || !Array.isArray(input.japanese)) return null
  var segments = []
  for (var i = 0; i < input.japanese.length; i++) {
    var segment = input.japanese[i]
    if (!segment || typeof segment !== "object") continue
    var base = trimString(segment.base)
    if (!base) continue
    segments.push({ base: base, reading: trimString(segment.reading) })
  }
  if (!segments.length) return null
  return { japanese: segments, english: trimString(input.english) }
}

function normalizeCard(input) {
  if (!input || typeof input !== "object") return null
  var date = trimString(input.date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  var kanji = normalizeKanji(input.kanji)
  if (!kanji) return null

  var level = Math.round(Number(input.level) || 1)
  return {
    date: date,
    level: Math.min(5, Math.max(1, level)),
    index: Math.max(0, Math.round(Number(input.index) || 0)),
    count: Math.max(0, Math.round(Number(input.count) || 0)),
    kanji: kanji,
    word: normalizeWord(input.word),
    sentence: normalizeSentence(input.sentence),
    fetchedAt: Math.max(0, Number(input.fetchedAt) || 0)
  }
}

function emptyCache(year) {
  return { version: VERSION, year: Math.round(Number(year) || 0), last: "", days: {} }
}

function normalizeCache(input, year) {
  var y = Math.round(Number(year) || 0)
  var fallback = emptyCache(y)
  if (!input || typeof input !== "object") return fallback

  var rawDays = input.days && typeof input.days === "object" ? input.days : {}
  var days = {}
  for (var key in rawDays) {
    var card = normalizeCard(rawDays[key])
    if (!card) continue
    if (y > 0 && card.date.indexOf(y + "-") !== 0) continue
    days[card.date] = card
  }

  var last = trimString(input.last)
  if (last === "" || !days[last]) {
    last = ""
    for (var date in days) {
      if (date > last) last = date
    }
  }

  return { version: VERSION, year: y || Number(last.slice(0, 4)) || 0, last: last, days: days }
}

function parseCache(text, year) {
  var raw = trimString(text)
  if (raw === "") return emptyCache(year)
  try {
    return normalizeCache(JSON.parse(raw), year)
  } catch (error) {
    return emptyCache(year)
  }
}

function serializeCache(cache) {
  return JSON.stringify(cache) + "\n"
}

if (typeof module !== "undefined") {
  module.exports = {
    VERSION: VERSION,
    normalizeKanji: normalizeKanji,
    normalizeWord: normalizeWord,
    normalizeSentence: normalizeSentence,
    normalizeCard: normalizeCard,
    emptyCache: emptyCache,
    normalizeCache: normalizeCache,
    parseCache: parseCache,
    serializeCache: serializeCache
  }
}
