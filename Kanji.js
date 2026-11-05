// Pure date, Jisho fetch and HTML/JSON parsing for the Kanji of the Day app.
// Kept free of QML so the selection and the parsers can be tested under node.

var SEARCH_URL = "https://jisho.org/search/"
var WORDS_URL = "https://jisho.org/api/v1/search/words"
var PER_PAGE = 20
var DEFAULT_USER_AGENT = "omarchy-kanji-of-the-day/1.0.0"

function trimString(value) {
  return value === undefined || value === null ? "" : String(value).trim()
}

function pad2(value) {
  var n = Number(value)
  return (n < 10 ? "0" : "") + n
}

// Local calendar day, because "the date of the user" is the wall date they see.
function dateKey(date) {
  return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate())
}

// ---- Seeded daily pick ---------------------------------------------------
// DJB2 and xorshift32 are small, deterministic and avoid Math.imul, which some
// older QML JS engines lack. The level is draw one and the result index draw
// two, both from the same date seed.
function hashSeed(text) {
  var h = 5381
  var s = String(text === undefined || text === null ? "" : text)
  for (var i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) | 0
  return h >>> 0
}

function rng(seed) {
  var state = (seed >>> 0) || 0x9e3779b9
  return function() {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 4294967296
  }
}

function draws(date) {
  var next = rng(hashSeed(String(date)))
  return { level: 1 + Math.floor(next() * 5), roll: next() }
}

function levelFor(date) {
  return draws(date).level
}

function indexFor(date, count) {
  var total = Math.floor(Number(count))
  if (!isFinite(total) || total <= 0) return 0
  var index = 1 + Math.floor(draws(date).roll * total)
  return Math.min(total, Math.max(1, index))
}

function pageForIndex(index) {
  var n = Math.max(1, Math.round(Number(index) || 1))
  return Math.floor((n - 1) / PER_PAGE) + 1
}

function levelCode(level) {
  var n = Math.round(Number(level) || 1)
  return "n" + Math.min(5, Math.max(1, n))
}

function searchUrl(level, page) {
  var url = SEARCH_URL + encodeURIComponent(" #kanji " + levelCode(level))
  var p = Math.max(1, Math.round(Number(page) || 1))
  return p > 1 ? url + "?page=" + p : url
}

function wordUrl(character) {
  return WORDS_URL + "?keyword=" + encodeURIComponent(trimString(character))
}

function sentenceUrl(word) {
  return SEARCH_URL + encodeURIComponent(trimString(word) + " #sentences")
}

function curlCommand(url, userAgent) {
  return [
    "curl", "-sS", "--max-time", "20",
    "-A", trimString(userAgent) || DEFAULT_USER_AGENT,
    url
  ]
}

// ---- HTML helpers --------------------------------------------------------
function codePointToString(value) {
  var n = Number(value)
  if (!isFinite(n) || n <= 0 || n > 0x10ffff) return ""
  if (n <= 0xffff) return String.fromCharCode(n)
  n -= 0x10000
  return String.fromCharCode(0xd800 + (n >> 10), 0xdc00 + (n & 0x3ff))
}

