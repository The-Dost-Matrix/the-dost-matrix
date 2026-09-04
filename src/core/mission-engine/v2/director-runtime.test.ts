/**
 * Tests voor `ensureMissionPullRequestMerged` in `director-runtime.ts`.
 *
 * Doel van deze tests: aantonen dat wanneer de risicoclassificatie van een
 * pull request "needs-signoff" is, de functie een fout gooit met een
 * gestructureerd, machineleesbaar foutcode-veld (`code: 'NEEDS_SIGNOFF'`) —
 * in plaats van dat consumenten (zoals de UI) tekstueel moeten matchen op de
 * bewoording van de foutmelding.
 *
 * De GitHub-API-laag wordt volledig gemockt (pull request ophalen en
 * risicoclassificatie bepalen), zodat deze tests deterministisch zijn en
 * zonder netwerktoegang draaien.
 *
 * Let op: de exacte vormen van het `MissionV2`-object en de GitHub-client
 * worden hier bewust via `Parameters<typeof ensureMissionPullRequestMerged>`
 * afgeleid in plaats van los geïmporteerd. Zo blijft deze test gekoppeld aan
 * het daadwerkelijke, publieke contract van de functie (inclusief het aantal
 * en de volgorde van de argumenten), zonder dat interne typenamen hier
 * opnieuw gedupliceerd hoeven te worden.
 */

import { ensureMissionPullRequestMerged } from './director-runtime'

type EnsureMissionPullRequestMergedArgs = Parameters<typeof ensureMissionPullRequestMerged>
type MissionArg = EnsureMissionPullRequestMergedArgs[0]
type GithubClientArg = EnsureMissionPullRequestMergedArgs[1]

function buildMission(overrides: Record<string, unknown> = {}): MissionArg {
  const baseMission = {
    id: 'mission-needs-signoff',
    title: 'Herstel de kapotte testbestanden',
    status: 'awaiting-merge',
    repository: {
      owner: 'dost-matrix',
      name: 'the-dost-matrix',
    },
    pullRequest: {
      owner: 'dost-matrix',
      repo: 'the-dost-matrix',
      number: 123,
    },
  }

  return {
    ...baseMission,
    ...overrides,
  } as unknown as MissionArg
}

function buildGithubClientMock(riskClassification: string): GithubClientArg {
  return {
    getPullRequest: jest.fn().mockResolvedValue({
      number: 123,
      state: 'open',
      merged: false,
      mergeable: true,
    }),
    getPullRequestRiskClassification: jest.fn().mockResolvedValue(riskClassification),
    mergePullRequest: jest.fn().mockResolvedValue({ merged: true }),
  } as unknown as GithubClientArg
}

describe('ensureMissionPullRequestMerged', () => {
  it('gooit een fout met gestructureerde code NEEDS_SIGNOFF wanneer de risicoclassificatie needs-signoff is', async () => {
    const mission = buildMission()
    const githubClient = buildGithubClientMock('needs-signoff')

    await expect(ensureMissionPullRequestMerged(mission, githubClient)).rejects.toMatchObject({
      code: 'NEEDS_SIGNOFF',
    })
  })

  it('gooit geen NEEDS_SIGNOFF-fout wanneer de risicoclassificatie geen signoff vereist', async () => {
    const mission = buildMission()
    const githubClient = buildGithubClientMock('low-risk')

    await expect(ensureMissionPullRequestMerged(mission, githubClient)).resolves.not.toMatchObject({
      code: 'NEEDS_SIGNOFF',
    })
  })

  it('blijft werken als de bewoording van de foutmelding in de toekomst verandert', async () => {
    const mission = buildMission()
    const githubClient = buildGithubClientMock('needs-signoff')

    let capturedError: unknown

    try {
      await ensureMissionPullRequestMerged(mission, githubClient)
    } catch (error) {
      capturedError = error
    }

    expect(capturedError).toBeDefined()
    // De assertie hangt bewust af van het `code`-veld, niet van de exacte
    // tekst van `message`, zodat deze test niet breekt zodra de bewoording
    // van de foutmelding in `director-runtime.ts` wijzigt.
    expect((capturedError as { code?: string }).code).toBe('NEEDS_SIGNOFF')
  })
})