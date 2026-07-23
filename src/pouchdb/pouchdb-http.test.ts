import { PouchDB } from "./pouchdb-http.ts";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

Deno.test("PouchDB HTTP facade maps document, bulk, find, changes, transforms, and auth", async () => {
    const calls: Array<{ method: string; path: string; body?: any; auth?: string | null }> = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (input, init = {}) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const body = init.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({
            method: init.method ?? "GET",
            path: `${url.pathname}${url.search}`,
            body,
            auth: init.headers instanceof Headers ? init.headers.get("authorization") : null,
        });

        if (url.pathname.endsWith("/doc-a") && init.method === "GET") {
            return jsonResponse({ _id: "doc-a", _rev: "1-a", data: "stored" });
        }
        if (url.pathname.endsWith("/doc-a") && init.method === "PUT") {
            return jsonResponse({ ok: true, id: "doc-a", rev: "2-b" });
        }
        if (url.pathname.endsWith("/_all_docs")) {
            return jsonResponse({ rows: [{ id: "doc-a", key: "doc-a", doc: { _id: "doc-a", data: "stored" } }] });
        }
        if (url.pathname.endsWith("/_bulk_docs")) {
            return jsonResponse([{ ok: true, id: body.docs[0]._id, rev: "1-bulk" }]);
        }
        if (url.pathname.endsWith("/_bulk_get")) {
            return jsonResponse({ results: [{ id: "doc-a", docs: [{ ok: { _id: "doc-a", data: "stored" } }] }] });
        }
        if (url.pathname.endsWith("/_revs_diff")) {
            return jsonResponse({ "doc-a": { missing: ["1-a"] } });
        }
        if (url.pathname.endsWith("/_find")) {
            return jsonResponse({ docs: [{ _id: "doc-a", data: "stored" }] });
        }
        if (url.pathname.endsWith("/_changes")) {
            return jsonResponse({
                results: [{ id: "doc-a", seq: "2", changes: [{ rev: "1-a" }], doc: { _id: "doc-a", data: "stored" } }],
                last_seq: "2",
            });
        }
        return jsonResponse({ error: "not_found", reason: "missing" }, 404);
    };

    try {
        const db = new PouchDB("https://couch.example/vault", {
            auth: { username: "u", password: "p" },
        });
        db.transform({
            incoming: (doc) => ({ ...doc, data: `in:${doc.data}` }),
            outgoing: (doc) => ({ ...doc, data: `out:${doc.data}` }),
        });

        const got = await db.get("doc-a");
        assert(got.data === "out:stored", "expected outgoing transform on get");

        await db.put({ _id: "doc-a", data: "new" });
        const putCall = calls.find((call) => call.method === "PUT");
        assert(putCall?.body.data === "in:new", "expected incoming transform on put");

        const allDocs = await db.allDocs({ include_docs: true, keys: ["doc-a"] });
        assert(allDocs.rows[0].doc.data === "out:stored", "expected outgoing transform on allDocs");

        const bulkDocs = await db.bulkDocs([{ _id: "doc-a", data: "bulk" }]);
        assert(bulkDocs[0].ok === true, "expected bulkDocs response");

        const bulkGet = await db.bulkGet({ docs: [{ id: "doc-a" }] });
        assert(bulkGet.results[0].docs[0].ok.data === "out:stored", "expected outgoing transform on bulkGet");

        const revsDiff = await db.revsDiff({ "doc-a": ["1-a"] });
        assert(revsDiff["doc-a"].missing[0] === "1-a", "expected revsDiff response");

        const found = await db.find({ selector: { type: "plain" } });
        assert(found.docs[0].data === "out:stored", "expected outgoing transform on find");

        let changeSeen = false;
        const changes = await db
            .changes({ include_docs: true, since: "0" })
            .on("change", (change) => {
                changeSeen = change.doc.data === "out:stored";
            });
        assert(changeSeen, "expected change event with transformed doc");
        assert(changes.last_seq === "2", "expected changes last_seq");

        const authCall = calls.find((call) => call.auth);
        assert(authCall?.auth === "Basic dTpw", "expected Basic auth header");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test("PouchDB HTTP facade normalizes CouchDB errors", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(jsonResponse({ error: "not_found", reason: "missing" }, 404));
    try {
        const db = new PouchDB("https://couch.example/vault");
        let status = 0;
        try {
            await db.get("missing");
        } catch (error) {
            status = (error as { status?: number }).status ?? 0;
        }
        assert(status === 404, "expected normalized 404 status");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test("PouchDB live changes normalizes an empty since checkpoint", async () => {
    const originalFetch = globalThis.fetch;
    let requestedSince: string | null = null;
    let changes: ReturnType<PouchDB["changes"]>;

    globalThis.fetch = (input) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        requestedSince = url.searchParams.get("since");
        queueMicrotask(() => changes.cancel());
        return Promise.resolve(jsonResponse({ results: [], last_seq: "0" }));
    };

    try {
        const db = new PouchDB("https://couch.example/vault");
        changes = db.changes({ since: "", live: true });

        await changes;

        assert(requestedSince === "0", "expected an empty since checkpoint to start at sequence zero");
    } finally {
        globalThis.fetch = originalFetch;
    }
});
