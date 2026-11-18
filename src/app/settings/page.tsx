import { redirect } from "next/navigation";
import { getAuthStatusAction, listUsersAdminAction, SafeUser } from "@/actions/auth";
import { SettingsView } from "@/components/settings/settings-view";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { initialized, user } = await getAuthStatusAction();

  if (!initialized) {
    redirect("/setup");
  }

  if (!user) {
    redirect("/login");
  }

  let initialUsers: SafeUser[] = [];
  if (user.role === "admin") {
    const res = await listUsersAdminAction();
    if (res.success) {
      initialUsers = res.users;
    }
  }

  return <SettingsView currentUser={user} initialUsers={initialUsers} />;
}
