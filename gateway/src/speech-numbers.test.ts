import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cardinalWords,
  incompleteNumericHoldStart,
  verbalizeNumbersForTts,
} from "./speech-numbers.js";

describe("cardinalWords", () => {
  it("covers ones, compounds, and thousands", () => {
    assert.equal(cardinalWords(0), "zero");
    assert.equal(cardinalWords(1), "one");
    assert.equal(cardinalWords(21), "twenty-one");
    assert.equal(cardinalWords(100), "one hundred");
    assert.equal(cardinalWords(247), "two hundred forty-seven");
    assert.equal(cardinalWords(1247), "one thousand two hundred forty-seven");
  });
});

describe("verbalizeNumbersForTts", () => {
  it("speaks phones without minus", () => {
    assert.equal(
      verbalizeNumbersForTts("Call me at 555-123-4567."),
      "Call me at five five five, one two three, four five six seven.",
    );
    assert.doesNotMatch(verbalizeNumbersForTts("Call me at 555-123-4567."), /minus/);
  });

  it("speaks currency including cents-only amounts", () => {
    assert.equal(
      verbalizeNumbersForTts("The total is $1,247.50 all in."),
      "The total is one thousand two hundred forty-seven dollars and fifty cents all in.",
    );
    assert.equal(verbalizeNumbersForTts("That is $1."), "That is one dollar.");
    assert.equal(verbalizeNumbersForTts("I owe $0.99."), "I owe ninety-nine cents.");
  });

  it("speaks dates, percents, cardinals, and times", () => {
    assert.equal(
      verbalizeNumbersForTts("Launch is on 3/15/2026."),
      "Launch is on March fifteenth, twenty twenty-six.",
    );
    assert.equal(
      verbalizeNumbersForTts("ISO 2026-03-15 works too."),
      "ISO March fifteenth, twenty twenty-six works too.",
    );
    assert.equal(verbalizeNumbersForTts("About 50% done."), "About fifty percent done.");
    assert.equal(verbalizeNumbersForTts("See 2 apples."), "See two apples.");
    assert.equal(verbalizeNumbersForTts("Meet at 3:30pm."), "Meet at three thirty P M.");
  });

  it("leaves semver, v1, and leading token spaces alone", () => {
    assert.equal(verbalizeNumbersForTts("Keep v1.4.11 intact."), "Keep v1.4.11 intact.");
    assert.equal(verbalizeNumbersForTts("id v1 stays"), "id v1 stays");
    assert.equal(verbalizeNumbersForTts(" Ken"), " Ken");
  });
});

describe("incompleteNumericHoldStart", () => {
  it("holds trailing currency and phone fragments, not complete words", () => {
    assert.equal(incompleteNumericHoldStart("The total is $1,2"), "The total is ".length);
    assert.equal(incompleteNumericHoldStart("I have 2 apples"), null);
    assert.equal(incompleteNumericHoldStart("Call 555-"), "Call ".length);
    assert.equal(incompleteNumericHoldStart("id v1"), null);
  });
});
