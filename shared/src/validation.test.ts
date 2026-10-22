import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CreateStackSchema,
  EditNoteSchema,
  NOTE_TEXT_MAX_LENGTH,
  PushNoteSchema,
  ReorderNotesSchema,
  SetActiveStackSchema,
  STACK_NAME_MAX_LENGTH,
  UpdateStackSchema,
  type UpdateStackInput,
} from "./index.js";

/** Any of the exported request-body schemas. */
type BodySchema = z.ZodType<unknown>;

/** Distinct, realistic uuid literals for id-bearing bodies. */
const UUID_STACK = "0e6a4b1e-3b6a-4f1a-9d3e-2c6f5a8b7c01";
const UUID_NOTE_TOP = "8d1f2c3a-4b5e-4a6d-9c0f-1a2b3c4d5e6f";
const UUID_NOTE_BOT = "b2c9d4e5-f607-4a8b-9c1d-2e3f4a5b6c7d";

describe("limit constants", () => {
  // Pinned so a limit change is a deliberate test update, not a silent break
  // of the web forms that will mirror these in `maxlength`.
  it("keep the documented limits", () => {
    expect(STACK_NAME_MAX_LENGTH).toBe(80);
    expect(NOTE_TEXT_MAX_LENGTH).toBe(280);
  });
});

/**
 * Asserts `body` fails `schema` and (optionally) that some issue points at
 * `failPath`. Uses safeParse throughout — rejections are data, not throws.
 */
function expectRejected(
  schema: BodySchema,
  body: unknown,
  failPath?: readonly (string | number)[],
): void {
  const result = schema.safeParse(body);
  expect(result.success).toBe(false);
  if (failPath && !result.success) {
    const paths = result.error.issues.map((issue) => JSON.stringify(issue.path));
    expect(paths).toContain(JSON.stringify(failPath));
  }
}

/** Asserts `body` parses and the parsed output equals `expected` exactly. */
function expectParsed(schema: BodySchema, body: unknown, expected: unknown): void {
  const result = schema.safeParse(body);
  expect(result.success).toBe(true);
  expect(result.data).toEqual(expected);
}

describe("CreateStackSchema", () => {
  it.each([
    { name: "plain name", body: { name: "Work" }, expected: { name: "Work" } },
    {
      name: "trims surrounding whitespace",
      body: { name: "  Work  " },
      expected: { name: "Work" },
    },
    {
      name: "accepts a name at the max length boundary",
      body: { name: "a".repeat(STACK_NAME_MAX_LENGTH) },
      expected: { name: "a".repeat(STACK_NAME_MAX_LENGTH) },
    },
    {
      name: "checks the max length on the trimmed value, not the raw input",
      // Raw length 84 — fails under a check-raw-length-then-trim impl.
      body: { name: `  ${"a".repeat(STACK_NAME_MAX_LENGTH)}  ` },
      expected: { name: "a".repeat(STACK_NAME_MAX_LENGTH) },
    },
  ])("$name", ({ body, expected }) => {
    expectParsed(CreateStackSchema, body, expected);
  });

  it.each([
    { name: "empty string", body: { name: "" } },
    { name: "whitespace-only name", body: { name: "   " } },
    {
      name: "name one char over the limit",
      body: { name: "a".repeat(STACK_NAME_MAX_LENGTH + 1) },
      failPath: ["name"],
    },
    { name: "missing name", body: {} },
    { name: "number where name expected", body: { name: 5 } },
    { name: "array where name expected", body: { name: ["Work"] } },
    { name: "unknown extra key", body: { name: "Work", position: 1 } },
  ])("rejects $name", ({ body, failPath }) => {
    expectRejected(CreateStackSchema, body, failPath);
  });
});

