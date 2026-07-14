// Phase C write verification over HTTP: exercise the KanectaRepository write path
// (POST /items + POST /transaction against kanecta-api) and assert each write
// round-trips through the read path. Every case cleans up after itself so the
// backfilled read fixture stays intact and the script is idempotent.
//
// Run (kanecta-api up on :3001 over communityhub_backfill):
//   KANECTA_API_URL=http://127.0.0.1:3001 node scripts/verify-kanecta-writes.js
import * as suggestions from "../repositories/kanecta/suggestions.js";
import * as finances from "../repositories/kanecta/finances.js";
import * as pages from "../repositories/kanecta/pages.js";
import { deleteItem, graphql } from "../lib/kanectaClient.js";

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${detail ? "  " + detail : ""}`); fail++; }
};

// ── create (single item): suggestions.createSuggestion ───────────────────────
{
  const before = (await suggestions.listActiveSuggestions()).length;
  const { id } = await suggestions.createSuggestion({
    content: "PHASE-C probe suggestion", submittedById: "u-test", submittedByName: "Test User",
  });
  const active = await suggestions.listActiveSuggestions();
  const found = active.find((s) => s.id === id);
  ok("createSuggestion → appears in listActiveSuggestions",
    active.length === before + 1 && found && found.content === "PHASE-C probe suggestion",
    JSON.stringify(found));
  await deleteItem(id, { force: true });
  ok("createSuggestion cleanup", (await suggestions.listActiveSuggestions()).length === before);
}

// ── create + update + delete: finances transactions ──────────────────────────
{
  const created = await finances.createTransaction({
    date: "2026-07-01", description: "PHASE-C probe txn", amount: "12.34", type: "expense",
    category: "testing", reference: "REF1", sortOrder: 99, createdById: "u-test", createdByName: "Test User",
  });
  ok("createTransaction → returns pg-shaped row",
    created && created.description === "PHASE-C probe txn" && created.amount === "12.34"
      && created.type === "expense" && created.sort_order === 99, JSON.stringify(created));
  const id = created.id;

  const updated = await finances.updateTransaction({
    id, date: "2026-07-02", description: "PHASE-C probe txn EDITED", amount: "56.78",
    type: "income", category: "testing", reference: "REF2", sortOrder: 1,
  });
  ok("updateTransaction → merged new values",
    updated && updated.description === "PHASE-C probe txn EDITED" && updated.amount === "56.78"
      && updated.type === "income" && updated.date === "2026-07-02", JSON.stringify(updated));

  const delId = await finances.deleteTransaction(id);
  const gone = await graphql(`query($id:ID){ financesTransactionses(where:{id:{eq:$id}}, limit:1){ id } }`, { id });
  ok("deleteTransaction → row removed", delId === id && gone.financesTransactionses.length === 0);
}

// ── atomic multi-item: pages.createPageWithHistory (page + history in one tx) ──
{
  const slug = "phase-c-probe-page";
  const page = await pages.createPageWithHistory({
    slug, title: "Phase C Probe", contentJson: { root: { children: [] } },
    createdById: "u-test", createdByName: "Test User", licenceId: null, ownerType: "group", ownerId: null,
  });
  ok("createPageWithHistory → page row",
    page && page.slug === slug && page.version === 1 && page.public === false, JSON.stringify(page));

  // The initial history row committed in the SAME transaction.
  const hist = await graphql(
    `query($p:ID){ pageHistories(where:{pageId:{eq:$p}}, limit:10){ action version } }`,
    { p: page?.id },
  ).catch((e) => ({ error: e.message }));
  const rows = hist.pageHistories;
  ok("createPageWithHistory → initial 'Created' history row committed atomically",
    Array.isArray(rows) && rows.length === 1 && rows[0].action === "Created" && rows[0].version === 1,
    JSON.stringify(hist));

  // Cleanup: delete the history row(s) FIRST (they FK-reference the page), then
  // the page itself.
  if (page?.id) {
    const ids = await graphql(`query($p:ID){ pageHistories(where:{pageId:{eq:$p}}, limit:10){ id } }`, { p: page.id });
    for (const h of ids.pageHistories) await deleteItem(h.id, { force: true });
    await deleteItem(page.id, { force: true });
  }
  const check = await graphql(`query($s:String){ pageses(where:{slug:{eq:$s}}, limit:1){ id } }`, { s: slug });
  ok("createPageWithHistory cleanup", check.pageses.length === 0);
}

console.log(`\n${pass}/${pass + fail} write checks passed.`);
process.exit(fail ? 1 : 0);
