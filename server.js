/**
 * server.js
 * -----------
 * The application's entry point. Its only job is to wire everything
 * together: configure Express, point it at the view engine and static
 * assets, mount the routes, and start listening. All actual logic lives
 * in routes/controllers/models — this file should rarely need to change.
 */

require('dotenv').config();

const express = require('express');
const path = require('path');

const qrRoutes = require('./routes/qrRoutes');
const pool = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

// --- View engine setup -----------------------------------------------
// EJS lets us write plain HTML with embedded JS for dynamic data
// (e.g. looping over validation errors, conditionally showing the
// result section). Views live in /views.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Middleware ---------------------------------------------------------
// Parses HTML form submissions (application/x-www-form-urlencoded)
// into req.body, e.g. { qrType: 'url', qrText: 'example.com' }.
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Serves everything in /public directly (CSS, client-side JS, etc.)
// at the site root, e.g. /css/style.css.
app.use(express.static(path.join(__dirname, 'public')));

// --- Routes ---------------------------------------------------------------
app.use('/', qrRoutes);

// --- 404 handler ------------------------------------------------------
// Runs only if no route above matched the request.
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Page Not Found',
    message: 'The page you were looking for does not exist.',
    statusCode: 404,
  });
});

// --- Global error handler -----------------------------------------------
// Express recognizes this as an error handler because it takes 4
// arguments. Any error passed to next(err), or thrown inside an async
// route that isn't already caught, ends up here instead of crashing
// the process.
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', {
    title: 'Server Error',
    message: 'Something went wrong on our end. Please try again shortly.',
    statusCode: 500,
  });
});

// --- Startup DB check ---------------------------------------------------
// Fails fast with a clear message if PostgreSQL isn't reachable, rather
// than letting the app boot successfully and only error out on the
// first request someone makes.
async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('✅ Connected to PostgreSQL');
  } catch (err) {
    console.error('❌ Could not connect to PostgreSQL:', err.message);
    console.error('   Check your DATABASE_URL / DB_* environment variables and that the database is running.');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`🚀 QR Code Generator running at http://localhost:${PORT}`);
  });
}

start();
