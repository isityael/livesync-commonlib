import { DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT, diffLinesAsTuples } from "./lineDiff.ts";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

Deno.test("diffLinesAsTuples preserves equal, delete, and insert tuple shape", () => {
    const diff = diffLinesAsTuples("a\nb\n", "a\nc\n");

    assert(diff.length === 3, `expected 3 diff pieces, got ${diff.length}`);
    assert(diff[0][0] === DIFF_EQUAL && diff[0][1] === "a\n", "expected equal first line");
    assert(diff[1][0] === DIFF_DELETE && diff[1][1] === "b\n", "expected deleted second line");
    assert(diff[2][0] === DIFF_INSERT && diff[2][1] === "c\n", "expected inserted second line");
});
