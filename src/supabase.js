import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://sdxqtxxomhwkpmpyiwoj.supabase.co";
const SUPABASE_KEY = "sb_publishable_p4uAZlTussHob99EH1dNBg_x7644jFH";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);