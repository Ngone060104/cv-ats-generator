'use strict';

/** Express 4 n'attrape pas les erreurs async : on les renvoie au gestionnaire central. */
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
