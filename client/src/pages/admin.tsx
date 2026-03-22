import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Shield, KeyRound, Trash2, Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface AdminUser {
  id: string;
  username: string;
  displayName?: string;
  isAdmin: boolean;
}

export default function AdminPage({ onBack }: { onBack: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetUsername, setResetUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const [deleteUsername, setDeleteUsername] = useState("");

  const usersQuery = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { credentials: "include" });
      if (res.status === 401 || res.status === 403) {
        onBack();
        throw new Error("Session expired");
      }
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
  });

  const resetMutation = useMutation({
    mutationFn: async ({ userId, password }: { userId: string; password: string }) => {
      const res = await apiRequest("POST", `/api/admin/users/${userId}/reset-password`, { password });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Password reset successfully" });
      setResetUserId(null);
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to reset password", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("DELETE", `/api/admin/users/${userId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User deleted" });
      setDeleteUserId(null);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete user", description: err.message, variant: "destructive" });
    },
  });

  const handleResetSubmit = () => {
    if (!newPassword || newPassword.length < 4) {
      toast({ title: "Password must be at least 4 characters", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (resetUserId) {
      resetMutation.mutate({ userId: resetUserId, password: newPassword });
    }
  };

  const users = usersQuery.data || [];

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#f6f8fc" }}>
      <div className="max-w-[640px] mx-auto pt-8 px-4">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          <div className="px-6 py-5 border-b border-[#e0e0e0] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: "#c2e7ff" }}>
                <Shield className="w-5 h-5 text-[#001d35]" />
              </div>
              <div>
                <h1 className="text-lg font-medium text-[#202124]">Admin Panel</h1>
                <p className="text-xs text-[#5f6368]">Manage users and reset passwords</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={onBack}
              data-testid="button-admin-signout"
            >
              <LogOut className="h-3 w-3" />
              Sign out
            </Button>
          </div>

          {/* User list */}
          <div className="divide-y divide-[#e8eaed]">
            {usersQuery.isLoading ? (
              <div className="px-6 py-8 text-center text-sm text-[#5f6368]">Loading users...</div>
            ) : users.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-[#5f6368]">No users found</div>
            ) : (
              users.map(user => (
                <div key={user.id} className="px-6 py-4 flex items-center justify-between group hover:bg-[#f6f8fc] transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-medium" style={{ backgroundColor: user.isAdmin ? "#0b57d0" : "#5f6368" }}>
                      {(user.displayName || user.username).charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[#202124]">{user.displayName || user.username}</span>
                        {user.isAdmin && (
                          <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-[#e8f0fe] text-[#0b57d0]">Admin</span>
                        )}
                      </div>
                      <div className="text-xs text-[#5f6368]">@{user.username}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs gap-1.5"
                      onClick={() => { setResetUserId(user.id); setResetUsername(user.displayName || user.username); setNewPassword(""); setConfirmPassword(""); }}
                      data-testid={`button-reset-password-${user.id}`}
                    >
                      <KeyRound className="h-3 w-3" />
                      Reset Password
                    </Button>
                    {!user.isAdmin && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-[#5f6368] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => { setDeleteUserId(user.id); setDeleteUsername(user.displayName || user.username); }}
                        data-testid={`button-delete-user-${user.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Reset Password Dialog */}
      <Dialog open={!!resetUserId} onOpenChange={(v) => { if (!v) setResetUserId(null); }}>
        <DialogContent className="sm:max-w-[380px]" aria-describedby="reset-desc">
          <span id="reset-desc" className="sr-only">Reset the password for a user</span>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-[#5f6368]">Set a new password for <span className="font-medium text-[#202124]">{resetUsername}</span></p>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#5f6368]">New Password</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                data-testid="input-reset-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#5f6368]">Confirm Password</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                data-testid="input-reset-confirm-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResetUserId(null)}>Cancel</Button>
            <Button
              onClick={handleResetSubmit}
              disabled={!newPassword || !confirmPassword || resetMutation.isPending}
              style={{ backgroundColor: "#0b57d0" }}
              data-testid="button-reset-submit"
            >
              {resetMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteUserId} onOpenChange={(v) => { if (!v) setDeleteUserId(null); }}>
        <DialogContent className="sm:max-w-[380px]" aria-describedby="delete-desc">
          <span id="delete-desc" className="sr-only">Confirm user deletion</span>
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-[#5f6368]">
              Are you sure you want to delete <span className="font-medium text-[#202124]">{deleteUsername}</span>? This will remove their account but their data files will remain on disk.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteUserId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => { if (deleteUserId) deleteMutation.mutate(deleteUserId); }}
              disabled={deleteMutation.isPending}
              data-testid="button-delete-confirm"
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
