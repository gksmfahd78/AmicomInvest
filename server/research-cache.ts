import type { ResearchResult } from "../src/researchTypes";

export class ResearchCache {
  private entries = new Map<
    string,
    { result: ResearchResult<unknown>; until: number }
  >();
  private pending = new Map<string, Promise<ResearchResult<unknown>>>();
  constructor(private now = Date.now) {}
  async get<T>(
    key: string,
    ttl: number,
    source: ResearchResult<T>["source"],
    fetcher: () => Promise<T>,
    empty: (data: T) => boolean = () => false,
  ): Promise<ResearchResult<T>> {
    const hit = this.entries.get(key);
    if (hit && hit.until > this.now()) return hit.result as ResearchResult<T>;
    if (this.pending.has(key))
      return this.pending.get(key)! as Promise<ResearchResult<T>>;
    const task = (async () => {
      let result: ResearchResult<T>, until: number;
      try {
        const data = await fetcher();
        result = {
          status: empty(data) ? "empty" : "ok",
          data,
          receivedAt: this.now(),
          source,
        };
        until = this.now() + ttl;
      } catch {
        result = {
          status: hit?.result.data ? "stale" : "error",
          data: (hit?.result.data as T) ?? null,
          receivedAt: hit?.result.receivedAt ?? null,
          source,
        };
        until = this.now() + 60000;
      }
      this.entries.delete(key);
      this.entries.set(key, { result, until });
      while (this.entries.size > 256)
        this.entries.delete(this.entries.keys().next().value!);
      return result;
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
}
