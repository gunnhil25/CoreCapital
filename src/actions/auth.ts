"use server";

import { revalidatePath } from "next/cache";
import { store, UserRecord } from "@/lib/store";
import {
  clearSessionCookie,
  getSessionPayload,
  hashPassword,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";

export type SafeUser = Omit<UserRecord, "passwordHash">;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeUser(user: UserRecord): SafeUser {
  const { passwordHash: _ph, ...safe } = user;
  return safe;
}

function revalidateAllWorkspacePaths() {
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/ingest");
  revalidatePath("/accounts");
  revalidatePath("/budgets");
  revalidatePath("/subscriptions");
  revalidatePath("/cash-flow");
  revalidatePath("/property-goals");
  revalidatePath("/rules");
  revalidatePath("/settings");
}

export async function getAuthStatusAction(): Promise<{
  initialized: boolean;
  user: SafeUser | null;
}> {
  const userCount = await store.getUserCount();
  if (userCount === 0) {
    return { initialized: false, user: null };
  }

  const session = await getSessionPayload();
  if (!session) {
    return { initialized: true, user: null };
  }

  const user = await store.getUserById(session.userId);
  if (!user || !user.isActive || user.sessionVersion !== session.sessionVersion) {
    return { initialized: true, user: null };
  }

  return { initialized: true, user: sanitizeUser(user) };
}

export async function setupInitialAdminAction(input: {
  name: string;
  email: string;
  password: string;
  baseCurrency?: string;
  seedMode: "clean" | "demo";
}): Promise<{ success: boolean; user?: SafeUser; error?: string }> {
  try {
    const existingCount = await store.getUserCount();
    if (existingCount > 0) {
      return {
        success: false,
        error: "CoreCapital is already initialized. Please sign in instead.",
      };
    }

    const name = input.name?.trim() || "";
    const email = input.email?.trim().toLowerCase() || "";
    const password = input.password || "";

    if (name.length < 2) {
      return { success: false, error: "Full name must be at least 2 characters." };
    }
    if (!EMAIL_REGEX.test(email)) {
      return { success: false, error: "Please enter a valid email address." };
    }
    if (password.length < 8) {
      return { success: false, error: "Password must be at least 8 characters long." };
    }

    const passwordHash = hashPassword(password);
    const admin = await store.createUserWithWorkspace({
      name,
      email,
      passwordHash,
      role: "admin",
      baseCurrency: input.baseCurrency || "AUD",
      seedMode: input.seedMode === "demo" ? "demo" : "clean",
    });

    await setSessionCookie({
      userId: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      sessionVersion: admin.sessionVersion,
    });

    revalidatePath("/setup");
    revalidateAllWorkspacePaths();

    return { success: true, user: sanitizeUser(admin) };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Failed to initialize CoreCapital admin account.",
    };
  }
}

export async function loginAction(input: {
  email: string;
  password: string;
}): Promise<{ success: boolean; user?: SafeUser; error?: string }> {
  try {
    const email = input.email?.trim().toLowerCase() || "";
    const password = input.password || "";

    if (!email || !password) {
      return { success: false, error: "Email and password are required." };
    }

    const user = await store.getUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return { success: false, error: "Invalid email or password." };
    }

    if (!user.isActive) {
      return {
        success: false,
        error: "This account has been deactivated by an administrator.",
      };
    }

    await store.updateLastLogin(user.id);
    await setSessionCookie({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      sessionVersion: user.sessionVersion,
    });

    revalidatePath("/login");
    revalidateAllWorkspacePaths();

    return { success: true, user: sanitizeUser(user) };
  } catch (error: any) {
    return { success: false, error: error?.message || "Sign in failed." };
  }
}

export async function logoutAction(): Promise<{ success: boolean }> {
  await clearSessionCookie();
  revalidatePath("/");
  revalidatePath("/login");
  return { success: true };
}

