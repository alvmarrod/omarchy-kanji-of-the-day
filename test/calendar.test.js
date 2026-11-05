const test = require("node:test")
const assert = require("node:assert/strict")
const Calendar = require("../Calendar.js")

test("weekdayOrder: starts on the requested weekday", () => {
  assert.deepEqual(Calendar.weekdayOrder(0), [0, 1, 2, 3, 4, 5, 6])
  assert.deepEqual(Calendar.weekdayOrder(1), [1, 2, 3, 4, 5, 6, 0])
  assert.deepEqual(Calendar.weekdayOrder(6), [6, 0, 1, 2, 3, 4, 5])
})

test("monthCells: six rows, current-month days enabled only up to today", () => {
  const cells = Calendar.monthCells(2026, 10, 0, "2026-11-05")
  assert.equal(cells.length, 42)

  const nov5 = cells.find((cell) => cell.key === "2026-11-05")
  const nov6 = cells.find((cell) => cell.key === "2026-11-06")
  assert.ok(nov5)
  assert.equal(nov5.inMonth, true)
  assert.equal(nov5.today, true)
  assert.equal(nov5.enabled, true)
  assert.equal(nov6.inMonth, true)
  assert.equal(nov6.enabled, false)
})

test("monthCells: out-of-month cells are shown but disabled", () => {
  const cells = Calendar.monthCells(2026, 9, 0, "2026-11-05")
  const september = cells.find((cell) => cell.key === "2026-09-30")
  assert.ok(september)
  assert.equal(september.inMonth, false)
  assert.equal(september.enabled, false)
})

test("monthCells: leap day exists and is selectable on 29 February", () => {
  const cells = Calendar.monthCells(2028, 1, 0, "2028-02-29")
  const leap = cells.find((cell) => cell.key === "2028-02-29")
  const march = cells.find((cell) => cell.key === "2028-03-01")
  assert.ok(leap)
  assert.equal(leap.enabled, true)
  assert.equal(march.inMonth, false)
  assert.equal(march.enabled, false)
})

test("monthCells: honours a Monday week start", () => {
  const sundayStart = Calendar.monthCells(2026, 10, 0, "2026-11-05")
  const mondayStart = Calendar.monthCells(2026, 10, 1, "2026-11-05")
  assert.equal(sundayStart[0].weekday, 0)
  assert.equal(mondayStart[0].weekday, 1)
})

test("month stepping stays inside the current year", () => {
  assert.equal(Calendar.canPrevMonth(0), false)
  assert.equal(Calendar.canPrevMonth(1), true)
  assert.equal(Calendar.canNextMonth(10, 10), false)
  assert.equal(Calendar.canNextMonth(9, 10), true)
})
