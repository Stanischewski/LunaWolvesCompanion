'use strict';
// =============================================================================
// PM2 — alle drei Dienste in EINEM Container
// =============================================================================
// Die Ports stehen bewusst hier und nicht in der .env:
//
//   - Die API hoert fest auf 3001 (apps/api/src/index.ts: app.listen).
//     Eine PORT-Variable liest sie nicht.
//   - Next.js WUERDE eine PORT-Variable lesen. Da alle drei Dienste sich
//     dieselbe .env teilen, wuerde ein dort gesetztes PORT beide betreffen.
//     Darum bekommt Next den Port als CLI-Flag, das nichts ueberschreiben kann.
//
// Einzelne Dienste ansprechen:  pm2 restart lw-api   bzw.  --only lw-api
// =============================================================================

const ROOT = '/opt/lunawolves';

module.exports = {
  apps: [
    {
      name: 'lw-api',
      script: 'dist/index.js',
      cwd: `${ROOT}/apps/api`,
      // Ein Prozess, bewusst. Ohne Redis liegen Rollen-Cache und
      // Sync-Cooldown im Prozessspeicher — bei mehreren Instanzen haette
      // jede ihren eigenen und der Cooldown waere wirkungslos.
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
    },
    {
      name: 'lw-bot',
      script: 'dist/index.js',
      cwd: `${ROOT}/apps/bot`,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '256M',
      // Der Bot braucht die API. Startet er zuerst, laufen die ersten
      // Anfragen ins Leere — PM2 startet ihn dann einfach neu.
      restart_delay: 3000,
    },
    {
      name: 'lw-web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start --port 3000',
      cwd: `${ROOT}/apps/web`,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
    },
  ],
};
