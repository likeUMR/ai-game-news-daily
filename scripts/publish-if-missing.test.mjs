import {strict as assert} from "node:assert";
import {test} from "vitest";
import {hasArticles, isoWeek, repairReport} from "./publish-if-missing.mjs";

const html = '<h3>专题</h3><a href="https://example.org/article">来源</a>';

test("publication preserves an edition already filled by the Linux job", async () => {
  let checks = 0;
  const result = await repairReport({
    path: "daily", date: "2026-11-26",
    inspect: () => ({html: ++checks === 2 ? html : ""}), generate: () => html,
    publish: () => assert.fail("overwrote independent publication")
  });
  assert.equal(result, "已有并行任务发布正文");
});

test("empty editions cannot be published, and Sunday resolves the correct ISO year", async () => {
  await assert.rejects(repairReport({
    path: "daily", inspect: () => ({}), generate: () => "<h1>日报</h1>", publish: () => assert.fail()
  }), /缺少正文/);
  assert.equal(hasArticles(html), true);
  assert.equal(isoWeek("2027-01-03"), "2026-W53");
});
