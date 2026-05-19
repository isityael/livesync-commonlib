import { mapAllTasksWithConcurrencyLimit, unwrapTaskResult } from "octagonal-wheels/concurrency/task";

type TransformHooks = {
    incoming?: (doc: any) => Promise<any> | any;
    outgoing?: (doc: any) => Promise<any> | any;
};

type CouchDBAuth = {
    username?: string;
    password?: string;
};

type CouchDBConfig = {
    auth?: CouchDBAuth;
};

type EventHandler = (...args: any[]) => void | Promise<void>;

type CouchErrorBody = {
    error?: string;
    reason?: string;
};

type PurgeMultiResult = {
    ok: true;
    deletedRevs: string[];
    documentWasRemovedCompletely: boolean;
};

type PurgeMultiParam = [docId: string, rev$$1: string];

function encodeDocId(id: string): string {
    return id
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/");
}

function encodeQueryValue(value: unknown): string {
    if (typeof value === "string") return value;
    return JSON.stringify(value);
}

function couchError(status: number, body: CouchErrorBody | string, fallback: string): Error & {
    status: number;
    name: string;
    error?: string;
    reason?: string;
} {
    const detail = typeof body === "string" ? { reason: body } : body;
    const error = new Error(detail.reason || detail.error || fallback) as Error & {
        status: number;
        name: string;
        error?: string;
        reason?: string;
    };
    error.status = status;
    error.name = detail.error || (status === 404 ? "not_found" : "couchdb_error");
    error.error = detail.error;
    error.reason = detail.reason;
    return error;
}

class MinimalEventEmitter {
    private handlers = new Map<string, Set<EventHandler>>();

    on(event: string, handler: EventHandler): this {
        const handlers = this.handlers.get(event) ?? new Set<EventHandler>();
        handlers.add(handler);
        this.handlers.set(event, handlers);
        return this;
    }

    removeAllListeners(event?: string): this {
        if (event) {
            this.handlers.delete(event);
        } else {
            this.handlers.clear();
        }
        return this;
    }

    protected async emit(event: string, ...args: any[]): Promise<void> {
        for (const handler of this.handlers.get(event) ?? []) {
            await handler(...args);
        }
    }
}

class CouchChanges<T extends object> extends MinimalEventEmitter implements PromiseLike<any> {
    private controller = new AbortController();
    private promise: Promise<any>;
    private cancelled = false;
    private lastSeq: string | number | undefined;

    constructor(
        private db: PouchDB<T>,
        private options: Record<string, any>,
    ) {
        super();
        this.promise = this.run();
    }

    cancel(): void {
        this.cancelled = true;
        this.controller.abort();
    }

    then<TResult1 = any, TResult2 = never>(
        onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
        return this.promise.then(onfulfilled, onrejected);
    }

    private async run(): Promise<any> {
        try {
            if (this.options.live) {
                return await this.runLive();
            }
            const response = await this.db.requestChanges(this.options, this.controller.signal);
            await this.emitChanges(response.results ?? []);
            await this.emit("complete", response);
            return response;
        } catch (error) {
            if (this.cancelled && error instanceof DOMException && error.name === "AbortError") {
                const response = { results: [], last_seq: this.lastSeq ?? this.options.since ?? "0" };
                await this.emit("complete", response);
                return response;
            }
            await this.emit("error", error);
            throw error;
        }
    }

    private async runLive(): Promise<any> {
        let since = this.options.since ?? "now";
        do {
            const response = await this.db.requestChanges(
                {
                    ...this.options,
                    since,
                    live: false,
                    feed: "longpoll",
                    timeout: 60000,
                },
                this.controller.signal,
            );
            await this.emitChanges(response.results ?? []);
            since = response.last_seq ?? since;
            this.lastSeq = since;
        } while (!this.cancelled);

        const complete = { results: [], last_seq: since };
        await this.emit("complete", complete);
        return complete;
    }

    private async emitChanges(results: any[]): Promise<void> {
        for (const change of results) {
            this.lastSeq = change.seq;
            await this.emit("change", change);
        }
    }
}

export class PouchDB<T extends object = any> extends MinimalEventEmitter {
    private transforms: TransformHooks[] = [];
    private readonly baseUrl: string;
    private readonly auth?: CouchDBAuth;

    constructor(url: string, config: CouchDBConfig = {}) {
        super();
        this.baseUrl = url.replace(/\/+$/, "");
        this.auth = config.auth;
    }

    static plugin(_plugin: unknown): typeof PouchDB {
        return PouchDB;
    }

    plugin(_plugin: unknown): this {
        return this;
    }

    transform(hooks: TransformHooks): this {
        this.transforms.push(hooks);
        return this;
    }

    async info(): Promise<any> {
        return await this.requestJson([], {}, "GET");
    }

    async close(): Promise<void> {
        await this.emit("close");
    }

    async destroy(): Promise<void> {
        await this.requestJson([], {}, "DELETE");
        await this.close();
    }

    async get<U extends object = T>(id: string, options: Record<string, any> = {}): Promise<U & Record<string, any>> {
        const doc = await this.requestJson([encodeDocId(id)], options, "GET");
        return await this.applyOutgoing(doc);
    }

    async put<U extends object = T>(
        doc: U & Record<string, any>,
        options: Record<string, any> = {},
    ): Promise<{ ok: boolean; id: string; rev: string }> {
        const prepared = await this.prepareIncomingForWrite({ ...doc }, options);
        const id = prepared._id;
        if (!id) {
            throw new Error("Cannot put CouchDB document without _id");
        }
        return await this.requestJson([encodeDocId(id)], options, "PUT", prepared);
    }

    async remove(id: string, rev: string, options: Record<string, any> = {}): Promise<{ ok: boolean; id: string; rev: string }> {
        return await this.requestJson([encodeDocId(id)], { ...options, rev }, "DELETE");
    }

