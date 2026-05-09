import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import type { OverviewResponse, RangeKey, TrendGranularity } from '../../shared/types.js';
import type { SourceFilter } from '../store.js';

export function useOverview(
  range: RangeKey,
  granularity: TrendGranularity = 'day',
  sourceFilter: SourceFilter = 'all',
) {
  const sourceParam = sourceFilter !== 'all' ? `&source=${sourceFilter}` : '';
  return useQuery({
    queryKey: ['overview', range, granularity, sourceFilter],
    queryFn: () => api.get<OverviewResponse>(
      `/api/overview?range=${range}&granularity=${granularity}${sourceParam}`,
    ),
  });
}
