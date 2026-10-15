export const TICKET_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'RESOLVED', 'CLOSED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_KINDS = ['TASK', 'INCIDENT', 'REQUEST', 'BUG'] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

export const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_VISIBILITIES = ['TEAM', 'RESTRICTED'] as const;
export type TicketVisibility = (typeof TICKET_VISIBILITIES)[number];

export const EVENT_TYPES = [
  'TICKET_CREATED',
  'ASSIGNEE_CHANGED',
  'STATUS_CHANGED',
  'RESOLUTION_ADDED',
  'TICKET_REOPENED',
  'TICKET_EDITED',
  'COMMENT_ADDED',
  'WATCHER_ADDED',
  'WATCHER_REMOVED',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === 'string' && (TICKET_STATUSES as readonly string[]).includes(value);
}

export function isTicketKind(value: unknown): value is TicketKind {
  return typeof value === 'string' && (TICKET_KINDS as readonly string[]).includes(value);
}

export function isTicketPriority(value: unknown): value is TicketPriority {
  return typeof value === 'string' && (TICKET_PRIORITIES as readonly string[]).includes(value);
}

export function isTicketVisibility(value: unknown): value is TicketVisibility {
  return typeof value === 'string' && (TICKET_VISIBILITIES as readonly string[]).includes(value);
}

/** Presentational padding: 7 -> "TKT-000007". */
export function formatTicketNo(ticketNo: number): string {
  return `TKT-${String(ticketNo).padStart(6, '0')}`;
}