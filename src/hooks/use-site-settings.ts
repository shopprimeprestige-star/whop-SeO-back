import { useQuery } from "@tanstack/react-query";
import { siteGetSettings } from "@/server-fn/site.functions";

export type SiteSettings = {
  brand_name: string;
  brand_url: string;
  logo_url: string | null;
  logo_dark_url: string | null;
  support_email: string;
  privacy_email: string;
  legal_address: string | null;
  vat_number: string | null;
};

export const SITE_DEFAULT: SiteSettings = {
  brand_name: "Atelier Nord",
  brand_url: "ateliernord.eu",
  logo_url: null,
  logo_dark_url: null,
  support_email: "hello@ateliernord.eu",
  privacy_email: "privacy@ateliernord.eu",
  legal_address: null,
  vat_number: null,
};

export function useSiteSettings(): SiteSettings {
  const { data } = useQuery({
    queryKey: ["site", "settings"],
    queryFn: () => siteGetSettings(),
    staleTime: 60_000,
  });
  return (data as SiteSettings) ?? SITE_DEFAULT;
}
