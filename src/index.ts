export type CursorValue = string | number | boolean | null;
export interface SortField<T> {
  field: keyof T & string;
  direction?: 'asc' | 'desc';
  nulls?: 'first' | 'last';
}
export interface PageOptions<T> {
  sort: readonly SortField<T>[];
  limit: number;
  after?: string;
  before?: string;
  scope?: string;
  maxRecords?: number;
}
export interface Page<T> {
  items: T[];
  hasNext: boolean;
  hasPrevious: boolean;
  startCursor: string | null;
  endCursor: string | null;
}
interface Order {
  field: string;
  direction: 'asc' | 'desc';
  nulls: 'first' | 'last';
}
export class CursorError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'CursorError';
  }
}
function order<T>(sort: readonly SortField<T>[]): Order[] {
  if (!Array.isArray(sort) || !sort.length || sort.length > 32)
    throw new TypeError('sort must contain 1 to 32 fields.');
  const result = sort.map((entry) => {
    if (
      !entry ||
      typeof entry.field !== 'string' ||
      !entry.field ||
      (entry.direction !== undefined && entry.direction !== 'asc' && entry.direction !== 'desc') ||
      (entry.nulls !== undefined && entry.nulls !== 'first' && entry.nulls !== 'last')
    )
      throw new TypeError('Invalid sort descriptor.');
    return {
      field: entry.field,
      direction: entry.direction ?? 'asc',
      nulls: entry.nulls ?? 'last',
    };
  });
  if (new Set(result.map((entry) => entry.field)).size !== result.length)
    throw new TypeError('Sort fields must be unique.');
  return result;
}
function scopeName(scope: string): void {
  if (typeof scope !== 'string' || !scope || scope.length > 1000)
    throw new TypeError('scope must contain 1 to 1000 characters.');
}
function scalar(value: unknown): value is CursorValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}
function encode(values: readonly CursorValue[], sort: Order[], scope: string): string {
  let token: string;
  try {
    token = encodeURIComponent(JSON.stringify({ version: 1, scope, sort, values }));
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
    throw new CursorError('Cursor contains unsupported Unicode.');
  }
  if (token.length > 16000) throw new CursorError('Encoded cursor exceeds 16000 characters.');
  return token;
}
export function encodeCursor<T>(
  values: readonly CursorValue[],
  sort: readonly SortField<T>[],
  scope = 'default',
): string {
  const config = order(sort);
  scopeName(scope);
  if (
    !Array.isArray(values) ||
    values.length !== config.length ||
    values.some((value) => !scalar(value))
  )
    throw new CursorError('Cursor values must match the sort arity and contain finite primitives.');
  return encode([...values], config, scope);
}
export function decodeCursor<T>(
  token: string,
  sort: readonly SortField<T>[],
  scope = 'default',
): CursorValue[] {
  const config = order(sort);
  scopeName(scope);
  if (typeof token !== 'string' || !token || token.length > 16000)
    throw new CursorError('Invalid cursor size or type.');
  let value: unknown;
  try {
    value = JSON.parse(decodeURIComponent(token));
  } catch (error) {
    if (!(error instanceof SyntaxError) && !(error instanceof URIError)) throw error;
    throw new CursorError('Malformed cursor encoding.');
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('scope' in value) ||
    value.scope !== scope ||
    !('sort' in value) ||
    JSON.stringify(value.sort) !== JSON.stringify(config) ||
    !('values' in value) ||
    !Array.isArray(value.values) ||
    value.values.length !== config.length ||
    value.values.some((part) => !scalar(part))
  )
    throw new CursorError('Cursor version, scope, sort or values do not match.');
  return [...value.values];
}
function compare(a: readonly CursorValue[], b: readonly CursorValue[], sort: Order[]): number {
  for (let index = 0; index < sort.length; index++) {
    const first = a[index]!,
      second = b[index]!,
      config = sort[index]!;
    if (first === second) continue;
    if (first === null) return config.nulls === 'first' ? -1 : 1;
    if (second === null) return config.nulls === 'first' ? 1 : -1;
    if (typeof first !== typeof second)
      throw new TypeError(`Mixed primitive types in sort field ${config.field}.`);
    const result = first < second ? -1 : 1;
    return config.direction === 'asc' ? result : -result;
  }
  return 0;
}
export function paginate<T extends object>(rows: readonly T[], options: PageOptions<T>): Page<T> {
  const config = order(options.sort),
    scope = options.scope ?? 'default';
  scopeName(scope);
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 1000)
    throw new RangeError('limit must be 1..1000.');
  const maxRecords = options.maxRecords ?? 100000;
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 1000000)
    throw new RangeError('maxRecords must be 1..1000000.');
  if (!Array.isArray(rows) || rows.length > maxRecords)
    throw new RangeError('rows must be an array within maxRecords.');
  if (options.after !== undefined && options.before !== undefined)
    throw new CursorError('Use after or before, not both.');
  const knownTypes: (string | undefined)[] = [];
  const indexed = rows
    .map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row))
        throw new TypeError('Rows must be objects.');
      const values = config.map((entry, index): CursorValue => {
        if (!Object.hasOwn(row, entry.field))
          throw new TypeError(`Missing own sort field: ${entry.field}.`);
        const value: unknown = Reflect.get(row, entry.field);
        if (!scalar(value))
          throw new TypeError(`Sort field ${entry.field} must be a finite JSON primitive.`);
        if (value !== null) {
          if (knownTypes[index] !== undefined && knownTypes[index] !== typeof value)
            throw new TypeError(`Mixed primitive types in sort field ${entry.field}.`);
          knownTypes[index] = typeof value;
        }
        return value;
      });
      return { row, values };
    })
    .sort((a, b) => compare(a.values, b.values, config));
  for (let i = 1; i < indexed.length; i++)
    if (compare(indexed[i - 1]!.values, indexed[i]!.values, config) === 0) {
      throw new TypeError('Sort keys are not unique; add a stable identity tie-breaker.');
    }
  let start = 0,
    end = indexed.length;
  const token = options.after ?? options.before;
  if (token !== undefined) {
    const values = decodeCursor(token, options.sort, scope);
    values.forEach((value, index) => {
      if (value !== null && knownTypes[index] !== undefined && knownTypes[index] !== typeof value)
        throw new CursorError('Cursor value type does not match the dataset.');
    });
    let low = 0,
      high = indexed.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const comparison = compare(indexed[middle]!.values, values, config);
      if (comparison < 0 || (options.after !== undefined && comparison === 0)) low = middle + 1;
      else high = middle;
    }
    if (options.after !== undefined) start = low;
    else end = low;
  }
  if (options.before !== undefined) start = Math.max(start, end - options.limit);
  else end = Math.min(end, start + options.limit);
  const selected = indexed.slice(start, end);
  return {
    items: selected.map((entry) => entry.row),
    hasNext: end < indexed.length,
    hasPrevious: start > 0,
    startCursor: selected.length ? encode(selected[0]!.values, config, scope) : null,
    endCursor: selected.length
      ? encode(selected[selected.length - 1]!.values, config, scope)
      : null,
  };
}
