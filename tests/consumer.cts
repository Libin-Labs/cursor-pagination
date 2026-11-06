import { paginate } from '@lp-labs/cursor-pagination';
const result = paginate([{ id: 1 }], { sort: [{ field: 'id' }], limit: 1 });
const id: number | undefined = result.items[0]?.id;
void id;
