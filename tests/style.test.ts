import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** House style: short hyphens only. No en dash (U+2013) or em dash (U+2014) anywhere in source or docs. */
const ROOTS = ["src", "scripts", "tests", "docs", "README.md", "index.html"];
const LONG_DASH = new RegExp("[\\u2013\\u2014]");

function files(path: string): string[] {
  const full = resolve(__dirname, "..", path);
  try {
    const st = statSync(full);
    if (st.isFile()) return [full];
    return readdirSync(full).flatMap((f) => files(join(path, f)));
  } catch {
    return [];
  }
}

describe("style", () => {
  it("contains no long dashes", () => {
    const offenders = ROOTS.flatMap(files).filter((f) => LONG_DASH.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
  it("contains no leftover debug statements or placeholders in app source", () => {
    const pattern = new RegExp(["console\\.log", "debugger", "TODO", "FIXME", "lorem ipsum", "coming soon"].join("|"), "i");
    const offenders = files("src").filter((f) => pattern.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
