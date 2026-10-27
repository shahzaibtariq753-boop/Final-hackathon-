function workingDaysBetween(start, end, weekendDays = ['Saturday', 'Sunday'], publicHolidays = []) {
  if (start > end) return 0;
  const holidayDates = new Set(publicHolidays.map((holiday) => holiday.date));
  let count = 0;
  for (let current = new Date(`${start}T00:00:00Z`); current.toISOString().slice(0, 10) <= end; current.setUTCDate(current.getUTCDate() + 1)) {
    const date = current.toISOString().slice(0, 10);
    const weekday = current.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    if (!weekendDays.includes(weekday) && !holidayDates.has(date)) count += 1;
  }
  return count;
}

module.exports = { workingDaysBetween };
