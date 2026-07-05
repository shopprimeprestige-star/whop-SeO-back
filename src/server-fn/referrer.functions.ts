import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { buildWashUrl } from "@/lib/bridge/referrer";

const ShopifyTargetSchema = z
  .string()
  .trim()
  .min(1, "Inserisci un URL Shopify")
  .max(500, "URL troppo lungo")
  .url("Inserisci un URL valido")
  .transform((value) => new URL(value))
  .refine((url) => url.protocol === "https:", "Il target deve usare HTTPS")
  .refine(
    (url) => /\.myshopify\.com$/i.test(url.hostname) || /^checkout\./i.test(url.hostname),
    "Inserisci un dominio Shopify valido"
  )
  .transform((url) => url.toString());

export const buildReferrerTestLink = createServerFn({ method: "POST" })
  .inputValidator((input: { target: string }) => z.object({ target: ShopifyTargetSchema }).parse(input))
  .handler(async ({ data }) => {
    const requestUrl = getRequest().url;
    const washUrl = await buildWashUrl(data.target, requestUrl);
    return {
      target: data.target,
      washUrl,
    };
  });
