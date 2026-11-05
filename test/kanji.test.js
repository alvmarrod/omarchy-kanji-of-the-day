const test = require("node:test")
const assert = require("node:assert/strict")
const Kanji = require("../Kanji.js")

test("dateKey: uses the local calendar date", () => {
  assert.equal(Kanji.dateKey(new Date(2026, 10, 5, 23, 30)), "2026-11-05")
  assert.equal(Kanji.dateKey(new Date(2026, 0, 1, 0, 1)), "2026-01-01")
})

test("levelFor/indexFor: deterministic golden pair for a date", () => {
  // Locked so a refactor cannot silently reshuffle every user's daily kanji.
  assert.equal(Kanji.levelFor("2026-11-05"), 4)
  assert.equal(Kanji.indexFor("2026-11-05", 79), 64)
  assert.equal(Kanji.indexFor("2026-11-05", 1232), 990)
})

test("levelFor: always 1..5", () => {
  for (let day = 1; day <= 28; day++) {
    const key = `2026-02-${String(day).padStart(2, "0")}`
    const level = Kanji.levelFor(key)
    assert.ok(level >= 1 && level <= 5)
  }
})

test("indexFor: stays inside 1..count and is repeatable", () => {
  for (const count of [1, 2, 20, 79, 367, 1232]) {
    const index = Kanji.indexFor("2026-11-05", count)
    assert.ok(index >= 1 && index <= count)
    assert.equal(Kanji.indexFor("2026-11-05", count), index)
  }
  assert.equal(Kanji.indexFor("2026-11-05", 0), 0)
  assert.equal(Kanji.indexFor("2026-11-05", -4), 0)
})

test("pageForIndex: maps a result index onto Jisho's 20-item pages", () => {
  assert.equal(Kanji.pageForIndex(1), 1)
  assert.equal(Kanji.pageForIndex(20), 1)
  assert.equal(Kanji.pageForIndex(21), 2)
  assert.equal(Kanji.pageForIndex(79), 4)
  assert.equal(Kanji.pageForIndex(1232), 62)
})

test("urls: use the exact Jisho search shapes", () => {
  assert.equal(Kanji.searchUrl(5, 1), "https://jisho.org/search/%20%23kanji%20n5")
  assert.equal(Kanji.searchUrl(1, 4), "https://jisho.org/search/%20%23kanji%20n1?page=4")
  assert.equal(Kanji.wordUrl("日"), "https://jisho.org/api/v1/search/words?keyword=%E6%97%A5")
  assert.equal(Kanji.sentenceUrl("日曜日"), "https://jisho.org/search/%E6%97%A5%E6%9B%9C%E6%97%A5%20%23sentences")
})

test("curlCommand: an argv array, never a shell string", () => {
  const command = Kanji.curlCommand("https://jisho.org/", "ua")
  assert.equal(command[0], "curl")
  assert.ok(command.includes("ua"))
  assert.equal(command[command.length - 1], "https://jisho.org/")
})

const SEARCH_HTML = `
<div class="kanji_light_block">
  <h4>Kanji<span class="result_count"> — 79 found</span></h4>
  <div class="entry kanji_light clearfix">
    <div class="kanji_light_content">
      <div class="info clearfix">
        <span class="strokes">4 strokes.</span>
        JLPT N5.
        Jōyō kanji, taught in grade 1.
      </div>
      <div class="literal_block">
        <span class="character literal japanese_gothic" lang="ja"><a href="//jisho.org/search/%E6%97%A5%20%23kanji">日</a></span>
      </div>
      <div class="meanings english sense">
        <span>day, </span>
        <span>sun, </span>
        <span>Japan, </span>
        <span>counter for days</span>
      </div>
      <div class="kun readings">
        <span class="type">Kun: </span>
        <span class="japanese_gothic "><a href="//jisho.org/search/%E6%97%A5%20%E3%81%B2">ひ</a>、 </span>
        <span class="japanese_gothic "><a href="//jisho.org/search/%E6%97%A5%20%E3%81%B3">-び</a></span>
      </div>
      <div class="on readings">
        <span class="type">On: </span>
        <span class="japanese_gothic "><a href="//jisho.org/search/%E6%97%A5%20%E3%83%8B%E3%83%81">ニチ</a>、 </span>
        <span class="japanese_gothic "><a href="//jisho.org/search/%E6%97%A5%20%E3%82%B8%E3%83%84">ジツ</a></span>
      </div>
    </div>
    <a class="light-details_link" href="//jisho.org/search/%E6%97%A5%20%23kanji">Details ▸</a>
  </div>
  <div class="entry kanji_light clearfix">
    <div class="kanji_light_content">
      <div class="info clearfix"><span class="strokes">1 stroke.</span> JLPT N5.</div>
      <div class="literal_block">
        <span class="character literal japanese_gothic" lang="ja"><a href="//jisho.org/search/%E4%B8%80%20%23kanji">一</a></span>
      </div>
      <div class="meanings english sense"><span>one, </span><span>one radical (no.1)</span></div>
      <div class="kun readings"><span class="type">Kun: </span><span><a>ひと-</a>、 </span><span><a>ひと.つ</a></span></div>
      <div class="on readings"><span class="type">On: </span><span><a>イチ</a>、 </span><span><a>イツ</a></span></div>
    </div>
    <a class="light-details_link" href="//jisho.org/search/%E4%B8%80%20%23kanji">Details ▸</a>
  </div>
</div>`

