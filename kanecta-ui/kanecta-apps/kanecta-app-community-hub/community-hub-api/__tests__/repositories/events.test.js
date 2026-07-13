import { jest, describe, test, expect } from "@jest/globals";
import * as eventsRepo from "../../repositories/events.js";

// events repo methods take an explicit `db` handle, so they can be unit-tested
// with a fake db without any module mocking — and this also proves the
// transaction-threading contract (pass a client, statements run on it).
function fakeDb(result = { rows: [] }) {
  const calls = [];
  return { query: (sql, params) => { calls.push([sql, params]); return Promise.resolve(result); }, calls };
}

describe("events repository", () => {
  test("getEventFiles binds a uuid[] and orders hero-first", async () => {
    const db = fakeDb();
    await eventsRepo.getEventFiles(db, ["a", "b"]);
    const [sql, params] = db.calls[0];
    expect(sql).toMatch(/ef\.event_id = ANY\(\$1::uuid\[\]\) AND f\.deleted_at IS NULL/);
    expect(sql).toMatch(/ORDER BY ef\.event_id, ef\.role DESC, ef\.position/);
    expect(params).toEqual([["a", "b"]]);
  });

  test("listUpcomingApprovedEvents filters approved + not-past", async () => {
    const db = fakeDb();
    await eventsRepo.listUpcomingApprovedEvents(db);
    const [sql] = db.calls[0];
    expect(sql).toMatch(/status = 'approved'/);
    expect(sql).toMatch(/COALESCE\(end_date, start_date\) >= CURRENT_DATE/);
  });

  test("getEventForDelete / getEventOwnerStatus return the row or null", async () => {
    const withRow = fakeDb({ rows: [{ submitted_by_id: "u1", status: "pending" }] });
    expect(await eventsRepo.getEventOwnerStatus(withRow, "e1")).toEqual({ submitted_by_id: "u1", status: "pending" });
    const empty = fakeDb({ rows: [] });
    expect(await eventsRepo.getEventForDelete(empty, "e1")).toBeNull();
  });

  test("createEvent inserts 18 columns positionally", async () => {
    const db = fakeDb({ rows: [{ id: "e1" }] });
    const row = await eventsRepo.createEvent(db, {
      title: "T", description: "D", startDate: "2026-01-01", startTime: null, endDate: null, endTime: null,
      address: null, lat: 1.5, lng: 2.5, website: null, phone: null, email: null,
      organiserName: null, organiserEmail: null, organiserPhone: null, area: "Featherston",
      submittedById: "u1", submittedByName: "Jane",
    });
    expect(row).toEqual({ id: "e1" });
    const [sql, params] = db.calls[0];
    expect(sql).toMatch(/INSERT INTO events/);
    expect(params).toHaveLength(18);
    expect(params[0]).toBe("T");
    expect(params[7]).toBe(1.5);
    expect(params[16]).toBe("u1");
  });

  test("countGalleryImages returns a parsed integer", async () => {
    const db = fakeDb({ rows: [{ count: "2" }] });
    expect(await eventsRepo.countGalleryImages(db, "e1")).toBe(2);
    const [sql] = db.calls[0];
    expect(sql).toMatch(/COUNT\(\*\) FROM event_files WHERE event_id = \$1 AND role = 'gallery'/);
  });

  test("transactional statements run on the passed client (getHeroImage/insertEventFile)", async () => {
    const client = fakeDb({ rows: [{ file_id: "f1", storage_key: "k1" }] });
    const hero = await eventsRepo.getHeroImage(client, "e1");
    expect(hero).toEqual({ file_id: "f1", storage_key: "k1" });
    await eventsRepo.insertEventFile(client, { eventId: "e1", fileId: "f1", role: "hero", position: 0 });
    expect(client.calls[1][0]).toMatch(/INSERT INTO event_files/);
    expect(client.calls[1][1]).toEqual(["e1", "f1", "hero", 0]);
  });

  test("updateEvent returns { id, status }; approve/decline guard on pending", async () => {
    const upd = fakeDb({ rows: [{ id: "e1", status: "pending" }] });
    const r = await eventsRepo.updateEvent(upd, {
      id: "e1", title: "T", description: null, startDate: "d", startTime: null, endDate: null, endTime: null,
      address: null, lat: null, lng: null, website: null, phone: null, email: null,
      organiserName: null, organiserEmail: null, organiserPhone: null, area: "F", status: "pending",
    });
    expect(r).toEqual({ id: "e1", status: "pending" });

    const dec = fakeDb({ rows: [] });
    expect(await eventsRepo.declineEvent(dec, { id: "e1", declineReason: "x", reviewedById: "m", reviewedByName: "Mod" })).toBeUndefined();
    expect(dec.calls[0][0]).toMatch(/status = 'declined'/);
    expect(dec.calls[0][0]).toMatch(/AND status = 'pending' AND deleted_at IS NULL/);
  });
});
