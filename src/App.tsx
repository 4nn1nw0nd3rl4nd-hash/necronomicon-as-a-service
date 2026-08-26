import { supabase } from './lib/supabase'

function App() {
  const runTest = async () => {
    const password = 'TestPasswort123!'

    // 1. Alten GM anlegen
    const { data: gmSignup, error: gmSignupError } =
      await supabase.auth.signUp({
        email: 'transfer-gm@example.com',
        password,
        options: {
          data: {
            username: 'transfergm',
            display_name: 'Transfer GM',
          },
        },
      })

    if (gmSignupError || !gmSignup.user) {
      console.error('GM Signup:', gmSignupError)
      return
    }

    const oldGmId = gmSignup.user.id

    // 2. Runde erstellen
    const { data: roundId, error: roundError } = await supabase.rpc(
      'create_round',
      {
        p_name: 'Transfer Test',
        p_system: 'Testsystem',
      },
    )

    if (roundError || !roundId) {
      console.error('Runde:', roundError)
      return
    }

    await supabase.auth.signOut()

    // 3. Spieler anlegen
    const { data: playerSignup, error: playerSignupError } =
      await supabase.auth.signUp({
        email: 'transfer-player@example.com',
        password,
        options: {
          data: {
            username: 'transferplayer',
            display_name: 'Transfer Player',
          },
        },
      })

    if (playerSignupError || !playerSignup.user) {
      console.error('Player Signup:', playerSignupError)
      return
    }

    const newGmId = playerSignup.user.id

    await supabase.auth.signOut()

    // 4. Nutzer außerhalb der Runde anlegen
    const { data: outsiderSignup, error: outsiderSignupError } =
      await supabase.auth.signUp({
        email: 'transfer-outsider@example.com',
        password,
        options: {
          data: {
            username: 'transferoutsider',
            display_name: 'Transfer Outsider',
          },
        },
      })

    if (outsiderSignupError || !outsiderSignup.user) {
      console.error('Outsider Signup:', outsiderSignupError)
      return
    }

    const outsiderId = outsiderSignup.user.id

    await supabase.auth.signOut()

    // 5. Alten GM wieder anmelden
    await supabase.auth.signInWithPassword({
      email: 'transfer-gm@example.com',
      password,
    })

    // Spieler zur Runde hinzufügen
    await supabase.rpc('add_player_to_round', {
      p_round_id: roundId,
      p_user_id: newGmId,
    })

    // TEST 1: GM überträgt an bestehenden Spieler
    const { error: test1 } = await supabase.rpc(
      'transfer_game_master',
      {
        p_round_id: roundId,
        p_new_game_master_id: newGmId,
      },
    )

    console.log(
      'TEST 1 - GM überträgt an Spieler:',
      test1,
    )

    // TEST 2: Prüfen, ob alter GM jetzt Player ist
    const { data: memberships, error: membershipError } =
      await supabase
        .from('round_memberships')
        .select('user_id, role')
        .eq('round_id', roundId)

    console.log(
      'TEST 2 - Memberships nach Übertragung:',
      memberships,
      membershipError,
    )

    // Alter GM ist nach der Übertragung kein GM mehr.
    // Also ausloggen und neuen GM anmelden.
    await supabase.auth.signOut()

    await supabase.auth.signInWithPassword({
      email: 'transfer-player@example.com',
      password,
    })

    // TEST 3: Übertragung an Nutzer außerhalb der Runde
    const { error: test3 } = await supabase.rpc(
      'transfer_game_master',
      {
        p_round_id: roundId,
        p_new_game_master_id: outsiderId,
      },
    )

    console.log(
      'TEST 3 - Übertragung an Outsider:',
      test3,
    )

    // TEST 4: Neuer GM überträgt an sich selbst
    const { error: test4 } = await supabase.rpc(
      'transfer_game_master',
      {
        p_round_id: roundId,
        p_new_game_master_id: newGmId,
      },
    )

    console.log(
      'TEST 4 - Übertragung an aktuellen GM:',
      test4,
    )

    // 6. Neuen GM ausloggen, alten GM anmelden.
    // Der alte GM ist jetzt normaler Spieler.
    await supabase.auth.signOut()

    await supabase.auth.signInWithPassword({
      email: 'transfer-gm@example.com',
      password,
    })

    // TEST 5: normaler Spieler versucht GM zu übertragen
    const { error: test5 } = await supabase.rpc(
      'transfer_game_master',
      {
        p_round_id: roundId,
        p_new_game_master_id: oldGmId,
      },
    )

    console.log(
      'TEST 5 - normaler Spieler versucht Übertragung:',
      test5,
    )
  }

  return (
    <main>
      <h1>GM Transfer Test</h1>
      <button onClick={runTest}>
        Transfer-Test ausführen
      </button>
    </main>
  )
}

export default App