import { getManageDataAction } from "@/actions/manage";
import { ManageView } from "@/components/manage/manage-view";

export const dynamic = "force-dynamic";

export default async function AccountsAndCategoriesPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const initialData = await getManageDataAction();

  return (
    <ManageView
      initialData={initialData}
      initialTab={resolvedParams?.tab === "accounts" ? "accounts" : "categories"}
    />
  );
}
