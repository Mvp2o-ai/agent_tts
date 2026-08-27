import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PromptQueue } from "./prompt-queue.js";

describe("PromptQueue", () => {
  it("does not dispatch a second prompt while busy", () => {
    const q = new PromptQueue();
    const a = q.enqueue("one");
    const b = q.enqueue("two");
    const first = q.takeIfIdle();
    assert.equal(first?.id, a.id);
    assert.equal(q.takeIfIdle(), undefined);
    q.markIdle();
    const second = q.takeIfIdle();
    assert.equal(second?.id, b.id);
  });

  it("trims utterance text", () => {
    const q = new PromptQueue();
    const item = q.enqueue("  hello  ");
    assert.equal(item.text, "hello");
  });
});
