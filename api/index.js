// Vercel serverless entry point.
//
// Vercel turns each file under /api into a serverless function. The Express app
// is the handler: vercel.json rewrites every /api/* request here, and Express
// does its own routing from there. Everything in public/ is served straight
// from Vercel's CDN and never reaches this function.
//
// server/index.js only calls app.listen() when run directly, so importing it
// here gives us the configured app without starting a server Vercel doesn't want.
module.exports = require('../server/index.js');
