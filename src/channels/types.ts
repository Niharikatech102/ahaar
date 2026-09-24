/** Shape every channel adapter normalizes an inbound message into before handing it to the engine. */
export interface ChannelMessage {
  phone: string;
  text: string;
}
