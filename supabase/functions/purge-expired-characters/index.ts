import { createClient } from 'npm:@supabase/supabase-js@2'

const bucketName = 'character-portraits'
const portraitObjectName = 'portrait'
const storageListPageSize = 100

type PurgeSummary = {
  candidates: number
  purged: number
  failed: number
  skipped: number
  failedIds: string[]
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

function getPrivilegedSupabaseKey() {
  const secretKeysJson = Deno.env.get('SUPABASE_SECRET_KEYS')

  if (secretKeysJson) {
    try {
      const secretKeys: unknown = JSON.parse(secretKeysJson)

      if (
        typeof secretKeys === 'object' &&
        secretKeys !== null &&
        'default' in secretKeys &&
        typeof secretKeys.default === 'string' &&
        secretKeys.default.length > 0
      ) {
        return secretKeys.default
      }
    } catch {
      console.error('Supabase secret key configuration is invalid')
    }
  }

  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response(null, {
      status: 405,
      headers: {
        Allow: 'POST',
      },
    })
  }

  const expectedCronSecret = Deno.env.get('CHARACTER_PURGE_CRON_SECRET')
  const providedCronSecret = request.headers.get('x-cron-secret')

  if (
    !expectedCronSecret ||
    !providedCronSecret ||
    providedCronSecret !== expectedCronSecret
  ) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const privilegedSupabaseKey = getPrivilegedSupabaseKey()

  if (!supabaseUrl || !privilegedSupabaseKey) {
    console.error('Character purge configuration is incomplete')
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  const serviceClient = createClient(supabaseUrl, privilegedSupabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  async function inspectAllCharacterPortraitObjects(characterId: string) {
    let offset = 0
    let hasPortrait = false

    while (true) {
      const { data: folderEntries, error: listError } =
        await serviceClient.storage.from(bucketName).list(characterId, {
          limit: storageListPageSize,
          offset,
          sortBy: {
            column: 'name',
            order: 'asc',
          },
        })

      if (listError) {
        return {
          status: 'list-error' as const,
          error: listError,
        }
      }

      const entries = folderEntries ?? []

      if (entries.some(({ name }) => name !== portraitObjectName)) {
        return {
          status: 'unexpected-object' as const,
        }
      }

      if (entries.some(({ name }) => name === portraitObjectName)) {
        hasPortrait = true
      }

      if (entries.length < storageListPageSize) {
        return {
          status: 'safe' as const,
          hasPortrait,
        }
      }

      offset += storageListPageSize
    }
  }

  const { data: candidateData, error: candidateError } =
    await serviceClient.rpc('get_expired_character_ids_for_purge')

  if (candidateError || !Array.isArray(candidateData)) {
    console.error(
      'Loading expired character IDs failed',
      candidateError?.message ?? 'Unexpected RPC response',
    )
    return jsonResponse(
      {
        candidates: 0,
        purged: 0,
        failed: 1,
        skipped: 0,
        failedIds: [],
      } satisfies PurgeSummary,
      500,
    )
  }

  if (!candidateData.every((characterId) => typeof characterId === 'string')) {
    console.error('Loading expired character IDs returned invalid data')
    return jsonResponse(
      {
        candidates: candidateData.length,
        purged: 0,
        failed: 1,
        skipped: 0,
        failedIds: [],
      } satisfies PurgeSummary,
      500,
    )
  }

  const candidateIds = candidateData as string[]
  const summary: PurgeSummary = {
    candidates: candidateIds.length,
    purged: 0,
    failed: 0,
    skipped: 0,
    failedIds: [],
  }

  for (const characterId of candidateIds) {
    const portraitFolderInspection =
      await inspectAllCharacterPortraitObjects(characterId)

    if (portraitFolderInspection.status === 'list-error') {
      console.error(
        'Listing a character portrait failed',
        characterId,
        portraitFolderInspection.error.message,
      )
      summary.failed += 1
      summary.failedIds.push(characterId)
      continue
    }

    if (portraitFolderInspection.status === 'unexpected-object') {
      console.error(
        'Unexpected files found in a character portrait folder',
        characterId,
      )
      summary.failed += 1
      summary.failedIds.push(characterId)
      continue
    }

    if (portraitFolderInspection.hasPortrait) {
      const portraitPaths = [`${characterId}/${portraitObjectName}`]
      const { error: removeError } = await serviceClient.storage
        .from(bucketName)
        .remove(portraitPaths)

      if (removeError) {
        console.error(
          'Removing a character portrait failed',
          characterId,
          removeError.message,
        )
        summary.failed += 1
        summary.failedIds.push(characterId)
        continue
      }
    }

    const { data: wasPurged, error: purgeError } = await serviceClient.rpc(
      'purge_expired_character',
      {
        p_character_id: characterId,
      },
    )

    if (purgeError) {
      console.error(
        'Purging an expired character failed',
        characterId,
        purgeError.message,
      )
      summary.failed += 1
      summary.failedIds.push(characterId)
      continue
    }

    if (wasPurged === true) {
      summary.purged += 1
    } else {
      summary.skipped += 1
    }
  }

  return jsonResponse(summary, summary.failed > 0 ? 500 : 200)
})
