# @lp-labs/cursor-pagination

Independent in-memory keyset pagination with stable composite ordering, forward/backward navigation and scoped, versioned cursors. Zero runtime or peer dependencies.

## Install

```sh
npm install @lp-labs/cursor-pagination
```

Node 18+ or ES2022 browsers. ESM/CommonJS and declarations included.

## Quick start

```js
import { paginate } from '@lp-labs/cursor-pagination';
const rows = [{ id: 3 }, { id: 1 }, { id: 2 }];
const sort = [{ field: 'id', direction: 'asc' }];
const first = paginate(rows, { sort, limit: 2, scope: 'products-v1' });
const second = paginate(rows, { sort, limit: 2, scope: 'products-v1', after: first.endCursor });
console.log(first.items.map((row) => row.id)); // [1, 2]
console.log(second.items.map((row) => row.id)); // [3]
```

CommonJS: `const { paginate } = require('@lp-labs/cursor-pagination');`.

## Ordering contract

Supply a nonempty sort array with 1-32 unique field names:

```ts
interface SortField<T> {
  field: keyof T & string;
  direction?: 'asc' | 'desc'; // default asc
  nulls?: 'first' | 'last'; // default last, independent of direction
}
```

Each sort field must be an own property containing string, finite number, boolean or null. Within one field, non-null types must be consistent. Strings use JavaScript's deterministic UTF-16 lexical ordering, not locale collation. Booleans order false before true in ascending order. Missing/undefined/object/date/NaN values are rejected.

The combined key must be unique across the full dataset. Add a stable ID tie-breaker when sorting by nonunique names/timestamps. Ambiguous keys throw rather than silently produce skipped records. Key values should remain immutable between page requests.

## API reference

Runtime exports: `paginate`, `encodeCursor`, `decodeCursor`, `CursorError`.

Types: `CursorValue`, `SortField`, `PageOptions`, `Page`.

### `paginate<T extends object>(rows, options): Page<T>`

| Option | Default | Meaning |
|---|---|---|
| `sort` | required | Typed ordered field descriptors |
| `limit` | required | Integer page size 1-1000 |
| `after` | none | Exclusive lower boundary for forward paging |
| `before` | none | Exclusive upper boundary; returns the last limit rows before it |
| `scope` | `"default"` | 1-1000-character identity for the query/filter/tenant context |
| `maxRecords` | 100000 | Dataset cap; configurable 1-1000000 |

Use after or before, never both. Omitting either starts at the beginning, not the last page. Returned items always use the declared display order, even during backward paging.

`Page<T>`:

```ts
interface Page<T> {
  items: T[];
  hasNext: boolean;
  hasPrevious: boolean;
  startCursor: string | null;
  endCursor: string | null;
}
```

Flags indicate whether the currently supplied dataset has records beyond/before the selected window. Empty results have null cursors; a boundary beyond the last record can have hasPrevious true and hasNext false.

Input arrays are not reordered. Output items retain original row references; this is not snapshot cloning. Getters for sort fields execute normally, so use plain data records with stable fields.

### Cursor helpers

`encodeCursor(values, sort, scope = 'default')` encodes a key tuple. Arity must match the sort descriptor count. `decodeCursor(token, sort, scope = 'default')` validates the version, normalized sort configuration, scope and finite primitive values, returning a fresh tuple.

Cursors are percent-encoded JSON, capped at 16000 characters. They are **not encrypted, signed or authenticated** and may expose field values. Malformed percent encoding or JSON, incompatible contexts and type mismatches raise CursorError. JSON escaping preserves JavaScript strings, including unpaired UTF-16 surrogates. Do not log cursors containing personal data.

The helpers can support custom storage adapters, but this package does not generate SQL or query a database. Any backend adapter must reproduce the exact null/type/string comparison semantics or adopt its own consistent codec. Locale/database collation can differ from this comparator.

## Changing datasets

Keyset boundaries compare values rather than offsets. A cursor record may be removed; paging still uses its encoded position. Insertions before an after cursor do not shift the boundary. However:

- Updating an entity's sort values can move it across a boundary, causing it to reappear or be missed.
- New entities before an already-consumed boundary are intentionally not revisited.
- This is not a point-in-time database snapshot or exactly-once event feed.
- Bind scope to the actual query/filter/tenant version, but enforce authorization separately on the server. A caller can forge an unsigned scope.

Use immutable sorting keys or an external snapshot/version protocol when the application requires stronger guarantees.

## Performance, customization and errors

Every call validates and sorts the supplied array: O(n log n) time and O(n) auxiliary memory. Boundary search is binary, but this is not a replacement for a database index or an incremental sorted collection. Use adapters for remote/large datasets.

Choose sort descriptors/null policy and scope explicitly. Numeric comparison uses JavaScript numbers, not arbitrary precision; serialize sortable timestamps/numbers in a consistent representation. No deep paths, custom locale comparator, sparse-field inference, UI controls or runtime schema library is included.

Configuration/type/order failures throw TypeError, capacity/page limits throw RangeError, and invalid cursors throw CursorError (a TypeError subclass). Errors do not return empty success-shaped pages. This independently authored initial release includes complete forward/backward walk regression tests, not distributed consistency certification.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
