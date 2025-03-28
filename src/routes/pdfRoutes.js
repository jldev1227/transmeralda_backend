// routes/pdfRoutes.js
const express = require('express');
const router = express.Router();
const pdfController = require('../controllers/pdfController');
const { protect } = require('../middleware/auth'); // Asumiendo que tienes este middleware

// Ruta para generar PDFs y enviar correos
router.post('/generate', protect, pdfController.generatePDFs);

// Ruta para consultar el estado de un trabajo
router.get('/job-status/:jobId', protect, pdfController.checkJobStatus);

module.exports = router;