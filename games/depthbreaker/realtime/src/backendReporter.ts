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

  // Wallet/stash calls are SYNCHRONOUS (the transaction awaits the result) and
  // single-shot: a market/bank click is user-retryable, so no retry loop here.
  async walletBalance(accountId: string): Promise<WalletResult> {
    const res = await this.call("GET", `/internal/wallet/${accountId}`);
    return { ok: res.ok, status: res.status, balance: (res.json as { balance?: number } | null)?.balance };
  }

  async walletDebit(accountId: string, amount: number, reason: string): Promise<WalletResult> {
    const res = await this.call("POST", `/internal/wallet/${accountId}/debit`, { amount, reason });
    return { ok: res.ok, status: res.status, balance: (res.json as { balance?: number } | null)?.balance };
  }

  async walletCredit(accountId: string, amount: number, reason: string): Promise<WalletResult> {
    const res = await this.call("POST", `/internal/wallet/${accountId}/credit`, { amount, reason });
    return { ok: res.ok, status: res.status, balance: (res.json as { balance?: number } | null)?.balance };
  }

  async stashList(accountId: string): Promise<{ ok: boolean; items?: { itemId: string; count: number }[] }> {
    const res = await this.call("GET", `/internal/stash/${accountId}`);
    return { ok: res.ok, items: (res.json as { items?: { itemId: string; count: number }[] } | null)?.items };
  }

  async stashDeposit(accountId: string, itemId: string, count: number): Promise<{ ok: boolean; status?: number }> {
    const res = await this.call("POST", `/internal/stash/${accountId}/deposit`, { itemId, count });
    return { ok: res.ok, status: res.status };
  }

  async stashWithdraw(accountId: string, itemId: string, count: number): Promise<{ ok: boolean; status?: number }> {
    const res = await this.call("POST", `/internal/stash/${accountId}/withdraw`, { itemId, count });
    return { ok: res.ok, status: res.status };
  }

  async dailiesList(accountId: string): Promise<{ ok: boolean; json: unknown | null }> {
    return this.call("GET", `/internal/dailies/${accountId}`);
  }

  /** Fire-and-forget progress bump (backend clamps at target, so replays are safe). */
  async dailyProgress(accountId: string, questId: string, delta: number): Promise<void> {
    await this.call("POST", `/internal/dailies/${accountId}/progress`, { questId, delta });
  }

  async dailyClaim(accountId: string, questId: string): Promise<{ ok: boolean; balance?: number; gold?: number; xp?: number }> {
    const res = await this.call("POST", `/internal/dailies/${accountId}/claim`, { questId });
    const j = res.json as { balance?: number; gold?: number; xp?: number } | null;
    return { ok: res.ok, balance: j?.balance, gold: j?.gold, xp: j?.xp };
  }

  async skinsList(characterId: string): Promise<{ ok: boolean; equipped?: string; owned?: string[] }> {
    const res = await this.call("GET", `/internal/characters/${characterId}/skins`);
    const j = res.json as { equipped?: string; owned?: string[] } | null;
    return { ok: res.ok, equipped: j?.equipped, owned: j?.owned };
  }

  async skinBuy(characterId: string, skinId: string): Promise<{ ok: boolean; balance?: number }> {
    const res = await this.call("POST", `/internal/characters/${characterId}/skins/buy`, { skinId });
    return { ok: res.ok, balance: (res.json as { balance?: number } | null)?.balance };
  }

  async skinEquip(characterId: string, skinId: string): Promise<{ ok: boolean }> {
    const res = await this.call("POST", `/internal/characters/${characterId}/skins/equip`, { skinId });
    return { ok: res.ok };
  }

  private async call(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<{ ok: boolean; status?: number; json: unknown | null }> {
    try {
      const res = await fetch(`${this.backendUrl}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          authorization: `Bearer ${this.sharedSecret}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let json: unknown | null = null;
      try {
        json = await res.json();
      } catch {
        /* empty body */
      }
      if (!res.ok) {
        console.warn(`[backend] ${path} -> ${res.status}`);
        return { ok: false, status: res.status, json };
      }
      return { ok: true, status: res.status, json };
    } catch (err) {
      console.warn(`[backend] ${path} unreachable:`, (err as Error).message);
      return { ok: false, json: null };
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
