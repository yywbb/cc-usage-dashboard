export interface ParsedMessage {
  messageId: string;
  sessionId: string;
  parentUuid: string | null;
  role: 'user' | 'assistant';
  model: string | null;
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  stopReason: string | null;
  toolNames: string[];
  textPreview: string | null;
}

export interface ScanResult {
  scannedFiles: number;
  newMessages: number;
  durationMs: number;
}

export interface OverviewResponse {
  range: { from: string; to: string };
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheCreate: number;
    cacheRead: number;
    costUsd: number;
    messageCount: number;
    sessionCount: number;
  };
  byModel: Array<{ model: string; tokens: number; costUsd: number; share: number }>;
  byProject: Array<{ projectDir: string; displayName: string; tokens: number; costUsd: number; share: number }>;
  byTool: Array<{ tool: string; count: number }>;
  topSessions: Array<{
    sessionId: string;
    projectDir: string;
    displayName: string;
    costUsd: number;
    tokens: number;
    startedAt: number;
    messageCount: number;
  }>;
  dailyTrend: Array<{
    date: string;
    inputTokens: number;
    outputTokens: number;
    cacheCreate: number;
    cacheRead: number;
    costUsd: number;
    byModel: Record<string, number>;
  }>;
  cacheHitRate: number;
  previous: null | {
    inputTokens: number;
    outputTokens: number;
    cacheCreate: number;
    cacheRead: number;
    costUsd: number;
    messageCount: number;
    sessionCount: number;
    cacheHitRate: number;
  };
}

export interface ProjectRow {
  projectDir: string;
  displayName: string;
  realPath: string | null;
  sessionCount: number;
  totalTokens: number;
  totalCostUsd: number;
  avgTokensPerSession: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface SessionRow {
  sessionId: string;
  projectDir: string;
  startedAt: number;
  endedAt: number;
  messageCount: number;
  totalTokens: number;
  totalCostUsd: number;
  topTools: string[];
}

export interface MessageRow {
  messageId: string;
  role: 'user' | 'assistant';
  model: string | null;
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreate: number;
  cacheRead: number;
  costUsd: number;
  stopReason: string | null;
  toolNames: string[];
  textPreview: string | null;
}

export interface CostBucket {
  bucketKey: string;
  costUsd: number;
  tokens: number;
  byModel: Record<string, number>;
  byProject: Array<{ projectDir: string; costUsd: number }>;
}

export interface CostResponse {
  buckets: CostBucket[];
  anomalies: Array<{ date: string; costUsd: number; zScore: number }>;
}

export type RangeKey = 'today' | 'week' | 'month' | 'ytd' | 'all';
export type TrendGranularity = 'day' | 'hour';

export interface SessionsListStats {
  count: number;
  totalCostUsd: number;
  avgCostUsd: number;
  medianDurationMs: number;
}

export interface SessionsListResponse {
  total: number;
  items: SessionRow[];
  stats: SessionsListStats;
}
