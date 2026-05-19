import { diffLines } from "diff";

export const DIFF_DELETE = -1;
export const DIFF_INSERT = 1;
export const DIFF_EQUAL = 0;

export type Diff = [typeof DIFF_DELETE | typeof DIFF_INSERT | typeof DIFF_EQUAL, string];

export function diffLinesAsTuples(base: string, target: string): Diff[] {
    return diffLines(base, target).map((part) => {
        if (part.added) return [DIFF_INSERT, part.value];
        if (part.removed) return [DIFF_DELETE, part.value];
        return [DIFF_EQUAL, part.value];
    });
}
