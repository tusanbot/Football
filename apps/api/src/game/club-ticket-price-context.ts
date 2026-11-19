import { AsyncLocalStorage } from "node:async_hooks";

export interface ClubTicketPriceUpdate {
  ticketPrice: string;
  previousTicketPrice: string;
  replayed: boolean;
}
export interface ClubTicketPricePort {
  update(userId: string, ticketPrice: bigint, expectedTicketPrice: bigint): Promise<ClubTicketPriceUpdate>;
}
const scope = new AsyncLocalStorage<ClubTicketPricePort>();
export function withClubTicketPricePort<T>(port: ClubTicketPricePort, operation: () => Promise<T>): Promise<T> {
  return scope.run(port, operation);
}
export function getClubTicketPricePort(): ClubTicketPricePort | undefined {
  return scope.getStore();
}
