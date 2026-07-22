// Google OAuth + Postgres-backed sessions (F02).
// Sessions are stored in Postgres (connect-pg-simple) so logins survive restarts/redeploys,
// and the same session middleware is shared with Socket.io so every socket is bound to a user.
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');

const db = require('./db');
const repo = require('./repo');

const isProd = process.env.NODE_ENV === 'production';

// One session middleware instance, reused by Express and by io.engine so both read the same cookie.
const sessionMiddleware = session({
  store: new PgSession({
    pool: db.pool,
    createTableIfMissing: true, // owns the `session` table DDL — no schema change in db.js
  }),
  secret: process.env.SESSION_SECRET || 'dev-insecure-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
});

// Only the user id lives in the session; the full row is fetched per request/socket.
function configurePassport() {
  // Serialize/deserialize are safe without credentials; register them unconditionally.
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      done(null, (await repo.getUserById(id)) || false);
    } catch (err) {
      done(err);
    }
  });

  // The Google strategy constructor throws without a clientID, so skip it when unconfigured —
  // the server still boots and serves the signed-out landing; /auth/google just won't work yet.
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.warn('[auth] GOOGLE_CLIENT_ID/SECRET not set — Google sign-in is disabled until configured');
    return;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${process.env.APP_URL || 'http://localhost:3000'}/auth/google/callback`,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails && profile.emails[0] && profile.emails[0].value;
          if (!email) return done(null, false, { message: 'Google account has no email' });
          const user = await repo.upsertUser({
            email,
            name: profile.displayName || null,
            avatarUrl: (profile.photos && profile.photos[0] && profile.photos[0].value) || null,
            googleSub: profile.id,
          });
          done(null, user);
        } catch (err) {
          done(err);
        }
      }
    )
  );
}

// Shape the user row sent to the client — omit google_sub and other internals.
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    avatar_url: u.avatar_url,
    elo: u.elo,
    resume_score: u.resume_score,
    wins: u.wins,
    losses: u.losses,
    current_streak: u.current_streak,
    best_streak: u.best_streak,
  };
}

function mountAuthRoutes(app) {
  app.get(
    '/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
  );

  app.get(
    '/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => res.redirect('/')
  );

  app.post('/auth/logout', (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.status(204).end();
      });
    });
  });

  app.get('/api/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    res.json(publicUser(req.user));
  });
}

// Gate for future /api/* data routes (F09–F14). Wired now, applied as those routes land.
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  next();
}

// Socket.io middleware: bind each connection to its logged-in user via the shared session.
async function socketAuth(socket, next) {
  const userId = socket.request.session && socket.request.session.passport
    ? socket.request.session.passport.user
    : null;
  if (!userId) return next(new Error('unauthenticated'));
  try {
    const user = await repo.getUserById(userId);
    if (!user) return next(new Error('unauthenticated'));
    socket.user = user;
    next();
  } catch (err) {
    next(new Error('auth error'));
  }
}

module.exports = {
  sessionMiddleware,
  configurePassport,
  mountAuthRoutes,
  requireAuth,
  socketAuth,
  passport,
  publicUser,
};
