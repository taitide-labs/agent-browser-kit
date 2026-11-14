#!/usr/bin/env bun
import { runMain } from "../dist/cli.js";

const code = await runMain(process.argv.slice(2));
process.exit(code);
