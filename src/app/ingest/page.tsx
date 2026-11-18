import { getAccountsAction } from "@/actions/transactions";
import { getImportBatchesAction } from "@/actions/csv-parser";
import { IngestView } from "@/components/ingest/ingest-view";

export const dynamic = "force-dynamic";

export default async function IngestPage() {
  const accounts = await getAccountsAction();
  const batches = await getImportBatchesAction();

  return <IngestView accounts={accounts} batches={batches} />;
}
