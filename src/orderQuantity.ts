import type { Holding } from "./types";

export const MAX_ORDER_QUANTITY = 1000000;
export type QuantityRatio = 25 | 50 | 100;

export function availableSellQuantity(
  holding?: Pick<Holding, "quantity" | "reserved">,
) {
  return Math.max(0, (holding?.quantity ?? 0) - (holding?.reserved ?? 0));
}

export function quantityAtRatio(available: number, ratio: QuantityRatio) {
  if (!Number.isFinite(available) || available < 1) return 0;
  // Orders use whole shares. Show the rounded result on the button before selection.
  return Math.min(
    MAX_ORDER_QUANTITY,
    Math.max(1, Math.floor((available * ratio) / 100)),
  );
}
