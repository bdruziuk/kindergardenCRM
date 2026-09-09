import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, tables, orm, fixture, database, ScopeError } from "./test-helpers.mjs";

// Перенесення заявки з черги в групу: із заявки постає дитина в «Діти та
// групи», а сама заявка лишається в черзі з позначкою, куди вона поділась.

function setup() {
  const data = fixture();
  for (const branchId of [1, 2]) {
    data.waitlist.push({
      id: branchId, branchId, enrolledChildId: null,
      childName: `Waiting ${branchId}`, childBirthDate: "2022-04-05",
      parentName: `Parent of ${branchId}`, parentPhone: "+380000000",
      parentEmail: "", preferredGroupId: null, desiredFrom: null,
      status: "waiting", note: null, createdAt: new Date("2026-09-01"),
    });
  }
  const db = database(data);
  const enrollment = load("lib/waitlist-enrollment.ts", {
    "drizzle-orm": orm,
    "@/db": { getDb: () => db },
    "@/db/schema": tables,
    "./scope": { ScopeError },
  });
  const { POST } = load("app/api/waitlist/route.ts", {
    "drizzle-orm": orm,
    "@/db": { getDb: () => db },
    "@/db/schema": tables,
    "@/lib/api-schemas": schemas,
    "@/lib/format": { ageLabel: () => "" },
    "@/lib/waitlist-enrollment": enrollment,
    "@/lib/scope": {
      ScopeError, resolveScope: async () => ({ branchId: 1 }),
      scopeFailure: (error) => error instanceof ScopeError ? Response.json({ error: error.message }, { status: error.status }) : null,
    },
  });
  const post = (body) => POST(new Request("http://localhost/api/waitlist", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { data, post };
}

const enroll = { kind: "enroll", entryId: 1, groupId: 1, enrolledAt: "2026-09-15" };

test("Enrolling a queue entry creates the child, the contact and the link back", async () => {
  const { data, post } = setup();
  const response = await post(enroll);
  assert.equal(response.status, 200, JSON.stringify(await response.json()));

  const child = data.children.find((row) => row.fullName === "Waiting 1");
  assert.ok(child, "Заявка мала перетворитись на дитину");
  assert.equal(child.branchId, 1);
  assert.equal(child.groupId, 1);
  assert.equal(child.status, "active");
  assert.equal(child.birthDate, "2022-04-05");
  assert.equal(child.enrolledAt, "2026-09-15");

  const relative = data.relatives.find((row) => row.childId === child.id);
  assert.ok(relative, "Контактна особа має переїхати разом із дитиною");
  assert.equal(relative.fullName, "Parent of 1");
  assert.equal(relative.phone, "+380000000");

  const entry = data.waitlist.find((row) => row.id === 1);
  assert.equal(entry.status, "enrolled");
  assert.equal(entry.enrolledChildId, child.id);
  assert.equal(entry.preferredGroupId, 1);
});

test("A second enrolment of the same entry is refused instead of duplicating the child", async () => {
  const { data, post } = setup();
  assert.equal((await post(enroll)).status, 200);
  const before = structuredClone(data);

  const response = await post(enroll);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "Дитину вже перенесено до групи");
  assert.deepEqual(data, before, "Відмова не має нічого міняти");
});

test("Enrolment into another branch's group is refused", async () => {
  const { data, post } = setup();
  const before = structuredClone(data);

  const response = await post({ ...enroll, groupId: 2 });
  assert.equal(response.status, 404);
  assert.deepEqual(data, before, "Чужа група не має нічого створювати");
});

test("Enrolment of another branch's entry is refused", async () => {
  const { data, post } = setup();
  const before = structuredClone(data);

  const response = await post({ ...enroll, entryId: 2 });
  assert.equal(response.status, 404);
  assert.deepEqual(data, before, "Чужа заявка не має нічого створювати");
});

test("Edits made in the dialog reach both the child and the entry", async () => {
  const { data, post } = setup();
  const response = await post({
    ...enroll,
    entry: {
      childName: "Renamed child", childBirthDate: "2021-01-02",
      parentName: "Renamed parent", parentPhone: "+380111111",
      parentEmail: "parent@example.com", preferredGroupId: 1,
      desiredFrom: "2026-10", note: "З жовтня",
    },
  });
  assert.equal(response.status, 200, JSON.stringify(await response.json()));

  const child = data.children.find((row) => row.fullName === "Renamed child");
  assert.ok(child, "Дитина має постати з відредагованих полів, а не зі старих");
  assert.equal(child.birthDate, "2021-01-02");
  assert.equal(data.relatives.find((row) => row.childId === child.id).fullName, "Renamed parent");

  const entry = data.waitlist.find((row) => row.id === 1);
  assert.equal(entry.childName, "Renamed child");
  assert.equal(entry.parentEmail, "parent@example.com");
  assert.equal(entry.note, "З жовтня");
  // Місяць у заявці зберігається першим днем місяця, а API говорить «YYYY-MM».
  assert.equal(entry.desiredFrom, "2026-10-01");
});
