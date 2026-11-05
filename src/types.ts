export type SearchStatus = "queued" | "scraping" | "processing" | "completed" | "failed" | "cancelled";

export interface CreateSearchParams {
  sector: string;
  location?: string;
  /** Most leads to collect; caps the credits the search reserves. */
  limit?: number;
  search_mode?: "point" | "country";
  country_code?: string;
  latitude?: number;
  longitude?: number;
  radius_km?: number;
  language?: string;
  /** Your own id for the customer this search is for. */
  external_customer_id?: string;
}

export interface SearchCreated {
  project_id: string;
  job_id: string;
  status: SearchStatus;
}

export interface Search {
  id: string;
  sector: string;
  location: string;
  limit: number;
  search_mode?: string;
  country_code?: string;
  status: SearchStatus;
  progress: number;
  leads_found: number;
  leads_processed: number;
  credits_reserved?: number;
  credits_consumed?: number;
  credits_refunded?: number;
  error_message?: string;
  source?: string;
  api_key_id?: string;
  external_customer_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  project_id: string;
  name: string;
  phone?: string;
  website?: string;
  email?: string;
  address?: string;
  category?: string;
  rating?: number;
  score?: number;
  region_code?: string;
  region_name?: string;
  language?: string;
  created_at?: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface LeadListParams {
  page?: number;
  page_size?: number;
  q?: string;
  job_id?: string;
  category?: string;
  contact?: "email" | "phone" | "both" | "website" | "none";
  min_score?: number;
  min_rating?: number;
}

export interface OutreachMessage {
  id: string;
  lead_id: string;
  lead_name?: string;
  lead_email?: string;
  channel: string;
  email_subject?: string;
  message: string;
  scheduled_at?: string;
  sent_at?: string;
  error_message?: string;
  open_count?: number;
  click_count?: number;
  quality_issues?: string[];
  created_at: string;
}

export interface OutreachListParams {
  page?: number;
  page_size?: number;
  job_id?: string;
  status?: "draft" | "scheduled" | "sent" | "failed";
  q?: string;
}

export interface Stage {
  id: string;
  pipeline_id: string;
  name: string;
  position: number;
  is_won: boolean;
  is_lost: boolean;
}

export interface Pipeline {
  id: string;
  name: string;
  is_default: boolean;
  stages: Stage[];
}

export interface Deal {
  id: string;
  lead_id: string;
  pipeline_id: string;
  stage_id: string;
  title: string;
  value_cents?: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  lead_id: string;
  body: string;
  created_at: string;
}

export type WebhookEventType =
  | "search.completed"
  | "search.failed"
  | "search.cancelled"
  | "outreach.sent"
  | "outreach.replied"
  | "deal.stage_changed"
  | "lead.created";

export interface WebhookEndpoint {
  id: string;
  url: string;
  description: string;
  events: WebhookEventType[];
  created_at: string;
  disabled_at?: string;
  consecutive_failures: number;
}

export interface WebhookDelivery {
  id: string;
  event_id: string;
  event_type: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  last_status_code?: number;
  last_error?: string;
  next_attempt_at?: string;
  delivered_at?: string;
  created_at: string;
}

/** The body of a webhook delivery. */
export interface WebhookEvent<T = Record<string, unknown>> {
  id: string;
  type: WebhookEventType | "webhook.test";
  created_at: string;
  organization_id: string;
  data: T;
}

export interface Customer {
  external_customer_id: string;
  monthly_credit_limit: number | null;
  spent_this_month: number;
  remaining: number | null;
  period_start: string;
}

export interface SenderAccount {
  id: string;
  name: string;
  email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  daily_limit: number;
  external_customer_id?: string;
  created_at: string;
}

export interface Balance {
  plan: string;
  subscription_status: string;
  period_end?: string;
  credits: Record<string, number>;
  monthly_credits: Record<string, number>;
  fair_use_soft_reached: boolean;
  fair_use_hard_reached: boolean;
}

export interface UsageRow {
  group: string;
  searches: number;
  leads_found: number;
  credits_used: number;
  credits_held: number;
}

export interface Usage {
  from: string;
  to: string;
  group_by: "customer" | "api_key" | "none";
  rows: UsageRow[];
  total: UsageRow;
}
