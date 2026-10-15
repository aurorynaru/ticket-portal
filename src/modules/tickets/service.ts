import type { AppDatabase } from '../../db/connection.js';
import type { AuthUser } from '../../auth/session.js';
import { HttpError } from '../../lib/errors.js';
import * as repo from './repository.js';
import {
  TRANSITIONS,
  canAssign,
  canCloseTicket,
  canCreateTicket,
  canComment,
  canEditDetails,
  canInternalNote,
  canReadTicket,
  canReopenTicket,
  canTransition,
  canWorkOnTicket,
  type AccessInput,
  type TicketCommand,
} from './policy.js';
import {
  isTicketKind,
  isTicketPriority,
  isTicketVisibility,
  type TicketKind,
  type TicketPriority,
  type TicketVisibility,
} from './types.js';

export interface ServiceDeps {
  db: AppDatabase;
  actor: AuthUser;
}

const TITLE_MIN = 3;
const TITLE_MAX = 200;
const DESCRIPTION_MIN = 10;
const DESCRIPTION_MAX = 20000;
const COMMENT_MIN = 1;
const COMMENT_MAX = 10000;
const ISSUE_SUMMARY_MIN = 10;
const ISSUE_SUMMARY_MAX = 5000;
const ACTIONS_MIN = 10;
const ACTIONS_MAX = 10000;
const RESOLUTION_MIN = 10;
const RESOLUTION_MAX = 5000;
const ROOT_CAUSE_MAX = 5000;
const REASON_MIN = 10;
const REASON_MAX = 2000;

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireLength(value: string, min: number, max: number, label: string): void {
  if (value.length < min || value.length > max) {
    throw new HttpError(422, `${label} must be between ${min} and ${max} characters.`);
  }
}

