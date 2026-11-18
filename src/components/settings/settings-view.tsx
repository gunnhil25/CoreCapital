"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  User,
  KeyRound,
  RotateCcw,
  Users,
  Plus,
  Edit3,
  Trash2,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  Database,
  Layers,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import {
  SafeUser,
  updateMyProfileAction,
  changeMyPasswordAction,
  resetMyWorkspaceAction,
  listUsersAdminAction,
  createUserAdminAction,
  updateUserAdminAction,
  resetUserPasswordAdminAction,
  resetUserWorkspaceAdminAction,
  deleteUserAdminAction,
} from "@/actions/auth";

interface SettingsViewProps {
  currentUser: SafeUser;
  initialUsers: SafeUser[];
}

export function SettingsView({ currentUser, initialUsers }: SettingsViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState("account");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );

  // My Account state
  const [myName, setMyName] = useState(currentUser.name);
  const [myEmail, setMyEmail] = useState(currentUser.email);
  const [myCurrency, setMyCurrency] = useState(currentUser.baseCurrency);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  // Self workspace reset confirmation
  const [selfResetMode, setSelfResetMode] = useState<"clean" | "demo" | null>(null);

  // Admin Users list & modals
  const [usersList, setUsersList] = useState<SafeUser[]>(initialUsers);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"user" | "admin">("user");
  const [newUserSeedMode, setNewUserSeedMode] = useState<"clean" | "demo">("clean");

  const [editTarget, setEditTarget] = useState<SafeUser | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<"user" | "admin">("user");
  const [editIsActive, setEditIsActive] = useState(true);

  const [passwordTarget, setPasswordTarget] = useState<SafeUser | null>(null);
  const [adminNewPassword, setAdminNewPassword] = useState("");

  const [resetTarget, setResetTarget] = useState<SafeUser | null>(null);
  const [adminResetMode, setAdminResetMode] = useState<"clean" | "demo">("clean");

  const [deleteTarget, setDeleteTarget] = useState<SafeUser | null>(null);

  const refreshUsersList = async () => {
    const res = await listUsersAdminAction();
    if (res.success) {
      setUsersList(res.users);
    }
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    startTransition(async () => {
      const res = await updateMyProfileAction({
        name: myName,
        email: myEmail,
        baseCurrency: myCurrency,
      });

      if (res.success) {
        setFeedback({ type: "success", text: "Profile details updated." });
        if (currentUser.role === "admin") {
          await refreshUsersList();
        }
        router.refresh();
      } else {
        setFeedback({ type: "error", text: res.error || "Failed to update profile." });
      }
    });
  };

  const handleChangeMyPassword = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (newPassword.length < 8) {
      setFeedback({ type: "error", text: "New password must be at least 8 characters long." });
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setFeedback({ type: "error", text: "New passwords do not match." });
      return;
    }

    startTransition(async () => {
      const res = await changeMyPasswordAction({
        currentPassword,
        newPassword,
      });

      if (res.success) {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmNewPassword("");
        setFeedback({
          type: "success",
          text: "Password updated and other active sessions revoked.",
        });
      } else {
        setFeedback({ type: "error", text: res.error || "Failed to change password." });
      }
    });
  };

  const handleConfirmSelfReset = () => {
    if (!selfResetMode) return;
    setFeedback(null);

    startTransition(async () => {
      const res = await resetMyWorkspaceAction(selfResetMode);
      const modeLabel = selfResetMode === "clean" ? "Clean Slate ($0.00)" : "Demo Dataset";
      setSelfResetMode(null);

      if (res.success) {
        setFeedback({
          type: "success",
          text: `Your financial ledger has been reset to: ${modeLabel}.`,
        });
        router.refresh();
      } else {
        setFeedback({ type: "error", text: res.error || "Failed to reset workspace." });
      }
    });
  };

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    startTransition(async () => {
      const res = await createUserAdminAction({
        name: newUserName,
        email: newUserEmail,
        password: newUserPassword,
        role: newUserRole,
        seedMode: newUserSeedMode,
      });

      if (res.success && res.user) {
        setUsersList((prev) => [...prev, res.user!]);
        setIsCreateOpen(false);
        setNewUserName("");
        setNewUserEmail("");
        setNewUserPassword("");
        setNewUserRole("user");
        setNewUserSeedMode("clean");
        setFeedback({ type: "success", text: `User ${res.user.email} created.` });
      } else {
        setFeedback({ type: "error", text: res.error || "Failed to create user." });
      }
    });
  };

  const openEditModal = (u: SafeUser) => {
    setEditTarget(u);
    setEditName(u.name);
    setEditEmail(u.email);
    setEditRole(u.role);
    setEditIsActive(u.isActive);
  };

  const handleSaveEditUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setFeedback(null);

    startTransition(async () => {
      const res = await updateUserAdminAction({
        targetUserId: editTarget.id,
        name: editName,
        email: editEmail,
        role: editRole,
        isActive: editIsActive,
      });

      if (res.success && res.user) {
        setUsersList((prev) => prev.map((u) => (u.id === res.user!.id ? res.user! : u)));
        setEditTarget(null);
        setFeedback({ type: "success", text: `Updated user ${res.user.name}.` });
        router.refresh();
      } else {
        setFeedback({ type: "error", text: res.error || "Failed to update user." });
      }
    });
  };

  const handleAdminResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordTarget) return;
    setFeedback(null);

    startTransition(async () => {
      const res = await resetUserPasswordAdminAction({
        targetUserId: passwordTarget.id,
        newPassword: adminNewPassword,
      });

      if (res.success) {
        setFeedback({
          type: "success",
          text: `Password reset for ${passwordTarget.email}. All previous sessions invalidated.`,
        });
        setPasswordTarget(null);
        setAdminNewPassword("");
      } else {
        setFeedback({ type: "error", text: res.error || "Failed to reset user password." });
      }
    });
  };

  const handleAdminResetWorkspace = () => {
    if (!resetTarget) return;
    setFeedback(null);

    startTransition(async () => {
      const res = await resetUserWorkspaceAdminAction({
        targetUserId: resetTarget.id,
        seedMode: adminResetMode,
      });

      if (res.success) {
        setFeedback({
          type: "success",
          text: `Reset ledger workspace (${adminResetMode}) for ${resetTarget.email}.`,
        });
        setResetTarget(null);
        router.refresh();
      } else {
        setFeedback({ type: "error", text: res.error || "Failed to reset user workspace." });
      }
    });
  };

  const handleConfirmDeleteUser = () => {
    if (!deleteTarget) return;
    setFeedback(null);

    startTransition(async () => {
      const res = await deleteUserAdminAction(deleteTarget.id);
      if (res.success) {
        setUsersList((prev) => prev.filter((u) => u.id !== deleteTarget.id));
        setFeedback({
          type: "success",
          text: `User ${deleteTarget.email} and all associated ledger records deleted.`,
        });
        setDeleteTarget(null);
      } else {
        setFeedback({ type: "error", text: res.error || "Failed to delete user." });
      }
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          Settings & User Management
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
          Account security, ledger workspace resets, and administrator user directory
        </p>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-lg border text-xs sm:text-sm flex items-center justify-between ${
            feedback.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
              : "bg-destructive/10 border-destructive/30 text-destructive"
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-xs opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-muted/60 p-1">
          <TabsTrigger value="account" className="text-xs gap-1.5">
            <User className="h-3.5 w-3.5" />
            My Account & Workspace
          </TabsTrigger>
          {currentUser.role === "admin" && (
            <TabsTrigger value="users" className="text-xs gap-1.5">
              <Users className="h-3.5 w-3.5" />
              User Management ({usersList.length})
            </TabsTrigger>
          )}
        </TabsList>

        {/* TAB 1: MY ACCOUNT & WORKSPACE */}
        <TabsContent value="account" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Profile Settings */}
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="h-4 w-4 text-sky-500" />
                  Profile Details
                </CardTitle>
                <CardDescription className="text-xs">
                  Update your display name, login email, and base display currency.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSaveProfile} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Full Name</Label>
                    <Input
                      value={myName}
                      onChange={(e) => setMyName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Email Address</Label>
                    <Input
                      type="email"
                      value={myEmail}
                      onChange={(e) => setMyEmail(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Base Currency</Label>
                    <select
                      value={myCurrency}
                      onChange={(e) => setMyCurrency(e.target.value)}
                      className="w-full h-9 rounded-lg border border-input bg-background px-3 text-xs font-mono"
                    >
                      <option value="AUD">AUD ($)</option>
                      <option value="USD">USD ($)</option>
                      <option value="NZD">NZD ($)</option>
                      <option value="GBP">GBP (£)</option>
                      <option value="EUR">EUR (€)</option>
                    </select>
                  </div>

                  <div className="flex justify-end pt-2">
                    <Button type="submit" size="sm" disabled={isPending}>
                      {isPending ? "Saving..." : "Save Profile"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            {/* Change Password */}
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-indigo-500" />
                  Security & Password
                </CardTitle>
                <CardDescription className="text-xs">
                  Changing your password automatically invalidates sessions on all other devices.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleChangeMyPassword} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Current Password</Label>
                    <Input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>New Password (min 8 chars)</Label>
                    <Input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      minLength={8}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Confirm New Password</Label>
                    <Input
                      type="password"
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      minLength={8}
                      required
                    />
                  </div>

                  <div className="flex justify-end pt-2">
                    <Button type="submit" size="sm" disabled={isPending}>
                      {isPending ? "Updating..." : "Update Password"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>

          {/* Account Financial Reset */}
          <Card className="border-destructive/30 bg-destructive/5">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <RotateCcw className="h-4 w-4 text-destructive" />
                Account Financial Ledger Reset
              </CardTitle>
              <CardDescription className="text-xs">
                Wipes your transactions, accounts, budgets, subscriptions, and import batches while keeping your login credentials intact.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col sm:flex-row gap-3">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setSelfResetMode("clean")}
                className="gap-1.5"
              >
                <Layers className="h-3.5 w-3.5" />
                Reset to Clean Slate ($0.00)
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelfResetMode("demo")}
                className="gap-1.5"
              >
                <Database className="h-3.5 w-3.5" />
                Reset & Reload Demo Data
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: USER MANAGEMENT (ADMIN ONLY) */}
        {currentUser.role === "admin" && (
          <TabsContent value="users" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Each user has an isolated financial ledger, accounts, budgets, and goals.
              </p>
              <Button size="sm" onClick={() => setIsCreateOpen(true)} className="gap-1.5">
                <Plus className="h-4 w-4" />
                Create User
              </Button>
            </div>

            <Card className="border-border/60 overflow-hidden">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden md:table-cell">Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usersList.map((u) => {
                      const isSelf = u.id === currentUser.id;
                      return (
                        <TableRow key={u.id}>
                          <TableCell>
                            <div className="font-semibold text-xs sm:text-sm flex items-center gap-1.5">
                              <span>{u.name}</span>
                              {isSelf && (
                                <Badge variant="outline" className="text-[9px] py-0">
                                  You
                                </Badge>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground font-mono">
                              {u.email}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={u.role === "admin" ? "info" : "outline"}
                              className="text-[9px] uppercase font-mono py-0"
                            >
                              {u.role}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={u.isActive ? "success" : "destructive"}
                              className="text-[9px] uppercase font-mono py-0"
                            >
                              {u.isActive ? "Active" : "Disabled"}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-xs font-mono text-muted-foreground">
                            {formatDate(u.createdAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="inline-flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => openEditModal(u)}
                                title="Edit user details"
                              >
                                <Edit3 className="h-3.5 w-3.5 mr-1" />
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => {
                                  setPasswordTarget(u);
                                  setAdminNewPassword("");
                                }}
                                title="Reset password"
                              >
                                <KeyRound className="h-3.5 w-3.5 mr-1" />
                                Password
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => {
                                  setResetTarget(u);
                                  setAdminResetMode("clean");
                                }}
                                title="Reset user ledger"
                              >
                                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                                Reset
                              </Button>
                              {!isSelf && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                                  onClick={() => setDeleteTarget(u)}
                                  title="Delete user"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Self Reset Confirmation Modal */}
      {selfResetMode && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border rounded-xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5 shrink-0" />
              <h3 className="text-base font-bold text-foreground">
                Confirm Workspace Reset
              </h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              This will permanently erase all of your transactions, accounts, budgets, subscriptions, and import history, and initialize a{" "}
              <strong>
                {selfResetMode === "clean" ? "Clean Slate ($0.00)" : "Demo Dataset"}
              </strong>{" "}
              workspace. Your login credentials will remain unchanged.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelfResetMode(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isPending}
                onClick={handleConfirmSelfReset}
              >
                {isPending ? "Resetting..." : "Confirm Reset"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Admin: Create User Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border rounded-xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-bold">Create User Account</h3>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div className="space-y-1">
                <Label>Full Name</Label>
                <Input
                  placeholder="Jordan Lee"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1">
                <Label>Email</Label>
                <Input
                  type="email"
                  placeholder="jordan@domain.local"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1">
                <Label>Initial Password (min 8 chars)</Label>
                <Input
                  type="password"
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Role</Label>
                  <select
                    value={newUserRole}
                    onChange={(e) => setNewUserRole(e.target.value as "user" | "admin")}
                    className="w-full h-9 rounded-lg border border-input bg-background px-3 text-xs"
                  >
                    <option value="user">Standard User</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <Label>Initial Data</Label>
                  <select
                    value={newUserSeedMode}
                    onChange={(e) => setNewUserSeedMode(e.target.value as "clean" | "demo")}
                    className="w-full h-9 rounded-lg border border-input bg-background px-3 text-xs"
                  >
                    <option value="clean">Clean Slate</option>
                    <option value="demo">Demo Data</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCreateOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? "Creating..." : "Create User"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin: Edit User Modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border rounded-xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-bold">Edit User Details</h3>
              <button
                onClick={() => setEditTarget(null)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEditUser} className="space-y-4">
              <div className="space-y-1">
                <Label>Full Name</Label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Role</Label>
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as "user" | "admin")}
                    className="w-full h-9 rounded-lg border border-input bg-background px-3 text-xs"
                  >
                    <option value="user">Standard User</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <Label>Account Status</Label>
                  <select
                    value={editIsActive ? "active" : "disabled"}
                    onChange={(e) => setEditIsActive(e.target.value === "active")}
                    className="w-full h-9 rounded-lg border border-input bg-background px-3 text-xs"
                  >
                    <option value="active">Active</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditTarget(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin: Reset User Password Modal */}
      {passwordTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border rounded-xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-bold">Reset User Password</h3>
              <button
                onClick={() => setPasswordTarget(null)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Set a new password for <strong>{passwordTarget.email}</strong>. Existing sessions for this user will be immediately invalidated.
            </p>
            <form onSubmit={handleAdminResetPassword} className="space-y-4">
              <div className="space-y-1">
                <Label>New Password (min 8 chars)</Label>
                <Input
                  type="password"
                  value={adminNewPassword}
                  onChange={(e) => setAdminNewPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPasswordTarget(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? "Resetting..." : "Set Password"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin: Reset User Ledger Modal */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border rounded-xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-amber-500">
              <RotateCcw className="h-5 w-5 shrink-0" />
              <h3 className="text-base font-bold text-foreground">
                Reset User Ledger Workspace
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Choose how to re-initialize financial data for <strong>{resetTarget.email}</strong>:
            </p>
            <div className="space-y-1.5">
              <Label>Reset Target</Label>
              <select
                value={adminResetMode}
                onChange={(e) => setAdminResetMode(e.target.value as "clean" | "demo")}
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-xs"
              >
                <option value="clean">Clean Slate ($0.00 Checking + Default Categories)</option>
                <option value="demo">Demo Dataset (Sample Accounts & Transactions)</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" size="sm" onClick={() => setResetTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isPending}
                onClick={handleAdminResetWorkspace}
              >
                {isPending ? "Resetting..." : "Reset Workspace"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Admin: Delete User Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border rounded-xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5 shrink-0" />
              <h3 className="text-base font-bold text-foreground">Delete User Account</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Permanently delete <strong>{deleteTarget.name}</strong> ({deleteTarget.email}) and cascade-delete all of their accounts, transactions, budgets, and goals? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isPending}
                onClick={handleConfirmDeleteUser}
              >
                {isPending ? "Deleting..." : "Delete User"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
