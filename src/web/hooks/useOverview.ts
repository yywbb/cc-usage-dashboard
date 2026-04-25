import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import type { OverviewResponse, RangeKey, TrendGranularity } from '../../shared/types.js';

export function useOverview(range: RangeKey, granularity: TrendGranularity = 'day') {
  return useQuery({
    queryKey: ['overview', range, granularity],
    queryFn: () => api.get<OverviewResponse>(`/api/overview?range=${range}&granularity=${granularity}`),
  });
}
