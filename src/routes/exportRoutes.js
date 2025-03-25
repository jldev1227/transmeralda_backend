// routes/empresaRoutes.js
const express = require('express');
const router = express.Router();
const genericExportController = require('../controllers/genericExportController');
const { protect } = require('../middleware/auth');

/**  
 * @route   POST /api/empresas
 * @desc    Crear nueva empresa
 * @access  Privado
 */
router.post('/', genericExportController.exportToExcel.bind(genericExportController));
module.exports = router;