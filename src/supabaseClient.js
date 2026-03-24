import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://dxxrkimgyjcisvqvgmlc.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4eHJraW1neWpjaXN2cXZnbWxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzODU2MTgsImV4cCI6MjA4OTk2MTYxOH0.yUjmdA5K_euUvDQazatt3HRcHo1G-gqtgly6BvQOdK4";

export const supabase = createClient(supabaseUrl, supabaseKey);
