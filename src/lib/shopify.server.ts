// Shopify Storefront API helper - direct, transparent connection.
// Used to verify a store and to fetch product details (price/image/title).
// Admins paste shop_domain + Storefront API access token in the admin panel.

const STOREFRONT_API_VERSION = "2024-10";

export type ShopifyMoney = { amount: string; currencyCode: string };

export type ShopifyProduct = {
  id: string;
  title: string;
  handle: string;
  description: string | null;
  onlineStoreUrl: string | null;
  featuredImage: { url: string; altText: string | null } | null;
  priceRange: { minVariantPrice: ShopifyMoney };
  compareAtPriceRange: { minVariantPrice: ShopifyMoney | null };
};

async function storefront<T>(
  shopDomain: string,
  token: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const url = `https://${shopDomain}/api/${STOREFRONT_API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Shopify Storefront API ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data) throw new Error("Shopify Storefront API: empty response");
  return json.data;
}

export async function shopifyPing(shopDomain: string, token: string) {
  const data = await storefront<{ shop: { name: string; primaryDomain: { url: string } } }>(
    shopDomain,
    token,
    `query { shop { name primaryDomain { url } } }`
  );
  return data.shop;
}

export async function shopifyGetProduct(shopDomain: string, token: string, handle: string) {
  const data = await storefront<{ product: ShopifyProduct | null }>(
    shopDomain,
    token,
    `query($handle: String!) {
      product(handle: $handle) {
        id title handle description onlineStoreUrl
        featuredImage { url altText }
        priceRange { minVariantPrice { amount currencyCode } }
        compareAtPriceRange { minVariantPrice { amount currencyCode } }
      }
    }`,
    { handle }
  );
  return data.product;
}

/** Public, transparent product URL on the merchant's Shopify store. */
export function shopifyProductUrl(shopDomain: string, handle: string) {
  return `https://${shopDomain}/products/${handle}`;
}
