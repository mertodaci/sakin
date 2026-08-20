// PM2 cluster config - Node'un tek thread'i yerine makinedeki tum CPU
// cekirdeklerini kullanan birden fazla worker process baslatir (ayni port
// uzerinde, PM2 kendi ici load-balancer'i ile dagitir). Calistirmak icin:
//   npx pm2 start ecosystem.config.js
//   npx pm2 logs sakin
//   npx pm2 stop ecosystem.config.js
//
// DIKKAT - cluster moduna gecince degisen iki sey var:
// 1. Zamanlanmis bakim gorevi (gecikme faizi/otomatik aidat/tekrarlayan
//    fatura) sadece worker 0'da calisir - bkz. server.js'teki
//    isSchedulerOwner kontrolu. Digerlerinde HICBIR sey yapmaz, bu kasitli.
// 2. Genel API rate limiti (server.js'teki apiLimiter) worker-basina AYRI
//    bellekte tutuluyor - yani N worker'la pratik limit yaklasik N kat
//    genisler (ayni IP farkli worker'lara dusebilir). Tek makinede N kucuk
//    oldugu icin (CPU sayisi kadar) simdilik kabul edilebilir; gercekten
//    siki bir limit gerekirse paylasimli bir store (orn. Redis) gerekir.
module.exports = {
  apps: [
    {
      name: "sakin",
      script: "server.js",
      instances: "max",
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
