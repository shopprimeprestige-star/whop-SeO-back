import { create } from "zustand";
import { persist } from "zustand/middleware";
import { applyQuantityDiscount } from "@/lib/quantity-breaks";

export interface CartLine {
  productId: string;
  productSlug: string;
  productTitle: string;
  variantId: string;
  variantLabel: string;
  price: number; // prezzo base unitario (senza scaglione)
  currency: string;
  image: string | null;
  quantity: number;
}

interface CartState {
  lines: CartLine[];
  isOpen: boolean;
  open: () => void;
  close: () => void;
  setOpen: (v: boolean) => void;
  add: (line: CartLine) => void;
  remove: (variantId: string) => void;
  setQty: (variantId: string, qty: number) => void;
  clear: () => void;
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      isOpen: false,
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      setOpen: (v) => set({ isOpen: v }),
      add: (line) =>
        set((s) => {
          const idx = s.lines.findIndex((l) => l.variantId === line.variantId);
          if (idx >= 0) {
            const next = [...s.lines];
            next[idx] = { ...next[idx], quantity: Math.min(10, next[idx].quantity + line.quantity) };
            return { lines: next, isOpen: true };
          }
          return { lines: [...s.lines, line], isOpen: true };
        }),
      remove: (variantId) => set((s) => ({ lines: s.lines.filter((l) => l.variantId !== variantId) })),
      setQty: (variantId, qty) =>
        set((s) => ({
          lines: s.lines.map((l) =>
            l.variantId === variantId ? { ...l, quantity: Math.max(1, Math.min(10, qty)) } : l
          ),
        })),
      clear: () => set({ lines: [] }),
    }),
    { name: "atelier-nord-cart", partialize: (s) => ({ lines: s.lines }) }
  )
);

// Prezzo per riga, applicando lo scaglione quantità sul prezzo unitario.
export const lineTotal = (l: CartLine) => applyQuantityDiscount(l.price, l.quantity) * l.quantity;
export const lineUnitPrice = (l: CartLine) => applyQuantityDiscount(l.price, l.quantity);
export const cartTotal = (lines: CartLine[]) => lines.reduce((s, l) => s + lineTotal(l), 0);
export const cartCount = (lines: CartLine[]) => lines.reduce((s, l) => s + l.quantity, 0);
