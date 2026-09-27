import type { WorldEvent } from '@aiww/schemas';

export function eventKey(simulationId: string, event: WorldEvent): string {
  return `${simulationId}:${event.id}`;
}

export function orderWorldEvents(events: WorldEvent[]): WorldEvent[] {
  return events.slice().sort((left, right) => left.turn - right.turn || left.seq - right.seq);
}

export function mergeEventSnapshot(
  simulationId: string,
  current: WorldEvent[],
  snapshot: WorldEvent[],
): { events: WorldEvent[]; added: WorldEvent[] } {
  const known = new Set(current.map((event) => eventKey(simulationId, event)));
  const added: WorldEvent[] = [];

  for (const event of orderWorldEvents(snapshot)) {
    const key = eventKey(simulationId, event);
    if (known.has(key)) continue;
    known.add(key);
    added.push(event);
  }

  return { events: orderWorldEvents([...current, ...added]), added };
}

export function isVisualAction(event: WorldEvent): boolean {
  return event.type === 'action' && event.status === 'accepted' && Boolean(event.actionId && event.actorId);
}
