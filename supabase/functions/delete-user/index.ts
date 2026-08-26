import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Browser schickt vor dem eigentlichen Request ggf. einen CORS-Check.
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    })
  }

  try {
    const authHeader = req.headers.get('Authorization')

    if (!authHeader) {
      return new Response(
        JSON.stringify({
          error: 'Not authenticated',
        }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get(
      'SUPABASE_SERVICE_ROLE_KEY',
    )

    if (
      !supabaseUrl ||
      !supabaseAnonKey ||
      !serviceRoleKey
    ) {
      throw new Error(
        'Required Supabase environment variables are missing',
      )
    }

    const body = await req.json()
    const userId = body.user_id

    if (
      typeof userId !== 'string' ||
      userId.trim() === ''
    ) {
      return new Response(
        JSON.stringify({
          error: 'user_id is required',
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      )
    }

    // Dieser Client arbeitet mit den Rechten des
    // eingeloggten Nutzers aus dem Browser.
    const userClient = createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      },
    )

    // JWT tatsächlich validieren.
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser()

    if (userError || !user) {
      return new Response(
        JSON.stringify({
          error: 'Invalid authentication',
        }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      )
    }

    // Unsere bereits getestete DB-Funktion prüft:
    // - Ist der Aufrufer Admin?
    // - versucht er sich selbst zu löschen?
    // - ist das Ziel der Superadmin?
    //
    // Außerdem:
    // - SL-Runden → Superadmin
    // - übrige Memberships → entfernen
    const { error: prepareError } =
      await userClient.rpc('prepare_user_deletion', {
        p_user_id: userId,
      })

    if (prepareError) {
      return new Response(
        JSON.stringify({
          error: prepareError.message,
        }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      )
    }

    // Dieser zweite Client existiert NUR auf dem Server.
    // Der Service-Role-Key gelangt niemals in React.
    const adminClient = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    )

    const { error: deleteError } =
      await adminClient.auth.admin.deleteUser(userId)

    if (deleteError) {
      console.error(
        'Auth user deletion failed:',
        deleteError,
      )

      return new Response(
        JSON.stringify({
          error: 'Auth user deletion failed',
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    )
  } catch (error) {
    console.error(error)

    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : 'Unknown server error',
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    )
  }
})