import { describe, expect, it } from "vitest";
import { GroupHistoryBuffer } from "../group-history.js";

describe("GroupHistoryBuffer", () => {
  it("records and returns history per group key", () => {
    const buf = new GroupHistoryBuffer(50);
    buf.record("g1", { sender: "Alice", body: "hi", timestamp: 1, messageId: "m1" });
    buf.record("g2", { sender: "Bob", body: "yo", timestamp: 2, messageId: "m2" });

    expect(buf.getHistory("g1")).toEqual([
      { sender: "Alice", body: "hi", timestamp: 1, messageId: "m1" },
    ]);
    expect(buf.getHistory("g2")).toEqual([
      { sender: "Bob", body: "yo", timestamp: 2, messageId: "m2" },
    ]);
  });

  it("enforces the history limit by dropping oldest entries", () => {
    const buf = new GroupHistoryBuffer(2);
    buf.record("g", { sender: "A", body: "1", timestamp: 1 });
    buf.record("g", { sender: "B", body: "2", timestamp: 2 });
    buf.record("g", { sender: "C", body: "3", timestamp: 3 });

    expect(buf.getHistory("g").map((e) => e.body)).toEqual(["2", "3"]);
  });

  it("clear removes history for a group key", () => {
    const buf = new GroupHistoryBuffer(10);
    buf.record("g", { sender: "A", body: "1", timestamp: 1 });
    buf.clear("g");
    expect(buf.getHistory("g")).toEqual([]);
  });

  it("getHistory returns a copy (caller mutation does not affect buffer)", () => {
    const buf = new GroupHistoryBuffer(10);
    buf.record("g", { sender: "A", body: "1", timestamp: 1 });

    const h = buf.getHistory("g");
    h.push({ sender: "B", body: "2", timestamp: 2 });

    expect(buf.getHistory("g")).toEqual([{ sender: "A", body: "1", timestamp: 1 }]);
  });
});

