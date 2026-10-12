export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  description: string;
  image: string;
  rating: number;
  reviewCount: number;
  inStock: boolean;
  featured?: boolean;
}

export const products: Product[] = [
  {
    id: "prod-1",
    name: "Aura Noise-Cancelling Headphones",
    price: 249.99,
    category: "Audio",
    description: "Premium wireless over-ear headphones with custom dynamic drivers, active noise cancellation, and up to 40 hours of high-fidelity playback.",
    image: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80",
    rating: 4.8,
    reviewCount: 142,
    inStock: true,
    featured: true,
  },
  {
    id: "prod-2",
    name: "Chronos Minimalist Chronograph",
    price: 189.0,
    category: "Accessories",
    description: "Architectural stainless steel timepiece engineered with sapphire crystal glass, Japanese quartz movement, and genuine Italian leather band.",
    image: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80",
    rating: 4.9,
    reviewCount: 98,
    inStock: true,
    featured: true,
  },
  {
    id: "prod-3",
    name: "Nordic Ceramic Pour-Over Set",
    price: 64.5,
    category: "Home & Kitchen",
    description: "Handcrafted matte ceramic dripper and heat-resistant borosilicate carafe designed for balanced temperature retention and optimal extraction.",
    image: "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=800&q=80",
    rating: 4.7,
    reviewCount: 64,
    inStock: true,
    featured: true,
  },
  {
    id: "prod-4",
    name: "Nomad Canvas & Leather Backpack",
    price: 135.0,
    category: "Travel",
    description: "Water-repellent organic cotton canvas daypack with reinforced full-grain leather straps, padded 16-inch laptop sleeve, and brass hardware.",
    image: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=800&q=80",
    rating: 4.6,
    reviewCount: 83,
    inStock: true,
    featured: true,
  },
  {
    id: "prod-5",
    name: "Lumina Aluminum Desk Lamp",
    price: 119.0,
    category: "Home & Office",
    description: "Sleek anodized aluminum task light featuring circadian color temperature shifting, smooth touch-dimming, and an integrated wireless charger base.",
    image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=800&q=80",
    rating: 4.9,
    reviewCount: 52,
    inStock: true,
    featured: false,
  },
  {
    id: "prod-6",
    name: "Verve Mechanical Keyboard",
    price: 159.0,
    category: "Tech",
    description: "Hot-swappable 75% mechanical keyboard with factory-lubed linear switches, sound-dampening silicone gaskets, and south-facing RGB backlighting.",
    image: "https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=800&q=80",
    rating: 4.8,
    reviewCount: 115,
    inStock: true,
    featured: false,
  },
];
