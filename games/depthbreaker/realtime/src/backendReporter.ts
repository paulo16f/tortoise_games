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

/** Result of a synchronous wallet call. ok=false covers both HTTP errors and
 *  unreachable-backend; `status` distinguishes 402 (insufficient) when present. */
export interface WalletResult {
  ok: boolean;
  balance?: number;
  status?: number;
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

  // Wallet calls are SYNCHRONOUS (the market transaction awaits the result) and
  // single-shot: a market click is user-retryable, so no retry loop here.
  async walletBalance(accountId: string): Promise<WalletResult> {
    return this.call("GET", `/internal/wallet/${accountId}`);
  }

  async walletDebit(accountId: string, amount: number, reason: string): Promise<WalletResult> {
    return this.call("POST", `/internal/wallet/${accountId}/debit`, { amount, reason });
  }

  async walletCredit(accountId: string, amount: number, reason: string): Promise<WalletResult> {
    return this.call("POST", `/internal/wallet/${accountId}/credit`, { amount, reason });
  }

  private async call(method: "GET" | "POST", path: string, body?: unknown): Promise<WalletResult> {
    try {
      const res = await fetch(`${this.backendUrl}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          authorization: `Bearer ${this.sharedSecret}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) {
        console.warn(`[backend] ${path} -> ${res.status}`);
        return { ok: false, status: res.status };
      }
      const json = (await res.json()) as { balance?: number };
      return { ok: true, balance: json.balance, status: res.status };
    } catch (err) {
      console.warn(`[backend] ${path} unreachable:`, (err as Error).message);
      return { ok: false };
    }
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
