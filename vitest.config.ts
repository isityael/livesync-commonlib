import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            "@lib": resolve(root, "src"),
        },
    },
    test: {
        environment: "node",
        exclude: ["**/*.integration.spec.ts", "**/*.integration.test.ts"],
        include: [
            "src/**/*.unit.spec.ts",
            "src/**/*.unit.test.ts",
            "src/pouchdb/pouchdb-http.test.ts",
            "src/managers/lineDiff.test.ts",
        ],
    },
});
