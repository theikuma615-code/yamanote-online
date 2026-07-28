import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAnswer } from "../app/api/game/answer-normalization";
import { topicByName } from "../app/api/game/topics";

test("treats sushi kanji, hiragana, and katakana as the same answer", () => {
  const topic = topicByName("お寿司のネタ");
  assert.equal(normalizeAnswer("大トロ", topic), normalizeAnswer("おおとろ", topic));
  assert.equal(normalizeAnswer("大トロ", topic), normalizeAnswer("オオトロ", topic));
});

test("normalizes kana variants for every topic", () => {
  const topic = topicByName("動物");
  assert.equal(normalizeAnswer("キリン", topic), normalizeAnswer("きりん", topic));
  assert.equal(normalizeAnswer("麒麟", topic), normalizeAnswer("きりん", topic));
});

test("keeps different answers distinct", () => {
  const topic = topicByName("お寿司のネタ");
  assert.notEqual(normalizeAnswer("大トロ", topic), normalizeAnswer("中トロ", topic));
});
