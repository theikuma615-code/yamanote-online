import assert from "node:assert/strict";
import test from "node:test";
import { canResumeRandomRoom } from "../app/api/game/matchmaking.ts";

test("only reconnects matchmaking to a game that is still in progress", () => {
  assert.equal(canResumeRandomRoom("starting"), true);
  assert.equal(canResumeRandomRoom("active"), true);
  assert.equal(canResumeRandomRoom("finished"), false);
  assert.equal(canResumeRandomRoom("lobby"), false);
  assert.equal(canResumeRandomRoom(null), false);
});
