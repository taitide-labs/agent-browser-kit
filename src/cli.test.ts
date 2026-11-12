import { expect, test } from "bun:test";
import { run } from "./cli.ts";

test("prints version and help", () => {
  expect(run(["--version"])).toBe(0);
  expect(run(["--help"])).toBe(0);
  expect(run([])).toBe(0);
  expect(run(["--unknown"])).toBe(2);
});
