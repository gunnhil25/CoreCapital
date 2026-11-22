import { getAccountsAction, getCategoriesAction } from "@/actions/transactions";
import { getImportBatchesAction } from "@/actions/csv-parser";
import { getRuleSuggestionsAction } from "@/actions/rules";
import { IngestView } from "@/components/ingest/ingest-view";

export const dynamic = "force-dynamic";

export default async function IngestPage() {
  const [accounts, batches, categories, initialSuggestions] = await Promise.all([
    getAccountsAction(),
    getImportBatchesAction(),
    getCategoriesAction(),
    getRuleSuggestionsAction(),
  ]);

  return (
    <IngestView
      accounts={accounts}
      batches={batches}
      categories={categories}
      initialSuggestions={initialSuggestions}
    />
  );
}
