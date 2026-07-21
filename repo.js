const db = require('./db');
const { query, withTransaction } = db;

// --- Users -------------------------------------------------------------

async function upsertUser({ email, name, avatarUrl, googleSub }) {
  const { rows } = await query(
    `INSERT INTO users (email, name, avatar_url, google_sub)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE
       SET name = COALESCE(EXCLUDED.name, users.name),
           avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
           google_sub = COALESCE(EXCLUDED.google_sub, users.google_sub)
     RETURNING *`,
    [email, name ?? null, avatarUrl ?? null, googleSub ?? null]
  );
  return rows[0];
}

async function getUserById(id) {
  const { rows } = await query(`SELECT * FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

// --- Resumes -------------------------------------------------------------

async function saveResume({ userId, pdfBytes, filename, score, breakdown, textExtract }) {
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE resumes SET is_current = false WHERE user_id = $1 AND is_current = true`,
      [userId]
    );
    const { rows } = await client.query(
      `INSERT INTO resumes (user_id, pdf_bytes, filename, score, breakdown, text_extract, is_current)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING id, user_id, filename, score, breakdown, is_current, uploaded_at`,
      [
        userId,
        pdfBytes,
        filename ?? null,
        score ?? null,
        breakdown ? JSON.stringify(breakdown) : null,
        textExtract ?? null,
      ]
    );
    return rows[0];
  });
}

async function getCurrentResume(userId) {
  const { rows } = await query(
    `SELECT * FROM resumes WHERE user_id = $1 AND is_current = true LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

// --- Matches -------------------------------------------------------------

async function recordMatch({
  playerA,
  playerB,
  winnerId,
  aTranscript,
  bTranscript,
  verdict,
  resumeScoreGap,
  aEloBefore,
  aEloAfter,
  bEloBefore,
  bEloAfter,
}) {
  const { rows } = await query(
    `INSERT INTO matches
       (player_a, player_b, winner_id, a_transcript, b_transcript, verdict, resume_score_gap,
        a_elo_before, a_elo_after, b_elo_before, b_elo_after)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      playerA,
      playerB,
      winnerId ?? null,
      aTranscript ?? null,
      bTranscript ?? null,
      verdict ? JSON.stringify(verdict) : null,
      resumeScoreGap ?? null,
      aEloBefore,
      aEloAfter,
      bEloBefore,
      bEloAfter,
    ]
  );
  return rows[0];
}

// NOTE for F06: draw handling (`winnerId == null`) currently leaves wins/losses/streak
// untouched for both players — only elo is updated. This is an assumption, not a spec
// requirement; revisit if the judge design wants draws to reset/preserve streaks differently.
async function applyMatchResult({ winnerId, playerA, playerB, aEloAfter, bEloAfter }) {
  return withTransaction(async (client) => {
    async function updateOne(userId, eloAfter, outcome) {
      if (outcome === 'win') {
        await client.query(
          `UPDATE users
             SET elo = $2, wins = wins + 1,
                 current_streak = current_streak + 1,
                 best_streak = GREATEST(best_streak, current_streak + 1)
           WHERE id = $1`,
          [userId, eloAfter]
        );
      } else if (outcome === 'loss') {
        await client.query(
          `UPDATE users SET elo = $2, losses = losses + 1, current_streak = 0 WHERE id = $1`,
          [userId, eloAfter]
        );
      } else {
        await client.query(`UPDATE users SET elo = $2 WHERE id = $1`, [userId, eloAfter]);
      }
    }

    const aOutcome = winnerId == null ? 'draw' : winnerId === playerA ? 'win' : 'loss';
    const bOutcome = winnerId == null ? 'draw' : winnerId === playerB ? 'win' : 'loss';
    await updateOne(playerA, aEloAfter, aOutcome);
    await updateOne(playerB, bEloAfter, bOutcome);

    const { rows } = await client.query(
      `SELECT id, elo, wins, losses, current_streak, best_streak
       FROM users WHERE id = ANY($1)`,
      [[playerA, playerB]]
    );
    return rows;
  });
}

async function topByElo(limit = 50) {
  const { rows } = await query(
    `SELECT id, name, avatar_url, elo, wins, losses
     FROM users ORDER BY elo DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

async function userStats(userId) {
  const { rows: userRows } = await query(
    `SELECT id, name, avatar_url, elo, wins, losses, current_streak, best_streak, created_at
     FROM users WHERE id = $1`,
    [userId]
  );
  const user = userRows[0];
  if (!user) return null;

  const { rows: history } = await query(
    `SELECT created_at,
            CASE WHEN player_a = $1 THEN a_elo_after ELSE b_elo_after END AS elo_after
     FROM matches WHERE player_a = $1 OR player_b = $1
     ORDER BY created_at ASC`,
    [userId]
  );

  const totalMatches = user.wins + user.losses;
  return {
    ...user,
    totalMatches,
    winRate: totalMatches > 0 ? user.wins / totalMatches : null,
    eloHistory: history.map((r) => ({ at: r.created_at, elo: r.elo_after })),
  };
}

async function userMatches(userId, limit = 20) {
  const { rows } = await query(
    `SELECT m.*,
            CASE WHEN m.player_a = $1 THEN ub.name ELSE ua.name END AS opponent_name,
            CASE WHEN m.player_a = $1 THEN ub.avatar_url ELSE ua.avatar_url END AS opponent_avatar,
            CASE WHEN m.player_a = $1 THEN m.a_elo_before ELSE m.b_elo_before END AS my_elo_before,
            CASE WHEN m.player_a = $1 THEN m.a_elo_after ELSE m.b_elo_after END AS my_elo_after
     FROM matches m
     JOIN users ua ON ua.id = m.player_a
     JOIN users ub ON ub.id = m.player_b
     WHERE m.player_a = $1 OR m.player_b = $1
     ORDER BY m.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  return rows.map((row) => ({
    matchId: row.id,
    opponent: { name: row.opponent_name, avatarUrl: row.opponent_avatar },
    result: row.winner_id == null ? 'draw' : row.winner_id === userId ? 'win' : 'loss',
    eloDelta: row.my_elo_after - row.my_elo_before,
    date: row.created_at,
    verdict: row.verdict,
    verdictSummary: row.verdict?.reasoning ?? null,
  }));
}

// --- Achievements -------------------------------------------------------------

async function grantAchievement(userId, code) {
  const { rows } = await query(
    `INSERT INTO achievements (user_id, code) VALUES ($1, $2)
     ON CONFLICT (user_id, code) DO NOTHING
     RETURNING id, code, earned_at`,
    [userId, code]
  );
  return rows[0] || null; // null => already earned (idempotent no-op)
}

async function listAchievements(userId) {
  const { rows } = await query(
    `SELECT code, earned_at FROM achievements WHERE user_id = $1 ORDER BY earned_at ASC`,
    [userId]
  );
  return rows;
}

// --- Admin export --------------------------------------------------------

async function exportUsersWithResumes() {
  const { rows } = await query(
    `SELECT u.email, u.name, u.elo, r.score, r.uploaded_at, r.filename
     FROM users u
     LEFT JOIN resumes r ON r.user_id = u.id AND r.is_current = true
     ORDER BY u.created_at ASC`
  );
  return rows;
}

module.exports = {
  upsertUser,
  getUserById,
  saveResume,
  getCurrentResume,
  recordMatch,
  applyMatchResult,
  topByElo,
  userStats,
  userMatches,
  grantAchievement,
  listAchievements,
  exportUsersWithResumes,
};
