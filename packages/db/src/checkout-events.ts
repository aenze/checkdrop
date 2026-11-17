import { Pool } from "pg";
import { interactivePoolOptions } from "./interactive-pool.js";

export interface CheckoutEvent {
  projectRef: string;
  integrationId: string;
  formId: string;
  sessionRef: string;
  eventId: string;
  event: string;
  source: "customer" | "test";
  reason: string;
  field: string;
  context: string;
  orderRef?: string;
  purchaseChannel?: string;
}
export interface CheckoutEventStore {
  record(input: CheckoutEvent): Promise<void>;
  list(
    projectRef: string,
    from: Date,
    includeTests: boolean,
    sessionRefs?: string[],
  ): Promise<unknown[]>;
}

export function createPostgresCheckoutEventStore(connectionString: string): CheckoutEventStore {
  const pool = new Pool({ connectionString, ...interactivePoolOptions, max: 2 });
  return {
    async record(e) {
      await pool.query(
        `INSERT INTO app.checkout_events
        (project_ref,integration_id,form_id,session_ref,event_id,event,source,reason,field,context,order_ref,purchase_channel)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
        [
          e.projectRef,
          e.integrationId,
          e.formId,
          e.sessionRef,
          e.eventId,
          e.event,
          e.source,
          e.reason,
          e.field,
          e.context,
          e.orderRef ?? null,
          e.purchaseChannel ?? null,
        ],
      );
    },
    async list(projectRef, from, includeTests, sessionRefs) {
      const result = await pool.query(
        `WITH recent AS (
        SELECT * FROM app.checkout_events WHERE project_ref=$1 AND created_at >= $2
        AND created_at >= now() - interval '90 days' AND ($3 OR source <> 'test')
        AND ($4::text[] IS NULL OR session_ref = ANY($4))
      ) SELECT session_ref,form_id,integration_id,source,min(created_at) AS started_at,
        max(created_at) AS last_seen_at,
        count(*) FILTER (WHERE event='submit_attempt')::int AS attempts,
        count(*) FILTER (WHERE event='blocked')::int AS blocks,
        bool_or(event='submit_dispatched') AS submit_dispatched,
        bool_or(event='purchase_reported') AS purchase_reported,
        (max(created_at) < now() - interval '30 minutes') AS inactive,
        jsonb_agg(jsonb_build_object('event_id',event_id,'event',event,'reason',reason,'field',field,'context',context,'at',created_at) ORDER BY created_at) AS events
        FROM recent GROUP BY session_ref,form_id,integration_id,source
        ORDER BY max(created_at) DESC LIMIT 1000`,
        [projectRef, from, includeTests, sessionRefs ?? null],
      );
      return result.rows;
    },
  };
}
