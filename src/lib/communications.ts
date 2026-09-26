// Shared by every place a communication can be logged (transaction page,
// Realtor record) so the channel/direction vocabulary stays one list.
export const COMMUNICATION_CHANNELS = ["Phone", "Email", "Text", "In Person"] as const;
export const COMMUNICATION_DIRECTIONS = ["OUTBOUND", "INBOUND"] as const;

export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];
export type CommunicationDirection = (typeof COMMUNICATION_DIRECTIONS)[number];

export function isCommunicationChannel(value: string): value is CommunicationChannel {
  return (COMMUNICATION_CHANNELS as readonly string[]).includes(value);
}

export function isCommunicationDirection(value: string): value is CommunicationDirection {
  return (COMMUNICATION_DIRECTIONS as readonly string[]).includes(value);
}
