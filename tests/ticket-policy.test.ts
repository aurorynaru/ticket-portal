import { describe, expect, it } from 'vitest';
import {
  canAssign,
  canCloseTicket,
  canComment,
  canCreateTicket,
  canEditDetails,
  canInternalNote,
  canReadTicket,
  canReopenTicket,
  canTransition,
  canWorkOnTicket,
  TRANSITIONS,
  type AccessInput,
} from '../src/modules/tickets/policy.js';
import type { TicketStatus, TicketVisibility } from '../src/modules/tickets/types.js';

function input(overrides: {
  role?: AccessInput['actor']['role'];
  actorId?: string;
  createdBy?: string;
  assignedTo?: string | null;
  teamId?: string | null;
  visibility?: TicketVisibility;
  status?: TicketStatus;
  teamMember?: boolean;
  watcher?: boolean;
} = {}): AccessInput {
  return {
    actor: { id: overrides.actorId ?? 'actor-1', role: overrides.role ?? 'user' },
    ticket: {
      created_by: overrides.createdBy ?? 'creator-1',
      assigned_to: overrides.assignedTo === undefined ? null : overrides.assignedTo,
      team_id: overrides.teamId === undefined ? 'team-1' : overrides.teamId,
      visibility: overrides.visibility ?? 'TEAM',
      status: overrides.status ?? 'OPEN',
    },
    teamMember: overrides.teamMember ?? false,
    watcher: overrides.watcher ?? false,
  };
}

describe('canCreateTicket', () => {
  it('allows admin, manager, user; denies viewer', () => {
    expect(canCreateTicket('admin')).toBe(true);
    expect(canCreateTicket('manager')).toBe(true);
    expect(canCreateTicket('user')).toBe(true);
    expect(canCreateTicket('viewer')).toBe(false);
  });
});

describe('canReadTicket', () => {
  it('admin always reads', () => {
    expect(canReadTicket(input({ role: 'admin' }))).toBe(true);
  });

  it('creator and assignee read', () => {
    expect(canReadTicket(input({ actorId: 'creator-1' }))).toBe(true);
    expect(canReadTicket(input({ assignedTo: 'actor-1' }))).toBe(true);
  });

  it('watcher reads', () => {
    expect(canReadTicket(input({ watcher: true }))).toBe(true);
  });

  it('team member reads TEAM tickets only', () => {
    expect(canReadTicket(input({ teamMember: true, visibility: 'TEAM' }))).toBe(true);
    expect(canReadTicket(input({ teamMember: true, visibility: 'RESTRICTED' }))).toBe(false);
  });

  it('stranger cannot read', () => {
    expect(canReadTicket(input({}))).toBe(false);
  });
});

describe('canAssign', () => {
  it('admin always', () => {
    expect(canAssign(input({ role: 'admin' }))).toBe(true);
  });

  it('manager on own-team, created, or assigned tickets', () => {
    expect(canAssign(input({ role: 'manager', teamMember: true }))).toBe(true);
    expect(canAssign(input({ role: 'manager', actorId: 'creator-1' }))).toBe(true);
    expect(canAssign(input({ role: 'manager', assignedTo: 'actor-1' }))).toBe(true);
    expect(canAssign(input({ role: 'manager' }))).toBe(false);
  });

  it('user only as creator or assignee', () => {
    expect(canAssign(input({ actorId: 'creator-1' }))).toBe(true);
    expect(canAssign(input({ assignedTo: 'actor-1' }))).toBe(true);
    expect(canAssign(input({}))).toBe(false);
  });

  it('viewer never', () => {
    expect(canAssign(input({ role: 'viewer', actorId: 'creator-1' }))).toBe(false);
  });
});

describe('canEditDetails', () => {
  it('admin always; manager on own team; user as creator', () => {
    expect(canEditDetails(input({ role: 'admin' }))).toBe(true);
    expect(canEditDetails(input({ role: 'manager', teamMember: true }))).toBe(true);
    expect(canEditDetails(input({ role: 'manager' }))).toBe(false);
    expect(canEditDetails(input({ actorId: 'creator-1' }))).toBe(true);
    expect(canEditDetails(input({}))).toBe(false);
  });
});

describe('canWorkOnTicket', () => {
  it('admin always; manager on own team; user as assignee', () => {
    expect(canWorkOnTicket(input({ role: 'admin' }))).toBe(true);
    expect(canWorkOnTicket(input({ role: 'manager', teamMember: true }))).toBe(true);
    expect(canWorkOnTicket(input({ role: 'manager' }))).toBe(false);
    expect(canWorkOnTicket(input({ assignedTo: 'actor-1' }))).toBe(true);
    expect(canWorkOnTicket(input({}))).toBe(false);
  });
});

describe('canCloseTicket', () => {
  it('admin always; manager on own team; user as creator', () => {
    expect(canCloseTicket(input({ role: 'admin' }))).toBe(true);
    expect(canCloseTicket(input({ role: 'manager', teamMember: true }))).toBe(true);
    expect(canCloseTicket(input({ actorId: 'creator-1' }))).toBe(true);
    expect(canCloseTicket(input({}))).toBe(false);
  });
});

describe('canReopenTicket', () => {
  it('admin always; manager on own team; user as creator or assignee', () => {
    expect(canReopenTicket(input({ role: 'admin' }))).toBe(true);
    expect(canReopenTicket(input({ role: 'manager', teamMember: true }))).toBe(true);
    expect(canReopenTicket(input({ actorId: 'creator-1' }))).toBe(true);
    expect(canReopenTicket(input({ assignedTo: 'actor-1' }))).toBe(true);
    expect(canReopenTicket(input({}))).toBe(false);
  });
});

describe('canComment / canInternalNote', () => {
  it('viewers cannot comment even when they can read', () => {
    expect(canComment(input({ role: 'viewer', actorId: 'creator-1' }))).toBe(false);
    expect(canComment(input({ actorId: 'creator-1' }))).toBe(true);
  });

  it('internal notes require readability plus elevated/participant role', () => {
    expect(canInternalNote(input({ role: 'admin' }))).toBe(true);
    expect(canInternalNote(input({ role: 'manager', actorId: 'creator-1' }))).toBe(true);
    expect(canInternalNote(input({ actorId: 'creator-1' }))).toBe(true);
    expect(canInternalNote(input({}))).toBe(false);
  });
});

describe('canTransition', () => {
  it('enforces the documented state graph', () => {
    expect(canTransition('start', 'ASSIGNED')).toBe(true);
    expect(canTransition('start', 'OPEN')).toBe(false);
    expect(canTransition('block', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('unblock', 'BLOCKED')).toBe(true);
    expect(canTransition('unblock', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('resolve', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('resolve', 'OPEN')).toBe(false);
    expect(canTransition('close', 'RESOLVED')).toBe(true);
    expect(canTransition('close', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('reopen', 'CLOSED')).toBe(true);
    expect(canTransition('reopen', 'OPEN')).toBe(false);
  });

  it('reopen targets ASSIGNED when assigned, OPEN otherwise', () => {
    expect(TRANSITIONS.reopen.to({ assigned_to: 'u1' } as never)).toBe('ASSIGNED');
    expect(TRANSITIONS.reopen.to({ assigned_to: null } as never)).toBe('OPEN');
  });
});