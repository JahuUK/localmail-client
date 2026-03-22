import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryClient as qc } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Inbox from "@/pages/inbox";
import LoginPage from "@/pages/login";
import SetupPage from "@/pages/setup";
import WelcomePage from "@/pages/welcome";
import AdminPage from "@/pages/admin";
import LogsPage from "@/pages/logs";

type AuthScreen = "welcome" | "login" | "register" | "admin";

function AppContent() {
  const queryClient = useQueryClient();
  const [authKey, setAuthKey] = useState(0);
  const [authScreen, setAuthScreen] = useState<AuthScreen>("welcome");

  if (window.location.pathname === "/logs") {
    return <LogsPage />;
  }

  const refresh = useCallback(() => {
    setAuthKey(k => k + 1);
  }, []);

  const setupQuery = useQuery<{ setupNeeded: boolean }>({
    queryKey: ["/api/auth/setup-needed", authKey],
    queryFn: async () => {
      const res = await fetch("/api/auth/setup-needed", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to check setup status");
      return res.json();
    },
    retry: false,
  });

  const meQuery = useQuery<{ id: string; username: string; displayName?: string; isAdmin?: boolean } | null>({
    queryKey: ["/api/auth/me", authKey],
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error("Failed to check auth status");
      return res.json();
    },
    retry: false,
  });

  const isLoading = setupQuery.isLoading || meQuery.isLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#f6f8fc" }}>
        <div className="text-sm text-[#5f6368]">Loading...</div>
      </div>
    );
  }

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    queryClient.clear();
    setAuthScreen("welcome");
    refresh();
  };

  if (meQuery.data && authScreen === "admin") {
    return <AdminPage onBack={handleLogout} />;
  }

  if (meQuery.data && authScreen !== "admin") {
    return <Inbox user={meQuery.data} onLogout={handleLogout} />;
  }

  const isFirstUser = setupQuery.data?.setupNeeded === true;

  if (isFirstUser) {
    return <SetupPage isFirstUser onSetup={refresh} />;
  }

  if (authScreen === "login") {
    return (
      <LoginPage
        onLogin={refresh}
        onBack={() => setAuthScreen("welcome")}
        onAdminLogin={() => { setAuthScreen("admin"); refresh(); }}
      />
    );
  }

  if (authScreen === "register") {
    return <SetupPage onSetup={refresh} onBack={() => setAuthScreen("welcome")} />;
  }

  return (
    <WelcomePage
      onChooseLogin={() => setAuthScreen("login")}
      onChooseRegister={() => setAuthScreen("register")}
    />
  );
}

function App() {
  return (
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <Toaster />
        <AppContent />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
