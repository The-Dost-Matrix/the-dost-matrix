import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * director-runtime.ts importeert getCombinedCheckStatus en mergePullRequest
 * rechtstreeks vanuit ./github/github-client. Door deze module hier te
 * mocken kunnen we ensureMissionPullRequestMerged isoleren van een
 * daadwerkelijke GitHub API-aanroep en volledige controle houden over de
 * combined check status die de functie te zien krijgt.
 */
vi.mock("./github/github-client", () => ({
  getCombinedCheckStatus: vi.fn(),
  mergePullRequest: vi.fn(),
}));

import { ensureMissionPullRequestMerged, DirectorRuntimeError } from "./director-runtime";
import { getCombinedCheckStatus, mergePullRequest } from "./github/github-client";

/**
 * Bouwt de minimale, gemeenschappelijke input voor ensureMissionPullRequestMerged
 * op die in alle drie de scenario's hieronder wordt hergebruikt. De
 * risicoclassificatie is bewust op een waarde gezet die auto-approve/auto-merge
 * toestaat, zodat de CI-statuscontrole zelf de enige beslissende factor is in
 * deze tests (en niet een eventuele signoff-vereiste).
 */
function buildMergeInput(overrides: Record<string, unknown> = {}) {
  return {
    owner: "acme-org",
    repo: "dost-matrix",
    pullNumber: 42,
    headSha: "abc123def456",
    riskClassification: "auto-approve",
    ...overrides,
  } as never;
}

describe("ensureMissionPullRequestMerged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gooit een DirectorRuntimeError met code CI_CHECKS_FAILED en roept mergePullRequest niet aan wanneer de combined check status 'failure' is", async () => {
    vi.mocked(getCombinedCheckStatus).mockResolvedValue({ state: "failure" } as never);

    const input = buildMergeInput();

    await expect(ensureMissionPullRequestMerged(input)).rejects.toThrow(DirectorRuntimeError);

    let caughtError: unknown;
    try {
      await ensureMissionPullRequestMerged(buildMergeInput());
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(DirectorRuntimeError);
    expect((caughtError as DirectorRuntimeError).code).toBe("CI_CHECKS_FAILED");
    expect(mergePullRequest).not.toHaveBeenCalled();
  });

  it("gooit een DirectorRuntimeError met code CI_CHECKS_PENDING en roept mergePullRequest niet aan wanneer de combined check status 'pending' is", async () => {
    vi.mocked(getCombinedCheckStatus).mockResolvedValue({ state: "pending" } as never);

    const input = buildMergeInput();

    await expect(ensureMissionPullRequestMerged(input)).rejects.toThrow(DirectorRuntimeError);

    let caughtError: unknown;
    try {
      await ensureMissionPullRequestMerged(buildMergeInput());
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(DirectorRuntimeError);
    expect((caughtError as DirectorRuntimeError).code).toBe("CI_CHECKS_PENDING");
    expect(mergePullRequest).not.toHaveBeenCalled();
  });

  it("roept mergePullRequest aan wanneer de combined check status geslaagd is en de risicoclassificatie auto-approve toestaat", async () => {
    vi.mocked(getCombinedCheckStatus).mockResolvedValue({ state: "success" } as never);
    vi.mocked(mergePullRequest).mockResolvedValue(undefined as never);

    const input = buildMergeInput();

    await ensureMissionPullRequestMerged(input);

    expect(mergePullRequest).toHaveBeenCalledTimes(1);
  });
});