# Changelog

All notable changes to this plugin are documented here.

## [1.0.0] - 2026-11-05

### Added

- Initial public release.
- Deterministic daily kanji seeded from the local date: first a JLPT level
  draw, then an index draw over Jisho's result count.
- Meishi card with a 2×2 writing guide, large kanji, meaning, kun'yomi and
  on'yomi.
- Example word from Jisho's word API, with reading and meaning.
- Example sentence from Jisho's sentence search, rendered with real furigana.
- Compact `Examples` block with `Word` and `Sentence` rows.
- Copy button beside the calendar for the current kanji.
- `jisho.org` link at the bottom of the card.
- Current-year calendar picker limited to today.
- Per-year cache in the plugin's `data/` folder, so cached dates survive shell
  restarts; older year files are deleted when a new year starts.
- 15% larger panel text, with the large kanji left at its original size.
- Last-available-day fallback in the bar and a stale/offline warning with retry
  in the panel.