describe("UpdateStackSchema", () => {
  it("accepts a position at the min boundary and a multi-key patch", () => {
    expectParsed(
      UpdateStackSchema,
      { name: "New name", position: 2 },
      {
        name: "New name",
        position: 2,
      },
    );
  });

  it.each([
    {
      name: "only a name, trimmed",
      body: { name: "  Bath  " },
      expected: { name: "Bath" },
    },
    {
      name: "only a position",
      body: { position: 1 },
      expected: { position: 1 },
    },
  ])("accepts $name", ({ body, expected }: { body: unknown; expected: UpdateStackInput }) => {
    expectParsed(UpdateStackSchema, body, expected);
  });

  it.each([
    // An empty PATCH body is a client bug; reject rather than silently no-op.
    { name: "no keys at all", body: {}, failPath: [] },
    { name: "empty-string name", body: { name: "" }, failPath: ["name"] },
    {
      name: "whitespace-only name",
      body: { name: "   " },
      failPath: ["name"],
    },
    {
      name: "name one char over the limit",
      body: { name: "a".repeat(STACK_NAME_MAX_LENGTH + 1) },
      failPath: ["name"],
    },
    { name: "fractional position", body: { position: 1.5 }, failPath: ["position"] },
    { name: "zero position", body: { position: 0 }, failPath: ["position"] },
    { name: "negative position", body: { position: -1 }, failPath: ["position"] },
    { name: "string position", body: { position: "1" }, failPath: ["position"] },
    { name: "number where name expected", body: { name: 5 } },
    { name: "unknown extra key", body: { name: "Work", keep: true } },
    // Present-but-undefined keys are a no-op patch: never valid.
    { name: "explicit undefined name only", body: { name: undefined }, failPath: [] },
    {
      name: "explicit undefined name and position",
      body: { name: undefined, position: undefined },
      failPath: [],
    },
  ])("rejects $name", ({ body, failPath }) => {
    expectRejected(UpdateStackSchema, body, failPath);
  });
});

describe("SetActiveStackSchema", () => {
  it("accepts a uuid stack id", () => {
    expectParsed(SetActiveStackSchema, { stackId: UUID_STACK }, { stackId: UUID_STACK });
  });

  it("accepts a deliberately non-uuid id — no format coupling", () => {
    // Fixture style matches index.test.ts ("stack-1"); proves idSchema does
    // not over-restrict and the server's existence check stays the 404 path.
    expectParsed(SetActiveStackSchema, { stackId: "stack-1" }, { stackId: "stack-1" });
  });

  it("passes ids through untouched (no trimming, null or otherwise)", () => {
    // Whitespace-containing ids must survive verbatim — trimming could alias
    // ids and hide a client bug.
    expectParsed(SetActiveStackSchema, { stackId: " stack-1 " }, { stackId: " stack-1 " });
  });

  it.each([
    { name: "missing stackId", body: {} },
    { name: "empty string", body: { stackId: "" }, failPath: ["stackId"] },
    { name: "whitespace-only id", body: { stackId: " " }, failPath: ["stackId"] },
    {
      name: "whitespace-only id (tabs/newlines)",
      body: { stackId: "\t\n" },
      failPath: ["stackId"],
    },
    { name: "number where string expected", body: { stackId: 5 }, failPath: ["stackId"] },
    { name: "array where string expected", body: { stackId: [UUID_STACK] }, failPath: ["stackId"] },
    { name: "unknown extra key", body: { stackId: UUID_STACK, noteId: UUID_NOTE_TOP } },
  ])("rejects $name", ({ body, failPath }) => {
    expectRejected(SetActiveStackSchema, body, failPath);
  });
});

