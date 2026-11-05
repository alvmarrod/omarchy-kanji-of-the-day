const test = require("node:test")
const assert = require("node:assert/strict")
const Store = require("../Store.js")

function card(overrides) {
  return Object.assign({
    date: "2026-11-05",
    level: 4,
    index: 64,
    count: 79,
    kanji: {
      character: "日",
      meanings: ["day", "sun"],
      kun: ["ひ"],
      on: ["ニチ"],
      strokes: 4,
      jlpt: "N5",
      url: "https://jisho.org/search/日"
    },
    word: { word: "日曜日", reading: "にちようび", meaning: "Sunday" },
    sentence: {
      japanese: [{ base: "日曜日", reading: "にちようび" }, { base: "は休みだ。", reading: "" }],
      english: "Sunday is a day off."
    },
    fetchedAt: 1762300000000
  }, overrides)
}

test("emptyCache: a year with no days", () => {
  assert.deepEqual(Store.emptyCache(2026), { version: 1, year: 2026, last: "", days: {} })
})

test("parseCache: empty, junk and non-object input fall back to an empty year", () => {
  for (const raw of ["", "   ", "not json", "[]", "{}", "null", "42"]) {
    assert.deepEqual(Store.parseCache(raw, 2026), Store.emptyCache(2026))
  }
})

test("serialize/parse: round-trips every day and the latest date", () => {
  const cache = Store.parseCache(Store.serializeCache({
    version: 1,
    year: 2026,
    last: "2026-11-05",
    days: {
      "2026-11-04": card({ date: "2026-11-04" }),
      "2026-11-05": card()
    }
  }), 2026)
  assert.equal(cache.version, 1)
  assert.equal(cache.year, 2026)
  assert.equal(cache.last, "2026-11-05")
  assert.deepEqual(Object.keys(cache.days).sort(), ["2026-11-04", "2026-11-05"])
  assert.equal(cache.days["2026-11-05"].kanji.character, "日")
  assert.deepEqual(cache.days["2026-11-05"].sentence.japanese[0], { base: "日曜日", reading: "にちようび" })
})

test("normalizeCache: keeps only the requested year and derives last", () => {
  const cache = Store.normalizeCache({
    year: 2026,
    last: "",
    days: {
      "2025-12-31": card({ date: "2025-12-31" }),
      "2026-01-01": card({ date: "2026-01-01" }),
      "2026-03-04": card({ date: "2026-03-04" })
    }
  }, 2026)
  assert.deepEqual(Object.keys(cache.days).sort(), ["2026-01-01", "2026-03-04"])
  assert.equal(cache.last, "2026-03-04")
})

test("normalizeCache: an invalid last falls back to the newest stored day", () => {
  const cache = Store.normalizeCache({ last: "2026-12-31", days: { "2026-11-05": card() } }, 2026)
  assert.equal(cache.last, "2026-11-05")
})

test("normalizeCard: repairs loose values and rejects unusable cards", () => {
  const repaired = Store.normalizeCard(card({ level: 9, index: -3, count: "80", fetchedAt: "x" }))
  assert.equal(repaired.level, 5)
  assert.equal(repaired.index, 0)
  assert.equal(repaired.count, 80)
  assert.equal(repaired.fetchedAt, 0)

  assert.equal(Store.normalizeCard(null), null)
  assert.equal(Store.normalizeCard(card({ date: "5 November" })), null)
  assert.equal(Store.normalizeCard(card({ kanji: null })), null)
  assert.equal(Store.normalizeCard(card({ kanji: { character: "" } })), null)
})

test("normalizeSentence: drops empty segments and keeps reading pairs", () => {
  const sentence = Store.normalizeSentence({
    japanese: [{ base: "毎朝", reading: "まいあさ" }, { base: "", reading: "x" }, null],
    english: " Every morning. "
  })
  assert.deepEqual(sentence, {
    japanese: [{ base: "毎朝", reading: "まいあさ" }],
    english: "Every morning."
  })
  assert.equal(Store.normalizeSentence({ japanese: [], english: "x" }), null)
})

