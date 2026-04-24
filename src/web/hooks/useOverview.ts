import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import type { OverviewResponse, RangeKey } from '../../shared/types.js';

export function useOverview(range: RangeKey) {
  return useQuery({
    queryKey: ['overview', range],
    queryFn: () => api.get<OverviewResponse>(`/api/overview?range=${range}`),
  });
}