    async allDocs<U extends object = T>(options: Record<string, any> = {}): Promise<any> {
        const { keys, ...query } = options;
        const response = keys
            ? await this.requestJson(["_all_docs"], query, "POST", { keys })
            : await this.requestJson(["_all_docs"], query, "GET");
        if (options.include_docs && response.rows) {
            response.rows = await Promise.all(
                response.rows.map(async (row: any) => row.doc ? { ...row, doc: await this.applyOutgoing(row.doc) } : row),
            );
        }
        return response;
    }

    async bulkDocs<U extends object = T>(
        docs: Array<U & Record<string, any>>,
        options: Record<string, any> = {},
    ): Promise<any[]> {
        const prepared = await Promise.all(docs.map((doc) => this.prepareIncomingForWrite({ ...doc }, options)));
        return await this.requestJson(["_bulk_docs"], {}, "POST", {
            docs: prepared,
            new_edits: options.new_edits,
        });
    }

    async bulkGet<U extends object = T>(options: Record<string, any>): Promise<any> {
        const response = await this.requestJson(["_bulk_get"], {}, "POST", options);
        if (response.results) {
            response.results = await Promise.all(
                response.results.map(async (result: any) => ({
                    ...result,
                    docs: await Promise.all(
                        (result.docs ?? []).map(async (entry: any) =>
                            entry.ok ? { ...entry, ok: await this.applyOutgoing(entry.ok) } : entry
                        ),
                    ),
                })),
            );
        }
        return response;
    }

    async revsDiff(diff: Record<string, string[]>): Promise<any> {
        return await this.requestJson(["_revs_diff"], {}, "POST", diff);
    }

    async find(options: Record<string, any>): Promise<any> {
        const response = await this.requestJson(["_find"], {}, "POST", options);
        if (response.docs) {
            response.docs = await Promise.all(response.docs.map((doc: any) => this.applyOutgoing(doc)));
        }
        return response;
    }

    changes(options: Record<string, any> = {}): CouchChanges<T> {
        return new CouchChanges(this, options);
    }

    async requestChanges(options: Record<string, any>, signal?: AbortSignal): Promise<any> {
        const { selector, live: _live, ...query } = options;
        const requestQuery = { ...query };
        if (selector) requestQuery.filter = "_selector";
        const response = selector
            ? await this.requestJson(["_changes"], requestQuery, "POST", { selector }, signal)
            : await this.requestJson(["_changes"], requestQuery, "GET", undefined, signal);
        if (response.results) {
            response.results = await Promise.all(
                response.results.map(async (change: any) =>
                    change.doc ? { ...change, doc: await this.applyOutgoing(change.doc) } : change
                ),
            );
        }
        return response;
    }

    async purgeMulti(docs: PurgeMultiParam[]): Promise<Record<string, PurgeMultiResult | Error>> {
        const tasks = docs.map(
            ([docId, rev]) => async (): Promise<[PurgeMultiParam, PurgeMultiResult | Error]> => {
                try {
                    const result = await this.requestJson(["_purge"], {}, "POST", { [docId]: [rev] });
                    return [[docId, rev], result[docId] ?? { ok: true, deletedRevs: [rev], documentWasRemovedCompletely: false }];
                } catch (error) {
                    return [[docId, rev], error instanceof Error ? error : new Error(String(error))];
                }
            },
        );
        const ret = await mapAllTasksWithConcurrencyLimit(1, tasks);
        const retAll = ret.map((e) => unwrapTaskResult(e)) as [PurgeMultiParam, PurgeMultiResult | Error][];
        return Object.fromEntries(retAll.map((e) => [e[0][0], e[1]]));
    }

    private async prepareIncomingForWrite(doc: Record<string, any>, options: Record<string, any>): Promise<Record<string, any>> {
        const transformed = options.skipTransform ? doc : await this.applyIncoming(doc);
        if (options.force && transformed._id && !transformed._rev) {
            try {
                const current = await this.get(transformed._id, { skipTransform: true });
                transformed._rev = current._rev;
            } catch (error) {
                if (!this.isNotFound(error)) throw error;
            }
        }
        return transformed;
    }

    private async applyIncoming(doc: any): Promise<any> {
        let current = doc;
        for (const hooks of this.transforms) {
            if (hooks.incoming) current = await hooks.incoming(current);
        }
        return current;
    }

    private async applyOutgoing(doc: any): Promise<any> {
        let current = doc;
        for (const hooks of this.transforms.slice().reverse()) {
            if (hooks.outgoing) current = await hooks.outgoing(current);
        }
        return current;
    }

    private isNotFound(error: unknown): boolean {
        return typeof error === "object" && error !== null && "status" in error && error.status === 404;
    }

    private async requestJson(
        path: string[],
        query: Record<string, any> = {},
        method = "GET",
        body?: unknown,
        signal?: AbortSignal,
    ): Promise<any> {
        const url = new URL(`${this.baseUrl}/${path.join("/")}`);
        for (const [key, value] of Object.entries(query)) {
            if (value === undefined || value === null || value === false) continue;
            url.searchParams.set(key, encodeQueryValue(value));
        }

        const headers = new Headers({ accept: "application/json" });
        if (body !== undefined) headers.set("content-type", "application/json");
        if (this.auth?.username || this.auth?.password) {
            headers.set("authorization", `Basic ${btoa(`${this.auth.username ?? ""}:${this.auth.password ?? ""}`)}`);
        }

        const response = await fetch(url, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal,
        });
        const text = await response.text();
        const parsed = text ? JSON.parse(text) : {};
        if (!response.ok) {
            throw couchError(response.status, parsed, `${method} ${url.pathname} failed`);
        }
        return parsed;
    }
}
