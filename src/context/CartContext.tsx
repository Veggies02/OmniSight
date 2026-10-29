import React, { createContext, useReducer, useEffect, useMemo } from "react";
import { products, type Product } from "../data/products";

export interface CartItem {
  product: Product;
  quantity: number;
}

interface StoredCartItem {
  productId: string;
  quantity: number;
}

interface CartState {
  items: CartItem[];
}

type CartAction =
  | { type: "ADD_ITEM"; product: Product; quantity?: number }
  | { type: "REMOVE_ITEM"; productId: string }
  | { type: "UPDATE_QUANTITY"; productId: string; quantity: number }
  | { type: "CLEAR_CART" }
  | { type: "INITIALIZE"; items: CartItem[] };

export interface CartContextValue {
  items: CartItem[];
  totalUnits: number;
  subtotal: number;
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
}

const STORAGE_KEY = "omnishop-cart";

export const CartContext = createContext<CartContextValue | undefined>(undefined);

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "INITIALIZE": {
      return { items: action.items };
    }

    case "ADD_ITEM": {
      if (!action.product || !action.product.id || !action.product.inStock) {
        return state;
      }
      const quantityToAdd = action.quantity && action.quantity > 0 ? Math.floor(action.quantity) : 1;
      const existingIndex = state.items.findIndex(
        (item) => item.product.id === action.product.id
      );

      if (existingIndex > -1) {
        const nextItems = [...state.items];
        const existingItem = nextItems[existingIndex];
        nextItems[existingIndex] = {
          ...existingItem,
          quantity: existingItem.quantity + quantityToAdd,
        };
        return { items: nextItems };
      }

      return {
        items: [...state.items, { product: action.product, quantity: quantityToAdd }],
      };
    }

    case "UPDATE_QUANTITY": {
      const validQty = Math.floor(action.quantity);
      if (validQty <= 0) {
        return {
          items: state.items.filter((item) => item.product.id !== action.productId),
        };
      }
      return {
        items: state.items.map((item) =>
          item.product.id === action.productId
            ? { ...item, quantity: validQty }
            : item
        ),
      };
    }

    case "REMOVE_ITEM": {
      return {
        items: state.items.filter((item) => item.product.id !== action.productId),
      };
    }

    case "CLEAR_CART": {
      return { items: [] };
    }

    default:
      return state;
  }
}

function loadInitialCart(): CartItem[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const validated: CartItem[] = [];
    for (const entry of parsed as StoredCartItem[]) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof entry.productId === "string" &&
        typeof entry.quantity === "number" &&
        Number.isInteger(entry.quantity) &&
        entry.quantity > 0
      ) {
        const foundProduct = products.find((p) => p.id === entry.productId);
        if (foundProduct) {
          validated.push({
            product: foundProduct,
            quantity: entry.quantity,
          });
        }
      }
    }
    return validated;
  } catch {
    // Malformed JSON or storage error - safely degrade to empty cart
    return [];
  }
}

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(cartReducer, { items: [] }, () => ({
    items: loadInitialCart(),
  }));

  // Sync to localStorage whenever items change
  useEffect(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const serialized: StoredCartItem[] = state.items.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
        }));
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
      }
    } catch {
      // Handle quota exceeded or private mode limitations gracefully
    }
  }, [state.items]);

  const totalUnits = useMemo(() => {
    return state.items.reduce((sum, item) => sum + item.quantity, 0);
  }, [state.items]);

  const subtotal = useMemo(() => {
    return state.items.reduce(
      (sum, item) => sum + item.product.price * item.quantity,
      0
    );
  }, [state.items]);

  const addItem = (product: Product, quantity = 1) => {
    dispatch({ type: "ADD_ITEM", product, quantity });
  };

  const removeItem = (productId: string) => {
    dispatch({ type: "REMOVE_ITEM", productId });
  };

  const updateQuantity = (productId: string, quantity: number) => {
    dispatch({ type: "UPDATE_QUANTITY", productId, quantity });
  };

  const clearCart = () => {
    dispatch({ type: "CLEAR_CART" });
  };

  const value: CartContextValue = {
    items: state.items,
    totalUnits,
    subtotal,
    addItem,
    removeItem,
    updateQuantity,
    clearCart,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};