test("parseCount: reads the total, not the 20 items on the page", () => {
  assert.equal(Kanji.parseCount(SEARCH_HTML), 79)
  assert.equal(Kanji.parseCount(""), 0)
  assert.equal(Kanji.parseCount("nothing here"), 0)
})

test("parseEntries: character, readings, meanings, strokes and JLPT", () => {
  const entries = Kanji.parseEntries(SEARCH_HTML)
  assert.equal(entries.length, 2)

  const first = entries[0]
  assert.equal(first.character, "日")
  assert.deepEqual(first.meanings, ["day", "sun", "Japan", "counter for days"])
  assert.deepEqual(first.kun, ["ひ", "-び"])
  assert.deepEqual(first.on, ["ニチ", "ジツ"])
  assert.equal(first.strokes, 4)
  assert.equal(first.jlpt, "N5")
  assert.equal(first.url, "https://jisho.org/search/%E6%97%A5%20%23kanji")

  assert.equal(entries[1].character, "一")
  assert.equal(entries[1].strokes, 1)
})

test("entryForIndex: maps a global index onto the page's local slot", () => {
  assert.equal(Kanji.entryForIndex(SEARCH_HTML, 1).character, "日")
  assert.equal(Kanji.entryForIndex(SEARCH_HTML, 2).character, "一")
  // The page is always fetched for the index's own page, so 21 is its slot 0.
  assert.equal(Kanji.entryForIndex(SEARCH_HTML, 21).character, "日")
  assert.equal(Kanji.entryForIndex(SEARCH_HTML, 22).character, "一")
  assert.equal(Kanji.entryForIndex(SEARCH_HTML, 23), null)
  assert.equal(Kanji.entryForIndex(SEARCH_HTML, 0), null)
})

test("parseWords: first common multi-character word that contains the kanji", () => {
  const payload = {
    data: [
      { is_common: true, japanese: [{ word: "日", reading: "にち" }], senses: [{ english_definitions: ["Sunday"] }] },
      { is_common: true, japanese: [{ word: "死ね", reading: "しね" }], senses: [{ english_definitions: ["drop dead"] }] },
      { is_common: true, japanese: [{ word: "日曜日", reading: "にちようび" }], senses: [{ english_definitions: ["Sunday"] }] },
      { is_common: false, japanese: [{ word: "日時", reading: "にちじ" }], senses: [{ english_definitions: ["date and time"] }] }
    ]
  }
  const words = Kanji.parseWords(payload, "日")
  assert.equal(words[0].word, "日曜日")
  assert.equal(words[0].reading, "にちようび")
  assert.equal(words[0].meaning, "Sunday")
  assert.equal(words[1].word, "日時")
  assert.ok(!words.some((entry) => entry.word === "死ね"))
})

test("parseWords: malformed JSON and an unknown kanji degrade to no words", () => {
  assert.deepEqual(Kanji.parseWords("not json", "日"), [])
  assert.deepEqual(Kanji.parseWords({ data: [] }, "日"), [])
})