function decodeEntities(text) {
  return String(text === undefined || text === null ? "" : text)
    .replace(/&#x([0-9a-fA-F]+);/g, function(_, hex) { return codePointToString(parseInt(hex, 16)) })
    .replace(/&#(\d+);/g, function(_, dec) { return codePointToString(parseInt(dec, 10)) })
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    // Decoded last so "&amp;lt;" keeps its literal &lt;.
    .replace(/&amp;/g, "&")
}

function cleanText(html) {
  return decodeEntities(String(html === undefined || html === null ? "" : html).replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim()
}

function hasKanji(text) {
  var value = String(text === undefined || text === null ? "" : text)
  for (var i = 0; i < value.length; i++) {
    var code = value.charCodeAt(i)
    if ((code >= 0x3400 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff)
        || (code >= 0xf900 && code <= 0xfaff)) return true
    // CJK extensions B and beyond live in the first supplementary plane.
    if (code >= 0xd840 && code <= 0xd87f) return true
  }
  return false
}

// ---- Kanji search pages --------------------------------------------------
function parseCount(html) {
  var match = String(html === undefined || html === null ? "" : html)
    .match(/class="result_count"[^>]*>[\s\S]*?([\d,]+)\s*found/i)
  if (!match) return 0
  var count = parseInt(match[1].replace(/,/g, ""), 10)
  return isFinite(count) && count > 0 ? count : 0
}

function readAnchors(block) {
  var out = []
  var re = /<a[^>]*>([\s\S]*?)<\/a>/g
  var match
  while ((match = re.exec(block))) {
    var reading = cleanText(match[1])
    if (reading) out.push(reading)
  }
  if (!out.length) {
    var fallback = cleanText(block).replace(/^(Kun|On):\s*/, "")
    if (fallback) out = fallback.split(/\s*、\s*/).filter(function(part) { return part !== "" })
  }
  return out
}

function parseEntry(chunk) {
  var html = String(chunk === undefined || chunk === null ? "" : chunk)
  var character = cleanText((html.match(/class="character literal[^"]*"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || "")
  if (!character) return null

  var info = cleanText((html.match(/<div class="info clearfix">([\s\S]*?)<\/div>/) || [])[1] || "")
  var strokes = info.match(/(\d+)\s+strokes?/)
  var jlpt = info.match(/JLPT\s+(N[1-5])/)

  var meanings = []
  var meaningBlock = (html.match(/<div class="meanings english sense">([\s\S]*?)<\/div>/) || [])[1] || ""
  var meaningRe = /<span[^>]*>([\s\S]*?)<\/span>/g
  var meaningMatch
  while ((meaningMatch = meaningRe.exec(meaningBlock))) {
    var meaning = cleanText(meaningMatch[1]).replace(/,\s*$/, "")
    if (meaning) meanings.push(meaning)
  }
  if (!meanings.length) {
    var fallback = cleanText(meaningBlock)
    if (fallback) meanings = fallback.split(/\s*,\s*/).filter(function(part) { return part !== "" })
  }

  var kun = readAnchors((html.match(/<div class="kun readings">([\s\S]*?)<\/div>/) || [])[1] || "")
  var on = readAnchors((html.match(/<div class="on readings">([\s\S]*?)<\/div>/) || [])[1] || "")

  var href = (html.match(/class="light-details_link"[^>]*href="([^"]+)"/) || [])[1]
    || (html.match(/href="([^"]+)"[^>]*class="light-details_link"/) || [])[1]
    || (html.match(/href="(\/\/jisho\.org[^"]+)"/) || [])[1]
    || ""
  if (href.indexOf("//") === 0) href = "https:" + href

  return {
    character: character,
    meanings: meanings,
    kun: kun,
    on: on,
    strokes: strokes ? Number(strokes[1]) : 0,
    jlpt: jlpt ? jlpt[1] : "",
    url: href
  }
}

function parseEntries(html) {
  var parts = String(html === undefined || html === null ? "" : html)
    .split(/<div class="entry kanji_light clearfix">/)
  parts.shift()
  var out = []
  for (var i = 0; i < parts.length; i++) {
    var entry = parseEntry(parts[i])
    if (entry) out.push(entry)
  }
  return out
}

function entryForIndex(html, index) {
  var n = Math.floor(Number(index))
  if (!isFinite(n) || n <= 0) return null
  var entries = parseEntries(html)
  var local = (n - 1) % PER_PAGE
  return entries[local] || null
}

// ---- Example words and sentences ----------------------------------------
function parseWords(payload, character) {
  var data
  try {
    data = typeof payload === "string" ? JSON.parse(payload) : payload
  } catch (error) {
    return []
  }
  var list = data && Array.isArray(data.data) ? data.data : []
  var wanted = trimString(character)
  var common = []
  var other = []
  var seen = {}

  for (var i = 0; i < list.length; i++) {
    var entry = list[i] || {}
    var forms = Array.isArray(entry.japanese) ? entry.japanese : []
    for (var j = 0; j < forms.length; j++) {
      var word = trimString(forms[j] && forms[j].word)
      if (!word || word.length < 2 || seen[word]) continue
      if (wanted && word.indexOf(wanted) === -1) continue
      seen[word] = true

      var meaning = ""
      var senses = Array.isArray(entry.senses) ? entry.senses : []
      if (senses.length && Array.isArray(senses[0].english_definitions))
        meaning = senses[0].english_definitions.join(", ")

      var item = { word: word, reading: trimString(forms[j].reading), meaning: meaning }
      if (entry.is_common === true) common.push(item)
      else other.push(item)
    }
  }

  return common.concat(other).slice(0, 5)
}

// Jisho wraps each annotated word as furigana + unlinked spans. Readings over
// digits or latin text are dropped; a slash-separated alternative keeps the
// first reading.
function parseFurigana(html) {
  var text = String(html === undefined || html === null ? "" : html)
  var out = []
  var re = /<li class="clearfix">([\s\S]*?)<\/li>/g
  var last = 0
  var match

  while ((match = re.exec(text))) {
    var before = cleanText(text.slice(last, match.index))
    if (before) out.push({ base: before, reading: "" })

    var inner = match[1]
    var reading = cleanText((inner.match(/<span class="furigana">([\s\S]*?)<\/span>/) || [])[1] || "")
    var base = cleanText((inner.match(/<span class="unlinked">([\s\S]*?)<\/span>/) || [])[1] || "")
    if (base) {
      reading = reading.split("/")[0].trim()
      if (!hasKanji(base)) reading = ""
      out.push({ base: base, reading: reading })
    }
    last = match.index + match[0].length
  }

  var tail = cleanText(text.slice(last))
  if (tail) out.push({ base: tail, reading: "" })
  return out
}

function parseSentences(html) {
  var chunks = String(html === undefined || html === null ? "" : html)
    .split(/<li class="entry sentence clearfix">/)
  chunks.shift()

  var out = []
  for (var i = 0; i < chunks.length && i < 10; i++) {
    var chunk = chunks[i]
    var japaneseHtml = (chunk.match(/<ul class="japanese_sentence[\s\S]*?">([\s\S]*?)<\/ul>/) || [])[1] || ""
    var segments = parseFurigana(japaneseHtml)
    if (!segments.length) continue

    var plain = segments.map(function(segment) { return segment.base }).join("")
    out.push({
      japanese: segments,
      english: cleanText((chunk.match(/<span class="english">([\s\S]*?)<\/span>/) || [])[1] || ""),
      plain: plain
    })
  }
  return out
}

function pickSentence(html, word) {
  var all = parseSentences(html)
  if (!all.length) return null
  var wanted = trimString(word)
  var matches = all.filter(function(sentence) {
    return wanted === "" || sentence.plain.indexOf(wanted) !== -1
  })
  if (!matches.length) return null
  var best = matches[0]
  for (var i = 1; i < matches.length && i < 5; i++) {
    if (matches[i].plain.length < best.plain.length) best = matches[i]
  }
  return { japanese: best.japanese, english: best.english, plain: best.plain }
}

// ---- Ruby layout units ---------------------------------------------------
var CLOSING = "。、，．！？!?.,;:）〕】」』》〉ー〜…‥"

function characters(text) {
  var value = String(text === undefined || text === null ? "" : text)
  var out = []
  for (var i = 0; i < value.length; i++) {
    var code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      var next = value.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        out.push(value.substr(i, 2))
        i++
        continue
      }
    }
    out.push(value.charAt(i))
  }
  return out
}

function plainTokens(text) {
  var chars = characters(text)
  var out = []
  var run = ""
  for (var i = 0; i < chars.length; i++) {
    var ch = chars[i]
    if (/^[A-Za-z0-9]$/.test(ch)) {
      run += ch
      continue
    }
    if (run) {
      out.push(run)
      run = ""
    }
    if (/^\s$/.test(ch)) out.push(" ")
    else out.push(ch)
  }
  if (run) out.push(run)
  return out
}

function appendPlain(out, text) {
  var tokens = plainTokens(text)
  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i]
    if (token === " ") {
      if (!out.length) continue
      if (!out[out.length - 1].reading) out[out.length - 1].base += " "
      else out.push({ base: " ", reading: "" })
      continue
    }
    if (CLOSING.indexOf(token) !== -1 && out.length && !out[out.length - 1].reading) {
      out[out.length - 1].base += token
      continue
    }
    out.push({ base: token, reading: "" })
  }
}

// Flatten parsed segments into the atomic pieces the ruby Flow wraps: words
// with readings stay whole, plain text breaks between characters, and closing
// punctuation stays with the character before it.
function sentenceUnits(segments) {
  var out = []
  var list = Array.isArray(segments) ? segments : []
  for (var i = 0; i < list.length; i++) {
    var segment = list[i] || {}
    var base = trimString(segment.base)
    var reading = trimString(segment.reading)
    if (!base) continue
    if (reading) out.push({ base: base, reading: reading })
    else appendPlain(out, base)
  }
  return out
}

if (typeof module !== "undefined") {
  module.exports = {
    SEARCH_URL: SEARCH_URL,
    WORDS_URL: WORDS_URL,
    PER_PAGE: PER_PAGE,
    DEFAULT_USER_AGENT: DEFAULT_USER_AGENT,
    dateKey: dateKey,
    hashSeed: hashSeed,
    rng: rng,
    levelFor: levelFor,
    indexFor: indexFor,
    pageForIndex: pageForIndex,
    levelCode: levelCode,
    searchUrl: searchUrl,
    wordUrl: wordUrl,
    sentenceUrl: sentenceUrl,
    curlCommand: curlCommand,
    decodeEntities: decodeEntities,
    cleanText: cleanText,
    hasKanji: hasKanji,
    parseCount: parseCount,
    parseEntry: parseEntry,
    parseEntries: parseEntries,
    entryForIndex: entryForIndex,
    parseWords: parseWords,
    parseFurigana: parseFurigana,
    parseSentences: parseSentences,
    pickSentence: pickSentence,
    plainTokens: plainTokens,
    sentenceUnits: sentenceUnits
  }
}
