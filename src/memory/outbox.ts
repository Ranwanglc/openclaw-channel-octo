import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { MemoryClient, MemoryEvent, MemoryLog } from "./types.js";

function key(event: MemoryEvent): string {
  return createHash("sha256").update(JSON.stringify([
    event.scope.kind, event.scope.conversation_id, event.scope.parent_id ?? null, event.message_id, event.event_type,
  ])).digest("hex");
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

export class MemoryOutbox {
  private flushing?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private lastWarning = 0;
  private enqueueTail: Promise<void> = Promise.resolve();
  private directoryReady?: Promise<void>;

  constructor(readonly directory: string, private readonly client: MemoryClient, private readonly log?: MemoryLog,
              private readonly binding = "test-only") {}

  private ensureDirectory(): Promise<void> {
    if (!this.directoryReady) {
      this.directoryReady = this.initializeDirectory().catch((error) => {
        this.directoryReady = undefined;
        throw error;
      });
    }
    return this.directoryReady;
  }

  private async initializeDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, "binding.meta");
    try {
      const handle = await open(path, "wx", 0o600);
      try { await handle.writeFile(this.binding); await handle.sync(); } finally { await handle.close(); }
      await syncDirectory(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (await readFile(path, "utf8") !== this.binding) throw new Error("MEMORY_OUTBOX_BINDING_MISMATCH");
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => { void this.flush(); }, 5000);
    this.timer.unref();
    void this.flush();
  }

  enqueue(event: MemoryEvent): Promise<void> {
    if (this.stopped) throw new Error("MEMORY_OUTBOX_STOPPED");
    const operation = this.enqueueTail.then(() => this.persist(event));
    this.enqueueTail = operation.catch(() => {});
    return operation;
  }

  private async persist(event: MemoryEvent): Promise<void> {
    if (!event.message_id || !event.text.trim() || event.text.length > 32000) throw new Error("INVALID_MEMORY_EVENT");
    await this.ensureDirectory();
    const entries = await readdir(this.directory);
    const suffix = `.${key(event)}.json`;
    const name = entries.find((name) => name.endsWith(suffix))
      ?? `${String(Date.parse(event.occurred_at)).padStart(16, "0")}.${String(event.sequence ?? 0).padStart(16, "0")}${suffix}`;
    const target = join(this.directory, name);
    const encoded = JSON.stringify(event);
    try {
      const old = await readFile(target, "utf8");
      if (old !== encoded) throw new Error("MEMORY_LOCAL_MESSAGE_CONFLICT");
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (entries.filter((name) => name.endsWith(".json")).length >= 10000) {
      throw new Error("MEMORY_OUTBOX_FULL");
    }
    const temporary = join(this.directory, `${key(event)}.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(encoded);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
    await syncDirectory(this.directory);
    void this.flush();
  }

  async flush(): Promise<void> {
    if (this.stopped) return;
    if (this.flushing) return this.flushing;
    this.flushing = this.drain().catch(() => {
      if (Date.now() - this.lastWarning > 30000) {
        this.lastWarning = Date.now();
        this.log?.warn?.("octo: memory delivery unavailable; original events remain in the persistent outbox");
      }
    });
    try { await this.flushing; } finally { this.flushing = undefined; }
  }

  private async drain(): Promise<void> {
    await this.ensureDirectory();
    // File creation times are not message order. Preserve native sequence/time for replay.
    const records = await Promise.all((await readdir(this.directory)).filter((n) => n.endsWith(".json")).sort().slice(0, 50).map(async (name) => ({
      name, event: JSON.parse(await readFile(join(this.directory, name), "utf8")) as MemoryEvent,
    })));
    for (const record of records) {
      if (this.stopped) return;
      const response = await this.client.call("memory_ingest_events", { events: [record.event] }, 10000);
      const accepted = response.events as Array<{ message_id?: string; job_id?: string; status?: string }> | undefined;
      const receipt = accepted?.[0];
      if (response.accepted !== true || accepted?.length !== 1 || receipt?.message_id !== record.event.message_id
          || (!receipt.job_id && receipt.status !== "forgotten")) {
        throw new Error("INVALID_MEMORY_ACK");
      }
      await unlink(join(this.directory, record.name));
      await syncDirectory(this.directory);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.enqueueTail;
    await this.flushing;
  }
}
