const DEFAULT_TIME_ZONE = 'Asia/Karachi';

function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function companyDateString(date = new Date(), timeZone = process.env.APP_TIMEZONE || DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isLate(date, officeStart, graceMinutes, timeZone = process.env.APP_TIMEZONE || DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, Number(value)]));
  const [startHour, startMinute] = officeStart.split(':').map(Number);
  return values.hour * 60 + values.minute > startHour * 60 + startMinute + graceMinutes;
}

function companyLocalDateTime(date, time, timeZone = process.env.APP_TIMEZONE || DEFAULT_TIME_ZONE) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const expected = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = expected;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, Number(value)]));
    const actual = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
    const difference = expected - actual;
    if (!difference) break;
    timestamp += difference;
  }

  return new Date(timestamp);
}

module.exports = { companyDateString, isLate, companyLocalDateTime, isValidDateString };