export async function updateMyProfileAction(input: {
  name: string;
  email: string;
  baseCurrency: string;
}): Promise<{ success: boolean; user?: SafeUser; error?: string }> {
  try {
    const { user: currentUser } = await getAuthStatusAction();
    if (!currentUser) {
      return { success: false, error: "Authentication required." };
    }

    const name = input.name?.trim() || "";
    const email = input.email?.trim().toLowerCase() || "";
    const baseCurrency = (input.baseCurrency || "AUD").trim().toUpperCase().slice(0, 3);

    if (name.length < 2) {
      return { success: false, error: "Name must be at least 2 characters." };
    }
    if (!EMAIL_REGEX.test(email)) {
      return { success: false, error: "Please enter a valid email address." };
    }

    const existingWithEmail = await store.getUserByEmail(email);
    if (existingWithEmail && existingWithEmail.id !== currentUser.id) {
      return { success: false, error: "Another account is already using that email." };
    }

    const updated = await store.updateUser(currentUser.id, {
      name,
      email,
      baseCurrency,
    });

    if (!updated) {
      return { success: false, error: "Account not found." };
    }

    await setSessionCookie({
      userId: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      sessionVersion: updated.sessionVersion,
    });

    revalidateAllWorkspacePaths();
    return { success: true, user: sanitizeUser(updated) };
  } catch (error: any) {
    return { success: false, error: error?.message || "Failed to update profile." };
  }
}

export async function changeMyPasswordAction(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { user: currentUser } = await getAuthStatusAction();
    if (!currentUser) {
      return { success: false, error: "Authentication required." };
    }

    const fullUser = await store.getUserById(currentUser.id);
    if (!fullUser || !verifyPassword(input.currentPassword || "", fullUser.passwordHash)) {
      return { success: false, error: "Current password is incorrect." };
    }

    if (!input.newPassword || input.newPassword.length < 8) {
      return { success: false, error: "New password must be at least 8 characters long." };
    }

    const updated = await store.updateUser(currentUser.id, {
      passwordHash: hashPassword(input.newPassword),
      bumpSession: true,
    });

    if (!updated) {
      return { success: false, error: "Account not found." };
    }

    // Re-issue cookie for the current device with bumped sessionVersion
    await setSessionCookie({
      userId: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      sessionVersion: updated.sessionVersion,
    });

    revalidatePath("/settings");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || "Failed to change password." };
  }
}

export async function resetMyWorkspaceAction(
  seedMode: "clean" | "demo"
): Promise<{ success: boolean; error?: string }> {
  try {
    const { user: currentUser } = await getAuthStatusAction();
    if (!currentUser) {
      return { success: false, error: "Authentication required." };
    }

    await store.resetUserWorkspace(currentUser.id, seedMode);
    revalidateAllWorkspacePaths();
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || "Failed to reset workspace." };
  }
}

async function requireAdmin(): Promise<SafeUser | null> {
  const { user } = await getAuthStatusAction();
  if (!user || user.role !== "admin") return null;
  return user;
}

export async function listUsersAdminAction(): Promise<{
  success: boolean;
  users: SafeUser[];
  error?: string;
}> {
  const admin = await requireAdmin();
  if (!admin) {
    return { success: false, users: [], error: "Administrator privileges required." };
  }

  const allUsers = await store.getUsers();
  return { success: true, users: allUsers };
}

export async function createUserAdminAction(input: {
  name: string;
  email: string;
  password: string;
  role: "admin" | "user";
  seedMode: "clean" | "demo";
}): Promise<{ success: boolean; user?: SafeUser; error?: string }> {
  try {
    const admin = await requireAdmin();
    if (!admin) {
      return { success: false, error: "Administrator privileges required." };
    }

    const name = input.name?.trim() || "";
    const email = input.email?.trim().toLowerCase() || "";
    const password = input.password || "";

    if (name.length < 2) {
      return { success: false, error: "Name must be at least 2 characters." };
    }
    if (!EMAIL_REGEX.test(email)) {
      return { success: false, error: "Please enter a valid email address." };
    }
    if (password.length < 8) {
      return { success: false, error: "Password must be at least 8 characters long." };
    }

    const existing = await store.getUserByEmail(email);
    if (existing) {
      return { success: false, error: "A user with that email already exists." };
    }

    const created = await store.createUserWithWorkspace({
      name,
      email,
      passwordHash: hashPassword(password),
      role: input.role === "admin" ? "admin" : "user",
      baseCurrency: "AUD",
      seedMode: input.seedMode === "demo" ? "demo" : "clean",
    });

    revalidatePath("/settings");
    return { success: true, user: sanitizeUser(created) };
  } catch (error: any) {
    return { success: false, error: error?.message || "Failed to create user." };
  }
}

