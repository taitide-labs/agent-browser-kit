import { expect, test } from "bun:test";
import { runCliArgs } from "./cli.ts";

test("prints version and help", () => {
  expect(runCliArgs(["--version"])).toBe(0);
  expect(runCliArgs(["--help"])).toBe(0);
  expect(runCliArgs([])).toBeNull();
  expect(runCliArgs(["--unknown"])).toBe(2);
});
