import { readyEvent } from "./ready.js";
import { interactionCreateEvent } from "./interactionCreate.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BotEvent = { name: string; once?: boolean; execute: (...args: any[]) => unknown };

export const events: BotEvent[] = [readyEvent, interactionCreateEvent];