export async function updateUserAdminAction(input: {
  targetUserId: string;
  name: string;
  email: string;
  role: "admin" | "user";
  isActive: boolean;
}): Promise<{ success: boolean; user?: SafeUser; error?: string }> {
  try {
    const admin = await requireAdmin();
    if (!admin) {
      return { success: false, error: "Administrator privileges required." };
    }

    const target = await store.getUserById(input.targetUserId);
    if (!target) {
      return { success: false, error: "User not found." };
    }

    const name = input.name?.trim() || "";
    const email = input.email?.trim().toLowerCase() || "";
    if (name.length < 2) {
      return { success: false, error: "Name must be at least 2 characters." };
    }
    if (!EMAIL_REGEX.test(email)) {
      return { success: false, error: "Please enter a valid email address." };
    }

    const duplicate = await store.getUserByEmail(email);
    if (duplicate && duplicate.id !== target.id) {
      return { success: false, error: "Another user is already using that email." };
    }

    // Protect against demoting or deactivating the last active administrator
    if (target.role === "admin" && (input.role !== "admin" || !input.isActive)) {
      const allUsers = await store.getUsers();
      const otherActiveAdmins = allUsers.filter(
        (u) => u.id !== target.id && u.role === "admin" && u.isActive
      );
      if (otherActiveAdmins.length === 0) {
        return {
          success: false,
          error: "Cannot demote or deactivate the last active administrator.",
        };
      }
    }

    const roleOrStatusChanged =
      target.role !== input.role || target.isActive !== input.isActive;

    const updated = await store.updateUser(target.id, {
      name,
      email,
      role: input.role,
      isActive: input.isActive,
      bumpSession: roleOrStatusChanged,
    });

    if (!updated) {
      return { success: false, error: "Failed to update user." };
    }

    if (updated.id === admin.id && updated.isActive) {
      await setSessionCookie({
        userId: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        sessionVersion: updated.sessionVersion,
      });
    }

    revalidateAllWorkspacePaths();
    return { success: true, user: sanitizeUser(updated) };
  } catch (error: any) {
    return { success: false, error: error?.message || "Failed to update user." };
  }
}

export async function resetUserPasswordAdminAction(input: {
  targetUserId: string;
  newPassword: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();
    if (!admin) {
      return { success: false, error: "Administrator privileges required." };
    }

    if (!input.newPassword || input.newPassword.length < 8) {
      return { success: false, error: "New password must be at least 8 characters long." };
    }

    const updated = await store.updateUser(input.targetUserId, {
      passwordHash: hashPassword(input.newPassword),
      bumpSession: true,
    });

    if (!updated) {
      return { success: false, error: "User not found." };
    }

    if (updated.id === admin.id) {
      await setSessionCookie({
        userId: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        sessionVersion: updated.sessionVersion,
      });
    }

    revalidatePath("/settings");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || "Failed to reset user password." };
  }
}

export async function resetUserWorkspaceAdminAction(input: {
  targetUserId: string;
  seedMode: "clean" | "demo";
}): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();
    if (!admin) {
      return { success: false, error: "Administrator privileges required." };
    }

    const target = await store.getUserById(input.targetUserId);
    if (!target) {
      return { success: false, error: "User not found." };
    }

    await store.resetUserWorkspace(target.id, input.seedMode);
    revalidateAllWorkspacePaths();
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || "Failed to reset user ledger." };
  }
}

export async function deleteUserAdminAction(
  targetUserId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();
    if (!admin) {
      return { success: false, error: "Administrator privileges required." };
    }

    if (targetUserId === admin.id) {
      return {
        success: false,
        error: "You cannot delete your own active admin account.",
      };
    }

    const target = await store.getUserById(targetUserId);
    if (!target) {
      return { success: false, error: "User not found." };
    }

    if (target.role === "admin" && target.isActive) {
      const allUsers = await store.getUsers();
      const otherActiveAdmins = allUsers.filter(
        (u) => u.id !== target.id && u.role === "admin" && u.isActive
      );
      if (otherActiveAdmins.length === 0) {
        return {
          success: false,
          error: "Cannot delete the last active administrator.",
        };
      }
    }

    await store.deleteUser(target.id);
    revalidatePath("/settings");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || "Failed to delete user." };
  }
}
