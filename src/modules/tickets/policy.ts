import type { EffectiveRole } from '../../auth/session.js';
import type { TicketStatus, TicketVisibility } from './types.js';

/**
 * Server-side ticket authorization (docs/03 + docs/04). UI visibility is never
 * authorization: every route re-checks these against the current DB state.
 */

export interface ActorRef {
  id: string;
  role: EffectiveRole;
}

export interface TicketRef {
  created_by: string;
  assigned_to: string | null;
  team_id: string | null;
  visibility: TicketVisibility;
  status: TicketStatus;
}

export interface AccessInput {
  actor: ActorRef;
  ticket: TicketRef;
  /** Actor belongs to the ticket's team (false when the ticket has no team). */
  teamMember: boolean;
  /** Actor is an explicit watcher of the ticket. */
  watcher: boolean;
}

export function canCreateTicket(role: EffectiveRole): boolean {
  return role === 'admin' || role === 'manager' || role === 'user';
}

/**
 * Readability for non-admins (docs/03): creator, current assignee, explicit
 * watcher, or a member of the owning team when visibility is TEAM.
 * RESTRICTED ignores team membership; admins bypass everything.
 */
export function canReadTicket(a: AccessInput): boolean {
  if (a.actor.role === 'admin') return true;
  if (a.ticket.created_by === a.actor.id || a.ticket.assigned_to === a.actor.id) return true;
  if (a.watcher) return true;
  if (a.ticket.visibility === 'TEAM' && a.ticket.team_id !== null && a.teamMember) return true;
  return false;
}

/** Assign/reassign: admin; manager on own-team tickets or when a participant; user as creator/assignee. */
export function canAssign(a: AccessInput): boolean {
  if (a.actor.role === 'admin') return true;
  if (a.actor.role === 'manager') {
    return a.teamMember || a.ticket.created_by === a.actor.id || a.ticket.assigned_to === a.actor.id;
  }
  if (a.actor.role === 'user') {
    return a.ticket.created_by === a.actor.id || a.ticket.assigned_to === a.actor.id;
  }
  return false;
}

/** Edit title/description/priority: admin; manager on own-team tickets; user as creator. */
export function canEditDetails(a: AccessInput): boolean {
  if (a.actor.role === 'admin') return true;
  if (a.actor.role === 'manager') return a.teamMember;
  if (a.actor.role === 'user') return a.ticket.created_by === a.actor.id;
  return false;
}

/** Start/block/unblock/resolve: admin; manager on own-team tickets; user as current assignee. */
export function canWorkOnTicket(a: AccessInput): boolean {
  if (a.actor.role === 'admin') return true;
  if (a.actor.role === 'manager') return a.teamMember;
  if (a.actor.role === 'user') return a.ticket.assigned_to === a.actor.id;
  return false;
}

/** Close after resolution: admin; manager on own-team tickets; user as creator. */
export function canCloseTicket(a: AccessInput): boolean {
  if (a.actor.role === 'admin') return true;
  if (a.actor.role === 'manager') return a.teamMember;
  if (a.actor.role === 'user') return a.ticket.created_by === a.actor.id;
  return false;
}

/** Reopen with reason: admin; manager on own-team tickets; user as creator or current assignee. */
export function canReopenTicket(a: AccessInput): boolean {
  if (a.actor.role === 'admin') return true;
  if (a.actor.role === 'manager') return a.teamMember;
  if (a.actor.role === 'user') {
    return a.ticket.created_by === a.actor.id || a.ticket.assigned_to === a.actor.id;
  }
  return false;
}

/** Normal comments: any readable ticket, viewers excluded. */
export function canComment(a: AccessInput): boolean {
  return canReadTicket(a) && a.actor.role !== 'viewer';
}

/** Internal notes: readable + (admin | manager | user who is a participant). */
export function canInternalNote(a: AccessInput): boolean {
  if (!canReadTicket(a)) return false;
  if (a.actor.role === 'admin' || a.actor.role === 'manager') return true;
  if (a.actor.role === 'user') {
    return (
      a.ticket.created_by === a.actor.id ||
      a.ticket.assigned_to === a.actor.id ||
      a.watcher
    );
  }
  return false;
}

export type TicketCommand =
  | 'assign'
  | 'start'
  | 'block'
  | 'unblock'
  | 'resolve'
  | 'close'
  | 'reopen';

export interface TransitionRule {
  from: readonly TicketStatus[];
  to: (ticket: TicketRef) => TicketStatus;
}

/** Allowed transition table (docs/04). REOPENED is an event, not a status. */
export const TRANSITIONS: Record<TicketCommand, TransitionRule> = {
  assign: {
    from: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED'],
    to: (t) => (t.status === 'OPEN' ? 'ASSIGNED' : t.status),
  },
  start: { from: ['ASSIGNED', 'BLOCKED'], to: () => 'IN_PROGRESS' },
  block: { from: ['ASSIGNED', 'IN_PROGRESS'], to: () => 'BLOCKED' },
  unblock: { from: ['BLOCKED'], to: () => 'IN_PROGRESS' },
  resolve: { from: ['ASSIGNED', 'IN_PROGRESS', 'BLOCKED'], to: () => 'RESOLVED' },
  close: { from: ['RESOLVED'], to: () => 'CLOSED' },
  reopen: {
    from: ['RESOLVED', 'CLOSED'],
    to: (t) => (t.assigned_to ? 'ASSIGNED' : 'OPEN'),
  },
};

export function canTransition(command: TicketCommand, status: TicketStatus): boolean {
  return TRANSITIONS[command].from.includes(status);
}