function parseDueAt(value: string): number | null {
  if (value === '') return null;
  // The form uses <input type="datetime-local"> which submits "YYYY-MM-DDTHH:mm"
  // (local time). A bare "YYYY-MM-DD" is also accepted and treated as UTC midnight.
  const ms = Date.parse(value.includes('T') ? value : `${value}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new HttpError(422, 'Due date must be a valid date (YYYY-MM-DD).');
  return ms;
}

function accessFor(deps: ServiceDeps, ticket: repo.TicketRow): AccessInput {
  return {
    actor: { id: deps.actor.id, role: deps.actor.role },
    ticket,
    teamMember: ticket.team_id !== null && repo.isTeamMember(deps.db, ticket.team_id, deps.actor.id),
    watcher: repo.isWatcher(deps.db, ticket.id, deps.actor.id),
  };
}

function loadTicket(deps: ServiceDeps, id: string): repo.TicketRow {
  const ticket = repo.getTicket(deps.db, id);
  if (!ticket) throw new HttpError(404, 'Ticket not found');
  return ticket;
}

/** Load a ticket and enforce readability (404 hides existence). */
function loadReadable(deps: ServiceDeps, id: string): { ticket: repo.TicketRow; access: AccessInput } {
  const ticket = loadTicket(deps, id);
  const access = accessFor(deps, ticket);
  if (!canReadTicket(access)) throw new HttpError(404, 'Ticket not found');
  return { ticket, access };
}

function parseVersion(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(422, 'Missing ticket version.');
  return n;
}

function conflict(): HttpError {
  return new HttpError(409, 'This ticket changed while you were working on it. Reload and try again.');
}

function notifyParticipants(db: AppDatabase, ticket: repo.TicketRow, actorId: string, kind: string): void {
  const recipients = new Set<string>();
  if (ticket.created_by && ticket.created_by !== actorId) recipients.add(ticket.created_by);
  if (ticket.assigned_to && ticket.assigned_to !== actorId) recipients.add(ticket.assigned_to);
  for (const recipientId of recipients) {
    repo.insertNotification(db, {
      recipientId,
      ticketId: ticket.id,
      kind,
      payload: { ticketId: ticket.id, actorId },
    });
  }
}

type Mutation = (tx: AppDatabase) => {
  fields: Record<string, unknown>;
  event: { type: string; metadata: Record<string, unknown> };
};

/**
 * Versioned write in one IMMEDIATE transaction: re-read the row, verify the
 * optimistic version, apply fields, bump the version, append the audit event.
 * Zero affected rows (concurrent writer) -> 409.
 */
function runVersioned(deps: ServiceDeps, ticket: repo.TicketRow, version: number, mutate: Mutation): void {
  const tx = deps.db.transaction(() => {
    const fresh = repo.getTicket(deps.db, ticket.id);
    if (!fresh) throw new HttpError(404, 'Ticket not found');
    if (fresh.version !== version) throw conflict();
    const { fields, event } = mutate(deps.db);
    const changes = repo.updateTicketVersioned(deps.db, ticket.id, version, fields);
    if (changes === 0) throw conflict();
    repo.appendEvent(deps.db, {
      ticketId: ticket.id,
      actorId: deps.actor.id,
      type: event.type,
      metadata: event.metadata,
    });
  });
  tx.immediate();
}

function applyTransition(
  deps: ServiceDeps,
  ticket: repo.TicketRow,
  command: TicketCommand,
  version: number,
  mutate: Mutation,
): void {
  if (!canTransition(command, ticket.status)) {
    throw new HttpError(422, `Cannot ${command} a ticket in status ${ticket.status}.`);
  }
  runVersioned(deps, ticket, version, (tx) => {
    const fresh = repo.getTicket(deps.db, ticket.id)!;
    if (!canTransition(command, fresh.status)) {
      throw new HttpError(422, `Cannot ${command} a ticket in status ${fresh.status}.`);
    }
    return mutate(tx);
  });
}

export interface CreateTicketInput {
  title: string;
  description: string;
  kind: string;
  categoryId: string;
  teamId: string;
  visibility: string;
  priority: string;
  assigneeId: string;
  dueAt: string;
}

export function createTicket(deps: ServiceDeps, input: CreateTicketInput): { id: string; ticketNo: number } {
  if (!canCreateTicket(deps.actor.role)) throw new HttpError(403, 'You cannot create tickets.');
  const title = str(input.title);
  const description = str(input.description);
  requireLength(title, TITLE_MIN, TITLE_MAX, 'Title');
  requireLength(description, DESCRIPTION_MIN, DESCRIPTION_MAX, 'Description');
  if (!isTicketKind(input.kind)) throw new HttpError(422, 'Invalid ticket kind.');
  if (!isTicketPriority(input.priority)) throw new HttpError(422, 'Invalid priority.');
  if (!isTicketVisibility(input.visibility)) throw new HttpError(422, 'Invalid visibility.');

  let categoryId: string | null = null;
  if (input.categoryId) {
    const cat = repo.getCategory(deps.db, input.categoryId);
    if (!cat || cat.is_active !== 1) throw new HttpError(422, 'Invalid category.');
    categoryId = cat.id;
  }
  let teamId: string | null = null;
  if (input.teamId) {
    const team = repo.getTeam(deps.db, input.teamId);
    if (!team) throw new HttpError(422, 'Invalid team.');
    teamId = team.id;
  }
  let assignedTo: string | null = null;
  if (input.assigneeId) {
    if (!repo.isUserActive(deps.db, input.assigneeId)) {
      throw new HttpError(422, 'Assignee must be an active user.');
    }
    assignedTo = input.assigneeId;
  }
  const dueAt = parseDueAt(input.dueAt);

  const status = assignedTo ? 'ASSIGNED' : 'OPEN';
  const id = crypto.randomUUID();
  const now = Date.now();

  const tx = deps.db.transaction(() => {
    const ticketNo = repo.nextTicketNo(deps.db);
    repo.insertTicket(deps.db, {
      id,
      ticketNo,
      title,
      description,
      kind: input.kind as TicketKind,
      categoryId,
      teamId,
      visibility: input.visibility as TicketVisibility,
      priority: input.priority as TicketPriority,
      status,
      createdBy: deps.actor.id,
      assignedTo,
      dueAt,
      createdAt: now,
    });
    repo.appendEvent(deps.db, {
      ticketId: id,
      actorId: deps.actor.id,
      type: 'TICKET_CREATED',
      metadata: {
        ticketNo,
        status,
        kind: input.kind,
        priority: input.priority,
        visibility: input.visibility,
      },
    });
    if (assignedTo) {
      repo.appendEvent(deps.db, {
        ticketId: id,
        actorId: deps.actor.id,
        type: 'ASSIGNEE_CHANGED',
        metadata: { before: null, after: assignedTo },
      });
      repo.insertNotification(deps.db, {
        recipientId: assignedTo,
        ticketId: id,
        kind: 'ticket_assigned',
        payload: { ticketId: id, actorId: deps.actor.id },
      });
    }
  });
  tx.immediate();

  const row = repo.getTicket(deps.db, id)!;
  return { id, ticketNo: row.ticket_no };
}

export function assignTicket(deps: ServiceDeps, ticketId: string, assigneeId: string, versionValue: unknown): void {
  const { ticket, access } = loadReadable(deps, ticketId);
  if (!canAssign(access)) throw new HttpError(403, 'You cannot assign this ticket.');
  const version = parseVersion(versionValue);
  if (!assigneeId) throw new HttpError(422, 'Choose an assignee.');
  if (!repo.isUserActive(deps.db, assigneeId)) throw new HttpError(422, 'Assignee must be an active user.');

  applyTransition(deps, ticket, 'assign', version, () => {
    const from = repo.getTicket(deps.db, ticketId)!;
    const to = TRANSITIONS.assign.to(from);
    return {
      fields: { assigned_to: assigneeId, status: to },
      event: {
        type: 'ASSIGNEE_CHANGED',
        metadata: { before: from.assigned_to, after: assigneeId, statusFrom: from.status, statusTo: to },
      },
    };
  });

  const fresh = repo.getTicket(deps.db, ticketId)!;
  notifyParticipants(deps.db, fresh, deps.actor.id, 'ticket_assigned');
}

export function startWork(deps: ServiceDeps, ticketId: string, versionValue: unknown, note: string): void {
  const { ticket, access } = loadReadable(deps, ticketId);
  if (!canWorkOnTicket(access)) throw new HttpError(403, 'You cannot start work on this ticket.');
  const version = parseVersion(versionValue);
  const noteText = str(note);
  if (noteText.length > 2000) throw new HttpError(422, 'Note must be at most 2000 characters.');

  applyTransition(deps, ticket, 'start', version, () => ({
    fields: { status: 'IN_PROGRESS' as const },
    event: {
      type: 'STATUS_CHANGED',
      metadata: { from: ticket.status, to: 'IN_PROGRESS', note: noteText || null },
    },
  }));
  const fresh = repo.getTicket(deps.db, ticketId)!;
  notifyParticipants(deps.db, fresh, deps.actor.id, 'ticket_started');
}

export function blockTicket(deps: ServiceDeps, ticketId: string, versionValue: unknown, reason: string): void {
  const { ticket, access } = loadReadable(deps, ticketId);
  if (!canWorkOnTicket(access)) throw new HttpError(403, 'You cannot block this ticket.');
  const version = parseVersion(versionValue);
  const reasonText = str(reason);
  requireLength(reasonText, 1, REASON_MAX, 'Block reason');

  applyTransition(deps, ticket, 'block', version, () => ({
    fields: { status: 'BLOCKED' as const },
    event: { type: 'STATUS_CHANGED', metadata: { from: ticket.status, to: 'BLOCKED', reason: reasonText } },
  }));
  const fresh = repo.getTicket(deps.db, ticketId)!;
  notifyParticipants(deps.db, fresh, deps.actor.id, 'ticket_blocked');
}

export function unblockTicket(deps: ServiceDeps, ticketId: string, versionValue: unknown): void {
  const { ticket, access } = loadReadable(deps, ticketId);
  if (!canWorkOnTicket(access)) throw new HttpError(403, 'You cannot unblock this ticket.');
  const version = parseVersion(versionValue);

  applyTransition(deps, ticket, 'unblock', version, () => ({
    fields: { status: 'IN_PROGRESS' as const },
    event: { type: 'STATUS_CHANGED', metadata: { from: ticket.status, to: 'IN_PROGRESS' } },
  }));
  const fresh = repo.getTicket(deps.db, ticketId)!;
  notifyParticipants(deps.db, fresh, deps.actor.id, 'ticket_unblocked');
}

export interface ResolveInput {
  issueSummary: string;
  actionsTaken: string;
  resolution: string;
  rootCause: string;
}

export function resolveTicket(deps: ServiceDeps, ticketId: string, versionValue: unknown, input: ResolveInput): void {
  const { ticket, access } = loadReadable(deps, ticketId);
  if (!canWorkOnTicket(access)) throw new HttpError(403, 'You cannot resolve this ticket.');
  const version = parseVersion(versionValue);

  const issueSummary = str(input.issueSummary);
  const actionsTaken = str(input.actionsTaken);
  const resolution = str(input.resolution);
  const rootCause = str(input.rootCause);
  requireLength(issueSummary, ISSUE_SUMMARY_MIN, ISSUE_SUMMARY_MAX, 'Issue summary');
  requireLength(actionsTaken, ACTIONS_MIN, ACTIONS_MAX, 'Actions taken');
  requireLength(resolution, RESOLUTION_MIN, RESOLUTION_MAX, 'Resolution');
  if (rootCause.length > ROOT_CAUSE_MAX) throw new HttpError(422, 'Root cause must be at most 5000 characters.');

  const resolutionId = crypto.randomUUID();
  applyTransition(deps, ticket, 'resolve', version, (tx) => {
    repo.insertResolution(tx, {
      id: resolutionId,
      ticketId,
      issueSummary,
      actionsTaken,
      resolution,
      rootCause: rootCause || null,
      resolvedBy: deps.actor.id,
    });
    return {
      fields: { status: 'RESOLVED' as const, resolved_at: Date.now() },
      event: {
        type: 'RESOLUTION_ADDED',
        metadata: { resolutionId, from: ticket.status, to: 'RESOLVED' },
      },
    };
  });
  const fresh = repo.getTicket(deps.db, ticketId)!;
  notifyParticipants(deps.db, fresh, deps.actor.id, 'ticket_resolved');
}

export function closeTicket(deps: ServiceDeps, ticketId: string, versionValue: unknown): void {
  const { ticket, access } = loadReadable(deps, ticketId);
  if (!canCloseTicket(access)) throw new HttpError(403, 'You cannot close this ticket.');
  const version = parseVersion(versionValue);

  applyTransition(deps, ticket, 'close', version, () => {
    const latest = repo.latestResolution(deps.db, ticketId);
    if (!latest) throw new HttpError(422, 'A ticket can only be closed after it has been resolved.');
    return {
      fields: { status: 'CLOSED' as const, closed_at: Date.now() },
      event: {
        type: 'STATUS_CHANGED',
        metadata: { from: ticket.status, to: 'CLOSED', resolutionId: latest.id },
      },
    };
  });
  const fresh = repo.getTicket(deps.db, ticketId)!;
  notifyParticipants(deps.db, fresh, deps.actor.id, 'ticket_closed');
}

export function reopenTicket(deps: ServiceDeps, ticketId: string, versionValue: unknown, reason: string): void {
  const { ticket, access } = loadReadable(deps, ticketId);
  if (!canReopenTicket(access)) throw new HttpError(403, 'You cannot reopen this ticket.');
  const version = parseVersion(versionValue);
  const reasonText = str(reason);
  requireLength(reasonText, REASON_MIN, REASON_MAX, 'Reopen reason');

  applyTransition(deps, ticket, 'reopen', version, () => {
    const from = repo.getTicket(deps.db, ticketId)!;
    const to = TRANSITIONS.reopen.to(from);
    return {
      fields: { status: to, resolved_at: null, closed_at: null },
      event: {
        type: 'TICKET_REOPENED',
        metadata: { reason: reasonText, from: from.status, to },
      },
    };
  });
  const fresh = repo.getTicket(deps.db, ticketId)!;
  notifyParticipants(deps.db, fresh, deps.actor.id, 'ticket_reopened');
}

export interface EditInput {
  title: string;
  description: string;
  priority: string;
  visibility: string;
  categoryId: string;
  teamId: string;
  dueAt: string;
}

export function editTicket(deps: ServiceDeps, ticketId: string, versionValue: unknown, input: EditInput): void {
  const { ticket, access } = loadReadable(deps, ticketId);
  if (!canEditDetails(access)) throw new HttpError(403, 'You cannot edit this ticket.');
  const version = parseVersion(versionValue);
  if (ticket.status === 'CLOSED') throw new HttpError(422, 'Closed tickets are read-only. Reopen to edit.');

  const title = str(input.title);
  const description = str(input.description);
  requireLength(title, TITLE_MIN, TITLE_MAX, 'Title');
  requireLength(description, DESCRIPTION_MIN, DESCRIPTION_MAX, 'Description');
  if (!isTicketPriority(input.priority)) throw new HttpError(422, 'Invalid priority.');
  if (!isTicketVisibility(input.visibility)) throw new HttpError(422, 'Invalid visibility.');

  let categoryId: string | null = null;
  if (input.categoryId) {
    const cat = repo.getCategory(deps.db, input.categoryId);
    if (!cat || cat.is_active !== 1) throw new HttpError(422, 'Invalid category.');
    categoryId = cat.id;
  }
  let teamId: string | null = null;
  if (input.teamId) {
    const team = repo.getTeam(deps.db, input.teamId);
    if (!team) throw new HttpError(422, 'Invalid team.');
    teamId = team.id;
  }
  const dueAt = parseDueAt(input.dueAt);

  const changed: string[] = [];
  const fields: Record<string, unknown> = {};
  if (title !== ticket.title) {
    fields.title = title;
    changed.push('title');
  }
  if (description !== ticket.description) {
    fields.description = description;
    changed.push('description');
  }
  if (input.priority !== ticket.priority) {
    fields.priority = input.priority;
    changed.push('priority');
  }
  if (input.visibility !== ticket.visibility) {
    fields.visibility = input.visibility;
    changed.push('visibility');
  }
  if (categoryId !== ticket.category_id) {
    fields.category_id = categoryId;
    changed.push('category');
  }
  if (teamId !== ticket.team_id) {
    fields.team_id = teamId;
    changed.push('team');
  }
  if (dueAt !== ticket.due_at) {
    fields.due_at = dueAt;
    changed.push('due_date');
  }
  if (changed.length === 0) return;

  runVersioned(deps, ticket, version, () => ({
    fields,
    event: { type: 'TICKET_EDITED', metadata: { fields: changed } },
  }));
}

export function addComment(
  deps: ServiceDeps,
  ticketId: string,
  content: string,
  isInternal: boolean,
): void {
  const { ticket, access } = loadReadable(deps, ticketId);
  if (ticket.status === 'CLOSED') {
    throw new HttpError(422, 'Closed tickets do not accept new comments. Reopen to continue.');
  }
  if (isInternal) {
    if (!canInternalNote(access)) throw new HttpError(403, 'You cannot add internal notes to this ticket.');
  } else if (!canComment(access)) {
    throw new HttpError(403, 'You cannot comment on this ticket.');
  }
  const text = str(content);
  requireLength(text, COMMENT_MIN, COMMENT_MAX, 'Comment');

  const tx = deps.db.transaction(() => {
    const commentId = crypto.randomUUID();
    repo.insertComment(deps.db, {
      id: commentId,
      ticketId,
      authorId: deps.actor.id,
      content: text,
      isInternal,
    });
    repo.appendEvent(deps.db, {
      ticketId,
      actorId: deps.actor.id,
      type: 'COMMENT_ADDED',
      metadata: { commentId, internal: isInternal },
    });
  });
  tx.immediate();
}

export function setWatcher(deps: ServiceDeps, ticketId: string, userId: string, watch: boolean): void {
  loadReadable(deps, ticketId);
  const self = userId === deps.actor.id;
  const canManageOthers = deps.actor.role === 'admin' || deps.actor.role === 'manager';
  if (!self && !canManageOthers) {
    throw new HttpError(403, 'You cannot change watchers on this ticket.');
  }
  if (!repo.isUserActive(deps.db, userId)) throw new HttpError(422, 'Watcher must be an active user.');

  const tx = deps.db.transaction(() => {
    if (watch) {
      repo.addWatcher(deps.db, ticketId, userId);
      repo.appendEvent(deps.db, {
        ticketId,
        actorId: deps.actor.id,
        type: 'WATCHER_ADDED',
        metadata: { userId },
      });
    } else {
      repo.removeWatcher(deps.db, ticketId, userId);
      repo.appendEvent(deps.db, {
        ticketId,
        actorId: deps.actor.id,
        type: 'WATCHER_REMOVED',
        metadata: { userId },
      });
    }
  });
  tx.immediate();
}