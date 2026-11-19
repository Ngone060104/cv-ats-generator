'use strict';

const express = require('express');
const asyncHandler = require('../asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { loadProfile, saveProfile } = require('../services/profileService');

const router = express.Router();
router.use(requireAuth);

/** GET /api/profile : renvoie le profil maître, ou null s'il n'est pas encore rempli. */
router.get(
  '/profile',
  asyncHandler(async (req, res) => {
    res.json({ profile: await loadProfile(req.userId) });
  })
);

/** PUT /api/profile : remplace tout le profil maître (formulaire complet). */
router.put(
  '/profile',
  asyncHandler(async (req, res) => {
    res.json({ profile: await saveProfile(req.userId, req.body) });
  })
);

module.exports = router;
