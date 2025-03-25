// src/routes/emailRoutes.js
const express = require('express');
const router = express.Router();
const emailController = require('../controllers/emailController');

// Ruta para envío masivo de emails con PDFs adjuntos
router.post('/send-mass-emails-desprendible', emailController.sendMassEmails);

module.exports = router;