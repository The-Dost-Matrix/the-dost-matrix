import { describe, expect, it } from 'vitest';
import {
  classifyPullRequestRisk,
  classifyPullRequestRiskForMission,
} from './risk-classification';

type TestFileChange = {
  path: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
};

const added = (path: string): TestFileChange => ({ path, status: 'added' });
const removed = (path: string): TestFileChange => ({ path, status: 'removed' });

const isolatedAutoApproveFile: TestFileChange[] = [added('src/utils/isolated-helper.ts')];

describe('classifyPullRequestRisk', () => {
  it('treats an empty file list as the lowest risk and auto-approves', () => {
    const result = classifyPullRequestRisk([] as any);

    expect(result.riskLevel).toBe('LOW');
    expect(result.recommendation).toBe('auto-approve');
  });

  it('increases the risk level when more than one file is changed', () => {
    const singleFileResult = classifyPullRequestRisk([added('src/utils/format.ts')] as any);
    const multipleFilesResult = classifyPullRequestRisk(
      [added('src/utils/format.ts'), added('src/utils/parse.ts')] as any
    );

    expect(singleFileResult.riskLevel).toBe('LOW');
    expect(multipleFilesResult.riskLevel).not.toBe('LOW');
    expect(['MEDIUM', 'HIGH', 'CRITICAL']).toContain(multipleFilesResult.riskLevel);
  });

  it('flags a removed file as an elevated risk that needs sign-off', () => {
    const result = classifyPullRequestRisk([removed('src/utils/legacy.ts')] as any);

    expect(result.riskLevel).not.toBe('LOW');
    expect(result.recommendation).toBe('needs-signoff');
  });

  it('flags a file on a critical path as needing sign-off', () => {
    const result = classifyPullRequestRisk([added('.github/workflows/deploy.yml')] as any);

    expect(result.riskLevel).not.toBe('LOW');
    expect(result.recommendation).toBe('needs-signoff');
  });

  it('treats a single isolated, non-critical file as the lowest risk and auto-approves', () => {
    const result = classifyPullRequestRisk(isolatedAutoApproveFile as any);

    expect(result.riskLevel).toBe('LOW');
    expect(result.recommendation).toBe('auto-approve');
  });
});

describe('classifyPullRequestRiskForMission', () => {
  it('leaves the file-based outcome unchanged when the mission risk level is LOW', () => {
    const baseline = classifyPullRequestRisk(isolatedAutoApproveFile as any);
    const withMission = classifyPullRequestRiskForMission(
      isolatedAutoApproveFile as any,
      { riskLevel: 'LOW' } as any
    );

    expect(withMission.riskLevel).toBe(baseline.riskLevel);
    expect(withMission.recommendation).toBe(baseline.recommendation);
  });

  it.each(['MEDIUM', 'HIGH', 'CRITICAL'] as const)(
    'always requires sign-off when the mission risk level is %s, even for an otherwise auto-approve file',
    (missionRiskLevel) => {
      const baseline = classifyPullRequestRisk(isolatedAutoApproveFile as any);
      expect(baseline.recommendation).toBe('auto-approve');

      const withMission = classifyPullRequestRiskForMission(
        isolatedAutoApproveFile as any,
        { riskLevel: missionRiskLevel } as any
      );

      expect(withMission.recommendation).toBe('needs-signoff');
    }
  );
});