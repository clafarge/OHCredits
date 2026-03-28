/**
 * Deploy: supabase functions deploy publish-credits
 * Secrets: PUBLISH_SECRET = long random string (same value you paste in the editor)
 * Built-in: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto in Supabase-hosted functions)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const publishSecret = Deno.env.get("PUBLISH_SECRET");
  const auth = req.headers.get("Authorization") || "";
  if (!publishSecret || auth !== `Bearer ${publishSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { event_code?: string; design?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const eventCode =
    typeof body.event_code === "string" ? body.event_code.trim() : "";
  if (!eventCode || !/^[\w-]{1,64}$/.test(eventCode)) {
    return new Response(JSON.stringify({ error: "Invalid event_code" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const design = body.design;
  if (!design || typeof design !== "object") {
    return new Response(JSON.stringify({ error: "Missing design" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(url, serviceKey);
  const { error } = await supabase.from("credit_events").upsert(
    {
      event_code: eventCode,
      design,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "event_code" }
  );

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
