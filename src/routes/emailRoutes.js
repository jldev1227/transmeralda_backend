// src/routes/emailRoutes.js
const express = require('express');
const router = express.Router();
const emailController = require('../controllers/emailController');
const { protect } = require('../middleware/auth'); // Asumiendo que tienes este middleware

// Ruta para iniciar el envío de correos (versión asíncrona con socket)
router.post('/send-mass', protect, emailController.sendMassEmails.bind(emailController));

// Ruta para consultar el estado de un trabajo
router.get('/job/:jobId', protect, emailController.getJobStatus.bind(emailController));

module.exports = router;