import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Trash2, Loader2, AlertCircle, Code, Pause, Play, Download, ArrowDown } from "lucide-react";
import localMailLogo from "@/assets/localmail.png";

type LogEntry = {
  timestamp: string;
  level: "info" | "warn" | "error" | "success";
  source: string;
  message: string;
};

const levelColor = (level: LogEntry["level"]) => {
  switch (level) {
    case "error": return "text-red-400";
    case "warn": return "text-yellow-400";
    case "success": return "text-green-400";
    default: return "text-gray-400";
  }
};

const levelBadge = (level: LogEntry["level"]) => {
  switch (level) {
    case "error": return "ERR";
    case "warn": return "WRN";
    case "success": return "OK ";
    default: return "INF";
  }
};

const levelFilterLabel = (level: string) => {
  switch (level) {
    case "error": return "Errors";
    case "warn": return "Warnings";
    case "success": return "Success";
    case "info": return "Info";
    default: return level;
  }
};

export default function LogsPage() {
  const queryClient = useQueryClient();
  const [autoScroll, setAutoScroll] = useState(true);
  const [paused, setPaused] = useState(false);
  const [filterLevel, setFilterLevel] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [searchText, setSearchText] = useState("");
  const logEndRef = useRef<HTMLDivElement>(null);

  const { data: logs = [], isLoading, isError, refetch } = useQuery<LogEntry[]>({
    queryKey: ["logs"],
    queryFn: () => apiRequest("GET", "/api/logs").then(r => r.json()),
    refetchInterval: paused ? false : 2000,
  });

  const clearMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/logs"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["logs"] }),
  });

  useEffect(() => {
    if (autoScroll && !paused) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs.length, autoScroll, paused]);

  const sources = Array.from(new Set(logs.map(l => l.source))).sort();

  const filteredLogs = logs.filter(log => {
    if (filterLevel !== "all" && log.level !== filterLevel) return false;
    if (filterSource !== "all" && log.source !== filterSource) return false;
    if (searchText) {
      const q = searchText.toLowerCase();
      if (!log.message.toLowerCase().includes(q) && !log.source.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const exportLogs = () => {
    const lines = filteredLogs.map(log => {
      const ts = new Date(log.timestamp);
      const dateStr = ts.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const timeStr = ts.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
      return `${dateStr} ${timeStr} [${levelBadge(log.level).trim()}] ${log.source} ${log.message}`;
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `localmail-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const errorCount = logs.filter(l => l.level === "error").length;
  const warnCount = logs.filter(l => l.level === "warn").length;

  return (
    <div className="h-screen flex flex-col bg-[#1e1e1e] text-gray-300" data-testid="page-logs-standalone">
      <header className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-[#404040] shrink-0">
        <div className="flex items-center gap-3">
          <img src={localMailLogo} alt="LocalMail" className="h-6 w-6" />
          <h1 className="text-sm font-medium text-gray-200">LocalMail Activity Logs</h1>
          <div className="flex items-center gap-2 ml-4 text-xs">
            <span className="text-gray-500">{filteredLogs.length} of {logs.length} entries</span>
            {errorCount > 0 && <span className="text-red-400">{errorCount} errors</span>}
            {warnCount > 0 && <span className="text-yellow-400">{warnCount} warnings</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPaused(!paused)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              paused ? "bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30" : "bg-[#404040] text-gray-300 hover:bg-[#505050]"
            }`}
            title={paused ? "Resume auto-refresh" : "Pause auto-refresh"}
            data-testid="button-pause-logs"
          >
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              autoScroll ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30" : "bg-[#404040] text-gray-300 hover:bg-[#505050]"
            }`}
            title={autoScroll ? "Disable auto-scroll" : "Enable auto-scroll"}
            data-testid="button-autoscroll"
          >
            <ArrowDown className="w-3.5 h-3.5" />
            Auto-scroll
          </button>
          <button
            onClick={exportLogs}
            disabled={filteredLogs.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#404040] text-gray-300 hover:bg-[#505050] disabled:opacity-40 disabled:cursor-default"
            title="Export logs"
            data-testid="button-export-logs"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
          <button
            onClick={() => clearMutation.mutate()}
            disabled={logs.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-40 disabled:cursor-default"
            title="Clear all logs"
            data-testid="button-clear-logs"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
        </div>
      </header>

      <div className="flex items-center gap-3 px-4 py-2 bg-[#252525] border-b border-[#404040] shrink-0">
        <input
          type="text"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          placeholder="Search logs..."
          className="bg-[#1e1e1e] border border-[#404040] rounded px-3 py-1.5 text-xs text-gray-300 placeholder:text-gray-600 w-64 focus:outline-none focus:border-blue-500"
          data-testid="input-search-logs"
        />
        <select
          value={filterLevel}
          onChange={e => setFilterLevel(e.target.value)}
          className="bg-[#1e1e1e] border border-[#404040] rounded px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
          data-testid="select-filter-level"
        >
          <option value="all">All levels</option>
          <option value="error">Errors only</option>
          <option value="warn">Warnings only</option>
          <option value="success">Success only</option>
          <option value="info">Info only</option>
        </select>
        <select
          value={filterSource}
          onChange={e => setFilterSource(e.target.value)}
          className="bg-[#1e1e1e] border border-[#404040] rounded px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
          data-testid="select-filter-source"
        >
          <option value="all">All sources</option>
          {sources.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {(filterLevel !== "all" || filterSource !== "all" || searchText) && (
          <button
            onClick={() => { setFilterLevel("all"); setFilterSource("all"); setSearchText(""); }}
            className="text-xs text-blue-400 hover:underline"
            data-testid="button-clear-filters"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto font-mono text-xs">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading logs...
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <AlertCircle className="w-8 h-8 mb-2 text-red-400 opacity-70" />
            <p className="text-sm">Failed to load logs — are you logged in?</p>
            <button onClick={() => refetch()} className="text-blue-400 text-xs mt-2 hover:underline">Retry</button>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Code className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">{logs.length === 0 ? "No log entries yet" : "No matching entries"}</p>
            <p className="text-[10px] mt-1 opacity-60">
              {logs.length === 0 ? "Events will appear here as they occur" : "Try adjusting your filters"}
            </p>
          </div>
        ) : (
          <div className="p-3 space-y-0.5">
            {filteredLogs.map((log, i) => {
              const ts = new Date(log.timestamp);
              const timeStr = ts.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
              const dateStr = ts.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              return (
                <div key={i} className="flex gap-2 leading-5 hover:bg-white/5 px-1 rounded" data-testid={`log-entry-${i}`}>
                  <span className="text-gray-600 shrink-0">{dateStr} {timeStr}</span>
                  <span className={`shrink-0 font-bold ${levelColor(log.level)}`}>[{levelBadge(log.level)}]</span>
                  <span className="text-blue-400 shrink-0">{log.source}</span>
                  <span className="text-gray-300 break-all">{log.message}</span>
                </div>
              );
            })}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      {paused && (
        <div className="px-4 py-1.5 bg-yellow-500/10 border-t border-yellow-500/30 text-center text-xs text-yellow-400 shrink-0">
          Auto-refresh paused
        </div>
      )}
    </div>
  );
}
