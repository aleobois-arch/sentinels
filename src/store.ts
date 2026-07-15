import { EventEmitter } from 'events';
import { AgentMessage, IncidentRecord, IncidentStatus } from './types';

/**
 * In-memory incident store + per-incident event bus.
 *
 * Keeps every incident's full context (timeline, tool audit trail, report)
 * and lets SSE clients subscribe to live pipeline events. On Alibaba
 * Function Compute this lives for the lifetime of the (warm) instance;
 * a production deployment would swap this for Tablestore or Redis
 * behind the same interface.
 */

export interface IncidentEvent {
  type: 'timeline' | 'status' | 'done' | 'error';
  data: unknown;
}

const incidents = new Map<string, IncidentRecord>();
const buses = new Map<string, EventEmitter>();
const MAX_INCIDENTS = 200;

function busFor(incidentId: string): EventEmitter {
  let bus = buses.get(incidentId);
  if (!bus) {
    bus = new EventEmitter();
    bus.setMaxListeners(50);
    buses.set(incidentId, bus);
  }
  return bus;
}

export function saveIncident(record: IncidentRecord): void {
  record.updatedAt = new Date().toISOString();
  incidents.set(record.incidentId, record);
  // Bound memory usage: evict the oldest incidents beyond the cap.
  if (incidents.size > MAX_INCIDENTS) {
    const oldest = incidents.keys().next().value;
    if (oldest) {
      incidents.delete(oldest);
      buses.delete(oldest);
    }
  }
}

export function getIncident(incidentId: string): IncidentRecord | undefined {
  return incidents.get(incidentId);
}

export function listIncidents(): IncidentRecord[] {
  return Array.from(incidents.values()).reverse();
}

export function publishEvent(incidentId: string, event: IncidentEvent): void {
  busFor(incidentId).emit('event', event);
}

export function publishTimeline(incidentId: string, entry: AgentMessage): void {
  publishEvent(incidentId, { type: 'timeline', data: entry });
}

export function publishStatus(incidentId: string, status: IncidentStatus): void {
  const record = incidents.get(incidentId);
  if (record) {
    record.status = status;
    saveIncident(record);
  }
  publishEvent(incidentId, { type: 'status', data: status });
}

export function subscribe(incidentId: string, listener: (event: IncidentEvent) => void): () => void {
  const bus = busFor(incidentId);
  bus.on('event', listener);
  return () => bus.off('event', listener);
}
