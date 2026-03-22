import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Mail, LogIn, Loader2, ArrowLeft, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage({ onLogin, onBack, onAdminLogin }: {
  onLogin: () => void;
  onBack?: () => void;
  onAdminLogin?: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isAdminMode, setIsAdminMode] = useState(false);

  const loginMutation = useMutation({
    mutationFn: async () => {
      const endpoint = isAdminMode ? "/api/auth/admin-login" : "/api/auth/login";
      const res = await apiRequest("POST", endpoint, { username, password });
      return res.json();
    },
    onSuccess: (data: any) => {
      setError("");
      if (isAdminMode && onAdminLogin) {
        onAdminLogin();
      } else {
        onLogin();
      }
    },
    onError: (err: Error) => {
      if (err.message.includes("401")) {
        setError("Invalid username or password");
      } else if (err.message.includes("403")) {
        setError("This account does not have admin privileges");
      } else {
        setError(err.message.replace(/^\d+:\s*/, ""));
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError("Please enter both username and password");
      return;
    }
    loginMutation.mutate();
  };

  const toggleAdminMode = () => {
    setIsAdminMode(!isAdminMode);
    setError("");
    setUsername("");
    setPassword("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#f6f8fc" }}>
      <div className="w-full max-w-[400px] mx-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 relative">
          {/* Admin toggle in top-right */}
          {!isAdminMode && onAdminLogin && (
            <button
              onClick={toggleAdminMode}
              className="absolute top-4 right-4 flex items-center gap-1.5 text-[11px] text-[#5f6368] hover:text-[#0b57d0] transition-colors"
              data-testid="button-admin-mode"
            >
              <Shield className="h-3 w-3" />
              Admin
            </button>
          )}

          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: isAdminMode ? "#e8f0fe" : "#c2e7ff" }}>
              {isAdminMode ? (
                <Shield className="w-7 h-7 text-[#0b57d0]" />
              ) : (
                <Mail className="w-7 h-7 text-[#001d35]" />
              )}
            </div>
            <h1 className="text-2xl font-medium text-[#202124]" data-testid="text-login-title">
              {isAdminMode ? "Admin Login" : "LocalMail"}
            </h1>
            <p className="text-sm text-[#5f6368] mt-1">
              {isAdminMode ? "Sign in with your admin credentials" : "Sign in to your account"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-[#5f6368]">Username</Label>
              <Input
                value={username}
                onChange={(e) => { setUsername(e.target.value); setError(""); }}
                placeholder="Enter your username"
                autoFocus
                data-testid="input-login-username"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-[#5f6368]">Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                placeholder="Enter your password"
                data-testid="input-login-password"
              />
            </div>

            {error && (
              <div className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg" data-testid="text-login-error">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full rounded-full"
              style={{ backgroundColor: isAdminMode ? "#0b57d0" : "#0b57d0" }}
              disabled={loginMutation.isPending}
              data-testid="button-login"
            >
              {loginMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : isAdminMode ? (
                <Shield className="h-4 w-4 mr-2" />
              ) : (
                <LogIn className="h-4 w-4 mr-2" />
              )}
              {loginMutation.isPending ? "Signing in..." : isAdminMode ? "Sign in as Admin" : "Sign in"}
            </Button>
          </form>

          <div className="mt-4 flex items-center justify-between">
            {onBack && (
              <button
                onClick={onBack}
                className="flex items-center gap-2 text-sm text-[#0b57d0] hover:text-[#1a73e8] transition-colors"
                data-testid="button-login-back"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
            )}
            {isAdminMode && (
              <button
                onClick={toggleAdminMode}
                className="flex items-center gap-2 text-sm text-[#5f6368] hover:text-[#202124] transition-colors ml-auto"
                data-testid="button-regular-login"
              >
                Regular sign in
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
