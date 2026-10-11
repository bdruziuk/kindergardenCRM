import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, tables, orm, fixture, database, ScopeError } from "./test-helpers.mjs";

// Свята днів народження: планує власник або керуючий, лише для дітей своєї
// філії; у один день може бути кілька свят.

const birthdayParties = {
  tableName: "birthdayParties",
  ...Object.fromEntries(
    ["id", "branchId", "childId", "date", "startTime", "durationMinutes", "note"]
      .map((key) => [key, { table: "birthdayParties", key }]),
  ),
};

function setup({ canManageBranch = true } = {}) {
  const data = { ...fixture(), birthdayParties: [] };
  data.children.push({ id: 4, branchId: 1, groupId: 1, fullName: "Second Child", status: "active", birthDate: "2021-10-14" });
  let nextId = 1;
  const db = database(data);
  const insert = db.insert;
  // Кожне свято отримує власний id — у спільному адаптері всі нові рядки мають 100.
  db.insert = (table) => {
    const chain = insert(table);
    const values = chain.values;
    chain.values = (fields) => values(table === birthdayParties ? { ...fields, id: nextId++ } : fields);
    return chain;
  };
  const { POST } = load("app/api/birthdays/route.ts", {
    "drizzle-orm": orm,
    "@/db": { getDb: () => db },
    "@/db/schema": { ...tables, birthdayParties },
    "@/lib/api-schemas": schemas,
    "@/lib/period": { currentMonth: () => "2026-10" },
    "@/lib/scope": {
      ScopeError, resolveScope: async () => ({ branchId: 1, canManageBranch }),
      scopeFailure: (error) => error instanceof ScopeError ? Response.json({ error: error.message }, { status: error.status }) : null,
    },
  });
  const post = (body) => POST(new Request("http://localhost/api/birthdays?month=2026-10", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  return { data, post };
}

const party = { kind: "party_add", childId: 1, date: "2026-10-14", startTime: "11:00", durationMinutes: 60, note: "" };

test("A manager plans two parties on the same day", async () => {
  const { data, post } = setup();
  const first = await post(party);
  assert.equal(first.status, 200, JSON.stringify(await first.json()));
  assert.equal((await post({ ...party, childId: 4, startTime: "15:30", durationMinutes: 90 })).status, 200);
  assert.deepEqual(
    data.birthdayParties.map(({ childId, date, startTime, durationMinutes }) => ({ childId, date, startTime, durationMinutes })),
    [
      { childId: 1, date: "2026-10-14", startTime: "11:00", durationMinutes: 60 },
      { childId: 4, date: "2026-10-14", startTime: "15:30", durationMinutes: 90 },
    ],
  );
});

test("A party can be moved and then removed", async () => {
  const { data, post } = setup();
  await post(party);
  const id = data.birthdayParties[0].id;
  assert.equal((await post({ ...party, kind: "party_update", partyId: id, date: "2026-10-15", startTime: "10:00" })).status, 200);
  assert.equal(data.birthdayParties[0].date, "2026-10-15");
  assert.equal(data.birthdayParties[0].startTime, "10:00");
  assert.equal((await post({ kind: "party_remove", partyId: id })).status, 200);
  assert.equal(data.birthdayParties.length, 0);
});

test("A teacher cannot plan a party", async () => {
  const { data, post } = setup({ canManageBranch: false });
  assert.equal((await post(party)).status, 403);
  assert.equal(data.birthdayParties.length, 0);
});

test("A child of another branch is refused", async () => {
  const { data, post } = setup();
  assert.equal((await post({ ...party, childId: 2 })).status, 404);
  assert.equal(data.birthdayParties.length, 0);
});

test("Another branch's party cannot be touched", async () => {
  const { data, post } = setup();
  data.birthdayParties.push({ id: 50, branchId: 2, childId: 2, date: "2026-10-14", startTime: "11:00", durationMinutes: 60 });
  assert.equal((await post({ kind: "party_remove", partyId: 50 })).status, 404);
  assert.equal(data.birthdayParties.length, 1);
});

test("Time and duration are validated", async () => {
  const { post } = setup();
  assert.equal((await post({ ...party, startTime: "25:00" })).status, 400);
  assert.equal((await post({ ...party, durationMinutes: 5 })).status, 400);
  assert.equal((await post({ ...party, durationMinutes: 800 })).status, 400);
});
