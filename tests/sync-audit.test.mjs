import test from 'node:test';
import assert from 'node:assert/strict';
import {datasetFor,latestSourceTime,datasets} from '../lib/sync-audit.ts';

test('sync audit datasets schema matches expected categories', () => {
  assert.equal(datasets.length, 9);
  assert.ok(datasets.includes('transactions'));
  assert.ok(datasets.includes('points'));
  assert.ok(datasets.includes('applications'));
  assert.ok(datasets.includes('subscriptions'));
});

test('datasetFor resolves correct dataset for business kinds', () => {
  assert.equal(datasetFor({kind: 'transaction'}), 'transactions');
  assert.equal(datasetFor({kind: 'settlement'}), 'settlements');
  assert.equal(datasetFor({kind: 'news'}), 'news');
  assert.equal(datasetFor({kind: 'task'}), 'tasks');
  assert.equal(datasetFor({kind: 'event'}), 'events');
  assert.equal(datasetFor({kind: 'journal'}), 'journal');
  assert.equal(datasetFor({kind: 'benefit', category: 'points'}), 'points');
  assert.equal(datasetFor({kind: 'benefit', category: 'ai_subscription'}), 'subscriptions');
  assert.equal(datasetFor({kind: 'benefit', category: '교통지원'}), 'applications');
  assert.equal(datasetFor({kind: 'benefit', category: null}), 'applications');
  assert.equal(datasetFor({kind: 'unknown'}), null);
});

test('latestSourceTime returns newest valid as_of date', () => {
  const rows = [
    {metadata: {as_of: '2026-11-12T07:00:00+09:00'}},
    {metadata: {as_of: '2026-11-12T08:30:00+09:00'}},
    {metadata: {as_of: '2026-11-12T06:15:00+09:00'}},
    {metadata: {as_of: null}},
    {metadata: {as_of: 'invalid-date'}},
    {}
  ];
  assert.equal(latestSourceTime(rows), '2026-11-12T08:30:00+09:00');
});

test('latestSourceTime returns null when no valid as_of exists', () => {
  assert.equal(latestSourceTime([]), null);
  assert.equal(latestSourceTime([{metadata: {}}, {metadata: {as_of: null}}]), null);
});
