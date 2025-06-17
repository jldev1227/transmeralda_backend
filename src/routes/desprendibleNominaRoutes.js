// routes/desprendibleNominaRoutes.js
const express = require('express');
const router = express.Router();
const desprendibleNomina = require('../controllers/desprendibleNomina');
const { protect } = require('../middleware/auth'); // Asumiendo que tienes este middleware

// Ruta para generar PDFs y enviar correos
router.post('/generate', protect, desprendibleNomina.generatePDFs);

// Ruta para consultar el estado de un trabajo
router.get('/job-status/:jobId', protect, desprendibleNomina.checkJobStatus);

module.exports = router;