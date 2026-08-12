import { describe, expect, it } from 'vitest';
import { WorkflowDriverRegistry } from '../../../src/infrastructure/workflow/driver-registry.js';

describe('WorkflowDriverRegistry', () => {
  const driver = { available: async () => ({ available: true, detail: 'test' }) } as any;

  it('resolves drivers by adapter and semantic role', () => {
    const registry = new WorkflowDriverRegistry().register('codex', 'supervisor', driver);
    expect(registry.require('codex', 'supervisor')).toBe(driver);
    expect(registry.get('codex', 'reviewer')).toBeUndefined();
  });

  it('rejects duplicate and unsupported registrations', () => {
    const registry = new WorkflowDriverRegistry().register('codex', 'supervisor', driver);
    expect(() => registry.register('codex', 'supervisor', driver)).toThrow('already registered');
    expect(() => registry.require('claude', 'supervisor')).toThrow('Unsupported supervisor binding: claude');
  });
});
