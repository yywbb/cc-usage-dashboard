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
  reasoningTokens: number;        // NEW
  stopReason: string | null;
  toolNames: string[];
  textPreview: string | null;
  source: 'claude' | 'codex';     // NEW
  originator: string | null;      // NEW
  cwdRealPath: string | null;     // NEW, Codex-specific; Claude passes null
  responseError?: boolean;
}

export interface RateLimitSnapshot {
  sessionId: string;
  observedAt: number;
  primaryUsedPct: number | null;
  primaryWindowMin: number | null;
  primaryResetsAt: number | null;
  secondaryUsedPct: number | null;
  secondaryWindowMin: number | null;
  secondaryResetsAt: number | null;
  planType: string | null;
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
    successfulResponses: number;
    failedResponses: number;
    responseAttempts: number;
    responseSuccessRate: number;
  };
  byModel: Array<{ model: string; tokens: number; costUsd: number; share: number }>;
  byProject: Array<{ projectDir: string; displayName: string; tokens: number; costUsd: number; share: number }>;
  byProvider: Array<{
    providerSlug: string;
    providerDisplayName: string;
    tokens: number;
    costUsd: number;
    share: number;
  }>;
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
    byProvider: Record<string, number>; // NEW: provider slug → tokens
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
    successfulResponses: number;
    failedResponses: number;
    responseAttempts: number;
    responseSuccessRate: number;
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
  /** 'claude' | 'codex' — added by Task 10 */
  source: string | null;
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
  /** Reasoning tokens (Codex / o-series models) */
  reasoningTokens: number;
  source: string | null;
  originator: string | null;
}

export interface SessionRateLimit {
  observedAt: number;
  primaryUsedPct: number | null;
  primaryWindowMin: number | null;
  primaryResetsAt: number | null;
  secondaryUsedPct: number | null;
  secondaryWindowMin: number | null;
  secondaryResetsAt: number | null;
  planType: string | null;
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

export interface MonitorRules {
  /** Codex 5h primary window — fire when used_pct ≥ thresholdPct. */
  codex5h:           { enabled: boolean; thresholdPct: number };
  /** Codex 7d secondary window. */
  codex7d:           { enabled: boolean; thresholdPct: number };
  /** Today's Claude-only cost — fire when running cost ≥ thresholdUsd. */
  todayCostClaude:   CostMonitorRule;
  /** Today's Codex-only cost — fire when running cost ≥ thresholdUsd. */
  todayCostCodex:    CostMonitorRule;
}

export interface CostMonitorRule {
  enabled: boolean;
  thresholdUsd: number;
  /** Alert once per reached percentage step of thresholdUsd. */
  stepPercents: number[];
}

export interface MonitorConfig {
  /** Master switch — when false, the interval scan is paused entirely. */
  enabled:          boolean;
  /** Scan + evaluate cadence in minutes. */
  intervalMinutes:  number;
  /** Suppress repeat alerts for the same rule for this long. */
  cooldownMinutes:  number;
  rules:            MonitorRules;
}

export interface MonitorAlert {
  ruleId: string;
  /** Pre-rendered Chinese title — used by desktop notifications and as a fallback. */
  title:  string;
  /** Pre-rendered Chinese body — used by desktop notifications and as a fallback. */
  body:   string;
  /** i18n key for the title (web UI translates with `vars`). */
  titleKey?: string;
  /** i18n key for the body. */
  bodyKey?:  string;
  /** Variables for the i18n template interpolation. */
  vars?: Record<string, string | number>;
}
