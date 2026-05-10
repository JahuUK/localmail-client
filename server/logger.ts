export type LogLevel = "info" | "warn" | "error" | "success";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
}

const MAX_LOGS = 2000;
export const userLogs: Map<string, LogEntry[]> = new Map();

export function addLog(userId: string, level: LogLevel, source: string, message: string): void {
  if (!userLogs.has(userId)) userLogs.set(userId, []);
  const logs = userLogs.get(userId)!;
  logs.push({ timestamp: new Date().toISOString(), level, source, message });
  if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
}
