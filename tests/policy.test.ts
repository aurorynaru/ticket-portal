import { describe, expect, it } from 'vitest';
import {
  canManageUsers,
  canViewAdminPanel,
  canAccessApp,
  isAssignableLevel,
  ASSIGNABLE_LEVELS,
} from '../src/auth/policy.js';
import { resolveEffectiveRole } from '../src/auth/session.js';

describe('policy', () => {
  it('only admins can manage users / view the admin panel', () => {
    expect(canManageUsers('admin')).toBe(true);
    expect(canViewAdminPanel('admin')).toBe(true);
    for (const role of ['manager', 'user', 'viewer'] as const) {
      expect(canManageUsers(role)).toBe(false);
      expect(canViewAdminPanel(role)).toBe(false);
    }
  });

  it('any resolved role can access the app; null cannot', () => {
    expect(canAccessApp('admin')).toBe(true);
    expect(canAccessApp('viewer')).toBe(true);
    expect(canAccessApp(null)).toBe(false);
  });

  it('exposes the assignable non-admin levels', () => {
    expect(ASSIGNABLE_LEVELS).toEqual(['manager', 'user', 'viewer']);
    expect(isAssignableLevel('manager')).toBe(true);
    expect(isAssignableLevel('admin')).toBe(false);
    expect(isAssignableLevel('nope')).toBe(false);
    expect(isAssignableLevel(42)).toBe(false);
  });
});

describe('resolveEffectiveRole', () => {
  it('denies when the profile is missing or inactive', () => {
    expect(resolveEffectiveRole('admin', null)).toBeNull();
    expect(resolveEffectiveRole('admin', { accessLevel: 'manager', isActive: false })).toBeNull();
  });

  it('admin requires the auth role AND an active profile', () => {
    expect(resolveEffectiveRole('admin', { accessLevel: 'user', isActive: true })).toBe('admin');
    expect(resolveEffectiveRole('user', { accessLevel: 'manager', isActive: true })).toBe('manager');
  });

  it('non-admin roles come from the profile access level', () => {
    expect(resolveEffectiveRole('user', { accessLevel: 'viewer', isActive: true })).toBe('viewer');
    expect(resolveEffectiveRole('user', { accessLevel: 'user', isActive: true })).toBe('user');
  });
});