// Pure month-grid math for the day picker. The picker is limited to the
// current year and to days that have already happened.

function pad2(value) {
  var n = Number(value)
  return (n < 10 ? "0" : "") + n
}

function normalizedWeekStart(value) {
  var n = Number(value)
  if (!isFinite(n)) return 0
  return ((Math.round(n) % 7) + 7) % 7
}

function weekdayOrder(weekStart) {
  var start = normalizedWeekStart(weekStart)
  var out = []
  for (var i = 0; i < 7; i++) out.push((start + i) % 7)
  return out
}

// 42 cells, six rows, so the popup keeps the same height in every month.
// Out-of-month cells are shown but disabled; so is anything after today.
function monthCells(year, month, weekStart, todayKey) {
  var y = Number(year)
  var m = Number(month)
  var start = normalizedWeekStart(weekStart)
  var today = String(todayKey === undefined || todayKey === null ? "" : todayKey)
  var first = new Date(Date.UTC(y, m, 1))
  var offset = (first.getUTCDay() - start + 7) % 7
  var cells = []

  for (var i = 0; i < 42; i++) {
    var date = new Date(Date.UTC(y, m, 1 - offset + i))
    var cellYear = date.getUTCFullYear()
    var cellMonth = date.getUTCMonth()
    var day = date.getUTCDate()
    var key = cellYear + "-" + pad2(cellMonth + 1) + "-" + pad2(day)
    var inMonth = cellMonth === m && cellYear === y
    cells.push({
      key: key,
      day: day,
      weekday: date.getUTCDay(),
      inMonth: inMonth,
      today: key === today,
      enabled: inMonth && key <= today
    })
  }

  return cells
}

function canPrevMonth(month) {
  return Number(month) > 0
}

function canNextMonth(month, todayMonth) {
  return Number(month) < Number(todayMonth)
}

if (typeof module !== "undefined") {
  module.exports = {
    pad2: pad2,
    normalizedWeekStart: normalizedWeekStart,
    weekdayOrder: weekdayOrder,
    monthCells: monthCells,
    canPrevMonth: canPrevMonth,
    canNextMonth: canNextMonth
  }
}
