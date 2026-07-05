export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      articles: {
        Row: {
          category: string | null
          content: string | null
          cover_image: string | null
          created_at: string
          excerpt: string | null
          featured: boolean
          id: string
          published_at: string | null
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          content?: string | null
          cover_image?: string | null
          created_at?: string
          excerpt?: string | null
          featured?: boolean
          id?: string
          published_at?: string | null
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          content?: string | null
          cover_image?: string | null
          created_at?: string
          excerpt?: string | null
          featured?: boolean
          id?: string
          published_at?: string | null
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      bridge_handshake_log: {
        Row: {
          created_at: string
          id: string
          integration_type: string | null
          ip: string | null
          outcome: string
          reason: string | null
          shop_domain: string | null
          site_a_store_id: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          integration_type?: string | null
          ip?: string | null
          outcome: string
          reason?: string | null
          shop_domain?: string | null
          site_a_store_id?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          integration_type?: string | null
          ip?: string | null
          outcome?: string
          reason?: string | null
          shop_domain?: string | null
          site_a_store_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      bridge_logs: {
        Row: {
          created_at: string
          direction: string
          endpoint: string
          error: string | null
          http_status: number | null
          id: string
          payload: Json | null
          store_id: string | null
          success: boolean
        }
        Insert: {
          created_at?: string
          direction: string
          endpoint: string
          error?: string | null
          http_status?: number | null
          id?: string
          payload?: Json | null
          store_id?: string | null
          success?: boolean
        }
        Update: {
          created_at?: string
          direction?: string
          endpoint?: string
          error?: string | null
          http_status?: number | null
          id?: string
          payload?: Json | null
          store_id?: string | null
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "bridge_logs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "bridge_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      bridge_orders: {
        Row: {
          cancelled_at: string | null
          created_at: string
          created_at_shopify: string | null
          currency: string | null
          financial_status: string | null
          id: string
          notified_at: string | null
          order_number: string | null
          shopify_order_id: string
          store_id: string
          total_price: number | null
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          created_at_shopify?: string | null
          currency?: string | null
          financial_status?: string | null
          id?: string
          notified_at?: string | null
          order_number?: string | null
          shopify_order_id: string
          store_id: string
          total_price?: number | null
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          created_at_shopify?: string | null
          currency?: string | null
          financial_status?: string | null
          id?: string
          notified_at?: string | null
          order_number?: string | null
          shopify_order_id?: string
          store_id?: string
          total_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bridge_orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "bridge_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      bridge_push_log: {
        Row: {
          created_at: string
          error: string | null
          http_status: number | null
          id: string
          ip: string | null
          outcome: string
          shadow_handle: string | null
          shopify_product_id: string | null
          site_a_store_id: string | null
          source_product_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          http_status?: number | null
          id?: string
          ip?: string | null
          outcome: string
          shadow_handle?: string | null
          shopify_product_id?: string | null
          site_a_store_id?: string | null
          source_product_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          http_status?: number | null
          id?: string
          ip?: string | null
          outcome?: string
          shadow_handle?: string | null
          shopify_product_id?: string | null
          site_a_store_id?: string | null
          source_product_id?: string | null
        }
        Relationships: []
      }
      bridge_rate_limits: {
        Row: {
          last_call_at: string
          store_id: string
          updated_at: string
        }
        Insert: {
          last_call_at?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          last_call_at?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bridge_rate_limits_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "bridge_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      bridge_referrer_probes: {
        Row: {
          created_at: string
          id: string
          referer: string | null
          source: string | null
          store_id: string | null
          target_host: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          referer?: string | null
          source?: string | null
          store_id?: string | null
          target_host?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          referer?: string | null
          source?: string | null
          store_id?: string | null
          target_host?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bridge_referrer_probes_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "bridge_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      bridge_revenue_events: {
        Row: {
          amount: number
          created_at: string
          currency: string | null
          event_type: string
          id: string
          occurred_at: string
          order_number: string | null
          shopify_order_id: string
          store_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          currency?: string | null
          event_type: string
          id?: string
          occurred_at?: string
          order_number?: string | null
          shopify_order_id: string
          store_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string | null
          event_type?: string
          id?: string
          occurred_at?: string
          order_number?: string | null
          shopify_order_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bridge_revenue_events_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "bridge_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      bridge_shadow_products: {
        Row: {
          bridge_store_id: string | null
          created_at: string
          currency: string | null
          id: string
          last_error: string | null
          price: number | null
          source_product_code: string | null
          source_product_id: string
          source_product_slug: string | null
          title: string | null
          updated_at: string
          whop_checkout_url: string | null
          whop_plan_id: string | null
          whop_product_id: string | null
        }
        Insert: {
          bridge_store_id?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          last_error?: string | null
          price?: number | null
          source_product_code?: string | null
          source_product_id: string
          source_product_slug?: string | null
          title?: string | null
          updated_at?: string
          whop_checkout_url?: string | null
          whop_plan_id?: string | null
          whop_product_id?: string | null
        }
        Update: {
          bridge_store_id?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          last_error?: string | null
          price?: number | null
          source_product_code?: string | null
          source_product_id?: string
          source_product_slug?: string | null
          title?: string | null
          updated_at?: string
          whop_checkout_url?: string | null
          whop_plan_id?: string | null
          whop_product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bridge_shadow_products_bridge_store_id_fkey"
            columns: ["bridge_store_id"]
            isOneToOne: false
            referencedRelation: "bridge_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      bridge_stores: {
        Row: {
          allowed_origin: string | null
          bridge_api_key_encrypted: string
          bridge_api_key_hash: string
          callback_url: string | null
          checkout_provider: string
          created_at: string
          custom_domains: string[] | null
          default_note_attributes: Json | null
          default_order_note: string | null
          default_tags: string | null
          display_name: string | null
          id: string
          is_active: boolean
          last_callback_at: string | null
          last_error: string | null
          last_handshake_at: string | null
          last_sync_at: string | null
          product_push_url: string | null
          rate_limit_rps: number | null
          shop_domain: string
          shopify_access_token_encrypted: string
          shopify_api_key_encrypted: string | null
          shopify_api_secret_encrypted: string | null
          shopify_api_version: string
          shopify_webhook_secret_encrypted: string | null
          site_a_store_id: string
          sync_key: string | null
          updated_at: string
          user_agent: string | null
          whop_api_key_encrypted: string | null
          whop_company_id: string | null
          whop_plan_id: string | null
          whop_product_id: string | null
          whop_webhook_secret_encrypted: string | null
        }
        Insert: {
          allowed_origin?: string | null
          bridge_api_key_encrypted?: string
          bridge_api_key_hash?: string
          callback_url?: string | null
          checkout_provider?: string
          created_at?: string
          custom_domains?: string[] | null
          default_note_attributes?: Json | null
          default_order_note?: string | null
          default_tags?: string | null
          display_name?: string | null
          id?: string
          is_active?: boolean
          last_callback_at?: string | null
          last_error?: string | null
          last_handshake_at?: string | null
          last_sync_at?: string | null
          product_push_url?: string | null
          rate_limit_rps?: number | null
          shop_domain: string
          shopify_access_token_encrypted?: string
          shopify_api_key_encrypted?: string | null
          shopify_api_secret_encrypted?: string | null
          shopify_api_version?: string
          shopify_webhook_secret_encrypted?: string | null
          site_a_store_id: string
          sync_key?: string | null
          updated_at?: string
          user_agent?: string | null
          whop_api_key_encrypted?: string | null
          whop_company_id?: string | null
          whop_plan_id?: string | null
          whop_product_id?: string | null
          whop_webhook_secret_encrypted?: string | null
        }
        Update: {
          allowed_origin?: string | null
          bridge_api_key_encrypted?: string
          bridge_api_key_hash?: string
          callback_url?: string | null
          checkout_provider?: string
          created_at?: string
          custom_domains?: string[] | null
          default_note_attributes?: Json | null
          default_order_note?: string | null
          default_tags?: string | null
          display_name?: string | null
          id?: string
          is_active?: boolean
          last_callback_at?: string | null
          last_error?: string | null
          last_handshake_at?: string | null
          last_sync_at?: string | null
          product_push_url?: string | null
          rate_limit_rps?: number | null
          shop_domain?: string
          shopify_access_token_encrypted?: string
          shopify_api_key_encrypted?: string | null
          shopify_api_secret_encrypted?: string | null
          shopify_api_version?: string
          shopify_webhook_secret_encrypted?: string | null
          site_a_store_id?: string
          sync_key?: string | null
          updated_at?: string
          user_agent?: string | null
          whop_api_key_encrypted?: string | null
          whop_company_id?: string | null
          whop_plan_id?: string | null
          whop_product_id?: string | null
          whop_webhook_secret_encrypted?: string | null
        }
        Relationships: []
      }
      bridge_wash_nonces: {
        Row: {
          created_at: string
          expires_at: string
          rid: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          rid: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          rid?: string
        }
        Relationships: []
      }
      bridge_webhooks: {
        Row: {
          address: string
          created_at: string
          format: string | null
          id: string
          last_error: string | null
          shopify_webhook_id: number
          status: string | null
          store_id: string
          topic: string
          updated_at: string
        }
        Insert: {
          address: string
          created_at?: string
          format?: string | null
          id?: string
          last_error?: string | null
          shopify_webhook_id: number
          status?: string | null
          store_id: string
          topic: string
          updated_at?: string
        }
        Update: {
          address?: string
          created_at?: string
          format?: string | null
          id?: string
          last_error?: string | null
          shopify_webhook_id?: number
          status?: string | null
          store_id?: string
          topic?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bridge_webhooks_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "bridge_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      capi_config: {
        Row: {
          created_at: string
          id: string
          meta_access_token: string | null
          meta_pixel_id: string | null
          meta_test_event_code: string | null
          shopify_webhook_secret: string | null
          singleton: boolean
          target_site_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          meta_access_token?: string | null
          meta_pixel_id?: string | null
          meta_test_event_code?: string | null
          shopify_webhook_secret?: string | null
          singleton?: boolean
          target_site_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          meta_access_token?: string | null
          meta_pixel_id?: string | null
          meta_test_event_code?: string | null
          shopify_webhook_secret?: string | null
          singleton?: boolean
          target_site_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      capi_events: {
        Row: {
          created_at: string
          error: string | null
          http_status: number | null
          id: string
          meta_event_name: string | null
          payload_excerpt: string | null
          status: string
          topic: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          http_status?: number | null
          id?: string
          meta_event_name?: string | null
          payload_excerpt?: string | null
          status: string
          topic?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          http_status?: number | null
          id?: string
          meta_event_name?: string | null
          payload_excerpt?: string | null
          status?: string
          topic?: string | null
        }
        Relationships: []
      }
      compared_products: {
        Row: {
          category: string | null
          compare_at_price: number | null
          created_at: string
          currency: string | null
          description: string | null
          featured: boolean
          id: string
          image_url: string | null
          price: number | null
          published: boolean
          shopify_product_handle: string | null
          shopify_store_id: string | null
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          compare_at_price?: number | null
          created_at?: string
          currency?: string | null
          description?: string | null
          featured?: boolean
          id?: string
          image_url?: string | null
          price?: number | null
          published?: boolean
          shopify_product_handle?: string | null
          shopify_store_id?: string | null
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          compare_at_price?: number | null
          created_at?: string
          currency?: string | null
          description?: string | null
          featured?: boolean
          id?: string
          image_url?: string | null
          price?: number | null
          published?: boolean
          shopify_product_handle?: string | null
          shopify_store_id?: string | null
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "compared_products_shopify_store_id_fkey"
            columns: ["shopify_store_id"]
            isOneToOne: false
            referencedRelation: "shopify_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      external_db_config: {
        Row: {
          external_publishable_key: string | null
          external_service_role_key: string | null
          external_url: string | null
          id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          external_publishable_key?: string | null
          external_service_role_key?: string | null
          external_url?: string | null
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          external_publishable_key?: string | null
          external_service_role_key?: string | null
          external_url?: string | null
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      lovable_sync_config: {
        Row: {
          api_key_encrypted: string | null
          created_at: string
          enabled: boolean
          hmac_secret_encrypted: string | null
          id: string
          notes: string | null
          singleton: boolean
          updated_at: string
        }
        Insert: {
          api_key_encrypted?: string | null
          created_at?: string
          enabled?: boolean
          hmac_secret_encrypted?: string | null
          id?: string
          notes?: string | null
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          api_key_encrypted?: string | null
          created_at?: string
          enabled?: boolean
          hmac_secret_encrypted?: string | null
          id?: string
          notes?: string | null
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      lovable_synced_products: {
        Row: {
          compare_price: number | null
          currency: string | null
          description_long: string | null
          description_short: string | null
          external_id: string
          id: string
          images: Json | null
          locale: string | null
          metadata: Json | null
          price: number | null
          received_at: string
          slug: string | null
          source: string
          status: string
          store_ref: string
          title: string
          updated_at: string
          variants: Json | null
        }
        Insert: {
          compare_price?: number | null
          currency?: string | null
          description_long?: string | null
          description_short?: string | null
          external_id: string
          id?: string
          images?: Json | null
          locale?: string | null
          metadata?: Json | null
          price?: number | null
          received_at?: string
          slug?: string | null
          source?: string
          status?: string
          store_ref: string
          title: string
          updated_at?: string
          variants?: Json | null
        }
        Update: {
          compare_price?: number | null
          currency?: string | null
          description_long?: string | null
          description_short?: string | null
          external_id?: string
          id?: string
          images?: Json | null
          locale?: string | null
          metadata?: Json | null
          price?: number | null
          received_at?: string
          slug?: string | null
          source?: string
          status?: string
          store_ref?: string
          title?: string
          updated_at?: string
          variants?: Json | null
        }
        Relationships: []
      }
      native_checkout_sessions: {
        Row: {
          amount_total: number
          bridge_store_id: string | null
          country: string | null
          created_at: string
          currency: string
          external_session_id: string | null
          id: string
          items: Json
          locale: string | null
          metadata: Json
          redirect_url: string | null
          site_a_store_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount_total?: number
          bridge_store_id?: string | null
          country?: string | null
          created_at?: string
          currency?: string
          external_session_id?: string | null
          id?: string
          items?: Json
          locale?: string | null
          metadata?: Json
          redirect_url?: string | null
          site_a_store_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount_total?: number
          bridge_store_id?: string | null
          country?: string | null
          created_at?: string
          currency?: string
          external_session_id?: string | null
          id?: string
          items?: Json
          locale?: string | null
          metadata?: Json
          redirect_url?: string | null
          site_a_store_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      shadow_checkout_log: {
        Row: {
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          integration_type: string | null
          ip: string | null
          items: Json
          outcome: string
          redirect_url: string | null
          site_a_store_id: string | null
          warmup: boolean
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          integration_type?: string | null
          ip?: string | null
          items?: Json
          outcome: string
          redirect_url?: string | null
          site_a_store_id?: string | null
          warmup?: boolean
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          integration_type?: string | null
          ip?: string | null
          items?: Json
          outcome?: string
          redirect_url?: string | null
          site_a_store_id?: string | null
          warmup?: boolean
        }
        Relationships: []
      }
      shadow_products: {
        Row: {
          created_at: string
          id: string
          last_error: string | null
          product_url: string | null
          shadow_handle: string
          shadow_title: string
          shopify_handle: string | null
          shopify_product_id: string | null
          source_product_id: string
          source_store_id: string
          status: string
          tags: string[]
          updated_at: string
          variant_map: Json
        }
        Insert: {
          created_at?: string
          id?: string
          last_error?: string | null
          product_url?: string | null
          shadow_handle: string
          shadow_title: string
          shopify_handle?: string | null
          shopify_product_id?: string | null
          source_product_id: string
          source_store_id: string
          status?: string
          tags?: string[]
          updated_at?: string
          variant_map?: Json
        }
        Update: {
          created_at?: string
          id?: string
          last_error?: string | null
          product_url?: string | null
          shadow_handle?: string
          shadow_title?: string
          shopify_handle?: string | null
          shopify_product_id?: string | null
          source_product_id?: string
          source_store_id?: string
          status?: string
          tags?: string[]
          updated_at?: string
          variant_map?: Json
        }
        Relationships: []
      }
      shop_categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      shop_product_whop_publications: {
        Row: {
          bridge_store_id: string
          created_at: string
          id: string
          last_error: string | null
          last_synced_at: string | null
          product_id: string
          updated_at: string
          whop_checkout_url: string | null
          whop_plan_id: string | null
          whop_product_id: string | null
        }
        Insert: {
          bridge_store_id: string
          created_at?: string
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          product_id: string
          updated_at?: string
          whop_checkout_url?: string | null
          whop_plan_id?: string | null
          whop_product_id?: string | null
        }
        Update: {
          bridge_store_id?: string
          created_at?: string
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          product_id?: string
          updated_at?: string
          whop_checkout_url?: string | null
          whop_plan_id?: string | null
          whop_product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_product_whop_publications_bridge_store_id_fkey"
            columns: ["bridge_store_id"]
            isOneToOne: false
            referencedRelation: "bridge_stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_product_whop_publications_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shop_products"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_products: {
        Row: {
          brand: string | null
          bridge_store_id: string | null
          category_id: string | null
          compare_at_price: number | null
          created_at: string
          currency: string
          description: string | null
          featured: boolean
          gallery: Json | null
          hidden_from_listing: boolean
          id: string
          image_url: string | null
          long_description: string | null
          material: string | null
          meta: Json | null
          prd_code: string
          price: number
          published: boolean
          shopify_product_handle: string | null
          shopify_product_id: string | null
          slug: string
          sort_order: number
          source: string
          source_product_ref: string | null
          source_store_id: string | null
          source_synced_at: string | null
          tags: string[]
          title: string
          updated_at: string
          whop_plan_id: string | null
          whop_product_id: string | null
          whop_sync_error: string | null
          whop_synced_at: string | null
        }
        Insert: {
          brand?: string | null
          bridge_store_id?: string | null
          category_id?: string | null
          compare_at_price?: number | null
          created_at?: string
          currency?: string
          description?: string | null
          featured?: boolean
          gallery?: Json | null
          hidden_from_listing?: boolean
          id?: string
          image_url?: string | null
          long_description?: string | null
          material?: string | null
          meta?: Json | null
          prd_code?: string
          price?: number
          published?: boolean
          shopify_product_handle?: string | null
          shopify_product_id?: string | null
          slug: string
          sort_order?: number
          source?: string
          source_product_ref?: string | null
          source_store_id?: string | null
          source_synced_at?: string | null
          tags?: string[]
          title: string
          updated_at?: string
          whop_plan_id?: string | null
          whop_product_id?: string | null
          whop_sync_error?: string | null
          whop_synced_at?: string | null
        }
        Update: {
          brand?: string | null
          bridge_store_id?: string | null
          category_id?: string | null
          compare_at_price?: number | null
          created_at?: string
          currency?: string
          description?: string | null
          featured?: boolean
          gallery?: Json | null
          hidden_from_listing?: boolean
          id?: string
          image_url?: string | null
          long_description?: string | null
          material?: string | null
          meta?: Json | null
          prd_code?: string
          price?: number
          published?: boolean
          shopify_product_handle?: string | null
          shopify_product_id?: string | null
          slug?: string
          sort_order?: number
          source?: string
          source_product_ref?: string | null
          source_store_id?: string | null
          source_synced_at?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
          whop_plan_id?: string | null
          whop_product_id?: string | null
          whop_sync_error?: string | null
          whop_synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_products_bridge_store_id_fkey"
            columns: ["bridge_store_id"]
            isOneToOne: false
            referencedRelation: "bridge_stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "shop_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_variants: {
        Row: {
          color: string | null
          created_at: string
          id: string
          label: string
          price_override: number | null
          product_id: string
          shopify_variant_label: string | null
          size: string | null
          sku: string | null
          sort_order: number
          stock: number | null
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          label: string
          price_override?: number | null
          product_id: string
          shopify_variant_label?: string | null
          size?: string | null
          sku?: string | null
          sort_order?: number
          stock?: number | null
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          label?: string
          price_override?: number | null
          product_id?: string
          shopify_variant_label?: string | null
          size?: string | null
          sku?: string | null
          sort_order?: number
          stock?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shop_products"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_stores: {
        Row: {
          created_at: string
          currency: string | null
          description: string | null
          id: string
          logo_url: string | null
          name: string
          shop_domain: string
          status: string | null
          storefront_access_token: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string | null
          description?: string | null
          id?: string
          logo_url?: string | null
          name: string
          shop_domain: string
          status?: string | null
          storefront_access_token?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string | null
          description?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          shop_domain?: string
          status?: string | null
          storefront_access_token?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          apple_pay_verification: string | null
          brand_name: string
          brand_url: string
          created_at: string
          id: string
          legal_address: string | null
          logo_dark_url: string | null
          logo_url: string | null
          privacy_email: string
          singleton: boolean
          support_email: string
          updated_at: string
          vat_number: string | null
        }
        Insert: {
          apple_pay_verification?: string | null
          brand_name?: string
          brand_url?: string
          created_at?: string
          id?: string
          legal_address?: string | null
          logo_dark_url?: string | null
          logo_url?: string | null
          privacy_email?: string
          singleton?: boolean
          support_email?: string
          updated_at?: string
          vat_number?: string | null
        }
        Update: {
          apple_pay_verification?: string | null
          brand_name?: string
          brand_url?: string
          created_at?: string
          id?: string
          legal_address?: string | null
          logo_dark_url?: string | null
          logo_url?: string | null
          privacy_email?: string
          singleton?: boolean
          support_email?: string
          updated_at?: string
          vat_number?: string | null
        }
        Relationships: []
      }
      sync_settings: {
        Row: {
          allowed_source_origins: string[]
          auto_publish_to_whop: boolean
          created_at: string
          default_synced_image_url: string | null
          default_whop_store_id: string | null
          hmac_secret_encrypted: string
          id: string
          singleton: boolean
          updated_at: string
        }
        Insert: {
          allowed_source_origins?: string[]
          auto_publish_to_whop?: boolean
          created_at?: string
          default_synced_image_url?: string | null
          default_whop_store_id?: string | null
          hmac_secret_encrypted?: string
          id?: string
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          allowed_source_origins?: string[]
          auto_publish_to_whop?: boolean
          created_at?: string
          default_synced_image_url?: string | null
          default_whop_store_id?: string | null
          hmac_secret_encrypted?: string
          id?: string
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      synced_products: {
        Row: {
          compare_price: number | null
          currency: string
          description: string | null
          external_id: string
          id: string
          images: Json
          locale: string
          metadata: Json
          name: string
          price: number
          received_at: string
          slug: string | null
          source: string
          status: string
          store_ref: string | null
          updated_at: string
          variants: Json
        }
        Insert: {
          compare_price?: number | null
          currency?: string
          description?: string | null
          external_id: string
          id?: string
          images?: Json
          locale?: string
          metadata?: Json
          name: string
          price: number
          received_at?: string
          slug?: string | null
          source?: string
          status?: string
          store_ref?: string | null
          updated_at?: string
          variants?: Json
        }
        Update: {
          compare_price?: number | null
          currency?: string
          description?: string | null
          external_id?: string
          id?: string
          images?: Json
          locale?: string
          metadata?: Json
          name?: string
          price?: number
          received_at?: string
          slug?: string | null
          source?: string
          status?: string
          store_ref?: string | null
          updated_at?: string
          variants?: Json
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bridge_create_native_checkout_session: {
        Args: {
          _api_key_hash: string
          _country?: string
          _currency?: string
          _ip?: string
          _items: Json
          _locale?: string
          _metadata?: Json
          _store_id: string
        }
        Returns: Json
      }
      bridge_handshake: {
        Args: {
          _api_key_hash: string
          _callback_url?: string
          _integration_type?: string
          _ip?: string
          _shop_domain?: string
          _store_id: string
          _user_agent?: string
        }
        Returns: Json
      }
      bridge_lookup_session_for_whop: {
        Args: { _session_id: string }
        Returns: Json
      }
      bridge_push_shadow_prepare: {
        Args: {
          _api_key_hash: string
          _ip?: string
          _shadow_handle: string
          _shadow_title: string
          _source_product_id: string
          _store_id: string
        }
        Returns: Json
      }
      bridge_push_shadow_record_error:
        | {
            Args: {
              _api_key_hash: string
              _error: string
              _ip?: string
              _shadow_handle: string
              _shadow_title: string
              _source_product_id: string
              _store_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              _error: string
              _ip?: string
              _shadow_handle: string
              _shadow_title: string
              _source_product_id: string
              _store_id: string
            }
            Returns: Json
          }
      bridge_push_shadow_save_success:
        | {
            Args: {
              _api_key_hash: string
              _ip?: string
              _product_url: string
              _shadow_handle: string
              _shadow_title: string
              _shopify_handle: string
              _shopify_product_id: string
              _source_product_id: string
              _store_id: string
              _variant_map: Json
            }
            Returns: Json
          }
        | {
            Args: {
              _ip?: string
              _product_url: string
              _shadow_handle: string
              _shadow_title: string
              _shopify_handle: string
              _shopify_product_id: string
              _source_product_id: string
              _store_id: string
              _variant_map: Json
            }
            Returns: Json
          }
      bridge_save_shadow_whop_mapping: {
        Args: {
          _bridge_store_id: string
          _currency: string
          _last_error?: string
          _price: number
          _session_id: string
          _source_product_code: string
          _source_product_id: string
          _source_product_slug: string
          _title: string
          _whop_checkout_url: string
          _whop_plan_id: string
          _whop_product_id: string
        }
        Returns: Json
      }
      get_native_checkout_session: {
        Args: { _session_id: string }
        Returns: {
          amount_total: number
          bridge_store_id: string
          currency: string
          id: string
          items: Json
          site_a_store_id: string
          status: string
        }[]
      }
      get_public_synced_product_by_slug: {
        Args: { _slug: string }
        Returns: {
          compare_at_price: number
          currency: string
          description: string
          gallery: Json
          id: string
          image_url: string
          prd_code: string
          price: number
          slug: string
          source: string
          title: string
          variants: Json
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
