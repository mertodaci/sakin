// Express 4, async route handler'lardan firlayan (reject olan) hatalari
// OTOMATIK yakalamaz - yakalanmayan bir promise reddi, istemciye hicbir
// yanit donmeden isteğin sonsuza kadar askida kalmasina yol acar.
//
// Bu dosya, express.Router() ile olusturulan her router'in
// get/post/put/patch/delete metodlarini, verilen her handler'i otomatik
// olarak `.catch(next)` ile saran bir versiyonla degistirir. Boylece her
// route dosyasinda tek tek try/catch veya wrapper yazmaya gerek kalmaz -
// bir async handler icinde firlayan hata (orn. bir Prisma sorgusu
// basarisiz olursa) otomatik olarak server.js'teki genel hata
// middleware'ine (app.use((err,req,res,next)=>{...})) yonlendirilir.
//
// server.js'te route dosyalarindan (ve dolayisiyla ilk express.Router()
// cagrisindan) ONCE require edilmelidir.
const express = require("express");

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "use"];
const originalRouterFactory = express.Router;

express.Router = function patchedRouterFactory(...args) {
  const router = originalRouterFactory.apply(express, args);
  HTTP_METHODS.forEach((method) => {
    const original = router[method].bind(router);
    router[method] = function (...handlers) {
      const wrapped = handlers.map((h) =>
        typeof h === "function"
          ? function (req, res, next) {
              Promise.resolve(h(req, res, next)).catch(next);
            }
          : h
      );
      return original(...wrapped);
    };
  });
  return router;
};
