import { supabase } from "../supabaseClient";

export const listRecentSessions = async () => {
  return supabase
    .from("sessions")
    .select("id, slug, title, description, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(12);
};

export const upsertSessionBySlug = async ({ slug, title, description, userId }) => {
  return supabase.from("sessions").upsert(
    {
      slug,
      title,
      description,
      created_by: userId,
    },
    { onConflict: "slug" },
  );
};

export const findSessionIdBySlug = async (slug) => {
  return supabase.from("sessions").select("id").eq("slug", slug).maybeSingle();
};

export const findPlayerMembership = async ({ sessionId, userId }) => {
  return supabase
    .from("session_players")
    .select("id")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
};

export const assignGmRole = async ({ membershipId, sessionId, userId }) => {
  if (membershipId) {
    return supabase.from("session_players").update({ role: "gm" }).eq("id", membershipId);
  }

  return supabase.from("session_players").insert({
    session_id: sessionId,
    user_id: userId,
    role: "gm",
  });
};

export const deleteSessionBySlug = async ({ sessionId, slug }) => {
  return supabase.from("sessions").delete().eq("id", sessionId ?? "").eq("slug", slug);
};