describe("PushNoteSchema", () => {
  it("parses a valid body", () => {
    expectParsed(PushNoteSchema, { text: "call the bank" }, { text: "call the bank" });
  });

  it.each([
    {
      name: "trims surrounding whitespace",
      body: { text: "  call the bank  " },
      expected: { text: "call the bank" },
    },
    {
      name: "accepts text at the max length boundary",
      body: { text: "x".repeat(NOTE_TEXT_MAX_LENGTH) },
      expected: { text: "x".repeat(NOTE_TEXT_MAX_LENGTH) },
    },
    {
      name: "checks the max length on the trimmed value, not the raw input",
      // Raw length 284 — fails under a check-raw-length-then-trim impl.
      body: { text: `  ${"x".repeat(NOTE_TEXT_MAX_LENGTH)}  ` },
      expected: { text: "x".repeat(NOTE_TEXT_MAX_LENGTH) },
    },
  ])("$name", ({ body, expected }) => {
    expectParsed(PushNoteSchema, body, expected);
  });

  it.each([
    { name: "empty string", body: { text: "" }, failPath: ["text"] },
    { name: "whitespace-only text", body: { text: "   " }, failPath: ["text"] },
    {
      name: "text one char over the limit",
      body: { text: "x".repeat(NOTE_TEXT_MAX_LENGTH + 1) },
      failPath: ["text"],
    },
    { name: "missing text", body: {} },
    { name: "number where text expected", body: { text: 280 } },
    { name: "array where text expected", body: { text: ["hello"] } },
    { name: "unknown extra key", body: { text: "hi", priority: "high" } },
  ])("rejects $name", ({ body, failPath }) => {
    expectRejected(PushNoteSchema, body, failPath);
  });
});

describe("EditNoteSchema", () => {
  it("parses a valid body", () => {
    expectParsed(EditNoteSchema, { text: "call the bank" }, { text: "call the bank" });
  });

  it.each([
    {
      name: "trims surrounding whitespace",
      body: { text: "  call the bank  " },
      expected: { text: "call the bank" },
    },
    {
      name: "accepts text at the max length boundary",
      body: { text: "x".repeat(NOTE_TEXT_MAX_LENGTH) },
      expected: { text: "x".repeat(NOTE_TEXT_MAX_LENGTH) },
    },
    {
      name: "checks the max length on the trimmed value, not the raw input",
      // Raw length 284 — fails under a check-raw-length-then-trim impl.
      body: { text: `  ${"x".repeat(NOTE_TEXT_MAX_LENGTH)}  ` },
      expected: { text: "x".repeat(NOTE_TEXT_MAX_LENGTH) },
    },
  ])("$name", ({ body, expected }) => {
    expectParsed(EditNoteSchema, body, expected);
  });

  it.each([
    { name: "empty string", body: { text: "" } },
    { name: "whitespace-only text", body: { text: "\t\n  " } },
    {
      name: "text one char over the limit",
      body: { text: "y".repeat(NOTE_TEXT_MAX_LENGTH + 1) },
      failPath: ["text"],
    },
    { name: "missing text", body: {} },
    { name: "number where text expected", body: { text: 1 } },
    { name: "null where text expected", body: { text: null } },
    { name: "unknown extra key", body: { text: "hi", completed: false } },
  ])("rejects $name", ({ body, failPath }) => {
    expectRejected(EditNoteSchema, body, failPath);
  });
});

describe("ReorderNotesSchema", () => {
  it("accepts a full id sequence", () => {
    expectParsed(
      ReorderNotesSchema,
      { noteIds: [UUID_NOTE_TOP, UUID_NOTE_BOT] },
      { noteIds: [UUID_NOTE_TOP, UUID_NOTE_BOT] },
    );
  });

  it("accepts an empty array as a valid rewrite of an empty stack", () => {
    expectParsed(ReorderNotesSchema, { noteIds: [] }, { noteIds: [] });
  });

  it.each([
    {
      name: "duplicate ids",
      body: { noteIds: [UUID_NOTE_TOP, UUID_NOTE_TOP] },
      failPath: ["noteIds"],
    },
    {
      name: "empty-string id",
      body: { noteIds: [UUID_NOTE_BOT, ""] },
      failPath: ["noteIds", 1],
    },
    {
      name: "whitespace-only id",
      body: { noteIds: [" "] },
      failPath: ["noteIds", 0],
    },
    {
      name: "string instead of an array of ids",
      body: { noteIds: `${UUID_NOTE_TOP},${UUID_NOTE_BOT}` },
      failPath: ["noteIds"],
    },
    { name: "missing noteIds", body: {} },
    { name: "unknown extra key", body: { noteIds: [UUID_NOTE_TOP], stackId: UUID_STACK } },
  ])("rejects $name", ({ body, failPath }) => {
    expectRejected(ReorderNotesSchema, body, failPath);
  });
});
