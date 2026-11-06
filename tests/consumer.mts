import { paginate, encodeCursor, decodeCursor, CursorError } from '@lp-labs/cursor-pagination';
import type { Page, SortField } from '@lp-labs/cursor-pagination';
interface Row {
  id: number;
  name: string | null;
}
const sort: SortField<Row>[] = [{ field: 'name', direction: 'asc' }, { field: 'id' }];
const result: Page<Row> = paginate<Row>([{ id: 1, name: null }], { sort, limit: 10 });
const token: string = encodeCursor<Row>(['Ada', 1], sort);
decodeCursor<Row>(token, sort);
void result;
void CursorError;
// @ts-expect-error unknown sort field
paginate<Row>([], { sort: [{ field: 'missing' }], limit: 10 });
// @ts-expect-error invalid direction
encodeCursor<Row>([1], [{ field: 'id', direction: 'up' }]);
