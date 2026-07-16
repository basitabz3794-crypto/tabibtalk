// Vercel serverless entry point.
//
// The Express app IS the handler: vercel.json rewrites every /api/* request
// here, and Express does its own routing from there. Everything in public/ is
// served straight from Vercel's CDN and never touches this function.
//
// If the app fails to load (missing env var, bad require, native module
// mismatch on Vercel's Node vs local), Vercel would otherwise surface a
// generic FUNCTION_INVOCATION_FAILED with no error text. The load is wrapped
// below so the real reason reaches both the logs and the response body,
// which is invaluable when the only debugging window is a browser tab.

let app;
let loadError;
try {
  app = require('../server/index.js');
} catch (err) {
  loadError = err;
  console.error('[api/index.js] Failed to load server:', err && (err.stack || err.message || err));
}

module.exports = function (req, res) {
  if (loadError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      error: 'Server failed to start',
      // Only the message, never the stack — the URL is publicly readable.
      detail: (loadError && loadError.message) || String(loadError),
    }));
    return;
  }
  return app(req, res);
};
