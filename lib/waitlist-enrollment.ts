import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { getDb } from "@/db";
import { children, groups, relatives, waitlist } from "@/db/schema";
import type { waitlistRequest } from "./api-schemas";
import { ScopeError } from "./scope";

type Enrollment = Extract<z.infer<typeof waitlistRequest>, { kind: "enroll" }>;

/** Lock the queue entry so concurrent confirmations cannot create two children. */
export async function enrollFromWaitlist(branchId: number, body: Enrollment) {
  return getDb().transaction(async (tx) => {
    const [entry] = await tx.select().from(waitlist)
      .where(and(eq(waitlist.id, body.entryId), eq(waitlist.branchId, branchId)))
      .for("update");
    if (!entry) throw new ScopeError("Заявку не знайдено", 404);
    if (entry.enrolledChildId) throw new ScopeError("Дитину вже перенесено до групи", 409);
    const [group] = await tx.select({ id: groups.id }).from(groups)
      .where(and(eq(groups.id, body.groupId), eq(groups.branchId, branchId)));
    if (!group) throw new ScopeError("Групу не знайдено", 404);
    const source = body.entry ?? entry;
    const [child] = await tx.insert(children).values({
      branchId, groupId: group.id, fullName: source.childName,
      birthDate: source.childBirthDate, status: "active", enrolledAt: body.enrolledAt,
    }).returning({ id: children.id });
    await tx.insert(relatives).values({
      childId: child.id, fullName: source.parentName, relation: "Контактна особа",
      phone: source.parentPhone, email: source.parentEmail || null,
    });
    await tx.update(waitlist).set({
      ...(body.entry ? {
        childName: source.childName, childBirthDate: source.childBirthDate,
        parentName: source.parentName, parentPhone: source.parentPhone,
        parentEmail: source.parentEmail || null, note: source.note || null,
        desiredFrom: body.entry.desiredFrom ? `${body.entry.desiredFrom}-01` : null,
      } : {}),
      status: "enrolled", preferredGroupId: group.id, enrolledChildId: child.id,
    }).where(and(eq(waitlist.id, entry.id), eq(waitlist.branchId, branchId)));
    return child.id;
  });
}
