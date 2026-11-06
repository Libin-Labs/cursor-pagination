import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { paginate, encodeCursor, decodeCursor, CursorError } from '../dist/esm/index.js';
const sort = [{ field: 'id' }];
test('forward pages are sorted and expose stable exclusive cursors', () => {
  const rows = [{ id: 3 }, { id: 1 }, { id: 2 }];
  const first = paginate(rows, { sort, limit: 2 });
  assert.deepEqual(
    first.items.map((row) => row.id),
    [1, 2],
  );
  assert.equal(first.hasNext, true);
  assert.equal(first.hasPrevious, false);
  const second = paginate(rows, { sort, limit: 2, after: first.endCursor });
  assert.deepEqual(second.items, [{ id: 3 }]);
  assert.equal(second.hasNext, false);
  assert.equal(second.hasPrevious, true);
  assert.deepEqual(
    rows.map((row) => row.id),
    [3, 1, 2],
  );
});
test('backward pages return preceding records in the same display order', () => {
  const rows = Array.from({ length: 10 }, (_, id) => ({ id }));
  const boundary = encodeCursor([7], sort);
  const page = paginate(rows, { sort, limit: 3, before: boundary });
  assert.deepEqual(
    page.items.map((row) => row.id),
    [4, 5, 6],
  );
  assert.equal(page.hasNext, true);
  assert.equal(page.hasPrevious, true);
});
test('insertions and deleted cursor records do not cause offset-based skips', () => {
  const first = paginate([{ id: 1 }, { id: 3 }, { id: 5 }], { sort, limit: 2 });
  const second = paginate([{ id: 0 }, { id: 1 }, { id: 4 }, { id: 5 }], {
    sort,
    limit: 2,
    after: first.endCursor,
  });
  assert.deepEqual(
    second.items.map((row) => row.id),
    [4, 5],
  );
});
test('multiple fields break ties and direction/null ordering are explicit', () => {
  const rows = [
    { id: 1, rank: null },
    { id: 2, rank: 2 },
    { id: 3, rank: 2 },
    { id: 4, rank: 1 },
  ];
  const options = {
    sort: [
      { field: 'rank', direction: 'desc' },
      { field: 'id', direction: 'asc' },
    ],
    limit: 4,
  };
  assert.deepEqual(
    paginate(rows, options).items.map((row) => row.id),
    [2, 3, 4, 1],
  );
  assert.deepEqual(
    paginate(rows, {
      ...options,
      sort: [{ field: 'rank', direction: 'desc', nulls: 'first' }, { field: 'id' }],
    }).items.map((row) => row.id),
    [1, 2, 3, 4],
  );
});
test('cursors bind version scope and normalized ordering without claiming authentication', () => {
  const token = encodeCursor(
    ['A😀', 1],
    [{ field: 'name' }, { field: 'id' }],
    'tenant-a/filter-v1',
  );
  assert.deepEqual(
    decodeCursor(
      token,
      [{ field: 'name', direction: 'asc', nulls: 'last' }, { field: 'id' }],
      'tenant-a/filter-v1',
    ),
    ['A😀', 1],
  );
  assert.throws(
    () => decodeCursor(token, [{ field: 'name' }, { field: 'id' }], 'tenant-b'),
    CursorError,
  );
  assert.throws(
    () =>
      decodeCursor(
        token,
        [{ field: 'name', direction: 'desc' }, { field: 'id' }],
        'tenant-a/filter-v1',
      ),
    CursorError,
  );
});
test('malformed tokens, excessive size and invalid cursor values fail explicitly', () => {
  for (const token of [
    '',
    '%ZZ',
    'not-json',
    'x'.repeat(16001),
    encodeURIComponent('{"version":2}'),
  ])
    assert.throws(() => decodeCursor(token, sort), CursorError);
  assert.throws(() => encodeCursor([Infinity], sort), CursorError);
  assert.throws(() => encodeCursor(['x'.repeat(20000)], sort), CursorError);
  assert.deepEqual(decodeCursor(encodeCursor(['\uD800'], sort), sort), ['\uD800']);
});
test('ambiguous order and missing/mixed/unsupported sort values are rejected', () => {
  for (const rows of [
    [{ id: 1 }, { id: 1 }],
    [{ id: 1 }, { id: '1' }],
    [{}],
    [{ id: undefined }],
    [{ id: NaN }],
    [{ id: {} }],
  ])
    assert.throws(() => paginate(rows, { sort, limit: 2 }), TypeError);
  assert.throws(
    () => paginate([{ id: 1 }], { sort, limit: 1, after: encodeCursor(['1'], sort) }),
    CursorError,
  );
});
test('empty boundaries and datasets produce null cursors with accurate flags', () => {
  const empty = paginate([], { sort, limit: 2 });
  assert.deepEqual(empty, {
    items: [],
    hasNext: false,
    hasPrevious: false,
    startCursor: null,
    endCursor: null,
  });
  const end = paginate([{ id: 1 }], { sort, limit: 2, after: encodeCursor([5], sort) });
  assert.equal(end.items.length, 0);
  assert.equal(end.hasPrevious, true);
  assert.equal(end.hasNext, false);
  const beginning = paginate([{ id: 1 }], { sort, limit: 2, before: encodeCursor([0], sort) });
  assert.equal(beginning.hasNext, true);
  assert.equal(beginning.hasPrevious, false);
});
test('configuration and capacity guards are enforced', () => {
  for (const limit of [0, 1001, 1.5])
    assert.throws(() => paginate([], { sort, limit }), RangeError);
  assert.throws(() => paginate([], { sort: [], limit: 1 }), TypeError);
  assert.throws(
    () => paginate([], { sort: [{ field: 'id' }, { field: 'id' }], limit: 1 }),
    TypeError,
  );
  assert.throws(() => paginate([], { sort, limit: 1, after: 'a', before: 'b' }), CursorError);
  assert.throws(
    () => paginate([{ id: 1 }, { id: 2 }], { sort, limit: 1, maxRecords: 1 }),
    RangeError,
  );
});
test('full forward/backward walks contain every stable identity exactly once', () => {
  const rows = Array.from({ length: 503 }, (_, id) => ({ id, group: id % 7 }));
  const ordered = [{ field: 'group', direction: 'desc' }, { field: 'id' }];
  const expected = [...rows].sort((a, b) => b.group - a.group || a.id - b.id).map((row) => row.id);
  const seen = [];
  let after;
  do {
    const page = paginate(rows, { sort: ordered, limit: 17, ...(after ? { after } : {}) });
    seen.push(...page.items.map((row) => row.id));
    if (!page.hasNext) break;
    after = page.endCursor;
  } while (true);
  assert.deepEqual(seen, expected);
  const backwards = [];
  let before = encodeCursor([-1, 0], ordered);
  do {
    const page = paginate(rows, { sort: ordered, limit: 19, before });
    backwards.unshift(...page.items.map((row) => row.id));
    if (!page.hasPrevious) break;
    before = page.startCursor;
  } while (true);
  assert.deepEqual(backwards, expected);
});
test('CommonJS supports portable cursor encoding and pagination', () => {
  const cjs = createRequire(import.meta.url)('../dist/cjs/index.js');
  assert.deepEqual(cjs.decodeCursor(encodeCursor([1], sort), sort), [1]);
  assert.equal(cjs.paginate([{ id: 1 }], { sort, limit: 1 }).items[0].id, 1);
});
