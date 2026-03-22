import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Mail, UserPlus, Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SetupPage({ onSetup, onBack, isFirstUser }: {
  onSetup: () => void;
  onBack?: () => void;
  isFirstUser?: boolean;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");

  const endpoint = isFirstUser ? "/api/auth/setup" : "/api/auth/register-public";

  const setupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", endpoint, {
        username,
        password,
        displayName: displayName || username,
      });
      return res.json();
    },
    onSuccess: () => {
      setError("");
      onSetup();
    },
    onError: (err: Error) => {
      setError(err.message.replace(/^\d+:\s*/, ""));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError("Please fill in all required fields");
      return;
    }
    if (username.length < 3) {
      setError("Username must be at least 3 characters");
      return;
    }
    if (password.length < 4) {
      setError("Password must be at least 4 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setupMutation.mutate();
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#f6f8fc" }}>
      <div className="w-full max-w-[440px] mx-4">
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <div className="flex flex-col items-center mb-6">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: "#c2e7ff" }}>
              <Mail className="w-7 h-7 text-[#001d35]" />
            </div>
            <h1 className="text-2xl font-medium text-[#202124]" data-testid="text-setup-title">
              {isFirstUser ? "Welcome to LocalMail" : "Create Account"}
            </h1>
            <p className="text-sm text-[#5f6368] mt-1 text-center">
              {isFirstUser ? "Create your first account to get started" : "Set up a new LocalMail account"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-[#5f6368]">Display Name</Label>
              <Input
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); setError(""); }}
                placeholder="Your name (optional)"
                data-testid="input-setup-display-name"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-[#5f6368]">Username <span className="text-red-500">*</span></Label>
              <Input
                value={username}
                onChange={(e) => { setUsername(e.target.value); setError(""); }}
                placeholder="Choose a username"
                autoFocus
                data-testid="input-setup-username"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-[#5f6368]">Password <span className="text-red-500">*</span></Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                placeholder="Choose a password"
                data-testid="input-setup-password"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-[#5f6368]">Confirm Password <span className="text-red-500">*</span></Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setError(""); }}
                placeholder="Confirm your password"
                data-testid="input-setup-confirm-password"
              />
            </div>

            {error && (
              <div className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg" data-testid="text-setup-error">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full rounded-full"
              style={{ backgroundColor: "#0b57d0" }}
              disabled={setupMutation.isPending}
              data-testid="button-setup-create"
            >
              {setupMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <UserPlus className="h-4 w-4 mr-2" />
              )}
              {setupMutation.isPending ? "Creating account..." : "Create Account"}
            </Button>
          </form>

          {onBack && (
            <button
              onClick={onBack}
              className="w-full flex items-center justify-center gap-2 mt-4 text-sm text-[#0b57d0] hover:text-[#1a73e8] transition-colors"
              data-testid="button-setup-back"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
