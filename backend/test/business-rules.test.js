const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateAnnualTax } = require('../src/utils/taxCalculator');
const { calculateDistanceInMeters } = require('../src/utils/haversine');
const { workingDaysBetween } = require('../src/utils/workingDays');
const { companyDateString, isLate, isValidDateString } = require('../src/utils/companyTime');
const { getJwtSecret, getMongoUri } = require('../src/config/environment');

test('deployment environment aliases resolve to the API configuration names', () => {
  assert.equal(getJwtSecret({ SECRET_KEY: 'provider-secret' }), 'provider-secret');
  assert.equal(getJwtSecret({ JWT_SECRET: 'app-secret', SECRET_KEY: 'provider-secret' }), 'app-secret');
  assert.equal(getMongoUri({ DB_URI: 'mongodb://provider-host' }), 'mongodb://provider-host');
  assert.equal(getMongoUri({ MONGO_URI: 'mongodb://app-host', DB_URI: 'mongodb://provider-host' }), 'mongodb://app-host');
});

test('annual tax applies the configured illustrative tax slabs', () => {
  assert.equal(calculateAnnualTax(600000), 0);
  assert.equal(calculateAnnualTax(1200000), 30000);
  assert.equal(calculateAnnualTax(2400000), 210000);
  assert.equal(calculateAnnualTax(3600000), 510000);
  assert.equal(calculateAnnualTax(4800000), 930000);
});

test('working days exclude configured weekends and public holidays inclusively', () => {
  assert.equal(workingDaysBetween('2026-10-19', '2026-10-25', ['Saturday', 'Sunday'], [{ date: '2026-10-20', name: 'Holiday' }]), 4);
  assert.equal(workingDaysBetween('2026-10-24', '2026-10-25', ['Saturday', 'Sunday'], []), 0);
  assert.equal(workingDaysBetween('2026-10-25', '2026-10-24', ['Saturday', 'Sunday'], []), 0);
});

test('attendance is late after the configured office grace period', () => {
  assert.equal(isLate(new Date('2026-10-26T04:15:00Z'), '09:00', 15, 'Asia/Karachi'), false);
  assert.equal(isLate(new Date('2026-10-26T04:16:00Z'), '09:00', 15, 'Asia/Karachi'), true);
});

test('attendance date follows the configured company time zone', () => {
  assert.equal(companyDateString(new Date('2026-10-26T20:00:00Z'), 'Asia/Karachi'), '2026-10-27');
});

test('calendar date validation rejects normalized impossible dates', () => {
  assert.equal(isValidDateString('2024-02-29'), true);
  assert.equal(isValidDateString('2026-02-29'), false);
  assert.equal(isValidDateString('2026-02-31'), false);
});

test('geofence distance is zero for identical coordinates and symmetric', () => {
  assert.equal(calculateDistanceInMeters(24.8607, 67.0011, 24.8607, 67.0011), 0);
  const forward = calculateDistanceInMeters(24.8607, 67.0011, 24.8617, 67.0021);
  const reverse = calculateDistanceInMeters(24.8617, 67.0021, 24.8607, 67.0011);
  assert.ok(forward > 0 && forward < 1000);
  assert.equal(Math.round(forward), Math.round(reverse));
});
