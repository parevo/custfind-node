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
  /** The offer the leads are pitched with; the workspace default when omitted. */
  seller_profile_id?: string;
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
  organization_id: string;
  project_id: string;
  created_by: string;
  sector: string;
  location: string;
  limit: number;
  latitude?: number;
  longitude?: number;
  radius_km?: number;
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
  seller_profile_id?: string;
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
  /** True when the plan's contact-reveal allowance hides this lead's email and phone. */
  contact_locked?: boolean;
  source?: string;
  region_code?: string;
  region_name?: string;
  language?: string;
  created_at?: string;
  unsubscribed_at?: string;
  seller_profile_id?: string;
  seller_profile_name?: string;
  deal_id?: string;
  deal_stage_id?: string;
  deal_stage_name?: string;
  assigned_user_id?: string;
  assigned_name?: string;
}

export interface LeadEnrichment {
  id: string;
  lead_id: string;
  email?: string;
  email_status: string;
  email_verified_at?: string;
  socials: string[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Call {
  id: string;
  lead_id: string;
  status: string;
  recording_url?: string;
  transcript?: string;
  summary?: string;
  duration_seconds: number;
  minutes_charged?: number;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

/** A lead with its enrichment, emails and calls. */
export interface LeadDetail {
  lead: Lead;
  enrichment?: LeadEnrichment;
  outreach?: OutreachMessage[];
  calls?: Call[];
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export type LeadSort =
  | "created_desc" | "created_asc"
  | "score_desc" | "score_asc"
  | "rating_desc" | "rating_asc"
  | "name" | "name_desc"
  | "category" | "category_desc"
  | "source" | "source_desc"
  | "email" | "email_desc"
  | "phone" | "phone_desc"
  | "region" | "region_desc"
  | "language" | "language_desc";

export interface LeadListParams {
  page?: number;
  /** At most 100. */
  page_size?: number;
  /** Searches name, email, phone and website. */
  q?: string;
  job_id?: string;
  category?: string;
  contact?: "email" | "phone" | "both" | "website" | "none";
  min_score?: number;
  max_score?: number;
  min_rating?: number;
  max_rating?: number;
  region?: string;
  language?: string;
  source?: "scrape" | "manual" | "import" | "linkedin" | "manual_import";
  outreach_status?: "none" | "pending" | "sent" | "opened" | "failed";
  unsubscribed?: "yes" | "no";
  stage_id?: string;
  tag_id?: string;
  /** Newest first when omitted. */
  sort?: LeadSort;
}

export interface OutreachMessage {
  id: string;
  lead_id: string;
  lead_name?: string;
  lead_email?: string;
  lead_email_status?: string;
  lead_email_suppressed?: boolean;
  channel: string;
  email_subject?: string;
  message: string;
  scheduled_at?: string;
  sent_at?: string;
  sender_account_id?: string;
  error_message?: string;
  opened_at?: string;
  open_count?: number;
  last_opened_at?: string;
  click_count?: number;
  first_clicked_at?: string;
  last_clicked_at?: string;
  engagement_score?: number;
  step_position?: number;
  sequence_step_name?: string;
  sequence_total_steps?: number;
  /** Automatic checks an AI draft failed; such a draft needs a human look before it is sent. */
  quality_issues?: string[];
  prompt_version?: string;
  created_at: string;
}

export interface OutreachListParams {
  page?: number;
  page_size?: number;
  job_id?: string;
  status?: "draft" | "scheduled" | "sent" | "failed";
  channel?: string;
  q?: string;
  /** Newest first when omitted. */
  sort?: "created_at_asc" | "sent_at_desc" | "sent_at_asc" | "lead_name_asc" | "lead_name_desc" | "engagement_score_desc";
}

/** Counts for the emails matching an outreach list's filter. */
export interface OutreachStats {
  total: number;
  draft: number;
  needs_review: number;
  scheduled: number;
  sent: number;
  failed: number;
  opened: number;
  open_rate: number;
  avg_engagement: number;
  engagement_rate: number;
}

export interface OutreachPage extends Page<OutreachMessage> {
  stats: OutreachStats;
}

export interface Stage {
  id: string;
  pipeline_id: string;
  name: string;
  position: number;
  color: string;
  is_won: boolean;
  is_lost: boolean;
  created_at: string;
}

export interface Pipeline {
  id: string;
  name: string;
  is_default: boolean;
  created_at: string;
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
  assigned_user_id?: string;
  assigned_name?: string;
  closed_at?: string;
  created_at: string;
  updated_at: string;
  lead_name?: string;
  lead_email?: string;
  lead_score?: number;
}

export interface Note {
  id: string;
  lead_id: string;
  author_name?: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  lead_id: string;
  deal_id?: string;
  assigned_name?: string;
  title: string;
  due_at?: string;
  completed_at?: string;
  created_at: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Meeting {
  id: string;
  lead_id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  meet_link?: string;
  attendee_email?: string;
  created_at: string;
}

/** Everything the CRM holds about a lead. */
export interface LeadCRM {
  deal?: Deal;
  notes: Note[];
  tasks: Task[];
  tags: Tag[];
  outreach: OutreachMessage[];
  meetings: Meeting[];
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

/** Data of search.completed, search.failed and search.cancelled. */
export interface SearchEventData {
  id: string;
  status: SearchStatus;
  sector: string;
  location: string;
  leads_found: number;
  credits_reserved: number;
  credits_consumed: number;
  source: string;
  api_key_id: string | null;
  external_customer_id: string | null;
  error_message: string | null;
}

export interface OutreachSentData {
  id: string;
  lead_id: string;
  channel: string;
  email_subject: string | null;
  sent_at: string;
}

export interface OutreachRepliedData {
  id: string;
  lead_id: string | null;
  outreach_message_id: string | null;
  thread_id: string;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  /** The first 2000 characters of the reply. */
  text: string | null;
  received_at: string;
}

/** previous_stage_id is null when the deal was just created. */
export interface DealStageChangedData {
  id: string;
  lead_id: string;
  pipeline_id: string;
  stage_id: string;
  stage_name: string;
  is_won: boolean;
  is_lost: boolean;
  previous_stage_id: string | null;
}

export interface LeadCreatedData {
  id: string;
  search_id: string | null;
  external_customer_id: string | null;
  name: string;
  phone: string | null;
  website: string | null;
  address: string | null;
  category: string | null;
  rating: number | null;
  region_name: string | null;
  language: string | null;
  source: string;
}

export interface WebhookEventDataMap {
  "search.completed": SearchEventData;
  "search.failed": SearchEventData;
  "search.cancelled": SearchEventData;
  "outreach.sent": OutreachSentData;
  "outreach.replied": OutreachRepliedData;
  "deal.stage_changed": DealStageChangedData;
  "lead.created": LeadCreatedData;
  "webhook.test": Record<string, unknown>;
}

interface WebhookEventOf<K extends keyof WebhookEventDataMap> {
  id: string;
  type: K;
  created_at: string;
  organization_id: string;
  data: WebhookEventDataMap[K];
}

/**
 * The body of a webhook delivery. Narrow on `type` to get typed `data`:
 * `if (event.type === "lead.created") event.data.name`.
 */
export type WebhookEvent = { [K in keyof WebhookEventDataMap]: WebhookEventOf<K> }[keyof WebhookEventDataMap];

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
  imap_sync_status?: string;
  imap_synced_at?: string;
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
