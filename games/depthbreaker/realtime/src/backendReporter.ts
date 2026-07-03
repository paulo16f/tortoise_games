// Reports authoritative run results back to the durable backend's /internal
// API using the shared secret (design doc trust boundary 3). Fire-and-forget
// with a small retry; failures are logged, never silently dropped.

export interface RunFinishReport {
  outcome: "dead" | "complete" | "abandoned";
  depthReached: number;
  xpEarned: number;
  currencyEarned: number;
  loot?: unknown[];
}

export class BackendReporter {
  constructor(
    private readonly backendUrl: string,
    private readonly sharedSecret: string,
  ) {}

  async reportRunFinish(runId: string, report: RunFinishReport): Promise<boolean> {
    return this.post(`/internal/runs/${runId}/finish`, report);
  }

  async reportCheckpoint(characterId: string, depthReached: number): Promise<boolean> {
    return this.post(`/internal/characters/${characterId}/checkpoint`, { depthReached });
  }

  private async post(path: string, body: unknown): Promise<boolean> {
    const url = `${this.backendUrl}${path}`;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.sharedSecret}`,
          },
          body: JSON.stringify(body),
        });
        if (res.ok) return true;
        // 4xx won't improve on retry (bad secret, already finished, implausible).
        if (res.status < 500) {
          console.warn(`[backend] ${path} rejected ${res.status}`);
          return false;
        }
      } catch (err) {
        console.warn(`[backend] ${path} attempt ${attempt} failed:`, (err as Error).message);
      }
      await new Promise((r) => setTimeout(r, attempt * 250));
    }
    console.error(`[backend] ${path} gave up after 3 attempts`);
    return false;
  }
}