const SENTENCE_HTML = `
<li class="entry sentence clearfix">
  <div class="sentence_content">
    <ul class="japanese_sentence japanese japanese_gothic clearfix" lang="ja">
      ホテルで<li class="clearfix"><span class="furigana">しゅくはく</span><span class="unlinked">宿泊</span></li>カードに<li class="clearfix"><span class="furigana">じゅうしょ/じゅうしょ2</span><span class="unlinked">住所</span></li>、<li class="clearfix"><span class="furigana">しめい</span><span class="unlinked">氏名</span></li>、電話番号などを記入する。
    </ul>
    <div class="english_sentence clearfix">
      <span class="english">Fill in your address, name and phone number.</span>
    </div>
  </div>
</li>
<li class="entry sentence clearfix">
  <div class="sentence_content">
    <ul class="japanese_sentence japanese japanese_gothic clearfix" lang="ja">
      <li class="clearfix"><span class="furigana">しめい</span><span class="unlinked">氏名</span></li>を書く。
    </ul>
    <div class="english_sentence clearfix">
      <span class="english">Write your name.</span>
    </div>
  </div>
</li>
<li class="entry sentence clearfix">
  <div class="sentence_content">
    <ul class="japanese_sentence japanese japanese_gothic clearfix" lang="ja">
      <li class="clearfix"><span class="furigana">はちじゅっパーセント</span><span class="unlinked">80％</span></li>の確率。
    </ul>
    <div class="english_sentence clearfix">
      <span class="english">An 80% chance.</span>
    </div>
  </div>
</li>`

test("parseFurigana: keeps kanji readings, first slash alternative, drops numeric ruby", () => {
  const segments = Kanji.parseFurigana(
    `<li class="clearfix"><span class="furigana">しゅくはく</span><span class="unlinked">宿泊</span></li>` +
    `<li class="clearfix"><span class="furigana">じゅうしょ/じゅうしょ2</span><span class="unlinked">住所</span></li>` +
    `<li class="clearfix"><span class="furigana">はちじゅっパーセント</span><span class="unlinked">80％</span></li>`
  )
  assert.deepEqual(segments, [
    { base: "宿泊", reading: "しゅくはく" },
    { base: "住所", reading: "じゅうしょ" },
    { base: "80％", reading: "" }
  ])
})

test("parseSentences/pickSentence: prefers the shortest result containing the word", () => {
  const sentences = Kanji.parseSentences(SENTENCE_HTML)
  assert.equal(sentences.length, 3)
  assert.equal(sentences[0].english, "Fill in your address, name and phone number.")

  const picked = Kanji.pickSentence(SENTENCE_HTML, "氏名")
  assert.equal(picked.plain, "氏名を書く。")
  assert.equal(picked.english, "Write your name.")
  assert.deepEqual(picked.japanese, [{ base: "氏名", reading: "しめい" }, { base: "を書く。", reading: "" }])

  // A sentence that does not contain the word is not an example of it.
  assert.equal(Kanji.pickSentence(SENTENCE_HTML, "存在しない"), null)
})

test("sentenceUnits: wraps plain text by character, keeps ruby words whole", () => {
  const units = Kanji.sentenceUnits([
    { base: "毎朝", reading: "まいあさ" },
    { base: "、散歩", reading: "" },
    { base: "だ。", reading: "" }
  ])
  assert.deepEqual(units, [
    { base: "毎朝", reading: "まいあさ" },
    { base: "、", reading: "" },
    { base: "散", reading: "" },
    { base: "歩", reading: "" },
    { base: "だ。", reading: "" }
  ])
})

test("sentenceUnits: groups latin runs and glues closing punctuation", () => {
  assert.deepEqual(Kanji.sentenceUnits([{ base: "1994年に80％だ。", reading: "" }]), [
    { base: "1994", reading: "" },
    { base: "年", reading: "" },
    { base: "に", reading: "" },
    { base: "80", reading: "" },
    { base: "％", reading: "" },
    { base: "だ。", reading: "" }
  ])
})

test("decodeEntities: named and numeric entities, without double-decoding", () => {
  assert.equal(Kanji.decodeEntities("A &amp; B &#39;x&#39; &quot;y&quot; &lt;z&gt;"), "A & B 'x' \"y\" <z>")
  assert.equal(Kanji.decodeEntities("&amp;lt;"), "&lt;")
})
