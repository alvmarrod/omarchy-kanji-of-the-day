import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Kanji.js" as Kanji
import "Calendar.js" as Calendar
import "Store.js" as Store

// Kanji of the Day: a meishi-shaped card for today's seeded Jisho pick, plus a
// calendar for revisiting earlier days of the current year. The bar widget
// reads barText; this panel owns all fetching, state and the calendar.
Panel {
  id: root
  moduleName: "io.github.alvmarrod.kanji-of-the-day"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  readonly property var barIdentity: hostWidget || root

  // ---- Persistent state ---------------------------------------------------
  readonly property string home: Quickshell.env("HOME") || ""
  readonly property string configHome: Quickshell.env("XDG_CONFIG_HOME") || home + "/.config"
  readonly property string pluginDataDir: configHome + "/omarchy/plugins/io.github.alvmarrod.kanji-of-the-day/data"
  readonly property string cachePath: pluginDataDir + "/" + now.getFullYear() + ".json"
  property bool cacheReady: false
  property bool stateLoaded: false
  property bool cacheDirty: false
  property var store: Store.emptyCache(new Date().getFullYear())
  readonly property var lastCard: store && store.last !== "" && store.days ? store.days[store.last] : null

  // ---- Clock and the requested day ---------------------------------------
  property date now: new Date()
  readonly property string todayKey: Kanji.dateKey(now)
  property string viewDate: todayKey
  readonly property int calendarYear: now.getFullYear()
  property int calendarMonth: now.getMonth()

  // ---- Card and in-flight fetch ------------------------------------------
  property var card: null
  property var cards: ({})
  property bool loading: false
  property bool calendarOpen: false
  property bool copied: false
  property string error: ""
  property int retryCount: 0
  property string pendingDate: ""
  property int requestId: 0

  property string stage: ""
  property int stageRequest: -1
  property string fetchDate: ""
  property int fetchLevel: 1
  property int fetchIndex: 0
  property int fetchCount: 0
  property var fetchKanji: null
  property var fetchWords: []
  property var fetchWord: null
  property var fetchSentence: null
  property int wordCursor: 0

  readonly property string userAgent: Kanji.DEFAULT_USER_AGENT
  readonly property bool busy: loading || !stateLoaded
  readonly property string barText: "KotD: " + (lastCard && lastCard.kanji ? lastCard.kanji.character : "…")
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color mutedForeground: Qt.darker(barForeground, 1.5)
  readonly property color urgentForeground: bar ? bar.urgent : Color.urgent
  readonly property real fontScale: 1.15
  readonly property int captionSize: Math.round(Style.font.caption * fontScale)
  readonly property int bodySmallSize: Math.round(Style.font.bodySmall * fontScale)
  readonly property int bodySize: Math.round(Style.font.body * fontScale)
  readonly property int subtitleSize: Math.round(Style.font.subtitle * fontScale)
  readonly property int iconSize: Math.round(Style.font.icon * fontScale)

  readonly property string displayedDate: card ? String(card.date || "") : String(viewDate || "")
  readonly property string warningText: {
    if (busy || !card || !viewDate) return ""
    if (error !== "") {
      if (card.date !== viewDate)
        return "Couldn't load " + prettyDate(viewDate) + ". Showing " + prettyDate(card.date) + "."
      return "Couldn't refresh " + prettyDate(card.date) + ". Showing the saved card."
    }
    if (card.date !== viewDate) return "Showing " + prettyDate(card.date) + "."
    return ""
  }

  readonly property string meaningText: card && card.kanji && card.kanji.meanings.length
    ? card.kanji.meanings.join(", ") : "—"
  readonly property string kunText: card && card.kanji && card.kanji.kun.length
    ? card.kanji.kun.join("、") : "—"
  readonly property string onText: card && card.kanji && card.kanji.on.length
    ? card.kanji.on.join("、") : "—"
  readonly property string wordText: {
    if (!card || !card.word) return "—"
    var word = card.word.word
    if (card.word.reading) word += " (" + card.word.reading + ")"
    if (card.word.meaning) word += " — " + card.word.meaning
    return word
  }
  readonly property string metaText: {
    if (!card || !card.kanji) return ""
    var parts = []
    if (card.kanji.jlpt) parts.push("JLPT " + card.kanji.jlpt)
    if (card.kanji.strokes > 0) parts.push(card.kanji.strokes + " strokes")
    return parts.join(" · ")
  }

  readonly property int weekStart: Calendar.normalizedWeekStart(Qt.locale().firstDayOfWeek)
  readonly property string monthLabel: Qt.locale().standaloneMonthName(calendarMonth, Locale.LongFormat).toUpperCase() + " " + calendarYear
  readonly property var calendarCells: Calendar.monthCells(calendarYear, calendarMonth, weekStart, todayKey)
  readonly property real panelContentHeight: Math.max(
    contentColumn.implicitHeight + Style.space(24),
    calendarOpen ? Style.space(430) : 0)

  function weekdayLabel(weekday) {
    return String(Qt.locale().dayName(weekday, Locale.ShortFormat)).toUpperCase()
  }

  function dateFromKey(key) {
    var parts = String(key || "").split("-")
    if (parts.length !== 3) return new Date()
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12)
  }

  function prettyDate(key) {
    return key ? Qt.formatDate(dateFromKey(key), "d MMMM yyyy") : ""
  }

  // Opaque tint of the theme background. The popup surface itself is allowed
  // to be glassy, so cards need their own solid ground to stay readable.
  function mixed(base, tint, amount) {
    var t = Math.max(0, Math.min(1, Number(amount) || 0))
    return Qt.rgba(
      base.r * (1 - t) + tint.r * t,
      base.g * (1 - t) + tint.g * t,
      base.b * (1 - t) + tint.b * t,
      1)
  }

  // ---- Persistence --------------------------------------------------------
  function loadCache(text) {
    var parsed = Store.parseCache(text, root.now.getFullYear())
    root.store = parsed
    root.cacheDirty = false
    root.cards = ({})
    for (var date in parsed.days) root.cards[date] = parsed.days[date]
    root.card = parsed.last !== "" ? parsed.days[parsed.last] : null
    root.stateLoaded = true
    root.loadDate(root.todayKey, false)
  }

  function saveCache() {
    if (!root.cacheReady || !root.stateLoaded) return
    cacheFile.setText(Store.serializeCache(root.store))
    root.cacheDirty = false
  }

  // Writing inside the plugin folder wakes the shell's plugin watcher, which
  // reloads the widget. Keep the cache dirty while the card is open and flush
  // on close, so a fetch never closes the panel under the user.
  function maybeSaveCache() {
    if (root.opened) return
    root.saveCache()
  }

  // ---- Fetch pipeline -----------------------------------------------------
  // Count page -> optional entry page -> word API -> sentence search. A word
  // or sentence failure only drops that line; only the kanji itself is fatal.
  function loadDate(date, force) {
    if (!root.cacheReady || !root.stateLoaded) {
      root.pendingDate = date
      return
    }
    if (root.loading) {
      root.pendingDate = date
      return
    }

    if (date !== root.viewDate) root.retryCount = 0
    root.viewDate = date
    root.error = ""

    if (!force && root.cards[date]) {
      root.card = root.cards[date]
      root.loading = false
      root.drainPending()
      return
    }

    root.loading = true
    root.requestId++
    root.fetchDate = date
    root.fetchLevel = Kanji.levelFor(date)
    root.fetchIndex = 0
    root.fetchCount = 0
    root.fetchKanji = null
    root.fetchWords = []
    root.fetchWord = null
    root.fetchSentence = null
    root.wordCursor = 0
    root.request(Kanji.searchUrl(root.fetchLevel, 1), "count")
  }

  function request(url, nextStage) {
    root.stage = nextStage
    root.stageRequest = root.requestId
    fetchProc.command = Kanji.curlCommand(url, root.userAgent)
    fetchProc.running = true
  }

  function handleFetch(text) {
    if (root.stageRequest !== root.requestId) return
    var raw = String(text || "")
    if (raw.trim() === "") {
      if (root.stage === "word") {
        root.fetchWords = []
        root.finishCard()
      } else if (root.stage === "sentence") {
        root.tryNextWord()
      } else {
        root.failFetch("Empty response from Jisho")
      }
      return
    }

    if (root.stage === "count") {
      var count = Kanji.parseCount(raw)
      if (count <= 0) {
        root.failFetch("No results from Jisho")
        return
      }
      root.fetchCount = count
      root.fetchIndex = Kanji.indexFor(root.fetchDate, count)
      var page = Kanji.pageForIndex(root.fetchIndex)
      if (page <= 1) {
        var first = Kanji.entryForIndex(raw, root.fetchIndex)
        if (!first) {
          root.failFetch("Could not read Jisho results")
          return
        }
        root.startDetails(first)
      } else {
        root.request(Kanji.searchUrl(root.fetchLevel, page), "entry")
      }
      return
    }

    if (root.stage === "entry") {
      var entry = Kanji.entryForIndex(raw, root.fetchIndex)
      if (!entry) {
        root.failFetch("Could not read Jisho result page")
        return
      }
      root.startDetails(entry)
      return
    }

    if (root.stage === "word") {
      root.fetchWords = Kanji.parseWords(raw, root.fetchKanji ? root.fetchKanji.character : "")
      if (!root.fetchWords.length) {
        root.finishCard()
        return
      }
      root.wordCursor = 0
      root.tryWord()
      return
    }

    if (root.stage === "sentence") {
      var sentence = Kanji.pickSentence(raw, root.fetchWord ? root.fetchWord.word : "")
      if (sentence) {
        root.fetchSentence = sentence
        root.finishCard()
      } else {
        root.tryNextWord()
      }
    }
  }

  function startDetails(entry) {
    root.fetchKanji = entry
    root.request(Kanji.wordUrl(entry.character), "word")
  }

  function tryWord() {
    root.fetchWord = root.fetchWords[root.wordCursor] || null
    if (!root.fetchWord) {
      root.finishCard()
      return
    }
    root.request(Kanji.sentenceUrl(root.fetchWord.word), "sentence")
  }

  function tryNextWord() {
    root.wordCursor++
    if (root.wordCursor < Math.min(3, root.fetchWords.length)) root.tryWord()
    else root.finishCard()
  }

  function finishCard() {
    if (!root.fetchKanji) {
      root.failFetch("No kanji in Jisho results")
      return
    }
    var made = {
      date: root.fetchDate,
      level: root.fetchLevel,
      index: root.fetchIndex,
      count: root.fetchCount,
      kanji: root.fetchKanji,
      word: root.fetchWord,
      sentence: root.fetchSentence,
      fetchedAt: Date.now()
    }
    root.cards[root.fetchDate] = made
    root.card = made
    root.loading = false
    root.error = ""
    root.retryCount = 0

    if (String(made.date).slice(0, 4) === String(root.store.year)) {
      var days = {}
      for (var date in root.store.days) days[date] = root.store.days[date]
      days[made.date] = made

      var last = root.store.last
      if (last === "" || made.date > last) last = made.date

      root.store = { version: Store.VERSION, year: root.store.year, last: last, days: days }
      root.cacheDirty = true
      root.maybeSaveCache()
    }
    root.drainPending()
  }

  function failFetch(message) {
    root.loading = false
    root.error = String(message || "Couldn't reach Jisho")
    if (root.retryCount < 2) {
      root.retryCount++
      retryTimer.restart()
    } else {
      root.retryCount = 0
      root.drainPending()
    }
  }

  function networkError() {
    var message = String(fetchStderr.text || "").split("\n")[0]
      .replace(/^curl:\s*\(\d+\)\s*/, "").trim()
    return message || "Couldn't reach Jisho"
  }

  function retry() {
    retryTimer.stop()
    root.retryCount = 0
    if (!root.cacheReady) {
      cachePrepare.running = true
      return
    }
    root.loadDate(root.viewDate, true)
  }

  function drainPending() {
    var next = root.pendingDate
    root.pendingDate = ""
    if (next && next !== root.viewDate) Qt.callLater(function() { root.loadDate(next, false) })
  }

  function checkDay() {
    var next = new Date()
    if (Kanji.dateKey(next) === root.todayKey) return
    var yearChanged = next.getFullYear() !== root.now.getFullYear()
    root.now = next
    root.retryCount = 0

    if (yearChanged) {
      root.requestId++
      if (fetchProc.running) fetchProc.running = false
      root.cacheReady = false
      root.stateLoaded = false
      root.loading = false
      root.cacheDirty = false
      root.store = Store.emptyCache(next.getFullYear())
      root.cards = ({})
      root.card = null
      cachePrepare.running = true
    } else {
      root.loadDate(root.todayKey, false)
    }
  }

  // ---- Calendar -----------------------------------------------------------
  function openCalendar() {
    var date = root.card ? root.dateFromKey(root.card.date) : root.now
    root.calendarMonth = date.getFullYear() === root.now.getFullYear()
      ? Math.min(date.getMonth(), root.now.getMonth())
      : root.now.getMonth()
    root.calendarOpen = true
    Qt.callLater(function() { if (root.calendarOpen) calendarOverlay.forceActiveFocus() })
  }

  function closeCalendar() {
    root.calendarOpen = false
    Qt.callLater(function() { if (root.opened) keyCatcher.forceActiveFocus() })
  }

  function selectDate(key) {
    root.retryCount = 0
    root.loadDate(key, false)
  }

  function goToday() {
    root.loadDate(root.todayKey, false)
  }

  function copyKanji() {
    if (!root.card || !root.card.kanji || !root.card.kanji.character) return
    Quickshell.execDetached(["wl-copy", root.card.kanji.character])
    root.copied = true
    copiedTimer.restart()
  }

  function openJisho() {
    var url = root.card && root.card.kanji ? root.card.kanji.url : ""
    if (url !== "") Quickshell.execDetached(["xdg-open", url])
  }

  // ---- Lifecycle ----------------------------------------------------------
  function open() {
    root.controller.show()
    if (root.viewDate !== root.todayKey || !root.card || root.card.date !== root.todayKey)
      root.loadDate(root.todayKey, false)
  }

  function close() {
    root.calendarOpen = false
    root.controller.hide()
    if (root.cacheDirty) Qt.callLater(root.saveCache)
  }

  function toggle() {
    if (root.opened) root.close()
    else root.open()
  }

  function refresh() {
    root.loadDate(root.viewDate, true)
  }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.barIdentity, direction)
    return false
  }

  Component.onCompleted: cachePrepare.running = true

  // ---- Processes and state file ------------------------------------------
  Process {
    id: fetchProc
    stdout: StdioCollector { id: fetchStdout; waitForEnd: true }
    stderr: StdioCollector { id: fetchStderr; waitForEnd: true }
    onExited: function(code) {
      if (root.stageRequest !== root.requestId) return
      if (code !== 0) {
        if (root.stage === "word") {
          root.fetchWords = []
          root.finishCard()
        } else if (root.stage === "sentence") {
          root.tryNextWord()
        } else {
          root.failFetch(root.networkError())
        }
        return
      }
      root.handleFetch(String(fetchStdout.text || ""))
    }
  }

  Process {
    id: cachePrepare
    command: ["bash", "-c",
      "umask 077\n" +
      "dir=$1\n" +
      "year=$2\n" +
      "mkdir -p -- \"$dir\" && chmod 700 -- \"$dir\" || exit 1\n" +
      "for file in \"$dir\"/*.json; do\n" +
      "  [[ -e $file ]] || continue\n" +
      "  base=${file##*/}\n" +
      "  old=${base%.json}\n" +
      "  [[ $old =~ ^[0-9]{4}$ && $old -lt $year ]] && rm -f -- \"$file\"\n" +
      "done\n" +
      "file=$dir/$year.json\n" +
      "if [[ -L $file ]]; then rm -f -- \"$file\"; fi\n" +
      "if [[ -f $file ]]; then chmod 600 -- \"$file\"; elif [[ ! -e $file ]]; then : >\"$file\"; fi\n",
      "omarchy-kanji-cache", root.pluginDataDir, String(root.now.getFullYear())]
    onExited: function(code) {
      root.cacheReady = code === 0
      if (code !== 0) {
        root.stateLoaded = true
        root.error = "Couldn't prepare the kanji cache"
      }
    }
  }

  FileView {
    id: cacheFile
    path: root.cacheReady ? root.cachePath : ""
    atomicWrites: true
    printErrors: false
    onLoaded: root.loadCache(text())
    onLoadFailed: if (root.cacheReady) root.loadCache("")
  }

  Timer {
    id: retryTimer
    interval: 3000
    onTriggered: root.loadDate(root.viewDate, true)
  }

  Timer {
    id: copiedTimer
    interval: 1500
    onTriggered: root.copied = false
  }

  Timer {
    interval: 60 * 1000
    running: true
    repeat: true
    onTriggered: root.checkDay()
  }

  // ---- Card ---------------------------------------------------------------
  component Field: Item {
    id: field
    property string label: ""
    property string value: ""
    property real labelWidth: Style.space(88)
    width: parent ? parent.width : 0
    height: Math.max(labelText.implicitHeight, valueText.implicitHeight)

    Text {
      id: labelText
      width: field.labelWidth
      textFormat: Text.PlainText
      text: field.label
      color: root.mutedForeground
      font.family: root.fontFamily
      font.pixelSize: root.captionSize
      font.letterSpacing: 0.5
    }

    Text {
      id: valueText
      x: labelText.width + Style.space(10)
      width: Math.max(0, field.width - x)
      textFormat: Text.PlainText
      text: field.value
      wrapMode: Text.WordWrap
      color: root.barForeground
      font.family: root.fontFamily
      font.pixelSize: root.bodySmallSize
    }
  }

  component SentenceField: Item {
    id: field
    property var sentence: null
    property string label: "Sentence"
    property real labelWidth: Style.space(88)
    width: parent ? parent.width : 0
    height: Math.max(labelText.implicitHeight, body.implicitHeight)

    Text {
      id: labelText
      width: field.labelWidth
      textFormat: Text.PlainText
      text: field.label
      color: root.mutedForeground
      font.family: root.fontFamily
      font.pixelSize: root.captionSize
      font.letterSpacing: 0.5
    }

    Column {
      id: body
      x: labelText.width + Style.space(10)
      width: Math.max(0, field.width - x)
      spacing: Style.space(3)

      RubyText {
        visible: field.sentence !== null
        units: field.sentence ? Kanji.sentenceUnits(field.sentence.japanese) : []
        fontFamily: root.fontFamily
        baseSize: root.bodySize
        textColor: root.barForeground
        readingColor: root.mutedForeground
      }

      Text {
        visible: field.sentence !== null && field.sentence.english !== ""
        width: parent.width
        textFormat: Text.PlainText
        text: field.sentence ? field.sentence.english : ""
        wrapMode: Text.WordWrap
        color: root.mutedForeground
        font.family: root.fontFamily
        font.pixelSize: root.captionSize
      }

      Text {
        visible: field.sentence === null
        textFormat: Text.PlainText
        text: "—"
        color: root.barForeground
        font.family: root.fontFamily
        font.pixelSize: root.bodySmallSize
      }
    }
  }

  // ---- Panel --------------------------------------------------------------
  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    padding: 0
    contentWidth: panel.fittedContentWidth(Style.space(760), Style.space(900))
    contentHeight: panel.fittedContentHeight(root.panelContentHeight, Style.space(720))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: root.calendarOpen
      onCloseRequested: root.close()
      onReturnRequested: root.retry()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(text, modifiers) {
        if (modifiers & (Qt.ControlModifier | Qt.AltModifier | Qt.MetaModifier)) return
        if (text === "r") root.retry()
        else if (text === "t") root.goToday()
      }

      // A solid popup ground, so the card stays readable even when the theme
      // lets the panel surface be glassy.
      Rectangle {
        anchors.fill: parent
        radius: Style.cornerRadius
        color: Color.background
      }

      Item {
        anchors.fill: parent
        anchors.margins: Style.space(12)

        Column {
          id: contentColumn
          width: parent.width
          spacing: Style.space(10)

          // Stale/offline warning, outside the card so the meishi stays intact.
          Rectangle {
            id: warningBanner
            visible: root.warningText !== ""
            width: parent.width
            height: visible ? warningRow.implicitHeight + Style.space(14) : 0
            radius: Style.cornerRadius
            color: root.mixed(Color.background, root.urgentForeground, 0.14)
            border.width: Style.spacing.hairline
            border.color: Qt.rgba(root.urgentForeground.r, root.urgentForeground.g, root.urgentForeground.b, 0.38)

            Row {
              id: warningRow
              anchors.left: parent.left
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              anchors.leftMargin: Style.space(8)
              anchors.rightMargin: Style.space(8)
              spacing: Style.space(8)

              Text {
                id: warningIcon
                textFormat: Text.PlainText
                text: "⚠"
                color: root.urgentForeground
                font.family: root.fontFamily
                font.pixelSize: root.bodySize
              }

              Text {
                width: Math.max(0, warningRow.width - warningIcon.width - retryButton.width - warningRow.spacing * 2)
                textFormat: Text.PlainText
                text: root.warningText
                wrapMode: Text.WordWrap
                color: root.urgentForeground
                font.family: root.fontFamily
                font.pixelSize: root.captionSize
              }

              Button {
                id: retryButton
                text: "Retry"
                fontSize: root.captionSize
                foreground: root.urgentForeground
                horizontalPadding: Style.space(8)
                verticalPadding: Style.space(3)
                onClicked: root.retry()
              }
            }
          }

          Rectangle {
            id: cardSurface
            visible: root.card !== null
            width: parent.width
            height: visible ? cardColumn.implicitHeight + Style.space(36) : 0
            radius: Style.cornerRadius
            color: root.mixed(Color.background, root.barForeground, 0.045)
            border.width: Style.spacing.hairline
            border.color: "yellow"

            Column {
              id: cardColumn
              width: Math.max(0, cardSurface.width - Style.space(36))
              anchors.centerIn: parent
              spacing: Style.space(14)

              Item {
                width: parent.width
                height: Math.max(headerRow.implicitHeight, headerButtons.height)

                Row {
                  id: headerRow
                  anchors.left: parent.left
                  anchors.right: headerButtons.left
                  anchors.rightMargin: Style.space(10)
                  anchors.verticalCenter: parent.verticalCenter
                  spacing: Style.space(8)

                  Text {
                    textFormat: Text.PlainText
                    text: root.card ? root.prettyDate(root.card.date) : ""
                    color: root.barForeground
                    font.family: root.fontFamily
                    font.pixelSize: root.subtitleSize
                    font.bold: true
                  }

                  Text {
                    visible: root.loading
                    textFormat: Text.PlainText
                    text: "loading…"
                    color: root.mutedForeground
                    font.family: root.fontFamily
                    font.pixelSize: root.captionSize
                    font.italic: true
                  }
                }

                Row {
                  id: headerButtons
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  spacing: Style.space(2)

                  PanelActionButton {
                    iconText: root.copied ? "" : ""
                    tooltipText: root.copied ? "Copied" : "Copy kanji"
                    foreground: root.barForeground
                    fontFamily: root.fontFamily
                    fontSize: root.iconSize
                    onClicked: root.copyKanji()
                  }

                  PanelActionButton {
                    iconText: "󰃭"
                    tooltipText: "Choose a day"
                    foreground: root.barForeground
                    fontFamily: root.fontFamily
                    fontSize: root.iconSize
                    onClicked: root.openCalendar()
                  }
                }
              }

              Row {
                width: parent.width
                spacing: Style.space(20)
                height: Math.max(guideColumn.implicitHeight, detailColumn.implicitHeight)

                Column {
                  id: guideColumn
                  width: Style.space(220)
                  spacing: Style.space(8)

                  Item {
                    id: guide
                    width: parent.width
                    height: width

                    Rectangle {
                      anchors.fill: parent
                      radius: Style.cornerRadius
                      color: root.mixed(Color.background, root.barForeground, 0.025)
                      border.width: Style.spacing.hairline
                      border.color: Qt.rgba(root.barForeground.r, root.barForeground.g, root.barForeground.b, 0.28)
                    }

                    Rectangle {
                      x: Math.round(parent.width / 2)
                      y: 0
                      width: Style.spacing.hairline
                      height: parent.height
                      color: Qt.rgba(root.barForeground.r, root.barForeground.g, root.barForeground.b, 0.16)
                    }

                    Rectangle {
                      x: 0
                      y: Math.round(parent.height / 2)
                      width: parent.width
                      height: Style.spacing.hairline
                      color: Qt.rgba(root.barForeground.r, root.barForeground.g, root.barForeground.b, 0.16)
                    }

                    Text {
                      anchors.centerIn: parent
                      textFormat: Text.PlainText
                      text: root.card ? root.card.kanji.character : ""
                      color: root.barForeground
                      font.family: root.fontFamily
                      font.pixelSize: Style.space(118)
                    }
                  }

                  Text {
                    width: parent.width
                    textFormat: Text.PlainText
                    text: root.metaText
                    horizontalAlignment: Text.AlignHCenter
                    color: root.mutedForeground
                    font.family: root.fontFamily
                    font.pixelSize: root.captionSize
                  }
                }

                Column {
                  id: detailColumn
                  width: Math.max(0, parent.width - guideColumn.width - parent.spacing)
                  spacing: Style.space(8)

                  Field { label: "Meaning"; value: root.meaningText }
                  Field { label: "Kun'yomi"; value: root.kunText }
                  Field { label: "On'yomi"; value: root.onText }

                  Text {
                    width: parent.width
                    topPadding: Style.space(3)
                    textFormat: Text.PlainText
                    text: "Examples"
                    color: root.mutedForeground
                    font.family: root.fontFamily
                    font.pixelSize: root.captionSize
                    font.letterSpacing: 0.5
                    font.bold: true
                  }

                  Field {
                    label: "Word"
                    labelWidth: Style.space(52)
                    value: root.wordText
                  }

                  SentenceField {
                    label: "Sentence"
                    labelWidth: Style.space(52)
                    sentence: root.card ? root.card.sentence : null
                  }
                }
              }

              Item {
                width: parent.width
                height: visible ? jishoLink.implicitHeight : 0
                visible: root.card !== null && root.card.kanji && root.card.kanji.url !== ""

                Text {
                  id: jishoLink
                  anchors.right: parent.right
                  textFormat: Text.PlainText
                  text: "jisho.org ↗"
                  color: jishoMouse.containsMouse ? root.barForeground : root.mutedForeground
                  font.family: root.fontFamily
                  font.pixelSize: root.captionSize
                  font.underline: jishoMouse.containsMouse
                }

                MouseArea {
                  id: jishoMouse
                  anchors.left: jishoLink.left
                  anchors.right: jishoLink.right
                  anchors.top: parent.top
                  anchors.bottom: parent.bottom
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onClicked: root.openJisho()
                }
              }
            }

          }

          Rectangle {
            id: errorSurface
            visible: root.card === null
            width: parent.width
            height: visible ? errorColumn.implicitHeight + Style.space(40) : 0
            radius: Style.cornerRadius
            color: root.mixed(Color.background, root.barForeground, 0.045)
            border.width: Style.spacing.hairline
            border.color: Qt.rgba(root.barForeground.r, root.barForeground.g, root.barForeground.b, 0.16)

            Column {
              id: errorColumn
              width: Math.max(0, parent.width - Style.space(48))
              anchors.centerIn: parent
              spacing: Style.space(8)

              Text {
                width: parent.width
                textFormat: Text.PlainText
                text: root.busy ? "Loading today's kanji…" : "Couldn't load today's kanji"
                horizontalAlignment: Text.AlignHCenter
                color: root.barForeground
                font.family: root.fontFamily
                font.pixelSize: root.subtitleSize
                font.bold: true
              }

              Text {
                visible: !root.busy && root.error !== ""
                width: parent.width
                textFormat: Text.PlainText
                text: root.error
                wrapMode: Text.WordWrap
                horizontalAlignment: Text.AlignHCenter
                color: root.mutedForeground
                font.family: root.fontFamily
                font.pixelSize: root.bodySmallSize
              }

              Button {
                visible: !root.busy
                anchors.horizontalCenter: parent.horizontalCenter
                text: "Retry"
                fontSize: root.bodySmallSize
                foreground: root.barForeground
                onClicked: root.retry()
              }
            }
          }
        }

        // In-panel picker instead of a Qt Popup: layer-shell surfaces put a
        // Qt Quick Popup behind sibling content, so draw the calendar on top.
        Item {
          id: calendarOverlay
          z: 100
          anchors.fill: parent
          visible: root.calendarOpen
          focus: root.calendarOpen

          readonly property real surfaceWidth: Style.space(300)
          readonly property real surfaceHeight: Style.space(340)

          Keys.onEscapePressed: root.closeCalendar()

          MouseArea {
            anchors.fill: parent
            onClicked: root.closeCalendar()
          }

          Rectangle {
            id: calendarSurface
            width: calendarOverlay.surfaceWidth
            height: calendarOverlay.surfaceHeight
            x: Math.max(Style.space(8), calendarOverlay.width - width - Style.space(4))
            y: Style.space(44)
            radius: Style.cornerRadius
            color: root.mixed(Color.background, root.barForeground, 0.06)
            border.width: Style.spacing.hairline
            border.color: Qt.rgba(root.barForeground.r, root.barForeground.g, root.barForeground.b, 0.28)

            MouseArea { anchors.fill: parent; onClicked: {} }

            Column {
              id: calendarColumn
              anchors.fill: parent
              anchors.margins: Style.space(10)
              spacing: Style.space(6)

              readonly property real cellSize: Math.max(0, Math.floor((width - Style.space(2) * 6) / 7))

              Item {
                width: parent.width
                height: Math.max(prevMonth.height, nextMonth.height, monthTitle.implicitHeight)

                PanelActionButton {
                  id: prevMonth
                  anchors.left: parent.left
                  anchors.verticalCenter: parent.verticalCenter
                  iconText: "󰅁"
                  tooltipText: "Previous month"
                  foreground: root.barForeground
                  fontFamily: root.fontFamily
                  fontSize: root.iconSize
                  enabled: Calendar.canPrevMonth(root.calendarMonth)
                  opacity: enabled ? 1 : 0.35
                  onClicked: root.calendarMonth = Math.max(0, root.calendarMonth - 1)
                }

                Text {
                  id: monthTitle
                  anchors.centerIn: parent
                  textFormat: Text.PlainText
                  text: root.monthLabel
                  color: root.barForeground
                  font.family: root.fontFamily
                  font.pixelSize: root.bodySmallSize
                  font.letterSpacing: 0.8
                }

                PanelActionButton {
                  id: nextMonth
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  iconText: "󰅂"
                  tooltipText: "Next month"
                  foreground: root.barForeground
                  fontFamily: root.fontFamily
                  fontSize: root.iconSize
                  enabled: Calendar.canNextMonth(root.calendarMonth, root.now.getMonth())
                  opacity: enabled ? 1 : 0.35
                  onClicked: root.calendarMonth = Math.min(root.now.getMonth(), root.calendarMonth + 1)
                }
              }

              Row {
                width: parent.width
                spacing: Style.space(2)

                Repeater {
                  model: Calendar.weekdayOrder(root.weekStart)

                  Text {
                    required property int modelData
                    width: calendarColumn.cellSize
                    textFormat: Text.PlainText
                    text: root.weekdayLabel(modelData)
                    horizontalAlignment: Text.AlignHCenter
                    color: root.mutedForeground
                    font.family: root.fontFamily
                    font.pixelSize: root.captionSize
                    font.letterSpacing: 0.5
                  }
                }
              }

              Grid {
                columns: 7
                columnSpacing: Style.space(2)
                rowSpacing: Style.space(2)

                Repeater {
                  model: root.calendarCells

                  Rectangle {
                    id: dayCell
                    required property var modelData
                    width: calendarColumn.cellSize
                    height: calendarColumn.cellSize
                    radius: Style.cornerRadius
                    readonly property bool selected: modelData.key === root.displayedDate
                    color: dayCell.selected
                      ? Style.selectedFillFor(root.barForeground, Color.accent)
                      : (dayMouse.containsMouse ? Style.hoverFillFor(root.barForeground, Color.accent) : "transparent")
                    border.width: modelData.today ? Style.spacing.hairline : 0
                    border.color: Style.normalBorderFor(root.barForeground, Color.accent)

                    Text {
                      anchors.centerIn: parent
                      textFormat: Text.PlainText
                      text: dayCell.modelData.day
                      color: !dayCell.modelData.inMonth
                        ? Qt.rgba(root.barForeground.r, root.barForeground.g, root.barForeground.b, 0.22)
                        : (dayCell.modelData.enabled ? root.barForeground : root.mutedForeground)
                      font.family: root.fontFamily
                      font.pixelSize: root.bodySmallSize
                      font.bold: dayCell.modelData.today
                    }

                    MouseArea {
                      id: dayMouse
                      anchors.fill: parent
                      enabled: dayCell.modelData.enabled
                      hoverEnabled: enabled
                      cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                      onClicked: {
                        root.selectDate(dayCell.modelData.key)
                        root.closeCalendar()
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
